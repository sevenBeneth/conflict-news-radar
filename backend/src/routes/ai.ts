import { Router } from "express";
import { answer, AnswerError, configured, modelName } from "../services/answer";
import { loadKnowledge } from "../services/knowledge";
const router = Router();
router.post("/analyze", async (req, res, next) => {
  const {
    query,
    context = {},
    promptVersion = "v3",
  } = req.body ?? {};
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > 2000 ||
    (req.body?.mode !== undefined && req.body.mode !== "rag") ||
    !["v1", "v2", "v3"].includes(promptVersion) ||
    !context ||
    typeof context !== "object" ||
    Array.isArray(context)
  ) {
    res
      .status(400)
      .json({ error: "问题须为 1–2000 字，请使用有效的筛选条件；不支持切换问答模式。" });
    return;
  }
  for (const key of ["region", "from", "to"]) {
    if (
      context[key] !== undefined &&
      (typeof context[key] !== "string" ||
        context[key].length > 100 ||
        (key !== "region" &&
          context[key] &&
          !Number.isFinite(Date.parse(context[key]))))
    ) {
      res.status(400).json({ error: "地区或日期格式错误。" });
      return;
    }
  }
  if (
    context.from &&
    context.to &&
    Date.parse(context.from) > Date.parse(context.to)
  ) {
    res.status(400).json({ error: "开始日期不能晚于结束日期。" });
    return;
  }
  try {
    res.json(
      await answer({ query: query.trim(), promptVersion, context }),
    );
  } catch (e) {
    if (e instanceof AnswerError)
      res.status(e.status).json({ error: e.message });
    else next(e);
  }
});
router.get("/status", async (_req, res, next) => {
  try {
    const kb = await loadKnowledge();
    res.json({
      available: configured(),
      configured: configured(),
      connectivity: "unchecked",
      model: modelName(),
      knowledge: {
        version: kb.version,
        documents: kb.documents,
        chunks: kb.chunks.length,
      },
    });
  } catch (e) {
    next(e);
  }
});
export default router;
