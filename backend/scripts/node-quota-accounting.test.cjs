const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {SquadQuotasService}=require('../dist/src/modules/squad-quotas/squad-quotas.service');
const {RecordUserUsageQueueProcessor}=require('../dist/src/queue/_nodes/processors/record-user-usage.processor');
const {UpdateUsersUsageQueueProcessor}=require('../dist/src/queue/_users/processors/update-users-usage.processor');
const {USERS_JOB_NAMES}=require('../dist/src/queue/_users/constants/users-job-name.constant');

const user='11111111-1111-4111-8111-111111111111';
const node='22222222-2222-4222-8222-222222222222';
const node2='33333333-3333-4333-8333-333333333333';
const node3='44444444-4444-4444-8444-444444444444';
const fields=new Set(['used_bytes','limit_bytes','tId']);

async function fixture(t) {
    const pg=new PGlite();
    t.after(()=>pg.close());
    await pg.exec(`
        CREATE TABLE users(uuid uuid PRIMARY KEY,t_id bigint UNIQUE NOT NULL);
        CREATE TABLE nodes(uuid uuid PRIMARY KEY,name text NOT NULL);
        CREATE TABLE user_traffic(t_id bigint PRIMARY KEY,used_traffic_bytes bigint DEFAULT 0,lifetime_used_traffic_bytes bigint DEFAULT 0,online_at timestamptz,first_connected_at timestamptz,last_connected_node_uuid uuid);
        CREATE TABLE quota_usage_receipts(event_id text PRIMARY KEY);
        CREATE TABLE user_node_quota_preferences(user_uuid uuid PRIMARY KEY,period_days integer,reset_at timestamptz,threshold_percent integer DEFAULT 80,threshold_percents integer[] NOT NULL DEFAULT ARRAY[80],updated_at timestamptz DEFAULT now());
        CREATE TABLE user_node_quota_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid NOT NULL,name text NOT NULL,limit_bytes bigint NOT NULL,used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,sent_threshold_percents integer[] NOT NULL DEFAULT '{}',period_days integer,reset_at timestamptz,updated_at timestamptz DEFAULT now());
        CREATE TABLE user_node_quotas(user_uuid uuid NOT NULL,node_uuid uuid NOT NULL,group_uuid uuid,limit_bytes bigint,used_bytes bigint NOT NULL DEFAULT 0,blocked boolean NOT NULL DEFAULT false,period_days integer,reset_at timestamptz,updated_at timestamptz DEFAULT now(),threshold_percent integer NOT NULL DEFAULT 80,threshold_sent boolean NOT NULL DEFAULT false,sent_threshold_percents integer[] NOT NULL DEFAULT '{}',PRIMARY KEY(user_uuid,node_uuid));
        CREATE TABLE node_quota_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_uuid uuid,node_uuid uuid,group_uuid uuid,group_name text,node_uuids uuid[] NOT NULL DEFAULT '{}',event text,used_bytes bigint,limit_bytes bigint,threshold_percent integer);
        CREATE TABLE quota_sync(user_uuid uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 1,updated_at timestamptz DEFAULT now());
    `);
    await pg.query('INSERT INTO users VALUES($1,123)',[user]);
    await pg.exec('INSERT INTO user_traffic(t_id) VALUES(123)');
    for(const [id,name] of [[node,'One'],[node2,'Two'],[node3,'Three']])await pg.query('INSERT INTO nodes VALUES($1,$2)',[id,name]);
    const stats={queries:0};
    const adapter=connection=>{
        const raw=async(first,values)=>{
            stats.queries++;
            const prepared=!Array.isArray(first);
            const text=prepared?first.text:first.reduce((s,part,i)=>s+part+(i<values.length?`$${i+1}`:''),'');
            const args=prepared?first.values:values;
            const result=await connection.query(text,args.map(x=>typeof x==='bigint'?x.toString():x));
            return {...result,rows:result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,fields.has(k)&&v!==null?BigInt(v):v])))};
        };
        return {
            $queryRaw:async(first,...values)=>(await raw(first,values)).rows,
            $executeRaw:async(first,...values)=>(await raw(first,values)).affectedRows,
            $transaction:callback=>connection.transaction(tx=>callback(adapter(tx))),
            users:{findUnique:async({where})=>(await connection.query('SELECT uuid,t_id AS "tId" FROM users WHERE uuid=$1',[where.uuid])).rows[0]??null},
        };
    };
    const service=new SquadQuotasService(adapter(pg));
    const globalBytes=async()=>BigInt((await pg.query('SELECT used_traffic_bytes FROM user_traffic WHERE t_id=123')).rows[0].used_traffic_bytes);
    return {pg,service,stats,globalBytes};
}

