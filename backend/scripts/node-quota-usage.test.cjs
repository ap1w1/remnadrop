const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { SquadQuotasService } = require('../dist/src/modules/squad-quotas/squad-quotas.service');

const userUuid = '11111111-1111-4111-8111-111111111111';
const nodeUuid = '22222222-2222-4222-8222-222222222222';
const secondNodeUuid = '33333333-3333-4333-8333-333333333333';
const thirdNodeUuid = '44444444-4444-4444-8444-444444444444';
const sql = (strings, values) => strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), '');
const bigintFields=new Set(['used_bytes','limit_bytes']);
const raw=async(connection,first,values)=>{
    const prepared=!Array.isArray(first)&&typeof first==='object'&&'text' in first;
    const query=prepared?first.text:sql(first,values);
    const args=prepared?first.values:values;
    const result=await connection.query(query,args.map(value=>typeof value==='bigint'?String(value):value));
    return {...result,rows:result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,bigintFields.has(key)&&value!==null?BigInt(value):value])))};
};

function adapter(connection) {
    return {
        $queryRaw: async (strings, ...values) => (await raw(connection,strings,values)).rows,
        $executeRaw: async (strings, ...values) => (await raw(connection,strings,values)).affectedRows,
        $transaction: callback => connection.transaction(tx => callback(adapter(tx))),
        users: { findUnique: async ({ where }) => (await connection.query(
            where.tId !== undefined ? 'SELECT uuid,t_id AS "tId" FROM users WHERE t_id=$1' : 'SELECT uuid,t_id AS "tId" FROM users WHERE uuid=$1',
            [String(where.tId ?? where.uuid)],
        )).rows[0] ?? null },
        nodes: { findUnique: async ({ where }) => (await connection.query('SELECT uuid,name FROM nodes WHERE uuid=$1',[where.uuid])).rows[0] ?? null },
    };
}

test('node quota counts usage in bytes and deduplicates a repeated job', async () => {
    const pg = new PGlite();
    try {
        await pg.exec(`
            CREATE TABLE users(uuid uuid PRIMARY KEY,t_id bigint UNIQUE NOT NULL);
            CREATE TABLE nodes(uuid uuid PRIMARY KEY,name text NOT NULL);
            CREATE TABLE quota_usage_receipts(event_id text PRIMARY KEY);
            CREATE TABLE user_node_quota_preferences(user_uuid uuid PRIMARY KEY,period_days integer,reset_at timestamptz,threshold_percent integer NOT NULL DEFAULT 80,updated_at timestamptz DEFAULT now());
            CREATE TABLE user_node_quotas(
                user_uuid uuid NOT NULL,node_uuid uuid NOT NULL,group_uuid uuid,limit_bytes bigint,
                used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,
                period_days integer,reset_at timestamptz,updated_at timestamptz DEFAULT now(),
                threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,
                PRIMARY KEY(user_uuid,node_uuid)
            );
            CREATE TABLE user_node_quota_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid NOT NULL,name text NOT NULL,limit_bytes bigint NOT NULL,used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,period_days integer,reset_at timestamptz,updated_at timestamptz DEFAULT now());
            CREATE TABLE node_quota_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid,node_uuid uuid,group_uuid uuid,group_name text,node_uuids uuid[] NOT NULL DEFAULT '{}',event text,used_bytes bigint,limit_bytes bigint);
            CREATE TABLE quota_sync(user_uuid uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz DEFAULT now());
        `);
        await pg.query('INSERT INTO users(uuid,t_id) VALUES($1,123)', [userUuid]);
        await pg.query('INSERT INTO nodes(uuid,name) VALUES($1,$2)', [nodeUuid,'First node']);
        const service = new SquadQuotasService(adapter(pg));
        const usage = [{ u:'123', b:'4424990', n:nodeUuid }];
        await service.record('usage-one', usage);
        await service.configure(userUuid,nodeUuid,'10737418240',null,80);
        assert.deepEqual((await service.listGroups(userUuid))[0].node_uuids,[nodeUuid]);
        assert.equal((await service.list(userUuid))[0].limit_bytes,null);
        await service.record('usage-one', usage);
        await service.record('usage-two', [{ u:'123', b:'1048576', n:nodeUuid }]);
        const rows = await pg.query('SELECT used_bytes,blocked FROM user_node_quotas WHERE user_uuid=$1 AND node_uuid=$2', [userUuid,nodeUuid]);
        assert.equal(BigInt(rows.rows[0].used_bytes),5473566n);
        assert.equal(rows.rows[0].blocked,false);
    } finally {
        await pg.close();
    }
});

