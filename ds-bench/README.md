# 跳表 vs Treap — 查询性能对比工具

纯前端实现，无需构建。所有数据结构运算在 **Web Worker** 中执行，主线程只负责渲染；
计时经 **PerformanceObserver** 收集，历史结果持久化到 **IndexedDB**，结构形态用 **Canvas** 可视化。

## 运行

浏览器不允许从 `file://` 加载 Worker，需启动本地静态服务：

```bash
cd ds-bench
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 功能

- **两种结构**：跳表（随机层数 p=0.5，最高 20 层）与 Treap（BST + 堆优先级旋转）
- **四种操作**：插入、删除、点查、范围查询（闭区间，结果有序）
- **三种输入模式**：随机（值域 1.5n，故意含重复键）、有序、逆序
- **重复键**：节点计数，重复插入只加计数，删除减计数归零才移除
- **指标**：各操作耗时、内存估算（含 JS 堆增量）、跳表层数 / Treap 高度
- **可视化**：跳表逐层采样图、Treap 顶部 12 层树形图（橙色 = 重复键节点）
- **一致性校验**：插入后全量遍历一致、范围查询抽样一致、删除后再校验
- **主线程不卡证明**：页面实时显示 longtask(>50ms) 计数，运行期间应为 0

## 文件

| 文件 | 说明 |
|---|---|
| `structures.js` | SkipList / Treap / 数据生成（Worker 与 Node 双兼容） |
| `worker.js` | 基准测试流程，PerformanceObserver 计时 |
| `main.js` | UI、Canvas 渲染、IndexedDB 历史、longtask 监控 |
| `index.html` | 页面布局 |
| `test.js` | 数据结构正确性测试：`node test.js` |
| `test-worker-all.js` | Worker 基准流程三模式回归：`node test-worker-all.js` |
