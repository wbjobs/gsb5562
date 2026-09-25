'use strict';
// Node 端一致性冒烟测试：node test-sanity.js
const assert = require('assert');
const { SkipList, Treap, runBenchmark, mulberry32 } = require('./worker.js');

// 1) 三种输入模式下的基准一致性
for (const mode of ['random', 'sorted', 'reversed']) {
  const result = runBenchmark(
    { mode, n: 20000, deletes: 3000, pointQ: 5000, rangeQ: 400, rangeLen: 50, seed: 12345 },
    () => {}
  );
  assert.strictEqual(result.consistency.pointMismatch, 0, mode + ' 点查结果不一致');
  assert.strictEqual(result.consistency.rangeMismatch, 0, mode + ' 范围查询结果不一致');
  assert.strictEqual(result.consistency.rangeSorted, true, mode + ' 范围查询无序');
  console.log(
    mode.padEnd(8),
    'build(ms): sl=' + result.metrics.skiplist.build.toFixed(1),
    'tp=' + result.metrics.treap.build.toFixed(1),
    '| height: sl=' + result.metrics.skiplist.height,
    'tp=' + result.metrics.treap.height,
    '| unique=' + result.metrics.treap.size
  );
}

// 2) 重复键语义：计数增减与彻底删除
{
  const rand = mulberry32(7);
  const sl = new SkipList(mulberry32(7));
  const tp = new Treap(rand);
  for (const ds of [sl, tp]) {
    ds.insert(5); ds.insert(5); ds.insert(5);
    assert.strictEqual(ds.get(5), 3, '重复键计数应为 3');
    ds.remove(5);
    assert.strictEqual(ds.get(5), 2, '删除一次后计数应为 2');
    ds.remove(5); ds.remove(5);
    assert.strictEqual(ds.get(5), 0, '删光后应为 0');
    assert.strictEqual(ds.remove(5), false, '删除不存在的键应返回 false');
  }
  assert.strictEqual(sl.size, 0);
  assert.strictEqual(tp.size, 0);
  console.log('duplicates: OK');
}

// 3) 范围查询边界：lo>hi 自动交换、空区间、边界包含
{
  const tp = new Treap(mulberry32(1));
  for (const k of [1, 3, 5, 7, 9]) tp.insert(k);
  assert.deepStrictEqual(tp.range(9, 3, []), [3, 1, 5, 1, 7, 1, 9, 1], 'lo>hi 应交换');
  assert.deepStrictEqual(tp.range(4, 4, []), [], '空区间应为空');
  assert.deepStrictEqual(tp.range(3, 7, []), [3, 1, 5, 1, 7, 1], '闭区间边界');
  assert.deepStrictEqual(tp.range(0, 100, []), [1, 1, 3, 1, 5, 1, 7, 1, 9, 1], '全覆盖');
  console.log('range bounds: OK');
}

// 4) 删除后结构维护：与朴素有序表对照 5 万次混合操作
{
  const sl = new SkipList(mulberry32(99));
  const tp = new Treap(mulberry32(100));
  const model = new Map();
  const rng = mulberry32(42);
  for (let i = 0; i < 50000; i++) {
    const key = Math.floor(rng() * 500);
    const op = rng();
    if (op < 0.5) {
      sl.insert(key); tp.insert(key);
      model.set(key, (model.get(key) || 0) + 1);
    } else {
      sl.remove(key); tp.remove(key);
      if (model.has(key)) {
        const c = model.get(key) - 1;
        if (c === 0) model.delete(key); else model.set(key, c);
      }
    }
    if (i % 5000 === 0) {
      const probe = Math.floor(rng() * 500);
      assert.strictEqual(sl.get(probe), model.get(probe) || 0, '跳表与模型不一致');
      assert.strictEqual(tp.get(probe), model.get(probe) || 0, 'Treap 与模型不一致');
    }
  }
  assert.strictEqual(sl.size, model.size);
  assert.strictEqual(tp.size, model.size);
  // 全量范围对比
  const expect = [];
  for (const [k, c] of [...model.entries()].sort((a, b) => a[0] - b[0])) expect.push(k, c);
  assert.deepStrictEqual(sl.range(0, 499, []), expect, '跳表全量范围不一致');
  assert.deepStrictEqual(tp.range(0, 499, []), expect, 'Treap 全量范围不一致');
  console.log('delete maintenance vs model: OK');
}

console.log('\nAll sanity tests passed.');
