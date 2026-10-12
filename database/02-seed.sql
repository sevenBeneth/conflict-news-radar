-- ============================================================================
--  CNR · 种子/演示数据
-- ----------------------------------------------------------------------------
--  作用：
--    1. 提供离线可用的演示数据，使界面在未配置任何数据源时仍能完整渲染；
--    2. 通过 data_sources 表登记「数据源国内化替换进度」，使逐项替换
--       可配置、可观测、可回退。
--
--  注意：
--    · 演示数据的 external_id 统一以 DEMO- 前缀，便于与真实数据区分与清理。
--    · 真实数据接入后，可执行文件末尾的清理语句删除全部演示数据。
--    · 空间列使用 POINT(经度 纬度) 的 SRID 0 平面坐标，与 01-schema.sql 一致。
--
--  ⚠ 中文乱码防护（实测踩过的坑，勿删下面这行）──────────────────────────────
--    MySQL 官方镜像的 entrypoint 在首次启动时会用 `mysql` 客户端执行
--    /docker-entrypoint-initdb.d/ 下的 .sql 文件。若客户端未显式指定字符集，
--    它会退回到 **latin1**，于是本文件的 UTF-8 中文字节被当作 latin1 解读后
--    再按 UTF-8 存入，形成**双重编码**。实测后果：
--      「顿涅茨克」(9 字节) 被存成 C3A9C2A1C2BF... (27 字节, 12 个字符)，
--      前端展示为「é¡¿æ¶…èŒ¨å…‹」。
--    显式 SET NAMES utf8mb4 后即恢复正常。
--    同时 docker-compose.yml 里已加 --character-set-server=utf8mb4 双保险。
-- ============================================================================

SET NAMES utf8mb4;

USE `cnr`;

-- ---------------------------------------------------------------------------
-- 1. 数据源注册表：登记国内化替换进度
--    origin=overseas 表示当前仍依赖境外服务，replace_target 记录计划的国内替代方案。
--    enabled=0 表示未配置凭据、当前不参与采集（不影响演示数据展示）。
-- ---------------------------------------------------------------------------
INSERT INTO `data_sources`
  (`source_key`, `source_name`, `category`, `origin`, `endpoint`, `requires_key`, `enabled`, `replace_target`, `note`)
VALUES
  ('opensky', 'OpenSky Network', 'aircraft', 'overseas',
   'https://opensky-network.org/api', 0, 0,
   '国内 ADS-B 数据服务',
   '国内访问不稳定且存在配额限制；表结构与路由已保留，替换数据源即可启用'),

  ('aisstream', 'AISStream.io', 'vessels', 'overseas',
   'https://api.aisstream.io/v0/vessels/latest', 1, 0,
   '国内 AIS 数据服务',
   '需境外注册申请 Key；代码中已有「无 Key 时注入演示数据」的降级分支'),

  ('acled', 'ACLED 武装冲突事件库', 'conflicts', 'overseas',
   'https://api.acleddata.com/acled/read', 1, 0,
   '国内冲突事件/新闻聚合源',
   '需境外邮箱注册；保留接入能力，同时开放国内可访问替代源'),

  ('gdelt', 'GDELT Doc 2.0', 'news', 'overseas',
   'https://api.gdeltproject.org/api/v2/doc/doc', 0, 0,
   '已替换：中新网官方 RSS（境内）',
   CONCAT('实测频繁返回 HTTP 429 限流，且检索为英文关键词，不作为默认新闻源；',
          '备选实现保留在 workers/src/news/gdelt.ts，可用 NEWS_PROVIDER=gdelt 启用')),

  ('chinanews_rss', '中新网官方 RSS（国际/即时/要闻）', 'news', 'domestic',
   'https://www.chinanews.com.cn/rss/world.xml', 0, 1,
   '—',
   CONCAT('当前默认新闻源。实测首条新闻距今 0 天，pubDate 带 +0800 时区，',
          '摘要为纯文本且含地名。同站即时与要闻频道一并接入，按链接全局去重')),

  ('people_rss', '人民网 RSS', 'news', 'domestic',
   'http://www.people.com.cn/rss/world.xml', 0, 0,
   '待其恢复更新后启用',
   CONCAT('实测 HTTP 200 且返回 100 条，但 channel 时间戳永久停在 2025-06-05、',
          '首条新闻距今 494 天，且 HTTP 与 HTTPS 返回字节完全相同，属静态缓存副本；',
          '判断该站 RSS 已停止维护，故默认禁用')),

  ('tianditu', '天地图（国家地理信息公共服务平台）', 'basemap', 'domestic',
   'https://t{0-7}.tianditu.gov.cn', 1, 0,
   '—',
   '国内官方权威底图，已作为前端默认底图；需免费申请 Key（详见 README）'),

  ('amap_tiles', '高德地图瓦片', 'basemap', 'domestic',
   'https://webrd0{1-4}.is.autonavi.com', 0, 0,
   '—',
   '免 Key 备选底图；注意使用 GCJ-02 坐标系，需坐标纠偏，详见坐标系说明'),

  ('amap_geocode', '高德地理编码 API', 'geocode', 'domestic',
   'https://restapi.amap.com/v3/geocode', 1, 0,
   '—',
   '预留：中文地名 → 经纬度，用于「地点抽取与置信度判定」'),

  ('ollama', 'Ollama 本地大模型', 'ai', 'domestic',
   'http://localhost:11434', 0, 0,
   '—',
   '本地推理，数据不出本机，符合隐私优先目标；需本机安装 Ollama')
