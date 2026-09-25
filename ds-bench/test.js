const { SkipList, Treap, generateKeys } = require('./structures.js');

function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

for (const mode of ['random', 'asc', 'desc']) {
  const n = 100000;
  const keys = generateKeys(n, mode, 99);
  const sl = new SkipList(1);
  const tp = new Treap(2);

  let t0 = performance.now();
  for (const k of keys) sl.insert(k);
  const slIns = performance.now() - t0;

  t0 = performance.now();
  for (const k of keys) tp.insert(k);
  const tpIns = performance.now() - t0;

  // 全量有序性 & 一致性
  const a = sl.toArray(), b = tp.toArray();
  assertEq(a, b, mode + ' traversal mismatch');
  // 与原生排序对照
  const sorted = [...keys].sort((x, y) => x - y);
  assertEq(a, sorted, mode + ' vs native sort');

  // 点查一致性
  for (let i = 0; i < 2000; i++) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    if (sl.search(k) !== tp.search(k)) { console.error('FAIL search', k); process.exit(1); }
    if (sl.search(k) < 1) { console.error('FAIL search missing', k); process.exit(1); }
  }
  if (sl.search(-12345) !== 0 || tp.search(-12345) !== 0) { console.error('FAIL miss'); process.exit(1); }

  // 范围查询一致性 + 有序性
  for (let i = 0; i < 200; i++) {
    const lo = keys[Math.floor(Math.random() * keys.length)];
    const hi = lo + Math.floor(Math.random() * 500);
    const r1 = sl.range(lo, hi), r2 = tp.range(lo, hi);
    assertEq(r1, r2, mode + ' range mismatch ' + lo + ',' + hi);
    for (let j = 1; j < r1.length; j++) if (r1[j] < r1[j-1]) { console.error('FAIL range order'); process.exit(1); }
    const expect = sorted.filter(v => v >= lo && v <= hi);
    assertEq(r1, expect, mode + ' range vs native');
  }

  // 删除一半后一致性
  const delKeys = keys.filter((_, i) => i % 2 === 0);
  for (const k of delKeys) sl.delete(k);
  for (const k of delKeys) tp.delete(k);
  assertEq(sl.toArray(), tp.toArray(), mode + ' post-delete mismatch');
  const remain = {};
  for (const k of keys) remain[k] = (remain[k] || 0) + 1;
  for (const k of delKeys) remain[k]--;
  for (const k of Object.keys(remain)) {
    const c = remain[k];
    if (sl.search(+k) !== c || tp.search(+k) !== c) { console.error('FAIL dup count', k); process.exit(1); }
  }
  // 再删不存在的键
  if (sl.delete(-999) || tp.delete(-999)) { console.error('FAIL delete missing'); process.exit(1); }

  console.log(`${mode.padEnd(6)} OK  n=${n}  size=${sl.size}  total=${sl.totalCount}  ` +
    `SL高度=${sl.getHeight()}  Treap高度=${tp.getHeight()}  ` +
    `插入耗时 SL=${slIns.toFixed(0)}ms Treap=${tpIns.toFixed(0)}ms`);
}
console.log('ALL TESTS PASSED');
