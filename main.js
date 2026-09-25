'use strict';

/* 主线程：只负责 UI、Canvas 渲染与 IndexedDB 持久化。
 * 全部数据结构计算都在 worker.js 中执行。 */

const $ = (id) => document.getElementById(id);
const COLORS = { skiplist: '#4fc3f7', treap: '#ffb74d' };
const PHASES = [
  ['build', '构建'],
  ['delete', '删除'],
  ['point', '点查'],
  ['range', '范围查询'],
];

let worker = null;
let longtasks = 0;

// PerformanceObserver 监控主线程长任务，验证“主线程不卡”
try {
  const ltObserver = new PerformanceObserver((list) => {
    longtasks += list.getEntries().length;
    updateLongtaskBadge();
  });
  ltObserver.observe({ entryTypes: ['longtask'] });
} catch (e) { /* 浏览器不支持 longtask 时忽略 */ }

function updateLongtaskBadge() {
  const badge = $('longtaskBadge');
  badge.textContent = '主线程长任务：' + longtasks;
  badge.className = 'badge ' + (longtasks === 0 ? 'ok' : 'bad');
}

// ---------------- IndexedDB ----------------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ds-bench', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSave(result) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('runs', 'readwrite');
    tx.objectStore('runs').add({ ts: Date.now(), result });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction('runs').objectStore('runs').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

const MODE_NAMES = { random: '随机', sorted: '有序', reversed: '逆序' };

async function renderHistory() {
  const list = $('history');
  try {
    const runs = (await idbAll()).slice(-10).reverse();
    list.innerHTML = '';
    if (runs.length === 0) {
      list.innerHTML = '<li class="empty">暂无记录</li>';
      return;
    }
    for (const run of runs) {
      const li = document.createElement('li');
      const time = new Date(run.ts).toLocaleString();
      const cfg = run.result.cfg;
      li.innerHTML =
        '<strong>' + MODE_NAMES[cfg.mode] + ' · N=' + cfg.n + '</strong>' +
        '<span class="meta">' + time +
        ' · 一致性 ' + (run.result.consistency.ok ? '✓' : '✗') + '</span>';
      li.addEventListener('click', () => renderResult(run.result));
      list.appendChild(li);
    }
  } catch (e) {
    list.innerHTML = '<li class="empty">IndexedDB 不可用</li>';
  }
}

// ---------------- Worker 调度 ----------------
function setRunning(running) {
  $('runBtn').disabled = running;
  $('stopBtn').disabled = !running;
}

function runBenchmark() {
  const cfg = {
    mode: $('mode').value,
    n: Math.max(1000, Math.floor(+$('n').value || 100000)),
    deletes: Math.max(0, Math.floor(+$('deletes').value || 0)),
    pointQ: Math.max(0, Math.floor(+$('pointQ').value || 0)),
    rangeQ: Math.max(0, Math.floor(+$('rangeQ').value || 0)),
    rangeLen: Math.max(1, Math.floor(+$('rangeLen').value || 1)),
    seed: (Math.random() * 0x7fffffff) | 0,
  };

  if (worker) worker.terminate();
  worker = new Worker('worker.js');

  longtasks = 0;
  updateLongtaskBadge();
  setRunning(true);
  $('status').textContent = 'Worker 已启动，正在生成数据…';
  $('consistencyBadge').textContent = '一致性：验证中…';
  $('consistencyBadge').className = 'badge';

  worker.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      $('status').textContent = msg.text;
    } else if (msg.type === 'error') {
      $('status').textContent = 'Worker 错误：' + msg.message;
      setRunning(false);
    } else if (msg.type === 'result') {
      $('status').textContent = '完成（N=' + msg.result.cfg.n + '，' +
        MODE_NAMES[msg.result.cfg.mode] + '数据）';
      renderResult(msg.result);
      setRunning(false);
      try {
        await idbSave(msg.result);
        renderHistory();
      } catch (err) { /* 持久化失败不影响展示 */ }
    }
  };
  worker.onerror = (err) => {
    $('status').textContent = 'Worker 异常：' + err.message;
    setRunning(false);
  };
  worker.postMessage({ type: 'run', config: cfg });
}

