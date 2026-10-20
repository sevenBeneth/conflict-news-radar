# DeepSeek + 本地 RAG 非正式演示

分支：`codex/deepseek-rag-demo`。这一分支把原 Ollama 问答入口替换为 DeepSeek 云端问答；原版可以从分支创建前的 Git 历史查看。地图业务保留。适合实验演示，已完成真实调用与样例对比，详见 [RESULTS.md](RESULTS.md)。

## 快速运行（无须 MySQL）

在项目根 `.env` 填写 `DEEPSEEK_API_KEY=你的密钥`。可选设置 `DEEPSEEK_MODEL=deepseek-flash`、`DEEPSEEK_BASE_URL=https://api.deepseek.com`。不要将 Key 提交到仓库。Key 只由后端读取。

分别在两个终端运行：

```powershell
npm run dev:demo --prefix backend
npm run dev --prefix frontend
```

访问 http://localhost:3000/demo 。若 4000 端口已运行完整后端，直接使用该后端，无须重复启动 demo 服务。完整地图入口仍为 `/`，需要原有 MySQL 与采集服务。

页面支持直接问答、RAG、同时对比；每次发送为独立上下文。对比通常产生两次收费调用。地区为文本精确包含过滤；日期按浏览器本地时区转换为 UTC。筛选的是报道发布时间，不是事件发生日期。

## 本地知识库

```powershell
# 从项目已有公开 RSS 源取最多 30 条摘要，不抓取全文
npm run knowledge:fetch --prefix workers
# 本地清洗、去重、切分并生成知识库
npm run rag --prefix backend -- import data/news.json
# 或从本机 MySQL 导出待审核草稿
npm run rag --prefix backend -- export-news news-draft.json
```

导出的数据库草稿须核实使用权限、敏感信息和无关内容后再导入。RSS 摘要仅限本地教学演示；版权归原发布方，并未取得全文再分发授权。不要将本地新闻快照上传公共仓库。输入资料绝不能包含密码、个人敏感信息或未授权资料。

输入为 JSON 数组，每个对象必须有字符串字段：`id,title,text,source,url,publishedAt,permission`。URL 仅接受 HTTP(S)，日期需可解析。支持自行整理的有授权资料；不依赖向量服务。

原始资料在 `backend/data/news.json`，知识库在 `backend/data/knowledge.json`，运行记录在 `backend/data/runs/`。这些目录均被 Git 忽略；Docker 将该目录挂载至 `/app/data`。可用 `RAG_DATA_DIR` 覆盖输出位置。

按完整句子组合，目标每块 500 字以内；上一块末句不超过 80 字时作为重叠。超长单句优先保持完整，允许超过目标长度。短摘要独立成块。正文哈希去重，片段包含来源与发布时间，内容及元数据共同决定知识库版本。重新导入原子替换快照，实验期间不要更新。

当前本地快照：2026-10-20 获取 30 条公开摘要，30 个片段。抽查前三块的句子、标题、链接与 RSS 一致；短摘要没有截断。没有把摘要补写成全文。RSS 中观点保留为“某方称”，不能当成独立核实事实。

## 检索与引用

中文分词使用 Node `Intl.Segmenter`，过滤常见停用词、日期数字与孤立单字，并补充少量专名与美乌／俄乌别称。BM25 参数 k1=1.2、b=0.75；按分数降序取 Top-4。至少命中两个非停用查询词；只有一个查询词时至少命中一个。此规则为启发式，已按当前固定问题检查检索，尚未通过真实模型回答完成调优，不把得分解释为概率。

上下文包括任务要求、用户问题、筛选条件及带 S1…S4 编号的资料。直接组不传资料。程序检查 JSON 字段、引用编号与正文标记，RAG 正常回答必须带引用；语义上是否支持结论仍须人工检查。空检索仍调用模型，以区分追问、超范围和资料不足，禁止无依据正常回答。

## 接口与模块

`POST /ai/analyze`：

```json
{"query":"某地区有哪些动态？","mode":"rag","promptVersion":"v3","context":{"region":"乌克兰","from":"2026-10-19T00:00:00Z","to":"2026-10-20T23:59:59Z"}}
```

