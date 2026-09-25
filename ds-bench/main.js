/*
 * main.js — 主线程：仅负责 UI、Canvas 渲染、IndexedDB 历史记录。
 * 所有计算都在 worker.js 中执行。
 * 使用 PerformanceObserver 监听 longtask，证明主线程不卡。
 */
'use strict';

const $ = (id) => document.getElementById(id);

/* ---------------- IndexedDB：历史记录 ---------------- */
const DB_NAME = 'ds-bench';
const STORE = 'runs';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRun(record) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) { console.warn('IndexedDB 保存失败', e); }
}

async function loadRuns() {
  try {
    const db = await openDB();
    const rows = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.sort((a, b) => b.id - a.id).slice(0, 10);
  } catch (e) { return []; }
}

async function renderHistory() {
  const rows = await loadRuns();
  const tbody = $('historyBody');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    const modeName = { random: '随机', asc: '有序', desc: '逆序' }[r.mode] || r.mode;
    tr.innerHTML =
      `<td>${new Date(r.time).toLocaleTimeString()}</td><td>${modeName}</td><td>${r.n}</td>` +
      `<td>${r.insert.sl} / ${r.insert.tp}</td>` +
      `<td>${r.search.sl} / ${r.search.tp}</td>` +
      `<td>${r.range.sl} / ${r.range.tp}</td>` +
      `<td>${r.del.sl} / ${r.del.tp}</td>` +
      `<td>${r.height.sl} / ${r.height.tp}</td>` +
      `<td>${r.consistent && r.postConsistent && !r.rangeMismatch ? '✅' : '❌'}</td>`;
    tbody.appendChild(tr);
  }
}

/* ---------------- 主线程卡顿监控 ---------------- */
let longtaskCount = 0;
let longtaskTotal = 0;
if ('PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      longtaskCount++;
      longtaskTotal += e.duration;
      $('longtask').textContent = `${longtaskCount} 次 / ${longtaskTotal.toFixed(0)}ms`;
    }
  }).observe({ entryTypes: ['longtask'] });
}

/* ---------------- Canvas 渲染 ---------------- */
function drawSkipList(canvas, levels, levelCounts) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!levels || !levels.length) return;
  const rows = levels.length;
  const rowH = (H - 30) / rows;
  const allKeys = levels[rows - 1]; // 最底层
  const min = allKeys.length ? allKeys[0] : 0;
  const max = allKeys.length ? allKeys[allKeys.length - 1] : 1;
  const span = Math.max(1, max - min);

  ctx.font = '11px monospace';
  for (let i = 0; i < rows; i++) {
    const y = 15 + i * rowH;
    const lvl = rows - i; // 层号（顶层最大）
    ctx.strokeStyle = '#2a2f3a';
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 10, y); ctx.stroke();
    ctx.fillStyle = '#8b93a7';
    ctx.fillText('L' + (lvl - 1) + (levelCounts ? ` (${levelCounts[lvl - 1]})` : ''), 2, y + 3);
    ctx.fillStyle = '#4fc3f7';
    for (const k of levels[i]) {
      const x = 30 + ((k - min) / span) * (W - 45);
      ctx.fillRect(x - 1, y - 2, 2, 4);
    }
  }
}

function drawTreap(canvas, nodes) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!nodes || !nodes.length) return;
  let maxDepth = 0;
  for (const nd of nodes) if (nd.depth > maxDepth) maxDepth = nd.depth;
  const pos = new Map(); // "depth,slot" -> {x,y}
  const rowH = (H - 40) / (maxDepth + 1);
  for (const nd of nodes) {
    const slots = Math.pow(2, nd.depth);
    const x = 20 + ((nd.slot + 0.5) / slots) * (W - 40);
    const y = 20 + nd.depth * rowH;
    pos.set(nd.depth + ',' + nd.slot, { x, y });
  }
  // 边
  ctx.strokeStyle = '#3a4152';
  for (const nd of nodes) {
    const p = pos.get(nd.depth + ',' + nd.slot);
    const l = pos.get((nd.depth + 1) + ',' + (nd.slot * 2));
    const r = pos.get((nd.depth + 1) + ',' + (nd.slot * 2 + 1));
    if (l) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(l.x, l.y); ctx.stroke(); }
    if (r) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(r.x, r.y); ctx.stroke(); }
  }
  // 节点
  for (const nd of nodes) {
    const p = pos.get(nd.depth + ',' + nd.slot);
    ctx.fillStyle = nd.count > 1 ? '#ffb74d' : '#81c784';
    ctx.beginPath(); ctx.arc(p.x, p.y, nd.depth < 5 ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    if (nd.depth < 5) {
      ctx.fillStyle = '#0d1117';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(nd.key).slice(0, 4), p.x, p.y + 2.5);
    }
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8b93a7';
  ctx.font = '11px monospace';
  ctx.fillText(`(显示前 ${maxDepth + 1} 层 / ${nodes.length} 节点，橙色=重复键)`, 8, H - 6);
}

