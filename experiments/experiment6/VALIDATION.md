# 实验6验证记录

测试时间：2026-11-09T09:55:22.373Z；冻结知识库版本：d2d5c794b5a92fab。

## 真实DeepSeek循环

| 任务关键词 | 期望篇数 | 实际篇数 | 状态 | 步数/模型请求 | 耗时ms | runId |
|---|---:|---:|---|---|---:|---|
| 乌克兰 | 7 | 7 | succeeded | 3/3 | 3471 | 83b06644-20af-4733-bdbc-85e03c069add |
| 安理会 | 1 | 1 | succeeded | 3/3 | 3482 | c8af01b7-9624-4636-9ef8-9f4d3904718e |
| 不存在的新闻关键词XYZ | 0 | 0 | succeeded | 3/3 | 3066 | 1cc08290-81b5-41c6-a7f0-cd5f515468f5 |

上述3个任务实际调用DeepSeek与本地工具，各经过query_news、compute_stats、最终结果检查。实际模型deepseek-flash；均未开启保存。测试程序直接从快照独立计算期望ID集合进行对照。首次额外试运行也成功，但不计入该3例汇总。

## 模拟边界与工具直测

| 用例 | 状态 | 结果 |
|---|---|---|
| 工具直测：正确／错误／未知工具／越权字段 | 直接检查 | 通过 |
| 正常模拟循环 | succeeded | 通过 |
| 参数错误后修正 | succeeded | 通过 |
| 工具异常后恢复 | succeeded | 通过 |
| 最终结果不合格 | failed | 通过 |
| 未经工具直接完成 | failed | 通过 |
| 步数上限 | step_limit | 通过 |
| 工具超时 | tool_timeout | 通过 |
| 模型超时 | model_timeout | 通过 |
| 总时限 | total_timeout | 通过 |
| 模型重试上限 | failed | 通过 |
| 用户中止 | cancelled | 通过 |
| 确认yes（模拟） | succeeded | 通过 |
| 确认no（模拟） | confirmation_rejected | 通过 |
| 确认timeout（模拟） | confirmation_timeout | 通过 |
| 保存权限拒绝 | failed | 通过 |
| 保存目录越权 | failed | 通过 |
| 统计ID范围检查 | 直接检查 | 通过 |

18项专项子测试通过，Node包含父测试汇总为19 pass；实验5回归的9项子测试通过，汇总为10 pass。人工确认的同意、拒绝、超时由依赖注入模拟，不能表述为真实用户已经同意保存。测试检查写入前文件不存在、同意后存在、拒绝与超时后不存在，同一任务重复保存不重复创建。

## 判断与局限

最终total、bySource及全部引用ID由程序验证，不能只靠模型说完成。模型answer为自由文字，仍需人工复核；程序单独生成verifiedBrief作为核验后的统计内容。零篇不代表现实没有相关新闻。读取工具超时会停止等待；不可取消的后台模拟Promise不会修改活动状态。保存的同步短写入不能中途撤回，写入不明状态停止并要求核对文件。

完整日志位于backend/data/agent/runs；模拟证据位于backend/data/agent-tests/latest.json；本地新闻与运行记录均不纳入公开Git提交。