返回 `response,status,follow_up,citations,sources,model,mode,runId,knowledgeVersion,elapsedMs,usage,calls,contextChars`。`sources` 包含原文、BM25 分数和命中词；属于检索候选，不一定全部被引用。

400：输入无效；503：缺少 Key；502：云端失败或输出/引用不合格；504：60 秒超时。浏览器超时为 75 秒。`GET /ai/status` 的 available 仅代表已配置 Key，connectivity=unchecked，不代表已验证云端在线。

可直接调用 `services/knowledge.ts` 的 buildKnowledge/loadKnowledge/retrieve 与 `services/answer.ts` 的 answer；CLI 可在没有数据库时运行。answer 本身为内部可信接口，HTTP 参数检查在 routes/ai.ts。

## 可复现实验

固定问题与判断规则：`experiments/questions.json`（7题，与当前冻结快照匹配）。新快照可能不包含答案，更新题集必须显式形成新实验版本。

```powershell
npm run rag --prefix backend -- evaluate ../experiments/questions.json
$env:PROMPT_VERSION='v1'
npm run rag --prefix backend -- evaluate ../experiments/questions.json
Remove-Item Env:PROMPT_VERSION
```

v2 增加不执行资料中指令、区分时间与报道说法、禁止补全缺失数字、明确矛盾的约束。v1 保留基本任务、JSON 格式及 RAG 引用约束。修改目的是减少时间混淆和无依据补充；默认 v3 增加当前日期上下文，修复实测出现的过去日期被当作未来问题；完整对比见 RESULTS.md。

每题两组使用同一模型、temperature=0.2、top_p=1、thinking=disabled、max_tokens=1200。运行记录保存完整 messages、参数、原始返回、检索片段、用量、耗时和错误，不记录鉴权请求头。运行结果中的 humanJudgment 留空，人工按“正确性、遗漏、无依据内容、引用支持程度”逐题填写。无答案题需区分模型已有知识与资料支持，不能将拒答一概判错。

费用应按运行当日 DeepSeek 模型单价及返回 usage 计算，注意缓存命中与未命中输入价格；未提供价格时不伪造费用。真实云端对比、Prompt 修改与费用估算已完成，见 RESULTS.md；页面及返回值包含 estimatedCost，未知模型不估算。

## 已有验证与局限

`npm run test:rag --prefix backend` 覆盖去重、检索与时间过滤、句子边界、两组上下文隔离、伪造引用拒绝、连接失败、超时、缺少 Key、日志不泄露鉴权。网络异常使用本地适配器模拟，不能代替真实 DeepSeek 可用性验证。

`npm run build --prefix backend` 与 `npm run type-check --prefix frontend` 检查编译和类型。演示入口故意独立于数据库；本机现有 MySQL 配置被拒绝访问，需要另行修正后使用完整地图功能。

后续优先：真实实验与人工评分、根据样例调优中文检索、处理近似重复报道和地名别称，再考虑向量检索。提交 PDF 还需真实运行结果、编号截图、姓名学号与仓库 Commit；当前不生成虚构结果或完成版报告。

## 本次检索迭代记录

首次检查发现仅凭相同日期会检索到铁路票价等无关摘要；移除日期数字与孤立单字、补充专名后，Q1 候选从 4 条缩减到正确的 1 条，原文上下文从 408 字降至 71 字。Q3/Q4 仍能召回支持综合回答的多份资料。Q6/Q7 检索为空。全库正文为 2640 字。该检索变化已保留；后续真实回答对比与上下文精简试验见 RESULTS.md。

运行 `npm run rag --prefix backend -- inspect ../experiments/questions.json` 保存抽查片段和 Top-k。evaluate 同时导出 JSON 原始记录与 Markdown 对照表，评分留给人工。

## 本轮真实验证

见 [RESULTS.md](RESULTS.md) 与 [VALIDATION.md](VALIDATION.md)。实际返回同时记录 model 和 requestedModel，避免旧别名与实际模型混淆。固定问题评估逐题落盘，部分失败时保留成功记录并返回非零退出码。

上下文对比复现：`npm exec --prefix backend -- tsx backend/src/scripts/context-experiment.ts`（从项目根执行，产生两次云端调用）。
