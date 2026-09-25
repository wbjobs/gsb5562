global.self = global;
self.DS = require('./structures.js');
global.importScripts = () => {};
self.postMessage = (m) => { (global.__msgs = global.__msgs || []).push(m); };
require('./worker.js');

for (const mode of ['random', 'asc', 'desc']) {
  global.__msgs = [];
  self.onmessage({ data: { n: 100000, mode, queryCount: 20000, rangeCount: 200, rangeSpan: 2000, deleteCount: 20000, seed: 777 } });
  const r = global.__msgs.find(m => m.type === 'result');
  const err = global.__msgs.find(m => m.type === 'error');
  if (err) { console.error(mode, 'ERROR', err.message); process.exit(1); }
  const m = r.metrics;
  const ok = m.consistent && m.postConsistent && !m.rangeMismatch;
  console.log(`${mode.padEnd(6)} 一致=${ok ? '✅' : '❌'} 插入 SL=${m.insert.sl}ms TP=${m.insert.tp}ms 点查 SL=${m.search.sl} TP=${m.search.tp} 范围 SL=${m.range.sl} TP=${m.range.tp} 删除 SL=${m.del.sl} TP=${m.del.tp} 高度 SL=${m.height.sl} TP=${m.height.tp} 内存 SL=${(m.memory.slEstimate/1048576).toFixed(1)}MB TP=${(m.memory.tpEstimate/1048576).toFixed(1)}MB`);
  if (!ok) process.exit(1);
}
// 30 万压力测试
global.__msgs = [];
self.onmessage({ data: { n: 300000, mode: 'random', queryCount: 20000, rangeCount: 200, rangeSpan: 2000, deleteCount: 20000, seed: 1 } });
const r = global.__msgs.find(m => m.type === 'result');
console.log(`300k random OK: 高度 SL=${r.metrics.height.sl} TP=${r.metrics.height.tp}, 一致=${r.metrics.consistent && r.metrics.postConsistent}`);
console.log('ALL MODES PASSED');