async function poll(service,{multiplier='1000000000',ignore=0n,nodeUuid=node,id='poll',uplink=524288,downlink=1048576}={}) {
    const history=[];
    const jobs=[];
    const events=[];
    const updater=new UpdateUsersUsageQueueProcessor({fireUserEventBulk:async payload=>events.push(payload)},service);
    const pipeline={hincrby:(...args)=>history.push(args),expire:()=>{},exec:async()=>[]};
    const processor=new RecordUserUsageQueueProcessor({},
        {getUsersStats:async()=>({isOk:true,response:{response:{users:[{username:'123',uplink,downlink}]}}})},
        {getOrThrow:()=>ignore},
        {updateUserUsage:async data=>jobs.push({id,name:USERS_JOB_NAMES.UPDATE_USERS_USAGE,data})},
        {recordUserUsageDelayed:async()=>{}},
        {createPipeline:()=>pipeline,set:async()=>{}});
    await processor.process({data:{nodeUuid,nodeId:'1',consumptionMultiplier:multiplier,connectionOpts:{address:'node.example.invalid',port:2222}}});
    assert.equal(jobs.length,1,'the node sample must reach durable accounting');
    await updater.process(jobs[0]);
    return {jobs,updater,history,events};
}

test('node polling counts actual bytes for multipliers 0, 0.1, 1 and 2; global billing stays weighted',async t=>{
    const {service,globalBytes}=await fixture(t);
    const {id}=await service.configureGroup(user,null,'Raw traffic',[node],'100000000');
    let expectedGlobal=0n;
    for(const [i,multiplier] of ['0','100000000','1000000000','2000000000'].entries()) {
        const {jobs,history}=await poll(service,{multiplier,id:`poll-${i}`});
        assert.equal(jobs[0].data[0].rawBytes,'1572864');
        assert.equal(history[0][2],1572864);
        expectedGlobal+=BigInt(jobs[0].data[0].b);
    }
    assert.equal((await service.listGroups(user)).find(g=>g.id===id).used_bytes,'6291456');
    assert.equal(await globalBytes(),4875878n);
    assert.equal(await globalBytes(),expectedGlobal);
});

test('small samples still count in quotas and history, and repeated accounting jobs do not double-charge',async t=>{
    const {service,globalBytes}=await fixture(t);
    await service.configureGroup(user,null,'Small samples',[node],'1000');
    const first=await poll(service,{id:'small-1',ignore:1048576n,uplink:128,downlink:256});
    await first.updater.process(first.jobs[0]);
    await poll(service,{id:'small-2',ignore:1048576n,uplink:128,downlink:256});
    assert.equal(first.history[0][2],384);
    assert.equal((await service.listGroups(user))[0].used_bytes,'768');
    assert.equal(await globalBytes(),0n);
    assert.equal(first.events.length,0);
});

test('a batch sums all member nodes once, isolates other groups and emits every crossed warning',async t=>{
    const {pg,service,globalBytes}=await fixture(t);
    await pg.query('INSERT INTO user_node_quota_preferences(user_uuid,threshold_percents) VALUES($1,ARRAY[50,80,90])',[user]);
    const {id}=await service.configureGroup(user,null,'Shared',[node,node2],'100');
    const {id:other}=await service.configureGroup(user,null,'Other',[node3],'1000');
    const usage=[
        {u:'123',n:node,b:'0',rawBytes:'30'},
        {u:'123',n:node,b:'0',rawBytes:'10'},
        {u:'123',n:node2,b:'6',rawBytes:'60'},
        {u:'123',n:node3,b:'50',rawBytes:'25'},
        {u:'999',n:node,b:'50',rawBytes:'50'},
    ];
    await service.record('many-nodes',usage,true);
    await service.record('many-nodes',usage,true);
    const groups=await service.listGroups(user);
    assert.equal(groups.find(g=>g.id===id).used_bytes,'100');
    assert.equal(groups.find(g=>g.id===id).blocked,true);
    assert.equal(groups.find(g=>g.id===other).used_bytes,'25');
    assert.equal(groups.find(g=>g.id===other).blocked,false);
    assert.equal(await globalBytes(),56n);
    const events=(await pg.query('SELECT event,threshold_percent,node_uuids,used_bytes FROM node_quota_events ORDER BY threshold_percent')).rows;
    assert.deepEqual(events.map(e=>e.threshold_percent),[50,80,90,null]);
    assert.equal(events.filter(e=>e.event==='LOCATION_TRAFFIC_EXHAUSTED').length,1);
    assert(events.every(e=>BigInt(e.used_bytes)===100n&&e.node_uuids.length===2));
    await service.resetGroup(user,id);
    await service.record('new-period',[{u:'123',n:node,b:'0',rawBytes:'5'}],true);
    assert.equal((await service.listGroups(user)).find(g=>g.id===id).used_bytes,'5');
    assert.equal((await service.listGroups(user)).find(g=>g.id===other).used_bytes,'25');
});

