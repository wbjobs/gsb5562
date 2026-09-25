/*
 * structures.js — 跳表 (SkipList) 与 Treap（平衡树）实现
 * 同时兼容 Web Worker (importScripts) 与 Node (require)，便于离线测试。
 * 重复键处理：每个节点保存 count 计数，重复插入只增加计数，删除减计数，归零才移除节点。
 */
(function (global) {
  'use strict';

  /* ---------------- 可复现随机数（LCG） ---------------- */
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ======================= 跳表 ======================= */
  const SL_MAX_LEVEL = 20; // 足以容纳 100 万元素 (p=0.5 时期望层数 ~log2(n))
  const SL_P = 0.5;

  class SkipListNode {
    constructor(key, level) {
      this.key = key;
      this.count = 1;
      this.forward = new Array(level).fill(null);
    }
  }

  class SkipList {
    constructor(seed) {
      this.head = new SkipListNode(-Infinity, SL_MAX_LEVEL);
      this.level = 1;          // 当前最高非空层
      this.size = 0;           // 去重后的键数
      this.totalCount = 0;     // 含重复的总元素数
      this.nodeCount = 1;      // 含头节点，用于内存估算
      this.rand = makeRng(seed === undefined ? 42 : seed);
    }

    randomLevel() {
      let lvl = 1;
      while (lvl < SL_MAX_LEVEL && this.rand() < SL_P) lvl++;
      return lvl;
    }

    // 返回每层最后一个小于 key 的节点
    _updatePath(key) {
      const update = new Array(SL_MAX_LEVEL);
      let cur = this.head;
      for (let i = this.level - 1; i >= 0; i--) {
        while (cur.forward[i] && cur.forward[i].key < key) cur = cur.forward[i];
        update[i] = cur;
      }
      return update;
    }

    insert(key) {
      const update = this._updatePath(key);
      const next = update[0].forward[0];
      if (next && next.key === key) {
        next.count++;            // 重复键：仅计数
        this.totalCount++;
        return false;
      }
      const lvl = this.randomLevel();
      if (lvl > this.level) {
        for (let i = this.level; i < lvl; i++) update[i] = this.head;
        this.level = lvl;
      }
      const node = new SkipListNode(key, lvl);
      for (let i = 0; i < lvl; i++) {
        node.forward[i] = update[i].forward[i];
        update[i].forward[i] = node;
      }
      this.size++;
      this.totalCount++;
      this.nodeCount++;
      return true;
    }

    search(key) {
      let cur = this.head;
      for (let i = this.level - 1; i >= 0; i--) {
        while (cur.forward[i] && cur.forward[i].key < key) cur = cur.forward[i];
      }
      cur = cur.forward[0];
      return cur && cur.key === key ? cur.count : 0;
    }

    delete(key) {
      const update = this._updatePath(key);
      const target = update[0].forward[0];
      if (!target || target.key !== key) return false;
      if (target.count > 1) {
        target.count--;          // 重复键：先减计数
        this.totalCount--;
        return true;
      }
      for (let i = 0; i < this.level; i++) {
        if (update[i].forward[i] !== target) break;
        update[i].forward[i] = target.forward[i];
      }
      while (this.level > 1 && !this.head.forward[this.level - 1]) this.level--;
      this.size--;
      this.totalCount--;
      this.nodeCount--;
      return true;
    }

    // 范围查询 [lo, hi]，闭区间，结果有序，重复键按 count 展开
    range(lo, hi) {
      const res = [];
      let cur = this.head;
      for (let i = this.level - 1; i >= 0; i--) {
        while (cur.forward[i] && cur.forward[i].key < lo) cur = cur.forward[i];
      }
      cur = cur.forward[0];
      while (cur && cur.key <= hi) {
        for (let c = 0; c < cur.count; c++) res.push(cur.key);
        cur = cur.forward[0];
      }
      return res;
    }

    // 升序遍历全部（含重复展开）
    toArray() {
      const res = [];
      let cur = this.head.forward[0];
      while (cur) {
        for (let c = 0; c < cur.count; c++) res.push(cur.key);
        cur = cur.forward[0];
      }
      return res;
    }

    getHeight() { return this.level; }

    // 每层节点数（不含头节点）
    levelCounts() {
      const counts = new Array(this.level).fill(0);
      for (let i = 0; i < this.level; i++) {
        let cur = this.head.forward[i];
        while (cur) { counts[i]++; cur = cur.forward[i]; }
      }
      return counts;
    }

    // 可视化快照：每层最多采样 maxPerLevel 个键
    snapshot(maxPerLevel) {
      const levels = [];
      for (let i = this.level - 1; i >= 0; i--) {
        const keys = [];
        let cur = this.head.forward[i];
        while (cur && keys.length < maxPerLevel) { keys.push(cur.key); cur = cur.forward[i]; }
        levels.push(keys);
      }
      return levels; // levels[0] 是最高层
    }

    estimateBytes() {
      // 节点对象头 + key/count 字段 + forward 数组（按实际层数）
      let bytes = 0;
      let cur = this.head.forward[0];
      while (cur) {
        bytes += 48 + 16 + 8 * cur.forward.length;
        cur = cur.forward[0];
      }
      return bytes + 48 + 16 + 8 * SL_MAX_LEVEL; // 头节点
    }
  }

  /* ======================= Treap ======================= */
  class TreapNode {
    constructor(key, priority) {
      this.key = key;
      this.priority = priority;
      this.count = 1;
      this.left = null;
      this.right = null;
    }
  }

  class Treap {
    constructor(seed) {
      this.root = null;
      this.size = 0;
      this.totalCount = 0;
      this.rand = makeRng(seed === undefined ? 7 : seed);
    }

    _rotateRight(y) {
      const x = y.left;
      y.left = x.right;
      x.right = y;
      return x;
    }

    _rotateLeft(x) {
      const y = x.right;
      x.right = y.left;
      y.left = x;
      return y;
    }

    insert(key) {
      const prio = this.rand();
      this.root = this._insert(this.root, key, prio);
    }

    _insert(node, key, prio) {
      if (!node) {
        this.size++;
        this.totalCount++;
        return new TreapNode(key, prio);
      }
      if (key === node.key) {
        node.count++;            // 重复键：仅计数
        this.totalCount++;
        return node;
      }
      if (key < node.key) {
        node.left = this._insert(node.left, key, prio);
        if (node.left.priority > node.priority) node = this._rotateRight(node);
      } else {
        node.right = this._insert(node.right, key, prio);
        if (node.right.priority > node.priority) node = this._rotateLeft(node);
      }
      return node;
    }

    search(key) {
      let cur = this.root;
      while (cur) {
        if (key === cur.key) return cur.count;
        cur = key < cur.key ? cur.left : cur.right;
      }
      return 0;
    }

    delete(key) {
      this.root = this._delete(this.root, key);
    }

    _delete(node, key) {
      if (!node) return null;
      if (key < node.key) {
        node.left = this._delete(node.left, key);
        return node;
      }
      if (key > node.key) {
        node.right = this._delete(node.right, key);
        return node;
      }
      // 找到目标
      if (node.count > 1) {
        node.count--;            // 重复键：先减计数
        this.totalCount--;
        return node;
      }
      this.size--;
      this.totalCount--;
      if (!node.left) return node.right;
      if (!node.right) return node.left;
      // 双子：把优先级高的孩子旋上来，目标下沉后继续删
      if (node.left.priority > node.right.priority) {
        node = this._rotateRight(node);
        node.right = this._delete(node.right, key);
      } else {
        node = this._rotateLeft(node);
        node.left = this._delete(node.left, key);
      }
      return node;
    }

    // 范围查询 [lo, hi]，闭区间，迭代中序遍历，结果有序
    range(lo, hi) {
      const res = [];
      const stack = [];
      let cur = this.root;
      while (cur || stack.length) {
        while (cur) {
          if (cur.key >= lo) { stack.push(cur); cur = cur.left; }
          else cur = cur.right;
        }
        if (!stack.length) break;
        cur = stack.pop();
        if (cur.key > hi) break;
        for (let c = 0; c < cur.count; c++) res.push(cur.key);
        cur = cur.right;
      }
      return res;
    }

    toArray() {
      const res = [];
      const stack = [];
      let cur = this.root;
      while (cur || stack.length) {
        while (cur) { stack.push(cur); cur = cur.left; }
        cur = stack.pop();
        for (let c = 0; c < cur.count; c++) res.push(cur.key);
        cur = cur.right;
      }
      return res;
    }

    getHeight() {
      let h = 0;
      const stack = [[this.root, 1]];
      while (stack.length) {
        const [node, d] = stack.pop();
        if (!node) continue;
        if (d > h) h = d;
        stack.push([node.left, d + 1], [node.right, d + 1]);
      }
      return h;
    }

    // 可视化快照：按层输出前 maxDepth 层节点 {depth, pos, key}
    // pos 为该层内从左到右的序号（含空位占位由渲染端按二叉树位置推算）
    snapshot(maxDepth, maxNodes) {
      const nodes = [];
      if (!this.root) return nodes;
      const queue = [[this.root, 0, 0]]; // node, depth, 水平槽位 index
      while (queue.length && nodes.length < maxNodes) {
        const [node, depth, slot] = queue.shift();
        if (!node || depth > maxDepth) continue;
        nodes.push({ depth, slot, key: node.key, count: node.count });
        queue.push([node.left, depth + 1, slot * 2]);
        queue.push([node.right, depth + 1, slot * 2 + 1]);
      }
      return nodes;
    }

    estimateBytes() {
      // 每节点：对象头 + key/priority/count/left/right 五个字段
      return this.size * (48 + 5 * 8);
    }
  }

  /* ======================= 数据生成 ======================= */
  function generateKeys(n, mode, seed) {
    const keys = new Array(n);
    if (mode === 'asc') {
      for (let i = 0; i < n; i++) keys[i] = i * 2;
    } else if (mode === 'desc') {
      for (let i = 0; i < n; i++) keys[i] = (n - i) * 2;
    } else {
      // random：值域取 1.5n，故意制造一部分重复键以验证重复键处理
      const rand = makeRng(seed === undefined ? 1234 : seed);
      const bound = Math.floor(n * 1.5);
      for (let i = 0; i < n; i++) keys[i] = Math.floor(rand() * bound);
    }
    return keys;
  }

  const api = { SkipList, Treap, generateKeys, makeRng, SL_MAX_LEVEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DS = api;
})(typeof self !== 'undefined' ? self : globalThis);
