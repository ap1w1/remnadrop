import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { request } from 'node:http';
import { resolve } from 'node:path';
import Redis, { type RedisOptions } from 'ioredis';
import { LimiterBridgeSecretsService } from './limiter-bridge-secrets.service';

export type LimiterUserState = { ignored:boolean; permanentIgnore:boolean; ignoredUntil:string|null; restoreAt:string|null };

/** The control socket is private to the panel user; it is never an exposed TCP listener. */
@Injectable()
export class LimiterControlService {
  readonly socketPath = '/var/lib/remnawave/limiter/control.sock';
  constructor(private readonly secrets:LimiterBridgeSecretsService) {}

  async call<T>(method:string,path:string,body?:unknown):Promise<T> {
    const payload=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    if(payload&&payload.length>65536)throw new BadRequestException('Слишком большой запрос Limiter');
    return new Promise<T>((accept,reject)=>{
      const req=request({socketPath:this.socketPath,path,method,headers:{
        Authorization:'Bearer '+this.secrets.controlToken,'Content-Type':'application/json',
        ...(payload?{'Content-Length':String(payload.length)}:{}),
      }},res=>{
        const chunks:Buffer[]=[];let size=0;
        res.on('data',(chunk:Buffer)=>{
          size+=chunk.length;
          if(size>4*1024*1024){res.destroy();reject(new ServiceUnavailableException('Ответ Limiter слишком большой'));return;}
          chunks.push(chunk);
        });
        res.on('error',()=>reject(new ServiceUnavailableException('Не удалось получить ответ Limiter')));
        res.on('end',()=>{
          let data:{response:T;message?:string};
          try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof data;}
          catch{reject(new ServiceUnavailableException('Некорректный ответ Limiter'));return;}
          if((res.statusCode??500)>=400){
            const message=typeof data.message==='string'?data.message.slice(0,500):'Не удалось выполнить действие Limiter';
            reject((res.statusCode??500)<500?new BadRequestException(message):new ServiceUnavailableException(message));
          }else accept(data.response);
        });
      });
      req.setTimeout(30000,()=>req.destroy(new Error('Limiter timeout')));
      req.on('error',()=>reject(new ServiceUnavailableException('Limiter недоступен. Включите его в настройках и дождитесь запуска.')));
      req.end(payload);
    });
  }

  async health():Promise<{ready:boolean;lastCheck:string}|null> {
    try{return await this.call('GET','/health');}catch{return null;}
  }

  private options():RedisOptions {
    const password=process.env.REDIS_PASSWORD||undefined;
    if(process.env.REDIS_SOCKET)return {path:resolve(process.env.REDIS_SOCKET),password,db:8};
    const port=Number(process.env.REDIS_PORT),host=process.env.REDIS_HOST;
    if(!host||!Number.isInteger(port)||port<1||port>65535)throw new ServiceUnavailableException('Хранилище Limiter не настроено');
    return {host:host.replace(/^\[|\]$/g,''),port,password,db:8};
  }
  private async redis<T>(fn:(client:Redis)=>Promise<T>):Promise<T> {
    const client=new Redis({...this.options(),lazyConnect:true,maxRetriesPerRequest:1,connectTimeout:3000,retryStrategy:()=>null});
    client.on('error',()=>{});
    try{await client.connect();return await fn(client);}
    catch(error){if(error instanceof BadRequestException)throw error;throw new ServiceUnavailableException('Хранилище Limiter недоступно');}
    finally{client.disconnect();}
  }

  // Read the same overrides as /settings in Telegram, including while the engine is stopped.
  overrides():Promise<Record<string,string>> { return this.redis(client=>client.hgetall('config:overrides')); }
  pendingRestores():Promise<number> { return this.redis(client=>client.zcard('restore:queue')); }
  // Import old PostgreSQL exclusions once. Subsequent changes belong to the shared Redis set.
  importLegacyIgnoredUsers(ids:string[]):Promise<unknown> {
    return this.redis(client=>client.eval(`
      if redis.call('EXISTS',KEYS[1])==0 then
        for _,id in ipairs(ARGV) do redis.call('SADD',KEYS[2],id) end
        redis.call('SET',KEYS[1],'1')
      end
      return 1`,2,'panel:legacy-whitelist-imported','whitelist',...ids));
  }
  importLegacySettings(values:Record<string,string>):Promise<unknown> {
    return this.redis(client=>client.eval(`
      if redis.call('EXISTS',KEYS[1])==0 then
        for i=1,#ARGV,2 do redis.call('HSETNX',KEYS[2],ARGV[i],ARGV[i+1]) end
        redis.call('SET',KEYS[1],'1')
      end
      return 1`,2,'panel:settings-base-v1','config:overrides',...Object.entries(values).flat()));
  }
  async applySettings(values:Record<string,string>):Promise<void> {
    if(await this.health()){await this.call('PUT','/settings',values);return;}
    await this.redis(async client=>{
      if(values.ACTION_MODE==='auto'){
        const [aof,rdb]=await Promise.all([client.config('GET','appendonly'),client.config('GET','save')]);
        if(!(Array.isArray(aof)&&aof.includes('yes')||Array.isArray(rdb)&&rdb.some(v=>typeof v==='string'&&/\d+\s+\d+/.test(v))))
          throw new BadRequestException('Автоблокировка требует сохраняемого хранилища Limiter (AOF или RDB)');
      }
      // The engine validates the entire resulting config again on startup.
      const result=await client.multi().del('config:overrides').hset('config:overrides',values).exec();
      if(!result||result.some(([error])=>error))throw new Error('Settings transaction failed');
    });
  }
  async states(ids:string[]):Promise<Record<string,LimiterUserState>> {
    const unique=[...new Set(ids)].slice(0,250);
    if(unique.some(id=>!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))))throw new BadRequestException('Некорректный ID пользователя');
    return this.redis(async client=>{
      const result:Record<string,LimiterUserState>={};
      if(!unique.length)return result;
      const pipe=client.pipeline();
      for(const id of unique){pipe.sismember('whitelist',id);pipe.ttl('whitelist:temp:'+id);pipe.zscore('restore:queue',id);}
      const rows=await pipe.exec();
      if(!rows||rows.some(([error])=>error))throw new Error('State lookup failed');
      for(let i=0;i<unique.length;i++){
        const permanent=Number(rows[i*3][1])===1,ttl=Number(rows[i*3+1][1]),restore=rows[i*3+2][1];
        result[unique[i]]={ignored:permanent||ttl>0,permanentIgnore:permanent,
          ignoredUntil:ttl>0?new Date(Date.now()+ttl*1000).toISOString():null,
          restoreAt:restore!==null?new Date(Number(restore)*1000).toISOString():null};
      }
      return result;
    });
  }
  async ignoredIds():Promise<string[]> {
    return this.redis(async client=>{
      const ids=new Set(await client.smembers('whitelist'));let cursor='0';
      do{
        const [next,keys]=await client.scan(cursor,'MATCH','whitelist:temp:*','COUNT',200);
        for(const key of keys)ids.add(key.slice('whitelist:temp:'.length));
        cursor=next;
      }while(cursor!=='0'&&ids.size<1000);
      return [...ids].filter(id=>/^\d+$/.test(id)&&Number.isSafeInteger(Number(id))).slice(0,1000);
    });
  }
}
