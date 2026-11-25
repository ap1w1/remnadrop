const assert = require('node:assert/strict');
const { test } = require('node:test');
const { appRequire, createSourceLoader } = require('./source-loader.cjs');

// Use production decorators, role/scope constants and both real authorization guards.
// Only JWT verification and the service are replaced: no database/provider is needed
// to prove that a node-scoped API token cannot use automation as a DNS-write bypass.
class JwtDefaultGuard {}
const load = createSourceLoader({
  '@common/guards/jwt-guards/def-jwt-guard': { JwtDefaultGuard },
  './automations.service': { AutomationsService: class {} },
});
const { AutomationsController } = load('src/modules/node-operations/automations.controller.ts');
const { RolesGuard } = load('src/common/guards/roles/roles.guard.ts');
const { ScopesGuard } = load('src/common/guards/scopes/scopes.guard.ts');
const { ROLE, buildResourceScope } = load('libs/contract/constants/index.ts');
const { SCOPE_RESOURCE } = load('src/common/decorators/scopes/index.ts');
const { Reflector } = appRequire('@nestjs/core');
const { GUARDS_METADATA } = appRequire('@nestjs/common/constants');
const reflector = new Reflector();
const roles = new RolesGuard(reflector), scopes = new ScopesGuard(reflector);
const mutations = ['create', 'preview', 'previewSaved', 'run', 'duplicate', 'enabled', 'update', 'delete'];
const reads = ['list', 'options', 'executions'];
function context(method, role, grantedScopes = []) {
  return {
    getHandler: () => AutomationsController.prototype[method],
    getClass: () => AutomationsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role, scopes: grantedScopes } }) }),
  };
}

test('all automation mutations and previews override class API access with ADMIN-only metadata', () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, AutomationsController);
  assert(guards.includes(JwtDefaultGuard));
  assert(guards.includes(RolesGuard));
  assert(guards.includes(ScopesGuard));
  for (const method of mutations) {
    assert.deepEqual(Reflect.getMetadata(ROLE, AutomationsController.prototype[method]), [ROLE.ADMIN], method);
    assert.equal(roles.canActivate(context(method, ROLE.ADMIN)), true, method + ' allows admin');
    assert.equal(scopes.canActivate(context(method, ROLE.ADMIN)), true, method + ' admin passes scope guard');
    for (const grantedScopes of [[buildResourceScope('nodes')], ['*']]) {
      const request = context(method, ROLE.API, grantedScopes);
      assert.equal(scopes.canActivate(request), true, 'fixture scope itself permits nodes: ' + method);
      assert.throws(() => roles.canActivate(request), error => error.getStatus() === 403,
        method + ' must reject an API token regardless of its scopes');
    }
  }
});

test('existing automation reads retain nodes resource scope and permit authorized API clients', () => {
  assert.equal(Reflect.getMetadata(SCOPE_RESOURCE, AutomationsController), 'nodes');
  for (const method of reads) {
    const required = reflector.getAllAndOverride(ROLE, [AutomationsController.prototype[method], AutomationsController]);
    assert.deepEqual(required, [ROLE.ADMIN, ROLE.API], method);
    assert.equal(roles.canActivate(context(method, ROLE.API, [buildResourceScope('nodes')])), true);
    assert.equal(scopes.canActivate(context(method, ROLE.API, [buildResourceScope('nodes')])), true);
    assert.equal(scopes.canActivate(context(method, ROLE.API, [buildResourceScope('hosts')])), false);
    assert.equal(scopes.canActivate(context(method, ROLE.API, [])), false);
  }
});
