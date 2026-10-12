# 地区冲突资讯雷达 · Conflict News Radar

面向个人用户的**本地部署**地区冲突资讯聚合与可视化工具。

它把分散、无地理标注的中文新闻，转成带**时间、地点、摘要与原文链接**的可视化地图，
让人在几分钟内建立起对某地区局势的直观认识。

> **数据来源声明**：本项目仅订阅媒体公开提供的内容（官方 RSS），
> 不采集或展示任何涉及国家安全的敏感军事定位数据。
> 仅供教学、研究与技术演示使用。

---

## 目录

- [核心价值](#核心价值)
- [功能](#功能)
- [技术选型](#技术选型)
- [架构](#架构)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [环境变量](#环境变量)
- [接口](#接口)
- [数据库](#数据库)
- [关键设计说明](#关键设计说明)
- [常见问题](#常见问题)

---

## 核心价值

个人用户想持续关注某个地区的局势，当前的做法通常是：

> 每天打开多个新闻网站与社交平台 → 手动交叉比对同一事件的不同报道 →
> 用地图软件手工搜索地名确认位置 → 在表格里记录日期、来源、地点、摘要

这条流程整理一次"某地区最近一周的冲突动态"约需 **45–70 分钟**，而且容易遗漏关联事件。

本项目把这条流程压缩到**一次本地抓取与查看**：

| | 使用前 | 使用后 |
|---|---|---|
| 信息获取 | 打开 5–10 个来源，人工浏览 | 一次抓取，统一入库 |
| 去重 | 人工比对标题 | 按链接自动去重 |
| 地理定位 | 手工搜索地名 | 自动识别地名并落图 |
| 结果形式 | 分散的笔记 | 带时间轴的地图 + 列表 |
| 耗时 | 45–70 分钟 | 分钟级 |

---

## 功能

| 功能 | 说明 |
|---|---|
| **中文新闻聚合** | 订阅中新网官方 RSS（国际 / 即时 / 要闻），单一周期可获取数十条实时新闻 |
| **自动去重** | 以文章链接生成去重键，跨频道重复内容只入库一次 |
| **地名识别** | 纯规则实现（不依赖 AI）：结构化地名库 + 通讯社电头识别 + 分层置信度 |
| **国内新闻过滤** | 按地名清单剔除与本选题无关的国内地方新闻 |
| **地图可视化** | 天地图底图，标记点悬停即显示标题、摘要与可点击的原文链接 |
| **时间轴筛选** | 按 1–72 小时窗口查看事件 |
| **数据源注册表** | 数据库内登记各数据源的启用状态与替换进度，可逐项推进与回退 |
| **异常检测** | 冲突报道速率激增、航空器聚集、船舶聚集三类自动告警 |
| **WebSocket 推送** | 新增事件实时推送到前端，无需手动刷新 |
| **本地大模型问答** | 可选接入本机 Ollama；不可用时功能自动降级，不影响主流程 |

---

## 技术选型

| 层 | 技术 | 选择理由 |
|---|---|---|
| 前端 | Next.js 14 · React 18 · TypeScript · TailwindCSS | 与 Leaflet 配合成熟，构建产物可独立部署 |
| 地图 | Leaflet + 天地图 | 天地图是国家地理信息公共服务平台，境内可达性好；其坐标系为 CGCS2000，与数据的 WGS-84 在民用精度下一致，无需坐标偏移 |
| 后端 | Node.js 20 · Express · Socket.IO | 与前端同语言，减少上下文切换；Socket.IO 便于做增量推送 |
| 数据库 | **MySQL 8** | 国内普及度高、部署与运维成本低；**MySQL 8 原生空间类型 + SPATIAL INDEX 足以覆盖本项目全部空间查询需求**（仅需包围盒过滤），无需额外安装空间扩展 |
| 采集 | Node.js · Axios · xml2js | 官方 RSS 为 XML，xml2js 可直接解析；Axios 便于设置超时与自定义 UA |
| AI（可选） | Ollama 本地推理 | 数据不出本机，符合隐私优先目标 |
| 部署 | Docker Compose / 原生 Windows | 同时支持容器一键启动与本地原生运行 |

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                        浏览器界面                             │
│   Next.js 14 · Leaflet 地图 · 事件流 · 筛选/统计面板           │
└───────────────────────┬──────────────────────────────────────┘
                        │ REST + WebSocket
┌───────────────────────▼──────────────────────────────────────┐
│                      后端服务（Express）                       │
│   /api/news  /api/conflicts  /api/aircraft  /api/ships        │
│   /api/anomalies  /ai/analyze  /health                        │
└───────┬───────────────────────────────────┬──────────────────┘
        │                                   │ HTTP（可选）
┌───────▼──────────────────┐      ┌─────────▼────────────────┐
│   MySQL 8（cnr 库）       │      │  Ollama 本地大模型        │
│  news_events             │      │  （不可用时自动降级）      │
│  conflict_events         │      └──────────────────────────┘
│  aircraft / vessels      │
│  anomaly_alerts          │
│  data_sources / app_config│
└───────▲──────────────────┘
        │ INSERT / UPSERT
┌───────┴──────────────────────────────────────────────────────┐
│                       采集器（Workers）                        │
│  新闻 RSS  │ 航班 OpenSky │ 船舶 AIS │ 冲突事件 │ 异常检测     │
└──────────────────────────────────────────────────────────────┘
```

---

## 项目结构

```
conflict-news-radar/
├── docker-compose.yml            # 四个服务的编排
├── .env.example                  # 环境变量模板
├── .npmrc                        # npm 镜像源
│
├── shared/
│   └── db.ts                     # 共享数据库连接层（backend 与 workers 共用）
│
├── database/
│   ├── 01-schema.sql             # 库表结构与索引
│   └── 02-seed.sql               # 样例数据 + 数据源注册表
│
├── scripts/
│   ├── setup-dev.ps1             # 一键初始化（Windows）
│   └── sync-shared.ps1           # 共享层同步（构建前执行）
│
├── backend/                      # 后端服务
│   ├── Dockerfile
│   └── src/
│       ├── app.ts                # 应用装配与启动
│       ├── db/connection.ts      # 数据库入口（注入日志、重导出共享层）
│       ├── routes/               # 接口层：news / conflicts / aircraft / ships / anomalies / ai
│       ├── websocket/server.ts   # Socket.IO 推送
│       └── middleware/           # 错误处理
│
├── workers/                      # 采集器
│   ├── Dockerfile
│   └── src/
│       ├── index.ts              # 调度器
│       ├── news/
│       │   ├── rss.ts            # 中文新闻 RSS 采集
│       │   └── geo-dict.ts       # 地名库与识别算法
│       ├── aircraft/opensky.ts   # 航班数据
│       ├── ships/aisstream.ts    # 船舶数据
│       ├── conflicts/acled.ts    # 冲突事件数据
│       └── anomalies/detector.ts # 异常检测
│
└── frontend/                     # 前端界面
    ├── Dockerfile
    └── src/
        ├── app/                  # 页面与全局样式
        ├── components/
        │   ├── Map/              # 地图容器与各图层、标记悬停行为
        │   ├── panels/           # 事件流、筛选、统计、AI 对话
        │   └── ui/               # 顶栏、状态栏、面板缩放
        ├── hooks/                # WebSocket、初始数据
        ├── lib/                  # 接口客户端、常量、坐标转换、工具
        └── store/                # 全局状态
```

**职责划分**：后端按 `routes`（接口层）→ `workers`（业务处理）→ `shared/db`（数据访问层）组织；
前端按 `app`（页面）→ `components`（组件）→ `hooks`（数据获取）→ `lib/api.ts`（接口调用）→ `store`（状态管理）组织。

---

## 快速开始

### 前置条件

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 20 | 运行三个服务 |
| MySQL | 8.0+ | 数据库（原生方式运行需要） |
| Docker Desktop | ≥ 24 | 容器方式运行（可选） |
| Ollama | 最新 | 本地大模型（可选） |

### 方式一：Docker Compose（推荐）

```bash
copy .env.example .env
docker compose up --build
```

启动顺序：MySQL（健康检查通过）→ 后端 → 采集器 → 前端。
数据库结构在 MySQL 首次启动时自动建立。

访问：
- 界面 http://localhost:3000
- 接口 http://localhost:4000

### 方式二：原生本地运行

```powershell
# 建库、导入结构、生成配置文件
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
```

随后开三个终端：

```powershell
cd backend  ; npm install ; npm run dev     # http://localhost:4000
cd workers  ; npm install ; npm run dev     # 采集器（无界面）
cd frontend ; npm install ; npm run dev     # http://localhost:3000
```

---

## 环境变量

完整模板见 `.env.example`，关键项：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `MYSQL_HOST` / `MYSQL_PORT` | 数据库地址 | `127.0.0.1` / `3306` |
| `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | 库名与账号 | `cnr` / `cnr` / `cnr_password` |
| `NEWS_PROVIDER` | 新闻采集实现 | `rss` |
| `NEWS_RSS_SOURCES` | 自定义 RSS 源（留空用内置） | 空 |
| `NEWS_STALE_WARN_HOURS` | 数据新鲜度告警阈值（小时） | `48` |
| `NEXT_PUBLIC_TIANDITU_KEY` | 天地图 Key | 空（自动回退高德底图） |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | 本地大模型 | `http://localhost:11434` / `qwen2.5:7b` |
| `POLL_INTERVAL_NEWS` | 新闻采集周期（毫秒） | `120000` |

---

## 接口

### REST

| 方法 | 路径 | 说明 | 参数 |
|---|---|---|---|
| GET | `/api/news` | 新闻列表 | `hours`、`country`、`source`、`bbox`、`limit` |
| GET | `/api/conflicts` | 冲突事件 | `days`、`severity`、`country`、`region`、`bbox` |
| GET | `/api/conflicts/stats` | 冲突统计 | — |
| GET | `/api/aircraft` | 航班位置 | `minutes`、`on_ground`、`bbox` |
| GET | `/api/ships` | 船舶位置 | `minutes`、`type`、`bbox` |
| GET | `/api/anomalies` | 异常告警 | `hours` |
| POST | `/ai/analyze` | 大模型问答（可选） | body: `{ query, context? }` |
| GET | `/ai/status` | 模型可用性 | — |
| GET | `/health` | 健康检查 | — |

`bbox` 格式：`minLon,minLat,maxLon,maxLat`（WGS-84）。

### WebSocket 事件

`news:update`、`news:new`、`conflicts:update`、`conflicts:new`、
`aircraft:update`、`vessels:update`

---

## 数据库

| 表 | 说明 |
|---|---|
| `news_events` | 新闻情报（核心表，含标题、摘要、原文链接、地名、坐标） |
| `conflict_events` | 冲突事件 |
| `aircraft` / `vessels` | 航班与船舶位置 |
| `anomaly_alerts` | 异常告警 |
| `data_sources` | 数据源注册表（登记启用状态与替换进度） |
| `app_config` | 应用配置（关注地区、新闻源） |

**空间列约定**：

```sql
geom POINT NOT NULL SRID 0     -- 轴序：POINT(经度 纬度)
SPATIAL KEY idx_xxx_geom (geom)
```

- 使用 **SRID 0（平面）**：MySQL 8 的 SRID 4326 遵循 EPSG:4326 轴序，强制**纬度在前**，
  与项目其余代码一贯的 `(经度, 纬度)` 顺序相反，极易造成静默的经纬度颠倒。
  本项目的空间运算仅为**包围盒过滤**（矩形范围查询），在平面上进行即完全正确，
  不涉及球面距离计算，因此 SRID 0 不产生精度损失。
- 空间索引要求列 **NOT NULL**，故允许为空的表改用普通经纬度索引。

---

## 关键设计说明

### 1. 为什么选 MySQL 8

本项目对空间能力的需求只有一种：**判断点是否落在经纬度矩形范围内**（包围盒过滤）。
MySQL 8 的原生 `POINT` 类型配合 `SPATIAL INDEX` 完全满足该需求，
实测在 18000 行数据上执行计划为 `range` 扫描并命中空间索引。

数据库选型因此以**部署与运维成本**为主导：MySQL 在国内普及度高、
文档与社区支持充分、个人开发者上手快。

**两个实测得出的注意事项**（详见代码注释）：

- MySQL **没有** `ST_MakeEnvelope`，包围盒需改用闭合 WKT 多边形：
  `ST_GeomFromText('POLYGON((minLon minLat, ...))')`，且环必须闭合。
- 空间索引要求列 `NOT NULL`。

### 2. 地名识别（纯规则实现）

不依赖 AI，按以下顺序给出**带置信度的候选**：

| 置信度 | 触发条件 |
|---|---|
| 0.98 | 通讯社电头命中（如「中新社曼谷10月11日电」中的"曼谷"是记者发稿地） |
| 0.90 | 具体城市/国家命中于标题 |
| 0.75 | 具体城市/国家命中于摘要 |
| 0.60 | 仅命中大区域词（中东、非洲…），精度低 |
| 0.35 | 仅命中全国兜底锚点 |

另有两条判别规则：

- **词长优先**：同名片段先匹配长词（"北爱尔兰"优先于"爱尔兰"）；
- **体育/文体语境整体排除**：命中"女单/冠军/联赛/演唱会"等词时放弃国家匹配。

实测在 60 条真实新闻上地名命中率 **85%**，其中体育类 9 条全部正确排除。

### 3. 中文乱码防护（勿删）

`database/*.sql` 顶部的 `SET NAMES utf8mb4;` 不可删除。
MySQL 官方镜像的 entrypoint 执行初始化脚本时，`mysql` 客户端的默认字符集是 latin1，
会让文件中的 UTF-8 中文被双重编码（"顿涅茨克"由 4 字符变成 12 字符）。
仅设置服务端字符集**不足以**修复，因为客户端的 `SET NAMES` 会覆盖服务端默认。

### 4. 时区统一为 UTC

数据库连接层在每条新连接上执行 `SET time_zone = '+00:00'`。
否则 MySQL 的 `NOW()` 取本地时区、而驱动按 UTC 解释，同一记录写入与读回会相差数小时，
导致"近 N 分钟"这类过滤全部失效。

### 5. 采集器"并发抓取、串行写库"

多个源同时向 `news_events` 批量 `INSERT IGNORE` 时，InnoDB 会在唯一键的重复检查上
申请间隙锁并互相等待，实测报出 `Deadlock found when trying to get lock`。
因此把网络抓取与数据库写入解耦：抓取并发（受网络延迟制约），写入串行（毫秒级）。

---

## 常见问题

**Q：地图一片空白？**
检查 `frontend/.env.local` 中 `NEXT_PUBLIC_TIANDITU_KEY`；
未配置时会自动回退到免 Key 的高德底图。天地图为实名制服务，Key 需选「浏览器端」类型。

**Q：页面能打开但没有事件？**
采集器需要联网抓取。查看采集器日志确认 RSS 是否可达；
数据新鲜度超过 `NEWS_STALE_WARN_HOURS` 时会输出告警日志。

**Q：标记位置有几百米偏差？**
底图坐标系与数据坐标系不匹配。天地图（CGCS2000）无需偏移；
高德（GCJ-02）需要偏移，项目已在 `lib/coords.ts` 中实现并在组件内自动应用。
新增底图时务必正确设置 `coordSystem` 字段。

**Q：`docker compose up` 报端口被占用？**
若本机已运行 MySQL 服务占用 3306，需保持 compose 中 MySQL 的 ports 段为注释状态
（容器之间通过服务名直连，本就不需要宿主机端口）。

**Q：PowerShell 脚本报中文乱码或语法错误？**
仓库内 `.ps1` 脚本均以 **UTF-8 with BOM** 保存，Windows PowerShell 5.1 依赖 BOM
才能正确识别 UTF-8。若编辑后 BOM 丢失，请用「UTF-8 with BOM」重新保存。

---

## 许可

MIT License — 详见 [LICENSE](LICENSE)。
