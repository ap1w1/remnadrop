import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type LimiterSecrets={
 telegramBotToken:string;telegramChatId:string;telegramThreadId:string;telegramAdminIds:string;
 maxmindLicenseKey:string;sharedHwidSquadUuids:string[];
};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
@Injectable()
export class LimiterCredentialsService {
 constructor(private readonly db:PrismaService){}
 private key(){
   const secret=process.env.REMNADROP_LIMITER_ENCRYPTION_KEY??process.env.APP_SECRET??process.env.JWT_AUTH_SECRET;
   if(!secret||secret.length<32||secret==='change_me')
     throw new ServiceUnavailableException('Set a stable REMNADROP_LIMITER_ENCRYPTION_KEY');
   return createHash('sha256').update('remnadrop-limiter-credentials-v1\0').update(secret).digest();
 }
 async status(){
   const rows=await this.db.$queryRaw<{updated_at:Date}[]>`SELECT updated_at FROM limiter_credentials WHERE id=1`;
   const value=rows.length?await this.get():{};
   return {response:{configured:rows.length>0,telegramConfigured:Boolean(value.telegramBotToken),
     maxmindConfigured:Boolean(value.maxmindLicenseKey),telegramChatId:value.telegramChatId??'',telegramThreadId:value.telegramThreadId??'',
     telegramAdminIds:value.telegramAdminIds??'',sharedHwidSquadUuids:value.sharedHwidSquadUuids??[],
     source:rows.length?'stored':'none',updatedAt:rows[0]?.updated_at??null}};
 }
 async get():Promise<Partial<LimiterSecrets>>{
   const rows=await this.db.$queryRaw<{iv:Uint8Array;tag:Uint8Array;ciphertext:Uint8Array}[]>`
     SELECT iv,tag,ciphertext FROM limiter_credentials WHERE id=1`;
   if(!rows.length)return {};
   try{
     const decipher=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(rows[0].iv));
     decipher.setAuthTag(Buffer.from(rows[0].tag));
     const raw=Buffer.concat([decipher.update(Buffer.from(rows[0].ciphertext)),decipher.final()]);
     return JSON.parse(raw.toString('utf8')) as LimiterSecrets;
   }catch{throw new ServiceUnavailableException('Limiter credentials cannot be decrypted; check encryption key');}
 }
 async save(input:unknown){
   if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Invalid credentials');
   const data=input as Partial<LimiterSecrets>;
   const saved=await this.get();
   for(const key of ['telegramBotToken','telegramChatId','telegramThreadId','telegramAdminIds','maxmindLicenseKey'] as const)
     if(data[key]!==undefined&&typeof data[key]!=='string')throw new BadRequestException('Invalid credential value');
   const telegramBotToken=data.telegramBotToken?.trim()||saved.telegramBotToken||'';
   const telegramChatId=data.telegramChatId?.trim()||saved.telegramChatId||'';
   const telegramThreadId=data.telegramThreadId===undefined?(saved.telegramThreadId??''):data.telegramThreadId.trim();
   const telegramAdminIds=(data.telegramAdminIds?.trim()||saved.telegramAdminIds||'').replace(/\s/g,'');
   const maxmindLicenseKey=data.maxmindLicenseKey?.trim()||saved.maxmindLicenseKey||'';
   const sharedHwidSquadUuids=data.sharedHwidSquadUuids??saved.sharedHwidSquadUuids??[];
   if((telegramBotToken||telegramChatId||telegramThreadId||telegramAdminIds)&&
      (!/^[0-9]{5,15}:[A-Za-z0-9_-]{20,200}$/.test(telegramBotToken)||!/^[-]?[0-9]{1,20}$/.test(telegramChatId)||
      !/^[0-9]{1,20}(,[0-9]{1,20})*$/.test(telegramAdminIds))||
      maxmindLicenseKey.length>200||telegramAdminIds.length>4096||
      (telegramThreadId!==''&&(!/^[1-9][0-9]{0,18}$/.test(telegramThreadId)||BigInt(telegramThreadId)>9223372036854775807n))||
      !Array.isArray(sharedHwidSquadUuids)||sharedHwidSquadUuids.length>200||sharedHwidSquadUuids.some(x=>typeof x!=='string'||!uuid.test(x)))
      throw new BadRequestException('Invalid Telegram/MaxMind configuration');
   const value:LimiterSecrets={telegramBotToken,telegramChatId,telegramThreadId,telegramAdminIds:telegramAdminIds.replace(/\s/g,''),
     maxmindLicenseKey,sharedHwidSquadUuids};
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(),iv);
   const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
   const tag=cipher.getAuthTag();
   await this.db.$executeRaw`INSERT INTO limiter_credentials(id,iv,tag,ciphertext) VALUES(1,${iv},${tag},${ciphertext})
      ON CONFLICT(id) DO UPDATE SET iv=EXCLUDED.iv,tag=EXCLUDED.tag,ciphertext=EXCLUDED.ciphertext,updated_at=now()`;
   return this.status();
 }
 async remove(){
   await this.db.$executeRaw`DELETE FROM limiter_credentials WHERE id=1`;
   return this.status();
 }
}
