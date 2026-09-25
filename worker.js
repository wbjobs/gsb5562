'use strict';

/* 所有数据结构操作与基准测试都在本 Web Worker 内完成。
 * 主线程只通过 postMessage 接收结果并渲染 Canvas。 */

// 确定性随机数（mulberry32），保证两种结构吃到完全相同的输入
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 跳表（Skip List） ----------
const SL_MAX_LEVEL = 32;
const SL_P = 0.5;

class SkipList {
  constructor(rand) {
    this.rand = rand;
    this.head = { key: -Infinity, count: 0, next: new Array(SL_MAX_LEVEL).fill(null) };
    this.level = 1;       // 当前最高有效层数
    this.size = 0;        // 不同键的数量
    this.totalLevel = 0;  // 所有节点层数之和（内存估算用）
    this._update = new Array(SL_MAX_LEVEL);
  }

  // 几何分布随机层数：每层以 SL_P 概率继续向上，封顶 SL_MAX_LEVEL
  randomLevel() {
    let lvl = 1;
    while (lvl < SL_MAX_LEVEL && this.rand() < SL_P) lvl++;
    return lvl;
  }

  insert(key) {
    const update = this._update;
    let x = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.next[i] !== null && x.next[i].key < key) x = x.next[i];
      update[i] = x;
    }
    x = x.next[0];
    if (x !== null && x.key === key) {
      x.count++; // 重复键：累计计数，不新建节点
      return false;
    }
    const lvl = this.randomLevel();
    if (lvl > this.level) {
      for (let i = this.level; i < lvl; i++) update[i] = this.head;
      this.level = lvl;
    }
    const node = { key, count: 1, next: new Array(lvl).fill(null) };
    for (let i = 0; i < lvl; i++) {
      node.next[i] = update[i].next[i];
      update[i].next[i] = node;
    }
    this.size++;
    this.totalLevel += lvl;
    return true;
  }

  remove(key) {
    const update = this._update;
    let x = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.next[i] !== null && x.next[i].key < key) x = x.next[i];
      update[i] = x;
    }
    x = x.next[0];
    if (x === null || x.key !== key) return false; // 删除不存在的键
    if (x.count > 1) {
      x.count--; // 仍有重复副本，保留节点
      return true;
    }
    const lvl = x.next.length;
    for (let i = 0; i < lvl; i++) update[i].next[i] = x.next[i];
    while (this.level > 1 && this.head.next[this.level - 1] === null) this.level--;
    this.size--;
    this.totalLevel -= lvl;
    return true;
  }

  get(key) {
    let x = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.next[i] !== null && x.next[i].key < key) x = x.next[i];
    }
    x = x.next[0];
    return x !== null && x.key === key ? x.count : 0;
  }

  // 闭区间范围查询，结果按 key 升序推入 [key,count,key,count,...]
  range(lo, hi, out) {
    if (lo > hi) { const t = lo; lo = hi; hi = t; } // 边界纠正
    let x = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.next[i] !== null && x.next[i].key < lo) x = x.next[i];
    }
    x = x.next[0];
    while (x !== null && x.key <= hi) {
      out.push(x.key, x.count);
      x = x.next[0];
    }
    return out;
  }

  levelCounts() {
    const counts = new Array(this.level).fill(0);
    for (let i = 0; i < this.level; i++) {
      let x = this.head.next[i];
      while (x !== null) { counts[i]++; x = x.next[i]; }
    }
    return counts;
  }

  // 沿最底层等距抽样塔高，用于形态可视化（10 万节点无法逐节点绘制）
  sampleTowers(maxCols) {
    const stride = Math.max(1, Math.ceil(this.size / maxCols));
    const towers = [];
    let x = this.head.next[0];
    let idx = 0;
    while (x !== null) {
      if (idx % stride === 0) towers.push(x.next.length);
      x = x.next[0];
      idx++;
    }
    return towers;
  }

  memBytes() {
    // 头节点 + 每节点（对象开销 + key/count）+ 每层指针
    return 56 + 8 * SL_MAX_LEVEL + this.size * 56 + 8 * this.totalLevel;
  }
}

// ---------- Treap（随机优先级二叉搜索树，旋转维持堆性质） ----------
class Treap {
  constructor(rand) {
    this.rand = rand;
    this.root = null;
    this.size = 0;
  }

  static rotateRight(y) {
    const x = y.l;
    y.l = x.r;
    x.r = y;
    return x;
  }

  static rotateLeft(x) {
    const y = x.r;
    x.r = y.l;
    y.l = x;
    return y;
  }

  insert(key) {
    this.root = this._insert(this.root, key);
  }

  _insert(t, key) {
    if (t === null) {
      this.size++;
      return { key, p: this.rand(), c: 1, l: null, r: null };
    }
    if (key === t.key) {
      t.c++; // 重复键计数
      return t;
    }
    if (key < t.key) {
      t.l = this._insert(t.l, key);
      if (t.l.p < t.p) t = Treap.rotateRight(t);
    } else {
      t.r = this._insert(t.r, key);
      if (t.r.p < t.p) t = Treap.rotateLeft(t);
    }
    return t;
  }

