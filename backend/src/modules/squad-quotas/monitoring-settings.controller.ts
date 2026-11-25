import { BadRequestException, Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { Roles } from '@common/decorators/roles/roles';
import { JwtDefaultGuard } from '@common/guards/jwt-guards/def-jwt-guard';
import { RolesGuard } from '@common/guards/roles';
import { ROLE } from '@libs/contracts/constants';
import { defaultMonitoringRule, validateMonitoringRule } from './monitoring-rules';

@Controller('monitoring')
@Roles(ROLE.ADMIN)
@UseGuards(JwtDefaultGuard, RolesGuard)
export class MonitoringSettingsController {
    constructor(private readonly db:PrismaService){}
    @Get('retention') async retention(){
        const rows=await this.db.$queryRaw<{retention_days:number}[]>`SELECT retention_days FROM monitoring_preferences WHERE id=1`;
        return {response:{days:rows[0]?.retention_days??90}};
    }
    @Put('retention') async updateRetention(@Body() body:{days?:unknown}){
        if(typeof body?.days!=='number'||!Number.isInteger(body.days)||body.days<1||body.days>365)
            throw new BadRequestException('Retention must be an integer from 1 to 365 days');
        await this.db.$executeRaw`INSERT INTO monitoring_preferences(id,retention_days) VALUES(1,${body.days}) ON CONFLICT(id) DO UPDATE SET retention_days=EXCLUDED.retention_days`;
        return {response:{days:body.days}};
    }
    @Get('settings') async list(){return {response:{defaults:defaultMonitoringRule,rules:await this.db.$queryRaw`SELECT scope,settings FROM monitoring_rules ORDER BY scope`}};}
    private async check(scope:string){
        if(scope==='global')return;
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope)||!await this.db.nodes.findUnique({where:{uuid:scope}}))throw new BadRequestException('Unknown node');
    }
    @Put('settings/:scope') async save(@Param('scope') scope:string,@Body() body:unknown){
        await this.check(scope);
        let rule;try{rule=validateMonitoringRule(body);}catch(e){throw new BadRequestException(String(e));}
        await this.db.$executeRaw`INSERT INTO monitoring_rules(scope,settings) VALUES(${scope},${JSON.stringify(rule)}::jsonb) ON CONFLICT(scope) DO UPDATE SET settings=excluded.settings,updated_at=now()`;
        return {response:{success:true}};
    }
    @Delete('settings/:scope') async reset(@Param('scope') scope:string){await this.check(scope);await this.db.$executeRaw`DELETE FROM monitoring_rules WHERE scope=${scope}`;return {response:{success:true}};}
    @Get('alerts') async alerts(){return {response:await this.db.$queryRaw`SELECT e.id,e.node_uuid,n.name,e.metric,e.active,e.value,e.threshold,e.created_at,e.delivered_at FROM node_metric_alert_events e LEFT JOIN nodes n ON n.uuid=e.node_uuid ORDER BY e.created_at DESC LIMIT 100`};}
}
