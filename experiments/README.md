# 新闻问答运行说明

新闻问答统一检索本地新闻资料，再调用 DeepSeek 生成带来源的回答。主界面和独立页面均不再提供直接问答或对比模式。每次问题使用独立上下文，只发起一次模型请求。实验5历史对比记录保留在 RESULTS.md、VALIDATION.md 和原分支历史中，不代表当前界面功能。

## 启动

在项目根目录 `.env` 配置 `DEEPSEEK_API_KEY`，可选 `DEEPSEEK_MODEL=deepseek-flash`、`DEEPSEEK_BASE_URL=https://api.deepseek.com`。密钥只由后端读取。

```powershell
npm run dev:demo --prefix backend
npm run dev --prefix frontend
```

访问 http://localhost:3000/demo 。若完整后端已占用4000端口，直接使用完整后端。主界面 `/` 的地图仍需要 MySQL 和采集服务。`/demo` 与 `dev:demo` 保留原地址和命令，界面提供普通新闻问答。

## 准备本地知识库

```powershell
npm run knowledge:fetch --prefix workers
npm run rag --prefix backend -- import data/news.json
# 可从数据库导出资料草稿，审核后再导入
npm run rag --prefix backend -- export-news news-draft.json
```

资料为 JSON 数组，每项包含字符串字段 `id,title,text,source,url,publishedAt,permission`。只导入有权使用的公开资料。RSS摘要版权归原发布方，不将新闻快照提交公共仓库。

知识库为 `backend/data/knowledge.json`；问答日志为 `backend/data/runs/`。可用 `RAG_DATA_DIR` 修改数据目录。片段按句子切分，正文哈希去重，以BM25检索Top-4，保留出处与发布时间；不依赖向量服务。资料更新后需重新导入。

## 使用与接口

输入问题，可选地区和日期。地区按文本包含筛选，日期按报道发布时间筛选；浏览器将本地日期边界转换为UTC。资料不足时会提示，不代表事件没有发生。每条相关来源可展开阅读摘要并打开原文。

`POST /ai/analyze`：

```json
{"query":"乌克兰近期有哪些动态？","context":{"region":"乌克兰","from":"2026-10-19T00:00:00Z","to":"2026-10-20T23:59:59Z"}}
```

服务固定检索资料，拒绝直接问答或对比模式请求；旧客户端传 `mode=rag` 仍可使用。返回 `response,status,follow_up,citations,sources` 以及供运维使用的模型、运行编号和用量等字段。界面不显示实验模式、检索分数、Prompt版本或费用估算。

程序检查JSON结构、引用编号与正文标记；正常回答必须包含有效引用。空检索仍调用模型区分追问、超范围和资料不足。语义上是否真正支持结论仍须根据来源复核。

400表示输入无效，503为缺少密钥，502为云端失败或输出校验失败，504为60秒模型超时。浏览器等待75秒。`GET /ai/status` 的 configured/available 仅表示配置了密钥，不代表云端连通性。

## 验证

```powershell
npm run build --prefix backend
npm run test:rag --prefix backend
npm run test:agent --prefix backend
npm run build --prefix frontend
# 可选：逐题验证，会实际调用云端API
npm run rag --prefix backend -- evaluate ../experiments/questions.json
```

evaluate现在每题仅执行一次带检索的问答，导出JSON和Markdown评估表，不再执行两组对比。固定题集与2026-10-20快照配套，新快照需相应检查题目。历史实验日志不因当前功能调整而改写。

测试覆盖资料检索、独立上下文、引用校验、HTTP模式约束、网络失败和超时。新闻统计Agent的工具、确认及运行限制说明见 [实验6说明](experiment6/README.md)。
