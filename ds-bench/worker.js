/*
 * worker.js — 所有数据结构与基准测试均在 Worker 中执行，主线程零阻塞。
 * 计时使用 performance.mark/measure + PerformanceObserver 收集。
 */
importScripts('structures.js');

const { SkipList, Treap, generateKeys, makeRng } = self.DS;

// 通过 PerformanceObserver 收集 measure 结果
const timings = {};
function collectEntries(list) {
  const entries = typeof list.getEntries === 'function' ? list.getEntries() : list;
  for (const entry of entries) {
    timings[entry.name] = (timings[entry.name] || 0) + entry.duration;
  }
}
const observer = new PerformanceObserver(collectEntries);

function timed(name, fn) {
  const startMark = name + ':start';
  const endMark = name + ':end';
  performance.mark(startMark);
  const out = fn();
  performance.mark(endMark);
  performance.measure(name, startMark, endMark);
  return out;
}

function post(stage, pct) {
  self.postMessage({ type: 'progress', stage, pct });
}

function heapUsed() {
  return (performance.memory && performance.memory.usedJSHeapSize) || 0;
}

self.onmessage = function (e) {
  const { n, mode, queryCount, rangeCount, rangeSpan, deleteCount, seed } = e.data;
  try {
    run(n, mode, queryCount, rangeCount, rangeSpan, deleteCount, seed);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};

function run(n, mode, queryCount, rangeCount, rangeSpan, deleteCount, seed) {
  // 重置计时状态，避免多次运行之间累积
  for (const k of Object.keys(timings)) delete timings[k];
  performance.clearMarks();
  performance.clearMeasures();
  observer.observe({ entryTypes: ['measure'] });

  post('生成数据 (' + mode + ')', 2);
  const keys = generateKeys(n, mode, seed);
  const rand = makeRng(seed + 1);

  const sl = new SkipList(seed);
  const tp = new Treap(seed + 7);

  /* ---------- 插入 ---------- */
  post('跳表插入中…', 8);
  const heapBefore = heapUsed();
  timed('sl.insert', () => { for (const k of keys) sl.insert(k); });
  post('Treap 插入中…', 25);
  timed('tp.insert', () => { for (const k of keys) tp.insert(k); });
  const heapAfter = heapUsed();

  /* ---------- 点查 ---------- */
  post('点查基准中…', 40);
  const queryKeys = new Array(queryCount);
  for (let i = 0; i < queryCount; i++) {
    // 80% 命中已有键，20% 查询不存在的键
    queryKeys[i] = rand() < 0.8
      ? keys[Math.floor(rand() * n)]
      : Math.floor(rand() * n * 2) + n * 2;
  }
  let slHits = 0, tpHits = 0;
  timed('sl.search', () => { for (const k of queryKeys) if (sl.search(k)) slHits++; });
  timed('tp.search', () => { for (const k of queryKeys) if (tp.search(k)) tpHits++; });

  /* ---------- 范围查询 ---------- */
  post('范围查询基准中…', 55);
  const maxKey = mode === 'random' ? Math.floor(n * 1.5) : n * 2 + 2;
  const ranges = [];
  for (let i = 0; i < rangeCount; i++) {
    const lo = Math.floor(rand() * maxKey);
    ranges.push([lo, lo + rangeSpan]);
  }
  let slRangeTotal = 0, tpRangeTotal = 0;
  let rangeMismatch = false;
  timed('sl.range', () => {
    for (const [lo, hi] of ranges) {
      const r = sl.range(lo, hi);
      slRangeTotal += r.length;
    }
  });
  timed('tp.range', () => { for (const [lo, hi] of ranges) tpRangeTotal += tp.range(lo, hi).length; });
  // 抽样校验一致性
  for (let i = 0; i < Math.min(20, ranges.length); i++) {
    const [lo, hi] = ranges[i];
    const a = sl.range(lo, hi), b = tp.range(lo, hi);
    if (a.length !== b.length || a.some((v, j) => v !== b[j])) rangeMismatch = true;
  }

  /* ---------- 全量一致性校验 ---------- */
  post('一致性校验中…', 70);
  const arrA = sl.toArray(), arrB = tp.toArray();
  let consistent = arrA.length === arrB.length;
  if (consistent) for (let i = 0; i < arrA.length; i++) if (arrA[i] !== arrB[i]) { consistent = false; break; }

  /* ---------- 删除 ---------- */
  post('删除基准中…', 80);
  const delKeys = new Array(deleteCount);
  for (let i = 0; i < deleteCount; i++) delKeys[i] = keys[Math.floor(rand() * n)];
  timed('sl.delete', () => { for (const k of delKeys) sl.delete(k); });
  timed('tp.delete', () => { for (const k of delKeys) tp.delete(k); });

  // 删除后再校验
  const postA = sl.toArray(), postB = tp.toArray();
  let postConsistent = postA.length === postB.length;
  if (postConsistent) for (let i = 0; i < postA.length; i++) if (postA[i] !== postB[i]) { postConsistent = false; break; }

  /* ---------- 结构快照 ---------- */
  post('生成结构快照…', 92);
  const snapshot = {
    slLevels: sl.snapshot(240),          // 每层最多 240 个采样点
    slLevelCounts: sl.levelCounts(),
    treapNodes: tp.snapshot(11, 1500),   // 前 12 层，最多 1500 节点
  };

  // takeRecords() 同步取回尚未派发的记录，保证结果在 postMessage 前就绪
  collectEntries(observer.takeRecords());
  observer.disconnect();
  const t = (name) => +(timings[name] || 0).toFixed(2);

  self.postMessage({
    type: 'result',
    metrics: {
      mode, n,
      size: sl.size,
      totalCount: sl.totalCount,
      duplicates: sl.totalCount - sl.size,
      insert: { sl: t('sl.insert'), tp: t('tp.insert') },
      search: { sl: t('sl.search'), tp: t('tp.search'), count: queryCount, slHits, tpHits },
      range: { sl: t('sl.range'), tp: t('tp.range'), count: rangeCount, span: rangeSpan, slTotal: slRangeTotal, tpTotal: tpRangeTotal },
      del: { sl: t('sl.delete'), tp: t('tp.delete'), count: deleteCount },
      height: { sl: sl.getHeight(), tp: tp.getHeight() },
      memory: {
        slEstimate: sl.estimateBytes(),
        tpEstimate: tp.estimateBytes(),
        heapDelta: heapAfter - heapBefore,
      },
      consistent, postConsistent, rangeMismatch,
    },
    snapshot,
  });
}
