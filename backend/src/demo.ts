import "./config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import ai from "./routes/ai";
import { errorHandler } from "./middleware/errorHandler";
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "32kb" }));
app.use("/ai", rateLimit({ windowMs: 60000, limit: 30 }), ai);
app.use(errorHandler);
const port = Number(process.env.PORT || 4000);
app.listen(port, "127.0.0.1", () =>
  console.log(`新闻问答服务：http://127.0.0.1:${port}（不依赖 MySQL）`),
);
