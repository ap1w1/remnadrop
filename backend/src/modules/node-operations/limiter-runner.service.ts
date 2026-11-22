import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Redis from 'ioredis';
import { LimiterService } from './limiter.service';
import { LimiterBridgeSecretsService } from './limiter-bridge-secrets.service';

/** Runs upstream Go Limiter 5.1.0 as a child of the existing panel process.
 * No additional container or Docker service is required.
 */
@Injectable()
export class LimiterRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger=new Logger(LimiterRunnerService.name);
  private readonly binary='/usr/local/bin/remnawave-limiter';
  private readonly socket='/var/run/valkey/valkey.sock';
  private readonly dir='/var/lib/remnawave/limiter';
  private interval?:NodeJS.Timeout;
  private initial?:NodeJS.Timeout;
  private child?:ChildProcess;
  private fingerprint='';
  private closing=false;
  private processing=false;
  private nextStartAt=0;
  constructor(private readonly limiter:LimiterService,private readonly secrets:LimiterBridgeSecretsService){}
  status():{response:{embedded:boolean;running:boolean;pid:number|null;version:string;redisDatabase:number}}{
    return {response:{embedded:true,running:!!this.child&&this.child.exitCode===null,
      pid:this.child?.pid??null,version:'5.1.0',redisDatabase:8}};
  }
  onApplicationBootstrap():void {
    if(process.env.INSTANCE_TYPE&&process.env.INSTANCE_TYPE!=='api')return;
    this.interval=setInterval(()=>void this.tick(),30000);
    this.initial=setTimeout(()=>void this.tick(),5000);
  }
  async onApplicationShutdown():Promise<void>{
    this.closing=true;
    if(this.interval)clearInterval(this.interval);
    if(this.initial)clearTimeout(this.initial);
    await this.stop();
  }
  private async stop():Promise<void>{
    const old=this.child;this.child=undefined;this.fingerprint='';
    if(!old||old.exitCode!==null)return;
    const exited=new Promise<void>(resolve=>old.once('exit',()=>resolve()));
    old.kill('SIGTERM');
    await Promise.race([exited,new Promise<void>(resolve=>setTimeout(resolve,6000))]);
    if(old.exitCode===null)old.kill('SIGKILL');
  }
  private async checkValkey(auto:boolean):Promise<void>{
    if(!existsSync(this.socket))throw new Error('Valkey Unix socket is missing in remnawave container');
    const client=new Redis({path:this.socket,db:8,lazyConnect:true,maxRetriesPerRequest:1,connectTimeout:3000,retryStrategy:()=>null});
    client.on('error',()=>{});
    try{
      await client.connect();await client.ping();
      if(auto){
        const [aof,rdb]=await Promise.all([client.config('GET','appendonly'),client.config('GET','save')]);
        const persistent=Array.isArray(aof)&&aof.includes('yes')||
          Array.isArray(rdb)&&rdb.some(x=>typeof x==='string'&&/\b\d+\s+\d+\b/.test(x));
        if(!persistent)throw new Error('Automatic blocking requires durable Valkey: enable AOF or RDB. Manual mode can run without persistence.');
      }
    }finally{client.disconnect();}
  }
  private environment(settings:Record<string,string>):NodeJS.ProcessEnv{
    // Do not inherit PostgreSQL, Cloudflare, JWT or panel secrets in the Go process.
    const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:this.dir,TMPDIR:'/tmp'};
    for(const [key,value] of Object.entries(settings)){
      if(!/^[A-Z_][A-Z0-9_]*$/.test(key)||typeof value!=='string')throw new Error('Invalid Limiter environment');
      env[key]=value;
    }
    const url='http://127.0.0.1:'+(process.env.APP_PORT||'3000')+'/api';
    env.REMNAWAVE_API_URL=url+'/limiter-bridge';
    env.REMNAWAVE_API_TOKEN=this.secrets.apiToken;
    env.WEBHOOK_URL=url+'/limiter-webhook';
    env.WEBHOOK_SECRET=this.secrets.webhookSecret;
    env.WEBHOOK_SECRET_HEADER='false';
    env.REDIS_URL='unix:///var/run/valkey/valkey.sock?db=8';
    env.LANGUAGE='ru';
    env.TIMEZONE=env.TIMEZONE||'Europe/Moscow';
    env.ASN_DATABASE_PATH=join(this.dir,'geoip','GeoLite2-ASN.mmdb');
    env.HEALTH_ADDR='';
    return env;
  }
  private async tick():Promise<void>{
    if(this.closing||this.processing)return;
    this.processing=true;
    try{
      const config=(await this.limiter.runtimeConfig()).response;
      if(!config.enabled){if(this.child)await this.stop();return;}
      if(!existsSync(this.binary))throw new Error('Embedded Limiter 5.1.0 binary is missing');
      if(Date.now()<this.nextStartAt)return;
      const env=this.environment(config.env);
      if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID||!env.TELEGRAM_ADMIN_IDS)
        throw new Error('Configure Telegram credentials in Tools > Limiter');
      const digest=createHash('sha256').update(JSON.stringify(config.env)).digest('hex');
      if(this.child&&this.child.exitCode===null&&digest===this.fingerprint){
        await this.limiter.heartbeat();return;
      }
      await this.checkValkey(config.env.ACTION_MODE==='auto');
      mkdirSync(join(this.dir,'geoip'),{recursive:true});
      if(this.child)await this.stop();
      this.logger.log('Starting embedded upstream Limiter 5.1.0');
      const child=spawn(this.binary,[],{cwd:this.dir,env,uid:10001,gid:10001,stdio:['ignore','pipe','pipe'],windowsHide:true});
      this.child=child;this.fingerprint=digest;
      child.once('error',(error)=>{
        if(this.child===child){this.fingerprint='';this.nextStartAt=Date.now()+30000;this.logger.error('Limiter child: '+error.message);}
      });
      child.once('exit',(code,signal)=>{
        if(this.child!==child||this.closing)return;
        this.logger.warn('Limiter exited: code='+code+' signal='+signal);
        this.child=undefined;this.fingerprint='';this.nextStartAt=Date.now()+30000;
      });
      child.stdout?.on('data',(chunk:Buffer)=>this.logger.debug('Limiter output received ('+chunk.length+' bytes)'));
      child.stderr?.on('data',(chunk:Buffer)=>this.logger.warn('Limiter diagnostic output received ('+chunk.length+' bytes)'));
      await this.limiter.heartbeat();
    }catch(error){
      const reason=error instanceof Error?error.message:'Unknown limiter error';
      this.logger.warn(reason);
      try{await this.limiter.heartbeat(reason)}catch{}
      if(this.child)await this.stop();
    }finally{this.processing=false;}
  }
}
