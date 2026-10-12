-- ============================================================================
--  地区冲突资讯雷达（Conflict News Radar）· MySQL 8.0 数据库结构
-- ----------------------------------------------------------------------------
--  ─── 空间类型设计说明（重要）────────────────────────────────────────────────
--  本项目的空间列采用 **SRID 0（平面坐标系）+ GIS 惯例轴序 POINT(经度 纬度)**。
--
--  为什么不用 SRID 4326：
--    1. MySQL 8 的 SRID 4326 遵循 EPSG:4326 轴序，强制 **纬度在前**
--       （POINT(lat lon)），与项目其余代码一贯使用的 (lon, lat) 顺序相反，
--       极易在写入与查询之间产生静默的经纬度颠倒错误。
--    2. SRID 0 无轴序约束，可稳定使用 POINT(lon lat)。
--    3. 本项目全部空间运算仅为**包围盒过滤**（矩形范围查询），在平面上进行
--       即完全正确，不需要球面几何，因此 SRID 0 不产生任何精度损失。
--
--  空间列与查询的写法：
--    写入：ST_GeomFromText(CONCAT('POINT(',lon,' ',lat,')'))
--    包围盒：ST_GeomFromText('POLYGON((minLon minLat, maxLon minLat,
--                                    maxLon maxLat, minLon maxLat, minLon minLat))')
--    判断：ST_Within(geom, <上述多边形>)
--    索引：SPATIAL INDEX(geom)   -- 要求列 NOT NULL、非 NULL、单列
--
--  ⚠ 两条实测得出的关键约束（已在 MySQL 8.0.34 验证）：
--    1. 空间列必须显式声明 NOT NULL 并使用 SRID 0；SPATIAL INDEX 不接受可空列。
--       实测：加 SPATIAL KEY 后，ST_Within(geom, <POLYGON>) 的执行计划为
--       type=range、key=<空间索引名>，索引正常生效（18000 行探针表验证）。
--    2. MySQL **没有** ST_MakeEnvelope 函数（调用会报
--       ERROR 1582 Incorrect parameter count）。必须改用 WKT 多边形，
--       且环必须闭合（首尾点相同），否则几何无效、查询恒为空。
--       因此允许为空的表（如新闻表）不建空间索引，改用普通经纬度索引。
--
--  ─── 字段类型选择的说明 ─────────────────────────────────────────────────────
--    DATETIME(3)   —— 毫秒精度；统一以 UTC 存储，应用层负责时区（见 shared/db.ts）
--    CHAR(36)      —— UUID 主键，默认 (UUID())
--    JSON          —— 结构化附加信息（如告警元数据、应用配置）
--    LIKE          —— 表/列使用 utf8mb4_0900_ai_ci（大小写与重音不敏感），
--                     因此 LIKE 天然具备大小写不敏感的匹配语义
--    TINYINT(1)    —— 布尔值
--
--  字符集统一 utf8mb4：支持中文地名（含生僻字），collation
--  utf8mb4_0900_ai_ci 为大小写与重音不敏感。
-- ============================================================================

-- 顺序说明：initdb 会按文件名字母序执行，01- 结构先于 02- 种子数据。
-- 本地手工执行时请按 01 → 02 顺序。

-- ⚠ 中文乱码防护：MySQL 官方镜像的 entrypoint 执行 initdb 脚本时，
--   客户端若不显式指定字符集会退回 latin1，导致中文被双重编码（详见 02-seed.sql 顶部说明）
SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `cnr`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `cnr`;

