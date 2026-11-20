import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {publicIPv4,postSignedWebhook}=require('../dist/src/modules/squad-quotas/quota-webhooks.service.js');
test('reject private, loopback, link-local and reserved destinations',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','198.18.0.1','203.0.113.1','::1']) assert.equal(publicIPv4(ip),false,ip);
 assert.equal(publicIPv4('8.8.8.8'),true);
});
test('reject unsafe URL before network access',async()=>{
 for(const url of ['http://example.com','https://user:pass@example.com','https://example.com:8443']) await assert.rejects(postSignedWebhook(url,'{}','secret','id'),/HTTPS/);
});
