const assert = require('node:assert/strict');
const { CreateHostCommand } = require('../dist/libs/contract/commands/hosts/create.command');
const { UpdateHostCommand } = require('../dist/libs/contract/commands/hosts/update.command');
const { TemplateEngine } = require('../dist/src/common/utils/templates/replace-templates-values');
const { SquadQuotasService } = require('../dist/src/modules/squad-quotas/squad-quotas.service');

async function main() {
    const oldRemark = '🇺🇸 США {{LOCATION_TRAFFIC_USED}}/{{LOCATION_TRAFFIC_LIMIT}}';
    const shortRemark = '🇺🇸 США {{N_USED}}/{{N_LIMIT}}';
    assert(CreateHostCommand.RequestSchema.shape.remark.safeParse(oldRemark).success);
    assert(UpdateHostCommand.RequestSchema.shape.remark.safeParse(oldRemark).success);
    assert(shortRemark.length <= 40);

    const nodeId = '10000000-0000-4000-8000-000000000001';
    const otherId = '10000000-0000-4000-8000-000000000002';
    const db = {
        $queryRaw: async () => [],
        nodes: { findMany: async () => [{ uuid: nodeId, name: 'USA' }, { uuid: otherId, name: 'Germany' }] },
        configProfileInboundsToNodes: { findMany: async () => [] },
    };
    const service = new SquadQuotasService(db);
    service.list = async () => [{ node_uuid: nodeId, used_bytes: 4424990n, limit_bytes: 10737418240n, blocked: false }];
    const hosts = [
        { uuid: 'one', configProfileInboundUuid: null, nodes: [{ nodeUuid: nodeId }] },
        { uuid: 'shared', configProfileInboundUuid: null, nodes: [{ nodeUuid: nodeId }, { nodeUuid: otherId }] },
        { uuid: 'unlimited', configProfileInboundUuid: null, nodes: [{ nodeUuid: otherId }] },
    ];
    const contexts = await service.hostContexts('user', hosts);
    const one = contexts.get('one').values;
    assert.equal(one.N_NAME(), 'USA');
    assert.equal(one.N_USED(), '4.22 MiB');
    assert.equal(one.N_LIMIT(), '10 GiB');
    assert.equal(one.N_PCT(), '0.04');
    assert.equal(one.N_USED(), one.NODE_TRAFFIC_USED());
    assert.equal(one.LOCATION_TRAFFIC_LIMIT(), '10.00 GiB');
    assert.equal(TemplateEngine.replace(shortRemark, one), '🇺🇸 США 4.22 MiB/10 GiB');
    assert.equal(TemplateEngine.replace(oldRemark, one), '🇺🇸 США 4.22 MiB/10.00 GiB');
    assert.equal(contexts.get('shared').values.N_LIMIT(), '');
    assert.equal(contexts.get('unlimited').values.N_LIMIT(), '');
    assert.equal(contexts.get('unlimited').values.N_PCT(), '');
    console.log('PASS host remark short limit uses a whole unit and unset limits are blank');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
