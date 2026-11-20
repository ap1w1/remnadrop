const fs=require('fs'),path=require('path');
let ts;try{ts=require(path.join(__dirname,'backend','node_modules','typescript'))}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js')}
const changed=[
'backend/src/modules/node-operations/dpi-credentials.service.ts',
'backend/src/modules/node-operations/node-operations.module.ts',
'backend/src/modules/node-operations/dpi-checker.controller.ts',
'backend/src/modules/node-operations/dpi-checker.service.ts',
'backend/src/modules/node-operations/node-ip.service.ts',
'backend/src/modules/node-operations/node-ip.controller.ts',
'backend/src/modules/node-operations/automations.service.ts',
'backend/src/modules/node-operations/automations.controller.ts',
'backend/src/modules/remnawave-backend.modules.ts',
'backend/src/modules/users/users.module.ts',
'frontend/src/pages/dashboard/node-operations/dpi-checker.page.tsx',
'frontend/src/pages/dashboard/node-operations/automations.page.tsx',
'frontend/src/pages/dashboard/monitoring/monitoring.page.tsx',
'frontend/src/app/router/router.tsx',
'frontend/src/shared/ui/forms/nodes/base-node-form/node-ip-pool.card.tsx',
'frontend/src/shared/ui/forms/nodes/base-node-form/base-node-form.tsx',
'frontend/src/widgets/dashboard/users/view-user-modal/squad-quotas.tsx',
'frontend/src/widgets/dashboard/torrent-blocker-reports/torrent-blocker-reports-table/use-tb-reports-table-columns.tsx',
'frontend/src/app/layouts/dashboard/main-layout/menu-sections/mobile-menu-sections.ts'
];
let errors=0;
for(const name of changed){const file=path.join(__dirname,name);const source=fs.readFileSync(file,'utf8');const kind=name.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS;const tree=ts.createSourceFile(name,source,ts.ScriptTarget.ESNext,true,kind);if(tree.parseDiagnostics.length){console.log('FAIL',name);for(const d of tree.parseDiagnostics)console.log(' ',ts.flattenDiagnosticMessageText(d.messageText,'\n'));errors+=tree.parseDiagnostics.length;}else console.log('OK  ',name);}
console.log('parse diagnostics:',errors);process.exit(errors?1:0);