function stopBenchmark() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  $('status').textContent = '已停止。';
  setRunning(false);
}

// ---------------- 结果渲染 ----------------
function fmtMs(v) { return v.toFixed(1) + ' ms'; }
function fmtMB(bytes) { return (bytes / 1048576).toFixed(2) + ' MB'; }

function renderResult(result) {
  const { metrics, consistency, measures, expectedHeight } = result;

  const badge = $('consistencyBadge');
  if (consistency.ok) {
    badge.textContent = '一致性：✓ 点查 ' + consistency.pointTotal +
      ' 条 + 范围 ' + consistency.rangeTotal + ' 条全部一致，范围结果有序';
    badge.className = 'badge ok';
  } else {
    badge.textContent = '一致性：✗ 点查不一致 ' + consistency.pointMismatch +
      '，范围不一致 ' + consistency.rangeMismatch;
    badge.className = 'badge bad';
  }
  $('poBadge').textContent = 'PerformanceObserver 条目：' + measures.length;

  const sl = metrics.skiplist;
  const tp = metrics.treap;
  const rows = [
    ['构建耗时（插入全部）', fmtMs(sl.build), fmtMs(tp.build)],
    ['删除耗时', fmtMs(sl.delete), fmtMs(tp.delete)],
    ['点查总耗时', fmtMs(sl.point), fmtMs(tp.point)],
    ['范围查询总耗时', fmtMs(sl.range), fmtMs(tp.range)],
    ['层数 / 树高', sl.height + ' 层', tp.height + ' 层'],
    ['理论期望高度 log₂(N)', expectedHeight, expectedHeight],
    ['唯一键数量', sl.size, tp.size],
    ['估算内存占用', fmtMB(sl.memBytes), fmtMB(tp.memBytes)],
  ];
  $('metricsTable').querySelector('tbody').innerHTML = rows
    .map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>')
    .join('');

  drawTiming(metrics);
  drawSkiplist(sl);
  drawTreap(tp);
  drawDist(sl, tp);
}

// ---------------- Canvas 绘制 ----------------
function ctx2d(id) {
  const c = $(id);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  return [ctx, c.width, c.height];
}

function drawLegend(ctx, x, y) {
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.skiplist;
  ctx.fillRect(x, y - 9, 10, 10);
  ctx.fillStyle = '#dbe4f5';
  ctx.fillText('跳表', x + 14, y);
  ctx.fillStyle = COLORS.treap;
  ctx.fillRect(x + 60, y - 9, 10, 10);
  ctx.fillStyle = '#dbe4f5';
  ctx.fillText('Treap', x + 74, y);
}

function drawTiming(metrics) {
  const [ctx, W, H] = ctx2d('timingChart');
  const padL = 56, padR = 16, padT = 28, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let max = 0;
  for (const s of ['skiplist', 'treap']) {
    for (const [p] of PHASES) max = Math.max(max, metrics[s][p]);
  }
  if (max <= 0) max = 1;

  // 网格与纵轴刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = '#8b98b8';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - (plotH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(((max * g) / 4).toFixed(0), padL - 6, y + 4);
  }

  const groupW = plotW / PHASES.length;
  PHASES.forEach(([phase, label], gi) => {
    ['skiplist', 'treap'].forEach((s, si) => {
      const v = metrics[s][phase];
      const bw = groupW / 3.2;
      const x = padL + gi * groupW + (si + 0.6) * bw;
      const h = (v / max) * plotH;
      ctx.fillStyle = COLORS[s];
      ctx.fillRect(x, padT + plotH - h, bw * 0.82, h);
      ctx.fillStyle = '#dbe4f5';
      ctx.textAlign = 'center';
      ctx.fillText(v.toFixed(1), x + bw * 0.41, padT + plotH - h - 5);
    });
    ctx.fillStyle = '#8b98b8';
    ctx.textAlign = 'center';
    ctx.fillText(label, padL + gi * groupW + groupW / 2, H - padB + 18);
  });
  drawLegend(ctx, padL + 6, 16);
}

