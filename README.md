# 跳表 vs Treap 查询性能对比工具

纯前端实现：所有数据结构运算在 **Web Worker** 中执行，主线程只负责 **Canvas** 渲染；
计时经 **PerformanceObserver**（Worker 内 `measure` 条目 + 主线程 `longtask` 监控）采集，
历史结果持久化到 **IndexedDB**。

## 运行

Worker 不能从 `file://` 加载，需要任意静态服务器：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 功能

- 两种结构：跳表（随机层数，几何分布 p=0.5，封顶 32 层）、Treap（随机优先级 + 旋转）
- 操作：插入 / 删除 / 点查 / 闭区间范围查询（`lo > hi` 自动交换）
- 三种输入模式：随机（值域 1.5N，天然含重复键）、有序、逆序
- 重复键：节点计数语义，删除先减计数、归零才摘除节点
- 一致性校验：两种结构的点查与范围查询结果逐条比对，并验证范围结果升序
- 指标：各阶段耗时、层数/树高（对照理论 log₂N）、唯一键数、估算内存
- 可视化：跳表抽样塔高图、Treap 顶部 9 层形态图（红点=重复键）、层数/深度分布曲线、分阶段耗时柱状图
- 主线程长任务计数为 0 即证明 10 万条数据下 UI 不卡

## 文件

- `worker.js` — 数据结构 + 基准测试（Node 可直接 require）
- `main.js` — 主线程：Worker 调度、Canvas 渲染、IndexedDB 历史
- `index.html` / `styles.css` — 页面
- `test-sanity.js` — Node 冒烟测试：`node test-sanity.js`