test('migration turns an existing node limit into a one-node group without losing usage or reset date', async () => {
    const pg=new PGlite();
    try {
        await pg.exec(`
            CREATE TABLE nodes(uuid uuid PRIMARY KEY,name text NOT NULL);
            CREATE TABLE user_node_quotas(user_uuid uuid NOT NULL,node_uuid uuid NOT NULL,group_uuid uuid,limit_bytes bigint,used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,period_days integer,reset_at timestamptz,threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_uuid,node_uuid));
            CREATE TABLE user_node_quota_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid NOT NULL,name varchar(80) NOT NULL,limit_bytes bigint NOT NULL,used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,updated_at timestamptz DEFAULT now(),UNIQUE(user_uuid,name));
        `);
        await pg.query('INSERT INTO nodes(uuid,name) VALUES($1,$2)',[nodeUuid,'First node']);
        await pg.query("INSERT INTO user_node_quotas(user_uuid,node_uuid,limit_bytes,used_bytes,period_days,reset_at) VALUES($1,$2,100,60,30,'2026-12-25T00:00:00Z')",[userUuid,nodeUuid]);
        await pg.exec(readFileSync(join(__dirname,'../prisma/migrations/20261124140000_group_only_node_quotas/migration.sql'),'utf8'));
        const group=(await pg.query('SELECT id,limit_bytes,used_bytes,period_days,reset_at FROM user_node_quota_groups')).rows[0];
        const node=(await pg.query('SELECT group_uuid,limit_bytes,used_bytes,period_days,reset_at FROM user_node_quotas')).rows[0];
        assert.equal(node.group_uuid,group.id);
        assert.equal(node.limit_bytes,null);
        assert.equal(BigInt(node.used_bytes),60n);
        assert.equal(BigInt(group.used_bytes),60n);
        assert.equal(group.period_days,30);
        assert.equal(group.reset_at.toISOString(),'2026-12-25T00:00:00.000Z');
    } finally {await pg.close();}
});

