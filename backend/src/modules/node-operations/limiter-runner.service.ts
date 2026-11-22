import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Redis, { type RedisOptions } from 'ioredis';
import { LimiterService } from './limiter.service';
import { LimiterBridgeSecretsService } from './limiter-bridge-secrets.service';
import { LimiterControlService } from './limiter-control.service';

/** Runs upstream Go Limiter 5.1.0 as a child of the existing panel process.
 * No additional container or Docker service is required.
 */
@Injectable()
export class LimiterRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger=new Logger(LimiterRunnerService.name);
  private readonly binary='/usr/local/bin/remnawave-limiter';
  private readonly dir='/var/lib/remnawave/limiter';
  private interval?:NodeJS.Timeout;
  private initial?:NodeJS.Timeout;
  private child?:ChildProcess;
  private fingerprint='';
  private closing=false;
  private processing=false;
  private nextStartAt=0;
  private ready=false;
  private restoring=false;
  private lastCheck:string|null=null;
  constructor(private readonly limiter:LimiterService,private readonly secrets:LimiterBridgeSecretsService,private readonly control:LimiterControlService){}
  status(){
    return {response:{embedded:true,running:this.isRunning(),
      ready:this.ready,restoring:this.restoring,lastCheck:this.lastCheck,pid:this.child?.pid??null,version:'5.1.0',redisDatabase:8}};
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
    await this.limiter.withRuntimeChange(async()=>{
      if(this.isRunning()){
        // The first bounded pause closes admission even if its drain times out.
        // Retry once so an already-started API call plus its independent Redis
        // timer write can finish before SIGTERM cancels the Go main context.
        for(let attempt=0;attempt<2;attempt++){
          try{await this.control.pause();break;}
          catch{this.logger.warn('Limiter shutdown drain failed (attempt '+(attempt+1)+')');}
        }
      }
      await this.stop(15000);
    });
  }
  private isRunning(child=this.child):boolean{
    return !!child?.pid&&child.exitCode===null&&child.signalCode===null;
  }
  private async stop(graceMs=6000):Promise<void>{
    const old=this.child;this.child=undefined;this.fingerprint='';this.ready=false;this.restoring=false;
    if(!old||!this.isRunning(old)){this.control.setProcessExpected(false);return;}
    const exited=new Promise<void>(resolve=>old.once('exit',()=>resolve()));
    old.kill('SIGTERM');
    let deadline:NodeJS.Timeout|undefined;
    await Promise.race([exited,new Promise<void>(resolve=>{deadline=setTimeout(resolve,graceMs);})]);
    if(deadline)clearTimeout(deadline);
    if(this.isRunning(old))old.kill('SIGKILL');
    this.control.setProcessExpected(false);
  }
  private redisConnection():{url:string;options:RedisOptions}{
    // Reuse the panel's existing Redis transport and credentials, but isolate
    // Limiter state in DB 8. Development and older installations may use TCP.
    const password=process.env.REDIS_PASSWORD||undefined;
    if(process.env.REDIS_SOCKET){
      const path=resolve(process.env.REDIS_SOCKET);
      const auth=password?':'+encodeURIComponent(password)+'@':'';
      const encodedPath=path.split('/').map(encodeURIComponent).join('/');
      return {url:'unix://'+auth+encodedPath+'?db=8',options:{path,password,db:8}};
    }
    const host=process.env.REDIS_HOST||'';
    const port=Number(process.env.REDIS_PORT);
    if(!host||!Number.isInteger(port)||port<1||port>65535)
      throw new Error('Configure REDIS_SOCKET or REDIS_HOST and REDIS_PORT for the panel');
    const urlHost=host.includes(':')&&!host.startsWith('[')?'['+host+']':host;
    const url=new URL('redis://'+urlHost+':'+port+'/8');
    if(password)url.password=password;
    return {url:url.toString(),options:{host:host.replace(/^\[|\]$/g,''),port,password,db:8}};
  }
  private async checkValkey(auto:boolean,options:RedisOptions):Promise<void>{
    if(options.path&&!existsSync(options.path))throw new Error('Configured Valkey Unix socket is missing in remnawave container');
    const client=new Redis({...options,lazyConnect:true,maxRetriesPerRequest:1,connectTimeout:3000,retryStrategy:()=>null});
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
  private environment(settings:Record<string,string>,redisUrl:string):NodeJS.ProcessEnv{
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
    env.REMNADROP_PANEL_CONTROL_SOCKET=this.control.socketPath;
    env.REMNADROP_PANEL_CONTROL_TOKEN=this.secrets.controlToken;
    env.REDIS_URL=redisUrl;
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
      let restoreOnly=false;
      if(!config.enabled){
        // Close all disable admission, drain ongoing timer writes, then inspect
        // the actual queue. Never kill a running engine on a failed stop probe.
        try{
          const paused=await this.limiter.pauseForStop(this.isRunning(),()=>this.stop());
          if(paused===null)return; // Re-enabled while this tick was awaiting I/O.
          if(paused.pendingRestores===0)return;
          restoreOnly=true;this.restoring=true;this.ready=false;
        }catch{
          await this.limiter.heartbeat('Не удалось безопасно остановить Limiter: очередь восстановления недоступна');
          return;
        }
      }
      if(!existsSync(this.binary))throw new Error('Embedded Limiter 5.1.0 binary is missing');
      if(Date.now()<this.nextStartAt)return;
      const redis=this.redisConnection();
      const env=this.environment(config.env,redis.url);
      if(env.TELEGRAM_BOT_TOKEN&&(!env.TELEGRAM_CHAT_ID||!env.TELEGRAM_ADMIN_IDS)){
        throw new Error('Укажите Chat ID и Admin IDs для Telegram или отключите Telegram-уведомления');
      }
      const digest=createHash('sha256').update(JSON.stringify(config.env)).digest('hex');
      if(this.isRunning()&&digest===this.fingerprint){
        let health=await this.control.health();
        if(health?.pauseReason&&config.enabled)health=await this.limiter.activateStartup();
        this.ready=Boolean(health?.ready);this.lastCheck=health?.lastCheck??null;
        this.restoring=restoreOnly;
        await this.limiter.heartbeat(this.ready||restoreOnly?undefined:'Limiter запускается или не отвечает',this.lastCheck);return;
      }
      await this.checkValkey(config.enabled&&(config.mode??config.env.ACTION_MODE)==='auto',redis.options);
      mkdirSync(join(this.dir,'geoip'),{recursive:true});
      const started=await this.limiter.withRuntimeChange(async()=>{
      if(this.child){
        // Credential/notification changes also replace the process. Drain
        // account mutations first; existing restore jobs survive this restart.
        if(this.isRunning()){
          try{await this.control.pause();}
          catch{
            await this.limiter.heartbeat('Не удалось безопасно перезапустить Limiter; предыдущая проверка продолжает работать');
            return false;
          }
        }
        await this.stop();
      }
      if(this.closing)return false;
      this.logger.log('Starting embedded upstream Limiter 5.1.0');
      this.control.setProcessExpected(true);
      const child=spawn(this.binary,[],{cwd:this.dir,env,uid:10001,gid:10001,stdio:['ignore','pipe','pipe'],windowsHide:true});
      this.child=child;this.fingerprint=digest;
      child.once('error',(error)=>{
        if(this.child===child){this.child=undefined;this.fingerprint='';this.ready=false;this.control.setProcessExpected(false);this.nextStartAt=Date.now()+30000;this.logger.error('Limiter child: '+error.message);}
      });
      child.once('exit',(code,signal)=>{
        if(this.child!==child||this.closing)return;
        this.logger.warn('Limiter exited: code='+code+' signal='+signal);
        this.child=undefined;this.fingerprint='';this.ready=false;this.control.setProcessExpected(false);this.nextStartAt=Date.now()+30000;
        void this.limiter.heartbeat('Limiter exited: code='+code+' signal='+signal).catch(()=>{});
      });
      child.stdout?.on('data',(chunk:Buffer)=>this.logger.debug('Limiter output received ('+chunk.length+' bytes)'));
      child.stderr?.on('data',(chunk:Buffer)=>this.logger.warn('Limiter diagnostic output received ('+chunk.length+' bytes)'));
      await new Promise<void>((started,failed)=>{child.once('spawn',started);child.once('error',failed);});
      if(this.closing){await this.stop();return false;}
      return true;
      });
      if(!started)return;
      let health=await this.control.health();
      if(health?.pauseReason&&config.enabled)health=await this.limiter.activateStartup();
      this.ready=Boolean(health?.ready);this.lastCheck=health?.lastCheck??null;
      this.restoring=restoreOnly;
      await this.limiter.heartbeat(undefined,this.lastCheck);
    }catch(error){
      const reason=error instanceof Error?error.message:'Unknown limiter error';
      this.logger.warn(reason);
      try{await this.limiter.heartbeat(reason)}catch{}
      // A failed preflight must not kill a healthy old child and its restoration
      // loop. Dead/spawn-failed processes are cleaned up by their exit handlers.
      if(!this.isRunning())this.control.setProcessExpected(false);
    }finally{this.processing=false;}
  }
}
