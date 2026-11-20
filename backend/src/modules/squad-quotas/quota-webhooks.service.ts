import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createHmac } from 'node:crypto';

export function publicIPv4(address: string): boolean {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a,b,c] = parts;
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
        (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===88 && c===99))) ||
        (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
}

export async function postSignedWebhook(destination: string, body: string, secret: string, id: string) {
    const url = new URL(destination);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('HTTPS port 443 without credentials required');
    const addresses = await lookup(url.hostname, { family: 4, all: true });
    if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new Error('Webhook destination must resolve to public IPv4 addresses');
    const timestamp = Math.floor(Date.now()/1000).toString();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    // Connect to the validated address while preserving TLS hostname verification.
    await new Promise<void>((resolve,reject) => {
        const req = request({ hostname: addresses[0].address, servername: url.hostname, port:443, path:url.pathname+url.search, method:'POST', headers:{
            Host:url.host, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body),
            'X-Webhook-Event-Id':id, 'X-Webhook-Timestamp':timestamp, 'X-Webhook-Signature':`sha256=${signature}`,
        } }, res => { res.resume(); if (res.statusCode && res.statusCode>=200 && res.statusCode<300) resolve(); else reject(new Error(`Webhook HTTP ${res.statusCode}`)); });
        const timer = setTimeout(()=>req.destroy(new Error('Webhook timeout')),10000);
        req.on('close',()=>clearTimeout(timer)); req.on('error',reject); req.end(body);
    });
}

@Injectable()
export class QuotaWebhooksService {
    constructor(private readonly db: PrismaService) {}
    async deliver() {
        const secret=process.env.QUOTA_WEBHOOK_SECRET;
        if (!secret || secret.length<32) return;
        for (const event of ['LOCATION_TRAFFIC_THRESHOLD','LOCATION_TRAFFIC_EXHAUSTED','LOCATION_TRAFFIC_RESET']) {
            const url=process.env[`QUOTA_WEBHOOK_${event}_URL`];
            if (!url) continue;
            const rows=await this.db.$queryRaw<{id:string;user_uuid:string;node_uuid:string;event:string;used_bytes:bigint;limit_bytes:bigint|null;attempts:number;created_at:Date}[]>`
                UPDATE node_quota_events SET lease_until=now()+interval '60 seconds',attempts=attempts+1
                WHERE id IN (SELECT id FROM node_quota_events WHERE event=${event} AND delivered_at IS NULL AND attempts<20 AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`;
            for (const row of rows) {
                try {
                    const remaining=row.limit_bytes===null?null:row.limit_bytes>row.used_bytes?row.limit_bytes-row.used_bytes:0n;
                    const body=JSON.stringify({id:row.id,event:row.event,occurredAt:row.created_at,data:{user:{uuid:row.user_uuid},location:{uuid:row.node_uuid,nodeUuids:[row.node_uuid]},traffic:{usedBytes:row.used_bytes.toString(),limitBytes:row.limit_bytes?.toString()??null,remainingBytes:remaining?.toString()??null}}});
                    await postSignedWebhook(url,body,secret,row.id);
                    await this.db.$executeRaw`UPDATE node_quota_events SET delivered_at=now(),lease_until=NULL WHERE id=${row.id}::uuid`;
                } catch {
                    const seconds=Math.min(3600,2**Math.min(row.attempts,12));
                    await this.db.$executeRaw`UPDATE node_quota_events SET lease_until=NULL,next_attempt_at=now()+${seconds}::int*interval '1 second' WHERE id=${row.id}::uuid`;
                }
            }
        }
    }
}