  remove(key) {
    this._removed = false;
    this.root = this._remove(this.root, key);
    return this._removed;
  }

  _remove(t, key) {
    if (t === null) return null;
    if (key < t.key) {
      t.l = this._remove(t.l, key);
      return t;
    }
    if (key > t.key) {
      t.r = this._remove(t.r, key);
      return t;
    }
    if (t.c > 1) {
      t.c--; // 重复副本减一，节点保留
      this._removed = true;
      return t;
    }
    this._removed = true;
    if (t.l === null) { this.size--; return t.r; }
    if (t.r === null) { this.size--; return t.l; }
    // 双子节点：向优先级小的一侧旋转，再递归删除，维持堆性质
    if (t.l.p < t.r.p) {
      t = Treap.rotateRight(t);
      t.r = this._remove(t.r, key);
    } else {
      t = Treap.rotateLeft(t);
      t.l = this._remove(t.l, key);
    }
    return t;
  }

  get(key) {
    let t = this.root;
    while (t !== null) {
      if (key < t.key) t = t.l;
      else if (key > t.key) t = t.r;
      else return t.c;
    }
    return 0;
  }

  range(lo, hi, out) {
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    this._range(this.root, lo, hi, out);
    return out;
  }

  _range(t, lo, hi, out) {
    if (t === null) return;
    if (lo < t.key) this._range(t.l, lo, hi, out);
    if (lo <= t.key && t.key <= hi) out.push(t.key, t.c);
    if (t.key < hi) this._range(t.r, lo, hi, out);
  }

  // 迭代求树高，避免极端输入下递归过深
  height() {
    if (this.root === null) return 0;
    let h = 0;
    const stack = [[this.root, 1]];
    while (stack.length > 0) {
      const [t, d] = stack.pop();
      if (d > h) h = d;
      if (t.l !== null) stack.push([t.l, d + 1]);
      if (t.r !== null) stack.push([t.r, d + 1]);
    }
    return h;
  }

  depthHist() {
    const hist = [];
    if (this.root === null) return hist;
    const stack = [[this.root, 0]];
    while (stack.length > 0) {
      const [t, d] = stack.pop();
      hist[d] = (hist[d] || 0) + 1;
      if (t.l !== null) stack.push([t.l, d + 1]);
      if (t.r !== null) stack.push([t.r, d + 1]);
    }
    return hist;
  }

  // BFS 抽样顶部 maxDepth+1 层，记录层内下标，用于绘制树形态
  sampleTree(maxDepth) {
    const nodes = [];
    if (this.root === null) return nodes;
    const queue = [[this.root, 0, 0, -1]];
    while (queue.length > 0) {
      const [t, d, i, pi] = queue.shift();
      nodes.push({ d, i, pi, k: t.key, c: t.c });
      if (d >= maxDepth) continue;
      if (t.l !== null) queue.push([t.l, d + 1, i * 2, i]);
      if (t.r !== null) queue.push([t.r, d + 1, i * 2 + 1, i]);
    }
    return nodes;
  }

  memBytes() {
    return this.size * 64;
  }
}

// ---------- 数据集生成：随机 / 有序 / 逆序 ----------
function makeDataset(cfg, rand) {
  const n = cfg.n;
  const data = new Array(n);
  if (cfg.mode === 'sorted') {
    for (let i = 0; i < n; i++) data[i] = i;
  } else if (cfg.mode === 'reversed') {
    for (let i = 0; i < n; i++) data[i] = n - 1 - i;
  } else {
    // 随机数据：取值范围 1.5N，天然包含重复键
    const bound = Math.floor(n * 1.5);
    for (let i = 0; i < n; i++) data[i] = Math.floor(rand() * bound);
  }
  return data;
}

function timed(name, fn) {
  performance.mark(name + ':begin');
  const t0 = performance.now();
  const out = fn();
  const t1 = performance.now();
  performance.mark(name + ':end');
  performance.measure(name, name + ':begin', name + ':end');
  return { out, ms: t1 - t0 };
}

function flatEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function rangeIsSorted(flat) {
  for (let i = 2; i < flat.length; i += 2) {
    if (flat[i] < flat[i - 2]) return false;
  }
  return true;
}

