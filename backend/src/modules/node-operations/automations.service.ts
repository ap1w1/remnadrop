import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { postSignedWebhook } from '@modules/squad-quotas/quota-webhooks.service';
import { DpiCheckerService, DpiLocation } from './dpi-checker.service';
import { NodeIpService } from './node-ip.service';
import { CloudflareDnsService } from './cloudflare-dns.service';

type Action={type:'dpi_check';hosts:string[];location:DpiLocation}|{type:'hide_hosts';hosts:string[]}|{type:'rotate_ip';updateCloudflare?:boolean}|{type:'webhook';url:string};
type Rule={id:string;node_uuid:string;name:string;enabled:boolean;drop_percent:number;min_online:number;duration_minutes:number;cooldown_minutes:number;actions:Action[];pending_since:Date|null;last_run_at:Date|null};
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function validate(input:Partial<Rule>){
  if(!input.node_uuid||!uuid.test(input.node_uuid)||typeof input.name!=='string'||input.name.length<2||input.name.length>80)throw new BadRequestException('Node UUID and rule name are required');
  for(const [key,min,max] of [['drop_percent',1,100],['min_online',0,1000000],['duration_minutes',1,1440],['cooldown_minutes',1,10080]] as const){if(!Number.isInteger(input[key])||Number(input[key])<min||Number(input[key])>max)throw new BadRequestException(`Invalid ${key}`)}
  if(!Array.isArray(input.actions)||input.actions.length<1||input.actions.length>4)throw new BadRequestException('Select 1–4 actions');
  for(const action of input.actions){
    if(action.type==='rotate_ip'){
      if(action.updateCloudflare!==undefined&&typeof action.updateCloudflare!=='boolean')throw new BadRequestException('Invalid Cloudflare DNS option');
      continue;
    }
    if(action.type==='webhook'){if(!/^https:\/\//.test(action.url))throw new BadRequestException('Webhook must use HTTPS');continue;}
    if(!action || typeof action !== 'object')throw new BadRequestException('Invalid action');
    if(action.type==='hide_hosts'||action.type==='dpi_check'){
      if(!Array.isArray(action.hosts)||!action.hosts.length||action.hosts.length>20||action.hosts.some(x=>!uuid.test(x)))throw new BadRequestException('Invalid host selection');
      if(action.type==='dpi_check'&&!['russia','russia_mobile','china','iran','turkmenistan'].includes(action.location))throw new BadRequestException('Invalid DPI region');continue;
    }
    throw new BadRequestException('Unknown automation action');
  }
}
@Injectable()
export class AutomationsService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private busy=false;
  private readonly logger=new Logger(AutomationsService.name);
  constructor(private readonly db:PrismaService,private readonly dpi:DpiCheckerService,private readonly ips:NodeIpService,private readonly cf:CloudflareDnsService){}
  onModuleInit(){if(process.env.INSTANCE_TYPE==='scheduler'){this.timer=setInterval(()=>void this.tick(),60000);void this.tick();}}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async list(){return {response:await this.db.$queryRaw`SELECT r.*,n.name AS node_name FROM node_automation_rules r JOIN nodes n ON n.uuid=r.node_uuid ORDER BY r.created_at DESC`};}
  async executions(){return {response:await this.db.$queryRaw`SELECT e.*,r.name,r.node_uuid FROM node_automation_executions e JOIN node_automation_rules r ON r.id=e.rule_id ORDER BY e.started_at DESC LIMIT 100`};}
  async create(input:Partial<Rule>){validate(input);
    if(!await this.db.nodes.findUnique({where:{uuid:input.node_uuid}}))throw new NotFoundException('Node not found');
    await this.validateHosts(input);
    await this.db.$executeRaw`INSERT INTO node_automation_rules(node_uuid,name,enabled,drop_percent,min_online,duration_minutes,cooldown_minutes,actions) VALUES(${input.node_uuid}::uuid,${input.name},${input.enabled===true},${input.drop_percent},${input.min_online},${input.duration_minutes},${input.cooldown_minutes},${JSON.stringify(input.actions)}::jsonb)`;
    return this.list();
  }
  async update(id:string,input:Partial<Rule>){if(!uuid.test(id))throw new BadRequestException('Invalid rule ID');validate(input);
    await this.validateHosts(input);
    const changed=await this.db.$executeRaw`UPDATE node_automation_rules SET node_uuid=${input.node_uuid}::uuid,name=${input.name},enabled=${input.enabled===true},drop_percent=${input.drop_percent},min_online=${input.min_online},duration_minutes=${input.duration_minutes},cooldown_minutes=${input.cooldown_minutes},actions=${JSON.stringify(input.actions)}::jsonb,updated_at=now(),pending_since=NULL WHERE id=${id}::uuid`;
    if(!changed)throw new NotFoundException('Rule not found');return this.list();
  }
  private async validateHosts(input:Partial<Rule>){
    const ids=[...new Set((input.actions??[]).flatMap(a=>a.type==='dpi_check'||a.type==='hide_hosts'?a.hosts:[]))];
    if(!ids.length)return;
    const rows=await this.db.$queryRaw<{uuid:string}[]>`SELECT h.uuid FROM hosts h JOIN hosts_to_nodes hn ON hn.host_uuid=h.uuid WHERE hn.node_uuid=${input.node_uuid}::uuid AND h.uuid IN (${Prisma.join(ids.map(id=>Prisma.sql`${id}::uuid`))})`;
    if(new Set(rows.map(r=>r.uuid)).size!==ids.length)throw new BadRequestException('All selected hosts must belong to this node');
  }
  async remove(id:string){if(!uuid.test(id))throw new BadRequestException();await this.db.$executeRaw`DELETE FROM node_automation_rules WHERE id=${id}::uuid`;return {response:{success:true}};}
  private async onlineDropped(rule:Rule){
    const rows=await this.db.$queryRaw<{online:number|null;available:number|null;baseline:number|null}[]>`
     WITH recent AS (SELECT metrics FROM node_metric_samples WHERE node_uuid=${rule.node_uuid}::uuid AND sampled_at>now()-interval '3 minutes' ORDER BY sampled_at DESC LIMIT 1),
     baseline AS (SELECT avg((metrics->>'online')::float8) AS online FROM node_metric_samples WHERE node_uuid=${rule.node_uuid}::uuid AND sampled_at BETWEEN now()-interval '30 minutes' AND now()-interval '5 minutes')
     SELECT (SELECT (metrics->>'online')::float8 FROM recent) AS online,(SELECT (metrics->>'available')::float8 FROM recent) AS available,baseline.online AS baseline FROM baseline`;
    if(!rows.length||rows[0].available===null)return false; // stale samples never mean zero online
    const row=rows[0];
    if(row.available===0)return true; // explicit disconnected node, not a missing datapoint
    if(row.online===null||row.baseline===null||row.baseline<rule.min_online)return false;
    return 100*(1-row.online/row.baseline)>=rule.drop_percent;
  }
  private async run(rule:Rule){
    const id=randomUUID();
    await this.db.$executeRaw`INSERT INTO node_automation_executions(id,rule_id) VALUES(${id}::uuid,${rule.id}::uuid)`;
    const details:{type:string;success:boolean;message:string}[]=[];
    for(const action of rule.actions){try{
      if(action.type==='dpi_check'){const prepared=await this.dpi.prepare({hosts:action.hosts,location:action.location});await this.dpi.start(prepared.response.id,Math.max(0,Number(process.env.DPICHECKER_AUTOMATION_MAX_COST_USD??'1')));details.push({type:action.type,success:true,message:`DPI check ${prepared.response.id} started`});}
      else if(action.type==='rotate_ip'){
        const result=await this.ips.rotateNext(rule.node_uuid,'automation');
        const rotated=result.response as {previousIp?:string;newIp?:string;success:boolean};
        if(action.updateCloudflare&&rotated.previousIp&&rotated.newIp){
          // DNS errors are recorded as partial failures; host IP rotation is not rolled back.
          const dns=await this.cf.syncAfterRotation(rule.node_uuid,rotated.previousIp,rotated.newIp);
          details.push({type:'cloudflare_dns',success:true,message:JSON.stringify(dns)});
        }
        details.push({type:action.type,success:true,message:JSON.stringify(result.response)});
      }
      else if(action.type==='hide_hosts'){
        // Shared hosts cannot be hidden from just one node. Skip them instead of affecting other nodes.
        // Do not hide shared hosts or hosts not belonging to this rule's node.
        const affected=await this.db.$executeRaw(Prisma.sql`
          UPDATE hosts h SET is_hidden=true,updated_at=now()
          WHERE h.uuid IN (${Prisma.join(action.hosts.map(id=>Prisma.sql`${id}::uuid`))})
            AND EXISTS (SELECT 1 FROM hosts_to_nodes hn WHERE hn.host_uuid=h.uuid AND hn.node_uuid=${rule.node_uuid}::uuid)
            AND (SELECT count(*) FROM hosts_to_nodes hn WHERE hn.host_uuid=h.uuid)=1`);
        if(affected!==action.hosts.length)throw new Error(`Only ${affected} of ${action.hosts.length} hosts could be hidden; shared or foreign hosts are skipped`);
        details.push({type:action.type,success:true,message:`${affected} host(s) hidden`});
      }
      else if(action.type==='webhook'){
        const secret=process.env.AUTOMATIONS_WEBHOOK_SECRET;
        if(!secret||secret.length<32)throw new Error('Configure AUTOMATIONS_WEBHOOK_SECRET (32+ characters)');
        await postSignedWebhook(action.url,JSON.stringify({event:'NODE_AUTOMATION_TRIGGERED',nodeUuid:rule.node_uuid,ruleId:rule.id,executionId:id}),secret,id);
        details.push({type:action.type,success:true,message:'Webhook delivered'});
      }
    }catch(error){details.push({type:action.type,success:false,message:String(error)});}}
    await this.db.$executeRaw`UPDATE node_automation_executions SET status=${details.every(d=>d.success)?'completed':'partial_failure'},finished_at=now(),details=${JSON.stringify(details)}::jsonb WHERE id=${id}::uuid`;
  }
  async tick(){if(this.busy)return;this.busy=true;try{
    const rules=await this.db.$queryRaw<Rule[]>`SELECT * FROM node_automation_rules WHERE enabled ORDER BY updated_at LIMIT 200`;
    for(const rule of rules){try{
      const dropped=await this.onlineDropped(rule);
      if(!dropped){if(rule.pending_since)await this.db.$executeRaw`UPDATE node_automation_rules SET pending_since=NULL WHERE id=${rule.id}::uuid`;continue;}
      if(!rule.pending_since){await this.db.$executeRaw`UPDATE node_automation_rules SET pending_since=now() WHERE id=${rule.id}::uuid AND pending_since IS NULL`;continue;}
      if(Date.now()-new Date(rule.pending_since).getTime()<rule.duration_minutes*60000)continue;
      if(rule.last_run_at&&Date.now()-new Date(rule.last_run_at).getTime()<rule.cooldown_minutes*60000)continue;
      const updated=await this.db.$executeRaw`UPDATE node_automation_rules SET last_run_at=now(),pending_since=now() WHERE id=${rule.id}::uuid AND enabled AND (last_run_at IS NULL OR last_run_at<now()-${rule.cooldown_minutes}::int*interval '1 minute')`;
      if(updated)await this.run(rule);
    }catch(error){this.logger.warn(`Rule ${rule.id}: ${String(error)}`);}}
    const periodic=await this.db.$queryRaw<{node_uuid:string}[]>`SELECT node_uuid FROM node_ip_pool WHERE is_active AND rotation_minutes IS NOT NULL AND (rotated_at IS NULL OR rotated_at < now()-rotation_minutes*interval '1 minute') LIMIT 30`;
    for(const row of periodic)try{await this.ips.rotateNext(row.node_uuid,'periodic')}catch(error){this.logger.warn(`Periodic IP rotation ${row.node_uuid}: ${String(error)}`);}
  }catch(error){this.logger.warn(String(error));}finally{this.busy=false;}}
}