/* ---------------- 指标渲染 ---------------- */
function fmtBytes(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

function renderMetrics(m) {
  const rows = [
    ['插入总耗时', m.insert.sl, m.insert.tp, 'ms'],
    [`点查 ${m.search.count} 次`, m.search.sl, m.search.tp, 'ms'],
    [`范围查询 ${m.range.count} 次`, m.range.sl, m.range.tp, 'ms'],
    [`删除 ${m.del.count} 次`, m.del.sl, m.del.tp, 'ms'],
    ['内存估算', fmtBytes(m.memory.slEstimate), fmtBytes(m.memory.tpEstimate), ''],
    ['高度 / 层数', m.height.sl, m.height.tp, ''],
  ];
  const tbody = $('metricsBody');
  tbody.innerHTML = '';
  for (const [label, sl, tp, unit] of rows) {
    const tr = document.createElement('tr');
    const slNum = typeof sl === 'number' ? sl : NaN;
    const tpNum = typeof tp === 'number' ? tp : NaN;
    let clsSl = '', clsTp = '';
    if (!isNaN(slNum) && !isNaN(tpNum) && slNum !== tpNum) {
      if (slNum < tpNum) clsSl = ' class="win"'; else clsTp = ' class="win"';
    }
    tr.innerHTML = `<td>${label}</td>` +
      `<td${clsSl}>${sl}${unit ? ' ' + unit : ''}</td>` +
      `<td${clsTp}>${tp}${unit ? ' ' + unit : ''}</td>`;
    tbody.appendChild(tr);
  }
  $('statInfo').textContent =
    `唯一键 ${m.size.toLocaleString()} / 总元素 ${m.totalCount.toLocaleString()} ` +
    `(重复 ${m.duplicates.toLocaleString()}) · 点查命中 SL=${m.search.slHits} Treap=${m.search.tpHits} · ` +
    `范围结果数 SL=${m.range.slTotal.toLocaleString()} Treap=${m.range.tpTotal.toLocaleString()}` +
    (m.memory.heapDelta ? ` · JS堆增量 ${fmtBytes(m.memory.heapDelta)}` : '');

  const ok = m.consistent && m.postConsistent && !m.rangeMismatch;
  const el = $('consistency');
  el.textContent = ok
    ? '✅ 一致性校验通过：插入后全量一致、范围查询一致、删除后结构一致'
    : `❌ 一致性校验失败 (insert=${m.consistent}, range=${!m.rangeMismatch}, delete=${m.postConsistent})`;
  el.className = ok ? 'ok' : 'bad';
}

/* ---------------- 运行控制 ---------------- */
let worker = null;
let running = false;

function setRunning(flag) {
  running = flag;
  $('runBtn').disabled = flag;
  $('runBtn').textContent = flag ? '运行中…' : '开始基准测试';
}

function runBench() {
  if (running) return;
  if (worker) worker.terminate();
  worker = new Worker('worker.js');
  setRunning(true);
  longtaskCount = 0; longtaskTotal = 0;
  $('longtask').textContent = '0 次 / 0ms';
  $('progressBar').style.width = '0%';
  $('progressText').textContent = '启动中…';
  $('consistency').textContent = '';

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      $('progressBar').style.width = msg.pct + '%';
      $('progressText').textContent = msg.stage;
    } else if (msg.type === 'result') {
      $('progressBar').style.width = '100%';
      $('progressText').textContent = '完成';
      renderMetrics(msg.metrics);
      drawSkipList($('slCanvas'), msg.snapshot.slLevels, msg.snapshot.slLevelCounts);
      drawTreap($('tpCanvas'), msg.snapshot.treapNodes);
      saveRun({ time: Date.now(), ...msg.metrics }).then(renderHistory);
      setRunning(false);
    } else if (msg.type === 'error') {
      $('progressText').textContent = '出错：' + msg.message;
      setRunning(false);
    }
  };
  worker.onerror = (err) => {
    $('progressText').textContent = 'Worker 错误：' + err.message;
    setRunning(false);
  };

  worker.postMessage({
    n: +$('nInput').value,
    mode: $('modeSelect').value,
    queryCount: +$('queryInput').value,
    rangeCount: +$('rangeInput').value,
    rangeSpan: +$('spanInput').value,
    deleteCount: +$('deleteInput').value,
    seed: (Math.random() * 1e9) | 0,
  });
}

$('runBtn').addEventListener('click', runBench);
renderHistory();