function runBenchmark(cfg, post) {
  // PerformanceObserver 采集所有 measure 条目（Worker 内可用）
  const observed = [];
  try {
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        observed.push({ name: e.name, duration: e.duration });
      }
    });
    observer.observe({ entryTypes: ['measure'] });
  } catch (e) { /* 不支持时仅使用 performance.now 计时 */ }
  performance.clearMarks();
  performance.clearMeasures();

  const rand = mulberry32(cfg.seed >>> 0);
  const data = makeDataset(cfg, rand);
  const keyMax = cfg.mode === 'random' ? Math.floor(cfg.n * 1.5) : cfg.n;

  // 删除键全部来自已插入数据；点查一半命中一半随机；范围查询随机起点
  const delKeys = new Array(cfg.deletes);
  for (let i = 0; i < delKeys.length; i++) {
    delKeys[i] = data[Math.floor(rand() * data.length)];
  }
  const pointKeys = new Array(cfg.pointQ);
  for (let i = 0; i < pointKeys.length; i++) {
    pointKeys[i] = rand() < 0.5
      ? data[Math.floor(rand() * data.length)]
      : Math.floor(rand() * keyMax);
  }
  const ranges = new Array(cfg.rangeQ);
  for (let i = 0; i < ranges.length; i++) {
    const lo = Math.floor(rand() * Math.max(1, keyMax - cfg.rangeLen));
    ranges[i] = [lo, lo + cfg.rangeLen];
  }

  // 两种结构使用不同但同分布的随机源（Treap 优先级 / 跳表层数）
  const structures = [
    ['skiplist', new SkipList(mulberry32((cfg.seed ^ 0x9e3779b9) >>> 0))],
    ['treap', new Treap(mulberry32((cfg.seed ^ 0x51ab3cd7) >>> 0))],
  ];

  const metrics = {};
  const results = {};

  for (const [name, ds] of structures) {
    const label = name === 'skiplist' ? '跳表' : 'Treap';

    post({ type: 'progress', text: label + '：插入 ' + cfg.n + ' 条…' });
    const build = timed(name + '.build', () => {
      for (let i = 0; i < data.length; i++) ds.insert(data[i]);
    });

    post({ type: 'progress', text: label + '：删除 ' + cfg.deletes + ' 次…' });
    const del = timed(name + '.delete', () => {
      for (let i = 0; i < delKeys.length; i++) ds.remove(delKeys[i]);
    });

    post({ type: 'progress', text: label + '：点查 ' + cfg.pointQ + ' 次…' });
    const point = timed(name + '.point', () => {
      const res = new Array(pointKeys.length);
      for (let i = 0; i < pointKeys.length; i++) res[i] = ds.get(pointKeys[i]);
      return res;
    });

    post({ type: 'progress', text: label + '：范围查询 ' + cfg.rangeQ + ' 次…' });
    const range = timed(name + '.range', () => {
      const res = new Array(ranges.length);
      for (let i = 0; i < ranges.length; i++) {
        res[i] = ds.range(ranges[i][0], ranges[i][1], []);
      }
      return res;
    });

    results[name] = { point: point.out, range: range.out };

    const m = {
      build: build.ms, delete: del.ms, point: point.ms, range: range.ms,
      size: ds.size, memBytes: ds.memBytes(),
    };
    if (name === 'skiplist') {
      m.height = ds.level;
      m.levelCounts = ds.levelCounts();
      m.towers = ds.sampleTowers(240);
    } else {
      m.height = ds.height();
      m.depthHist = ds.depthHist();
      m.tree = ds.sampleTree(8);
    }
    metrics[name] = m;
  }

  // ---------- 一致性校验：两种结构查询结果必须完全一致 ----------
  let pointMismatch = 0;
  for (let i = 0; i < results.skiplist.point.length; i++) {
    if (results.skiplist.point[i] !== results.treap.point[i]) pointMismatch++;
  }
  let rangeMismatch = 0;
  let rangeSorted = true;
  for (let i = 0; i < results.skiplist.range.length; i++) {
    if (!flatEqual(results.skiplist.range[i], results.treap.range[i])) rangeMismatch++;
    if (!rangeIsSorted(results.skiplist.range[i])) rangeSorted = false;
  }

  const result = {
    cfg,
    metrics,
    consistency: {
      ok: pointMismatch === 0 && rangeMismatch === 0 && rangeSorted,
      pointMismatch,
      rangeMismatch,
      rangeSorted,
      pointTotal: results.skiplist.point.length,
      rangeTotal: results.skiplist.range.length,
    },
    // 同步读取 measure 缓冲区（PerformanceObserver 回调是异步派发的，
    // 这里取 getEntriesByType 保证结果消息里就能带上全部计时条目）
    measures: performance.getEntriesByType('measure')
      .map((e) => ({ name: e.name, duration: e.duration })),
    expectedHeight: Math.ceil(Math.log2(Math.max(2, metrics.treap.size))),
  };
  post({ type: 'result', result });
  return result;
}

// ---------- Worker 入口（Node 环境下不挂载，便于单元测试） ----------
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (e) => {
    if (e.data && e.data.type === 'run') {
      try {
        runBenchmark(e.data.config, (msg) => self.postMessage(msg));
      } catch (err) {
        self.postMessage({ type: 'error', message: String((err && err.stack) || err) });
      }
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SkipList, Treap, runBenchmark, mulberry32 };
}
