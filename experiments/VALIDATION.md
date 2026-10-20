# 验证记录 · 2026-10-20（真实 DeepSeek 接入后更新）

分支：`codex/deepseek-rag-demo`，非正式演示。

## 自动化与构建

- 后端 TypeScript 构建：通过。
- 前端 Next.js 生产构建：通过，包含 `/demo`，类型检查通过。
- 9 个专项子测试通过（Node 包括父测试汇总为 10 pass）。新增当前日期上下文、明确关闭思考模式及缓存命中费用计算检查。
- HTTP 参数校验：空问题、未知模式、非法上下文、日期倒序、超长问题全部返回 400。
- 明确问题但知识库无相关资料：返回 200 / insufficient_evidence，sources 与 citations 为空。
- 首次空检索测试的问题本身未指明哪项安理会决议，模型合理追问；原测试仅接受资料不足，判断标准过窄。保留原记录 http-initial.json，改用明确问题验证无结果场景，未修改产品逻辑迎合错误测试。

## 云端与浏览器

- DeepSeek API Key 已成功使用，未写入代码、实验日志或前端。
- 初始接入 14/14、受控 v2 14/14、最终 v3 14/14、上下文精简 2/2 调用成功。
- 真实模型为 deepseek-flash，明确记录 requestedModel 与返回 model。
- `/demo` 两组实际请求成功，双栏显示回答、中文状态、真实模型、Token 与估算费用。
- 展开引用卡片确认原文、日期、检索分数和来源链接可见；浏览器错误日志为空。
- 截图：backend/data/screenshots/comparison.jpg。
- 当前本地演示服务为 http://localhost:3000/demo，后端为 4000 端口；不依赖 MySQL。

## 故障与证据

- 实际关闭本地端口得到 ECONNREFUSED，转换为 502；记录 failure-check.json 与 runs 日志。
- 单元测试模拟超时、错误 JSON、伪造引用，均返回明确错误；真实 DeepSeek 可用性已通过上述成功调用验证。
- 知识库 30 条摘要 / 30 片段，版本 d2d5c794b5a92fab。
- 结果分析、Prompt 修改前后、上下文变化、费用与局限见 RESULTS.md。

尚需学生人工确认评分及填写个人信息，再整理提交 PDF。完整地图的既有 MySQL 账户问题未在本轮改动；没有推送分支。