test('byte strings above Number.MAX_SAFE_INTEGER remain exact',async t=>{
    const {service}=await fixture(t);
    await service.configureGroup(user,null,'Large',[node],'9007199254741993');
    await service.record('large',[{u:'123',n:node,b:'0',rawBytes:'9007199254740993'},{u:'123',n:node,b:'0',rawBytes:'7'}]);
    assert.equal((await service.listGroups(user))[0].used_bytes,'9007199254741000');
});

test('legacy individual limits still block only their own node using actual bytes',async t=>{
    const {pg,service}=await fixture(t);
    await pg.query('INSERT INTO user_node_quotas(user_uuid,node_uuid,limit_bytes) VALUES($1,$2,100)',[user,node]);
    await service.record('legacy-cap',[{u:'123',n:node,b:'0',rawBytes:'100'},{u:'123',n:node2,b:'2',rawBytes:'20'}]);
    const quotas=await service.list(user);
    assert.equal(quotas.find(q=>q.node_uuid===node).blocked,true);
    assert.equal(quotas.find(q=>q.node_uuid===node2).blocked,false);
    assert.equal((await pg.query("SELECT count(*)::int n FROM node_quota_events WHERE event='LOCATION_TRAFFIC_EXHAUSTED'")).rows[0].n,1);
});

test('adding a member to a blocked group blocks it immediately; increasing the limit preserves usage and restores access',async t=>{
    const {service}=await fixture(t);
    const {id}=await service.configureGroup(user,null,'Blocked',[node],'10');
    await service.record('used',[{u:'123',n:node,b:'0',rawBytes:'20'}]);
    await service.configureGroup(user,id,'Blocked',[node,node2],'10');
    assert((await service.list(user)).every(q=>q.blocked));
    await service.configureGroup(user,id,'Raised',[node,node2],'100');
    assert.equal((await service.listGroups(user))[0].used_bytes,'20');
    assert((await service.list(user)).every(q=>!q.blocked));
});

test('a failed global write rolls back node usage, group usage and the receipt together',async t=>{
    const {pg,service,globalBytes}=await fixture(t);
    await service.configureGroup(user,null,'Atomic',[node],'1000');
    await pg.exec(`CREATE FUNCTION reject_traffic() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test write failure'; END $$;
        CREATE TRIGGER fail_traffic BEFORE UPDATE ON user_traffic FOR EACH ROW EXECUTE FUNCTION reject_traffic();`);
    const usage=[{u:'123',n:node,b:'10',rawBytes:'100'}];
    await assert.rejects(()=>service.record('retry',usage,true),/test write failure/);
    assert.equal((await service.listGroups(user))[0].used_bytes,'0');
    assert.equal((await pg.query('SELECT count(*)::int n FROM quota_usage_receipts')).rows[0].n,0);
    await pg.exec('DROP TRIGGER fail_traffic ON user_traffic');
    await service.record('retry',usage,true);
    await service.record('retry',usage,true);
    assert.equal((await service.listGroups(user))[0].used_bytes,'100');
    assert.equal(await globalBytes(),10n);
});

test('1500 limited users are accounted for without per-user database round trips',async t=>{
    const {pg,service,stats}=await fixture(t);
    await pg.exec(`INSERT INTO users SELECT gen_random_uuid(),n FROM generate_series(1000,2499) n;
        INSERT INTO user_traffic(t_id) SELECT t_id FROM users WHERE t_id>=1000;
        INSERT INTO user_node_quota_groups(user_uuid,name,limit_bytes) SELECT uuid,'Batch',1000000 FROM users WHERE t_id>=1000;`);
    await pg.query('INSERT INTO user_node_quotas(user_uuid,node_uuid,group_uuid) SELECT user_uuid,$1,id FROM user_node_quota_groups',[node]);
    stats.queries=0;
    await service.record('large-batch',Array.from({length:1500},(_,i)=>({u:String(1000+i),n:node,b:'2',rawBytes:'8'})),true);
    assert(stats.queries<20,`expected batched accounting, got ${stats.queries} queries`);
    assert.equal((await pg.query('SELECT count(*)::int n FROM user_node_quota_groups WHERE used_bytes=8')).rows[0].n,1500);
    assert.equal((await pg.query('SELECT count(*)::int n FROM user_traffic WHERE used_traffic_bytes=2')).rows[0].n,1500);
});