function drawSkiplist(sl) {
  const [ctx, W, H] = ctx2d('slCanvas');
  const towers = sl.towers || [];
  if (towers.length === 0) return;
  const maxLvl = sl.height;
  const padB = 22, padT = 8;
  const rowH = (H - padB - padT) / maxLvl;
  const colW = W / towers.length;

  towers.forEach((lvl, i) => {
    for (let l = 0; l < lvl; l++) {
      ctx.fillStyle = 'hsl(' + (205 - l * 14) + ',75%,' + (42 + l * 3.2) + '%)';
      ctx.fillRect(i * colW, H - padB - (l + 1) * rowH, Math.max(1, colW - 0.4), rowH - 0.8);
    }
  });

  ctx.fillStyle = '#8b98b8';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('当前最高 ' + maxLvl + ' 层 · 抽样 ' + towers.length + ' 列（共 ' +
    sl.size + ' 节点）', 6, H - 6);
}

function drawTreap(tp) {
  const [ctx, W, H] = ctx2d('tpCanvas');
  const nodes = tp.tree || [];
  if (nodes.length === 0) return;

  let maxD = 0;
  for (const n of nodes) if (n.d > maxD) maxD = n.d;
  const padT = 14, padB = 24;
  const rowH = (H - padT - padB) / (maxD + 1);
  const posX = (n) => ((n.i + 0.5) / Math.pow(2, n.d)) * W;
  const posY = (n) => padT + n.d * rowH + rowH / 2;

  const byKey = new Map();
  for (const n of nodes) byKey.set(n.d + ':' + n.i, n);

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  for (const n of nodes) {
    if (n.pi < 0) continue;
    const parent = byKey.get((n.d - 1) + ':' + n.pi);
    if (!parent) continue;
    ctx.beginPath();
    ctx.moveTo(posX(parent), posY(parent));
    ctx.lineTo(posX(n), posY(n));
    ctx.stroke();
  }

  const r = Math.max(2.5, Math.min(7, rowH * 0.28));
  for (const n of nodes) {
    ctx.beginPath();
    ctx.arc(posX(n), posY(n), r, 0, Math.PI * 2);
    ctx.fillStyle = n.c > 1 ? '#ef5350' : COLORS.treap;
    ctx.fill();
  }

  ctx.fillStyle = '#8b98b8';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('树高 ' + tp.height + ' · 显示顶部 ' + (maxD + 1) + ' 层（共 ' +
    tp.size + ' 节点）· 红点=重复键', 6, H - 6);
}

function drawDist(sl, tp) {
  const [ctx, W, H] = ctx2d('distChart');
  const a = sl.levelCounts || [];
  const b = tp.depthHist || [];
  if (a.length === 0 && b.length === 0) return;

  const padL = 56, padR = 16, padT = 28, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxCount = Math.max(1, ...a, ...b);
  const maxIdx = Math.max(a.length, b.length);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = '#8b98b8';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - (plotH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(String(Math.round((maxCount * g) / 4)), padL - 6, y + 4);
  }

  function plotSeries(arr, color) {
    if (arr.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    arr.forEach((count, i) => {
      const x = padL + (i / Math.max(1, maxIdx - 1)) * plotW;
      const y = padT + plotH - (count / maxCount) * plotH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  plotSeries(a, COLORS.skiplist);
  plotSeries(b, COLORS.treap);

  ctx.fillStyle = '#8b98b8';
  ctx.textAlign = 'center';
  ctx.fillText('层号 / 深度 →', padL + plotW / 2, H - 8);
  drawLegend(ctx, padL + 6, 16);
}

// ---------------- 启动 ----------------
$('runBtn').addEventListener('click', runBenchmark);
$('stopBtn').addEventListener('click', stopBenchmark);
updateLongtaskBadge();
renderHistory();