test('two nodes share usage, blocking, event snapshot and reset', async () => {
    const pg=new PGlite();
    try {
        await pg.exec(`
            CREATE TABLE users(uuid uuid PRIMARY KEY,t_id bigint UNIQUE NOT NULL);
            CREATE TABLE nodes(uuid uuid PRIMARY KEY,name text NOT NULL);
            CREATE TABLE quota_usage_receipts(event_id text PRIMARY KEY);
            CREATE TABLE user_node_quota_preferences(user_uuid uuid PRIMARY KEY,period_days integer,reset_at timestamptz,threshold_percent integer NOT NULL DEFAULT 80,updated_at timestamptz DEFAULT now());
            CREATE TABLE user_node_quotas(user_uuid uuid NOT NULL,node_uuid uuid NOT NULL,group_uuid uuid,limit_bytes bigint,used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,period_days integer,reset_at timestamptz,updated_at timestamptz DEFAULT now(),threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,PRIMARY KEY(user_uuid,node_uuid));
            CREATE TABLE user_node_quota_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid NOT NULL,name text NOT NULL,limit_bytes bigint NOT NULL,used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,period_days integer,reset_at timestamptz,updated_at timestamptz DEFAULT now());
            CREATE TABLE node_quota_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid,node_uuid uuid,group_uuid uuid,group_name text,node_uuids uuid[] NOT NULL DEFAULT '{}',event text,used_bytes bigint,limit_bytes bigint);
            CREATE TABLE quota_sync(user_uuid uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz DEFAULT now());
        `);
        await pg.query('INSERT INTO users(uuid,t_id) VALUES($1,123)',[userUuid]);
        await pg.query('INSERT INTO nodes(uuid,name) VALUES($1,$2),($3,$4),($5,$6)',[nodeUuid,'First node',secondNodeUuid,'Second node',thirdNodeUuid,'Third node']);
        const service=new SquadQuotasService(adapter(pg));
        await service.record('before-group',[{u:'123',n:nodeUuid,b:'30'}]);
        const {id}=await service.configureGroup(userUuid,null,'Shared',[nodeUuid,secondNodeUuid],'100');
        const {id:otherId}=await service.configureGroup(userUuid,null,'Single',[thirdNodeUuid],'500');
        assert.equal((await service.listGroups(userUuid)).length,2);
        await assert.rejects(()=>service.configureGroup(userUuid,null,'Overlapping',[secondNodeUuid],'100'));
        assert.equal((await service.listGroups(userUuid)).find(group=>group.id===id).used_bytes,'30');
        await service.record('other-group',[{u:'123',n:thirdNodeUuid,b:'100'}]);
        assert.equal((await service.listGroups(userUuid)).find(group=>group.id===otherId).used_bytes,'100');
        await service.record('shared-first',[{u:'123',n:nodeUuid,b:'30'}]);
        await service.record('shared-second',[{u:'123',n:secondNodeUuid,b:'40'}]);
        await service.record('shared-second',[{u:'123',n:secondNodeUuid,b:'40'}]);
        const group=(await service.listGroups(userUuid)).find(group=>group.id===id);
        assert.equal(group.used_bytes,'100');
        assert.equal(group.blocked,true);
        assert.equal((await service.list(userUuid)).filter(item=>item.group_uuid===id).every(item=>item.blocked),true);
        assert.equal((await service.list(userUuid)).find(item=>item.node_uuid===thirdNodeUuid).blocked,false);
        const events=(await pg.query('SELECT event,group_uuid,group_name,node_uuids,used_bytes FROM node_quota_events ORDER BY event')).rows;
        assert.deepEqual(events.map(row=>row.event),['LOCATION_TRAFFIC_EXHAUSTED','LOCATION_TRAFFIC_THRESHOLD']);
        assert.equal(events[0].group_uuid,id);
        assert.equal(events[0].group_name,'Shared');
        assert.deepEqual(new Set(events[0].node_uuids),new Set([nodeUuid,secondNodeUuid]));
        assert.equal((await service.status(userUuid)).items.find(item=>item.nodeUuid===nodeUuid).remainingBytes,'0');
        await service.resetGroup(userUuid,id);
        assert.equal((await service.listGroups(userUuid)).find(group=>group.id===id).used_bytes,'0');
        assert.equal((await service.list(userUuid)).filter(item=>item.group_uuid===id).every(item=>!item.blocked&&item.used_bytes===0n),true);
        assert.equal((await pg.query("SELECT count(*)::int AS count FROM node_quota_events WHERE event='LOCATION_TRAFFIC_RESET'")).rows[0].count,1);
        await service.configureGroup(userUuid,id,'Renamed',[nodeUuid,secondNodeUuid],'200');
        assert.equal((await service.listGroups(userUuid)).find(group=>group.id===id).name,'Renamed');
        assert.equal((await service.listGroups(userUuid)).find(group=>group.id===id).limit_bytes,'200');
        await service.record('after-group-reset',[{u:'123',n:secondNodeUuid,b:'50'}]);
        await service.resetAll(userUuid);
        assert.equal((await service.listGroups(userUuid)).find(group=>group.id===id).used_bytes,'0');
        assert.equal((await service.list(userUuid)).every(item=>item.used_bytes===0n),true);
        assert.equal((await pg.query("SELECT count(*)::int AS count FROM node_quota_events WHERE event='LOCATION_TRAFFIC_RESET'")).rows[0].count,3);
        await service.removeGroup(userUuid,id);
        assert.equal((await service.listGroups(userUuid)).length,1);
        assert.equal((await service.list(userUuid)).filter(item=>item.node_uuid!==thirdNodeUuid).every(item=>item.group_uuid===null),true);
    } finally {await pg.close();}
});