-- ---------------------------------------------------------------------------
-- 1. aircraft · 航班/航空器轨迹
--    数据来源：OpenSky Network ADS-B 数据
--    该源在国内访问不稳定且有配额限制，已在 data_sources 表中登记
--    待替换的国内 ADS-B 数据源；本表结构与全部字段保持完整，便于接入。
--    保留策略：滚动窗口，默认 2 小时后由清理任务删除
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `aircraft` (
  `id`            CHAR(36)      NOT NULL DEFAULT (UUID()),
  `icao24`        VARCHAR(12)   NOT NULL              COMMENT 'ICAO 24 位地址码，航空器唯一标识',
  `callsign`      VARCHAR(16)   DEFAULT NULL          COMMENT '呼号',
  `country`       VARCHAR(64)   DEFAULT NULL          COMMENT '注册国',
  `latitude`      DOUBLE        DEFAULT NULL,
  `longitude`     DOUBLE        DEFAULT NULL,
  `altitude`      DOUBLE        DEFAULT NULL          COMMENT '气压高度（米）',
  `velocity`      DOUBLE        DEFAULT NULL          COMMENT '地速（米/秒）',
  `heading`       DOUBLE        DEFAULT NULL          COMMENT '航向角（度，正北为 0）',
  `vertical_rate` DOUBLE        DEFAULT NULL          COMMENT '垂直速率（米/秒）',
  `on_ground`     TINYINT(1)    NOT NULL DEFAULT 0    COMMENT '是否在地面',
  `geom`          POINT         NOT NULL SRID 0     COMMENT '空间列：POINT(经度 纬度)，SRID 0（空间索引要求非空）',
  `timestamp`     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aircraft_icao_ts` (`icao24`, `timestamp`),
  KEY `idx_aircraft_icao24`   (`icao24`),
  KEY `idx_aircraft_ts`       (`timestamp`),
  KEY `idx_aircraft_country`  (`country`),
  SPATIAL KEY `idx_aircraft_geom` (`geom`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='航班/航空器位置（数据源见 data_sources 表）';

-- ---------------------------------------------------------------------------
-- 2. vessels · 船舶/海事轨迹
--    数据来源：AISStream.io AIS 数据
--    该源需境外注册，已在 data_sources 表中登记待替换的国内 AIS 服务；
--    本表结构与全部字段保持完整，便于接入。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `vessels` (
  `id`          CHAR(36)      NOT NULL DEFAULT (UUID()),
  `mmsi`        VARCHAR(16)   NOT NULL              COMMENT 'MMSI 海上移动通信业务标识',
  `name`        VARCHAR(128)  DEFAULT NULL          COMMENT '船名',
  `vessel_type` VARCHAR(48)   DEFAULT NULL          COMMENT '船型',
  `flag`        VARCHAR(48)   DEFAULT NULL          COMMENT '船旗国',
  `latitude`    DOUBLE        DEFAULT NULL,
  `longitude`   DOUBLE        DEFAULT NULL,
  `speed`       DOUBLE        DEFAULT NULL          COMMENT '对地航速（节）',
  `course`      DOUBLE        DEFAULT NULL          COMMENT '对地航向（度）',
  `heading`     DOUBLE        DEFAULT NULL          COMMENT '船首向（度）',
  `destination` VARCHAR(128)  DEFAULT NULL          COMMENT '目的港',
  `status`      VARCHAR(48)   DEFAULT NULL          COMMENT '航行状态',
  `length`      DOUBLE        DEFAULT NULL          COMMENT '船长（米）',
  `geom`        POINT         NOT NULL SRID 0     COMMENT '空间列：POINT(经度 纬度)，SRID 0（空间索引要求非空）',
  `timestamp`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vessels_mmsi_ts` (`mmsi`, `timestamp`),
  KEY `idx_vessels_mmsi`       (`mmsi`),
  KEY `idx_vessels_type`       (`vessel_type`),
  KEY `idx_vessels_ts`         (`timestamp`),
  SPATIAL KEY `idx_vessels_geom` (`geom`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='船舶/海事位置（数据源见 data_sources 表）';

-- ---------------------------------------------------------------------------
-- 3. conflict_events · 冲突事件
--    数据来源：ACLED 武装冲突事件库
--    该源需境外注册邮箱申请 Key，已在 data_sources 表中登记替代源；
--    本表结构保持完整，便于接入。
--    保留策略：长期保存，默认 365 天
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `conflict_events` (
  `id`             CHAR(36)      NOT NULL DEFAULT (UUID()),
  `external_id`    VARCHAR(100)  NOT NULL             COMMENT '数据源方事件 ID，用于幂等去重',
  `event_type`     VARCHAR(64)   DEFAULT NULL         COMMENT '事件类型（Battles/Protests/...）',
  `sub_event_type` VARCHAR(64)   DEFAULT NULL         COMMENT '子类型',
  `country`        VARCHAR(96)   DEFAULT NULL,
  `region`         VARCHAR(96)   DEFAULT NULL,
  `location`       VARCHAR(160)  DEFAULT NULL         COMMENT '地点名（中文优先）',
  `latitude`       DOUBLE        DEFAULT NULL,
  `longitude`      DOUBLE        DEFAULT NULL,
  `description`    TEXT,
  `source`         VARCHAR(96)   DEFAULT NULL,
  `severity`       VARCHAR(16)   DEFAULT NULL         COMMENT 'critical/high/medium/low',
  `fatalities`     INT           DEFAULT 0,
  `geom`           POINT         NOT NULL SRID 0    COMMENT '空间列：POINT(经度 纬度)，SRID 0（空间索引要求非空）',
  `event_date`     DATE          DEFAULT NULL         COMMENT '事件发生日期',
  `timestamp`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_conflicts_external` (`external_id`),
  KEY `idx_conflicts_country`  (`country`),
  KEY `idx_conflicts_region`   (`region`),
  KEY `idx_conflicts_severity` (`severity`),
  KEY `idx_conflicts_date`     (`event_date`),
  KEY `idx_conflicts_ts`       (`timestamp`),
  SPATIAL KEY `idx_conflicts_geom` (`geom`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='冲突事件（数据源见 data_sources 表）';

-- ---------------------------------------------------------------------------
-- 4. news_events · 新闻情报（本项目核心数据表）
--    数据来源：中文新闻 RSS（见 workers/src/news/rss.ts）
--    表内含语言、分类、地名与坐标字段，用于支撑中文新闻的
--    聚合、去重、地名识别与地图可视化。
--    保留策略：默认 48 小时
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `news_events` (
  `id`          CHAR(36)      NOT NULL DEFAULT (UUID()),
  `external_id` VARCHAR(200)  NOT NULL              COMMENT '源方文章 ID 或 URL 哈希，去重用',
  `headline`    VARCHAR(512)  DEFAULT NULL          COMMENT '标题',
  `summary`     TEXT                                COMMENT '摘要',
  `url`         VARCHAR(1024) DEFAULT NULL          COMMENT '原文链接（可追溯性核心字段）',
  `source`      VARCHAR(96)   DEFAULT NULL          COMMENT '来源媒体名',
  `category`    VARCHAR(64)   DEFAULT NULL          COMMENT '分类',
  `language`    VARCHAR(16)   DEFAULT 'zh'          COMMENT '语言（国内化新增）',
  `latitude`    DOUBLE        DEFAULT NULL,
  `longitude`   DOUBLE        DEFAULT NULL,
  `country`     VARCHAR(96)   DEFAULT NULL,
  `geom`        POINT         DEFAULT NULL          COMMENT '空间列：POINT(经度 纬度)，SRID 0（允许为空）',
  `published_at` DATETIME(3)  DEFAULT NULL          COMMENT '原文发布时间',
  `timestamp`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '入库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_news_external` (`external_id`),
  KEY `idx_news_country`   (`country`),
  KEY `idx_news_source`    (`source`),
  KEY `idx_news_category`  (`category`),
  KEY `idx_news_language`  (`language`),
  KEY `idx_news_published` (`published_at`),
  KEY `idx_news_ts`        (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='新闻情报（含语言、分类、地名与坐标字段）';

-- ---------------------------------------------------------------------------
-- 5. anomaly_alerts · 异常告警
--    设计要点：external_id 为按时段收敛的确定性告警键，配合唯一索引实现
--    幂等写入。否则每轮检测（默认 5 分钟）都会重复插入同类告警，迅速淹没数据。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `anomaly_alerts` (
  `id`          CHAR(36)      NOT NULL DEFAULT (UUID()),
  `external_id` VARCHAR(200)  DEFAULT NULL          COMMENT '告警去重键；配合唯一索引实现幂等写入',
  `alert_type`  VARCHAR(64)   DEFAULT NULL          COMMENT '告警类型',
  `title`       VARCHAR(512)  DEFAULT NULL,
  `description` TEXT,
  `severity`    VARCHAR(16)   DEFAULT NULL,
  `latitude`    DOUBLE        DEFAULT NULL,
  `longitude`   DOUBLE        DEFAULT NULL,
  `geom`        POINT         DEFAULT NULL          COMMENT '空间列：POINT(经度 纬度)，SRID 0（允许为空）',
  `metadata`    JSON          DEFAULT NULL,
  `resolved`    TINYINT(1)    NOT NULL DEFAULT 0,
  `timestamp`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_anomaly_external` (`external_id`),
  KEY `idx_anomaly_type`     (`alert_type`),
  KEY `idx_anomaly_severity` (`severity`),
  KEY `idx_anomaly_resolved` (`resolved`),
  KEY `idx_anomaly_ts`       (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='异常告警（external_id 唯一键保证幂等写入）';

-- ---------------------------------------------------------------------------
-- 6. app_config · 应用配置
--    为「设置关注地区与新闻源」这一核心用户流程预留的持久化位置。
--    当前仅建表并预置默认值，配置界面在后续迭代中实现。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `app_config` (
  `id`         CHAR(36)     NOT NULL DEFAULT (UUID()),
  `config_key` VARCHAR(96)  NOT NULL              COMMENT '配置键，如 watch_regions / news_sources',
  `config_val` JSON         DEFAULT NULL          COMMENT '配置值',
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_app_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='应用配置（预留：关注地区、新闻源列表）';

-- ---------------------------------------------------------------------------
-- 7. data_sources · 数据源注册表（国内化新增）
--    用于登记各数据源的启用状态、国内可用性、替换进度，
--    使「逐个替换为国内配置」这一过程可配置、可观测、可回退。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `data_sources` (
  `id`            CHAR(36)     NOT NULL DEFAULT (UUID()),
  `source_key`    VARCHAR(64)  NOT NULL             COMMENT '源标识，如 opensky / acled / gdelt',
  `source_name`   VARCHAR(128) DEFAULT NULL         COMMENT '显示名',
  `category`      VARCHAR(32)  DEFAULT NULL         COMMENT 'aircraft/vessels/conflicts/news',
  `origin`        VARCHAR(16)  DEFAULT 'overseas'   COMMENT 'overseas/domestic',
  `endpoint`      VARCHAR(512) DEFAULT NULL,
  `requires_key`  TINYINT(1)   NOT NULL DEFAULT 0,
  `enabled`       TINYINT(1)   NOT NULL DEFAULT 0   COMMENT '是否启用',
  `replace_target` VARCHAR(128) DEFAULT NULL        COMMENT '计划替换为的国内源',
  `note`          VARCHAR(512) DEFAULT NULL         COMMENT '备注/接入进度',
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_data_source_key` (`source_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='数据源注册表：登记国内化替换进度，支撑逐项替换与回退';