ON DUPLICATE KEY UPDATE
  `source_name`    = VALUES(`source_name`),
  `category`       = VALUES(`category`),
  `origin`         = VALUES(`origin`),
  `endpoint`       = VALUES(`endpoint`),
  `requires_key`   = VALUES(`requires_key`),
  `replace_target` = VALUES(`replace_target`),
  `note`           = VALUES(`note`);

-- ---------------------------------------------------------------------------
-- 2. 冲突事件演示数据（5 条）
-- ---------------------------------------------------------------------------
INSERT INTO `conflict_events`
  (`external_id`, `event_type`, `sub_event_type`, `country`, `region`, `location`,
   `latitude`, `longitude`, `description`, `source`, `severity`, `fatalities`,
   `geom`, `event_date`)
VALUES
  ('DEMO-001', 'Battles', 'Armed clash', '乌克兰', '东欧', '顿涅茨克',
   48.0159, 37.8029, '顿涅茨克前线沿线报告持续炮击交火。', '演示数据', 'high', 3,
   ST_GeomFromText('POINT(37.8029 48.0159)'), DATE_SUB(CURDATE(), INTERVAL 1 DAY)),

  ('DEMO-002', 'Remote violence', 'Air/drone strike', '巴勒斯坦', '中东', '加沙城',
   31.5017, 34.4674, '加沙北部报告空袭事件。', '演示数据', 'critical', 7,
   ST_GeomFromText('POINT(34.4674 31.5017)'), DATE_SUB(CURDATE(), INTERVAL 2 DAY)),

  ('DEMO-003', 'Protests', 'Peaceful protest', '苏丹', '撒哈拉以南非洲', '喀土穆',
   15.5007, 32.5599, '喀土穆市中心发生民众抗议与武装冲突。', '演示数据', 'high', 2,
   ST_GeomFromText('POINT(32.5599 15.5007)'), DATE_SUB(CURDATE(), INTERVAL 3 DAY)),

  ('DEMO-004', 'Battles', 'Government regains territory', '缅甸', '东南亚', '曼德勒',
   21.9588, 96.0891, '曼德勒地区报告军事进攻行动。', '演示数据', 'high', 5,
   ST_GeomFromText('POINT(96.0891 21.9588)'), DATE_SUB(CURDATE(), INTERVAL 1 DAY)),

  ('DEMO-005', 'Remote violence', 'Air/drone strike', '也门', '中东', '萨那',
   15.3694, 44.1910, '首都附近报告无人机袭击。', '演示数据', 'critical', 1,
   ST_GeomFromText('POINT(44.1910 15.3694)'), CURDATE())
ON DUPLICATE KEY UPDATE `external_id` = VALUES(`external_id`);

-- ---------------------------------------------------------------------------
-- 3. 新闻情报演示数据（3 条，含中文条目以验证字符集）
-- ---------------------------------------------------------------------------
INSERT INTO `news_events`
  (`external_id`, `headline`, `summary`, `url`, `source`, `category`, `language`,
   `latitude`, `longitude`, `country`, `geom`, `published_at`)
VALUES
  ('DEMO-NEWS-001',
   '乌克兰东部地区报告新一轮炮击',
   '乌方称东部前线多个地段遭到持续炮击，具体伤亡情况仍在核实。',
   'https://example.com/demo/1', '演示新闻源', '武装冲突', 'zh',
   48.3794, 31.1656, '乌克兰',
   ST_GeomFromText('POINT(31.1656 48.3794)'),
   DATE_SUB(NOW(3), INTERVAL 2 HOUR)),

  ('DEMO-NEWS-002',
   '联合国警告加沙人道主义局势持续恶化',
   '联合国官员警告当地人道主义状况正在恶化，呼吁开辟援助通道。',
   'https://example.com/demo/2', '演示新闻源', '人道危机', 'zh',
   31.3547, 34.3088, '巴勒斯坦',
   ST_GeomFromText('POINT(34.3088 31.3547)'),
   DATE_SUB(NOW(3), INTERVAL 4 HOUR)),

  ('DEMO-NEWS-003',
   '南海海域多国举行联合演习，地区紧张态势上升',
   '多国在南海海域进行联合军事演习，地区紧张态势受到关注。',
   'https://example.com/demo/3', '演示新闻源', '军事动态', 'zh',
   14.5995, 120.9842, '菲律宾',
   ST_GeomFromText('POINT(120.9842 14.5995)'),
   DATE_SUB(NOW(3), INTERVAL 6 HOUR))
