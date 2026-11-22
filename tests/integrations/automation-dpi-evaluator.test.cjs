const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createSourceLoader}=require('./source-loader.cjs');
const {evaluateDpiRegions}=createSourceLoader()('src/modules/node-operations/automation-dpi-evaluator.ts');

const job=(location,ids,regions,results,overrides={})=>({
  location,status:'completed',pop_ids:ids,popRegions:regions,
  popNames:Object.fromEntries(ids.map(id=>[String(id),'pop-'+id])),
  results,hostCount:1,...overrides,
});

test('two distinct failed geographic regions unlock only the unavailable branch',()=>{
  const output=evaluateDpiRegions([
    job('russia',[10],{'10':'Moscow'},[{pop_id:10,connected:false}]),
    job('russia_mobile',[20],{'20':'St Petersburg'},[{pop_id:20,connected:false}]),
  ],2);
  assert.equal(output.outcome,'unavailable');
  assert.equal(output.unavailableRegions,2);
});

test('same region measured by many PoPs counts only once',()=>{
  const output=evaluateDpiRegions([
    job('russia',[10,11],{'10':'Moscow','11':'Moscow'},
      [{pop_id:10,connected:false},{pop_id:11,connected:false}]),
  ],2);
  assert.equal(output.outcome,'available');
  assert.equal(output.unavailableRegions,1);
});

test('at least one reachable PoP makes the region accessible',()=>{
  const output=evaluateDpiRegions([
    job('russia',[10,11],{'10':'Moscow','11':'Moscow'},
      [{pop_id:10,connected:false},{pop_id:11,connected:true}]),
  ],1);
  assert.equal(output.outcome,'available');
  assert.equal(output.availableRegions,1);
});

test('malformed, unattributed, incomplete, pending or missing PoP results always fail closed',()=>{
  const rows=[
    job('russia',[10],{},[{pop_id:10,connected:false}]),
    job('russia',[10],{'10':'Moscow'},[{pop_id:99,connected:false}]),
    job('russia',[10],{'10':'Moscow'},[{pop_id:10,connected:false}],{status:'pending'}),
    job('russia',[10],{'10':'Moscow'},[{pop_id:10,connected:'false'}]),
    job('russia',[10],{'10':'Moscow'},[{pop_id:10,connected:false}],{hostCount:2}),
    job('russia',[10],{'10':'Moscow'},[],{status:'failed'}),
  ];
  for(const row of rows)assert.equal(evaluateDpiRegions([row],1).outcome,'unknown');
});

test('unknown region elsewhere cannot manufacture a second unavailable region',()=>{
  const output=evaluateDpiRegions([
    job('russia',[10],{'10':'Moscow'},[{pop_id:10,connected:false}]),
    job('china',[20],{},[{pop_id:20,connected:false}]),
  ],2);
  assert.equal(output.outcome,'unknown');
  assert.equal(output.unavailableRegions,1);
});

test('missing parameters never count as measured availability',()=>{
  assert.equal(evaluateDpiRegions([],1).outcome,'unknown');
  assert.equal(evaluateDpiRegions([job('russia',[10],{'10':'Moscow'},[{pop_id:10,connected:false}])],0).outcome,'unknown');
});