ON DUPLICATE KEY UPDATE `external_id` = VALUES(`external_id`);

-- ---------------------------------------------------------------------------
-- 4. 航班样例数据（3 条）
--    用于在未配置外部数据源时验证地图渲染：若无样例数据，该图层为空，
--    无法判断"是数据源不可达"还是"图层渲染有问题"。
--    真实数据接入后，可用文件末尾的清理语句移除。
-- ---------------------------------------------------------------------------
INSERT INTO `aircraft`
  (`icao24`, `callsign`, `country`, `latitude`, `longitude`,
   `altitude`, `velocity`, `heading`, `vertical_rate`, `on_ground`, `geom`)
VALUES
  ('demo01', 'DEMO101', '中国', 31.2304, 121.4737, 10360, 232.5, 92.0, 0.0, 0,
   ST_GeomFromText('POINT(121.4737 31.2304)')),
  ('demo02', 'DEMO202', '中国', 39.9042, 116.4074, 9144, 245.1, 180.0, -1.2, 0,
   ST_GeomFromText('POINT(116.4074 39.9042)')),
  ('demo03', 'DEMO303', '中国', 48.0159, 37.8029, 0, 0.0, 0.0, 0.0, 1,
   ST_GeomFromText('POINT(37.8029 48.0159)'))
ON DUPLICATE KEY UPDATE `icao24` = VALUES(`icao24`);

-- ---------------------------------------------------------------------------
-- 5. 船舶样例数据（3 条）
--    与航班样例数据同理，用于在无外部数据源时验证图层渲染；
--    采集器内部另有代码级的降级分支，作为运行时的兜底。
-- ---------------------------------------------------------------------------
INSERT INTO `vessels`
  (`mmsi`, `name`, `vessel_type`, `flag`, `latitude`, `longitude`,
   `speed`, `course`, `heading`, `destination`, `status`, `length`, `geom`)
VALUES
  ('413000001', '演示货轮一号', 'Cargo', '中国', 22.5431, 114.0579,
   12.5, 135.0, 133.0, '上海', 'Under way using engine', 225.0,
   ST_GeomFromText('POINT(114.0579 22.5431)')),
  ('413000002', '演示油轮二号', 'Tanker', '中国', 30.5931, 122.0658,
   10.2, 45.0, 44.0, '宁波', 'Under way using engine', 274.0,
   ST_GeomFromText('POINT(122.0658 30.5931)')),
  ('413000003', '演示渔船三号', 'Fishing', '中国', 18.2528, 109.5119,
   6.8, 210.0, 208.0, '三亚', 'Restricted manoeuvrability', 38.0,
   ST_GeomFromText('POINT(109.5119 18.2528)'))
ON DUPLICATE KEY UPDATE `mmsi` = VALUES(`mmsi`);

-- ---------------------------------------------------------------------------
-- 6. 应用配置预留项
-- ---------------------------------------------------------------------------
INSERT INTO `app_config` (`config_key`, `config_val`)
VALUES
  ('watch_regions', JSON_ARRAY(
      JSON_OBJECT('name', '乌克兰东部', 'lat', 48.0159, 'lon', 37.8029, 'radiusKm', 300),
      JSON_OBJECT('name', '中东', 'lat', 31.5, 'lon', 34.47, 'radiusKm', 400)
  )),
  ('news_sources', JSON_ARRAY()),
  ('map_provider', JSON_OBJECT('provider', 'tianditu', 'coordSystem', 'CGCS2000'))
ON DUPLICATE KEY UPDATE `config_val` = VALUES(`config_val`);

-- ---------------------------------------------------------------------------
-- 7. 清理演示数据（真实数据源接入后按需手工执行）
-- ---------------------------------------------------------------------------
-- DELETE FROM `conflict_events` WHERE `external_id` LIKE 'DEMO-%';
-- DELETE FROM `news_events`     WHERE `external_id` LIKE 'DEMO-%';
-- DELETE FROM `aircraft`        WHERE `icao24`       LIKE 'demo%';
-- DELETE FROM `vessels`         WHERE `mmsi`         LIKE '41300000%';
-- DELETE FROM `anomaly_alerts`  WHERE `external_id`  LIKE 'DEMO-%';
