/**
 * 中文新闻地名识别库（纯规则实现，不依赖 AI）
 * ============================================================================
 *
 * 设计目标：在**不引入大模型**的前提下，尽可能准确地把中文新闻文本中的
 * 地点抽取出来，给出坐标与**置信度**，使低置信度结果可以被区别对待。
 *
 * ─── 为什么不用「单表 + includes」的朴素做法 ─────────────────────────────────
 *   一张 `Record<地名, 坐标>` 表配合 `text.includes(词)` 遍历、**先命中者胜**，
 *   实测会暴露三个问题：
 *     1. 「中网女单冠军」因含顺序相邻的「中」「俄」被判为俄罗斯；
 *     2. 「中方」「我国」等高频泛称会把大量稿件吸附到中国；
 *     3. 只会返回一个结果，无法判断"到底有多可信"。
 *
 *   因此本实现采用：
 *     · **分层结构**：地域层级（国 > 城市/地区 > 大区域），按层级与词长排序；
 *     · **词长优先**：长词先匹配（"北爱尔兰" 先于 "爱尔兰"）；
 *     · **候选收集**：不再只取第一个，而是收集全部候选并按置信度打分；
 *     · **电头加权**：中文新闻普遍带「中新社北京10月11日电」式电头，
 *       电头中的地名是记者发稿地，信息价值最高；
 *     · **语境排除**：体育/文体语境直接判为不可用。
 *
 * ─── 置信度分级（用于决定是否可直接落图）───────────────────────────────────
 *   0.98  电头明确给出，且该地名是具体国家或城市 —— 可直接落图
 *   0.90  具体国家/城市命中于标题
 *   0.75  具体国家/城市命中于摘要
 *   0.60  仅命中大区域词（如"中东""非洲"），坐标为大洲中心，精度低
 *   0.00  体育/文体语境，或无任何命中
 *
 * ─── 已知局限（刻意保留，是"为何需要 AI"的论证依据）────────────────────────
 *   · 仅能识别库中已有的地名，无法覆盖新地名与新译名；
 *   · 无法处理同名异地（"苏丹"既是国名也是常见人名）；
 *   · 无法理解"东部边境""北部地区"这类相对方位表述；
 *   · 无法跨语言对齐（同一事件的英文报道与中文报道可能给出不同地名）。
 */

/** 地域层级：数值越小越具体、优先级越高 */
export const enum GeoLevel {
  /** 城市或次国家级地区，最具体 */
  City = 0,
  /** 国家 */
  Country = 1,
  /** 大区域（中东、非洲等），仅作兜底 */
  Region = 2,
  /**
   * 国家兜底锚点。
   * 仅在完全没有其他候选时使用 —— 中文国际新闻几乎都提到"中国/北京"，
   * 若与其他地名同权，会把大量稿件无差别吸附到中国，严重稀释地图区分度。
   */
  Fallback = 3,
}

export interface GeoEntry {
  /** 规范名称（写入 news_events.country 的值即为此） */
  name: string;
  level: GeoLevel;
  /** 纬度 */
  lat: number;
  /** 经度 */
  lon: number;
  /** 别名/旧译/简称，同样参与匹配 */
  aliases?: string[];
  /**
   * 是否属于「国内」。
   * 用于过滤与选题无关的国内地方新闻（赛事、文旅、天气、时政等）。
   * 见下方 isDomesticPlace() 的说明。
   */
  isDomestic?: boolean;
}

/**
 * 地名库。
 *
 * 匹配时先按 level 分层，再按"词"长度降序，因此本数组的书写顺序**不影响**结果，
 * 但仍建议按层级分组书写以便维护。
 *
 * 带 `isDomestic: true` 的条目表示「国内」，会被采集器过滤掉（见 isDomesticPlace）。
 */
export const GEO_ENTRIES: GeoEntry[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // 一、城市 / 次国家级地区（最具体，优先匹配）
  // ══════════════════════════════════════════════════════════════════════════

  // ── 冲突热点城市 ──
  { name: "顿涅茨克", level: GeoLevel.City, lat: 48.0159, lon: 37.8029, aliases: ["顿巴斯"] },
  { name: "卢甘斯克", level: GeoLevel.City, lat: 48.574, lon: 39.3078 },
  { name: "马里乌波尔", level: GeoLevel.City, lat: 47.0951, lon: 37.5413 },
  { name: "巴赫穆特", level: GeoLevel.City, lat: 48.5956, lon: 38.0009 },
  { name: "哈尔科夫", level: GeoLevel.City, lat: 49.9935, lon: 36.2304 },
  { name: "敖德萨", level: GeoLevel.City, lat: 46.4825, lon: 30.7233 },
  { name: "基辅", level: GeoLevel.City, lat: 50.4501, lon: 30.5234 },
  { name: "克里米亚", level: GeoLevel.City, lat: 45.3453, lon: 34.4997 },

  { name: "加沙城", level: GeoLevel.City, lat: 31.5017, lon: 34.4668, aliases: ["加沙市"] },
  { name: "拉法", level: GeoLevel.City, lat: 31.2968, lon: 34.2458 },
  { name: "汗尤尼斯", level: GeoLevel.City, lat: 31.3469, lon: 34.3029 },
  { name: "耶路撒冷", level: GeoLevel.City, lat: 31.7683, lon: 35.2137 },
  { name: "特拉维夫", level: GeoLevel.City, lat: 32.0853, lon: 34.7818 },
  { name: "贝鲁特", level: GeoLevel.City, lat: 33.8938, lon: 35.5018 },
  { name: "大马士革", level: GeoLevel.City, lat: 33.5138, lon: 36.2765 },
  { name: "阿勒颇", level: GeoLevel.City, lat: 36.2021, lon: 37.1343 },
  { name: "萨那", level: GeoLevel.City, lat: 15.3694, lon: 44.191 },
  { name: "亚丁", level: GeoLevel.City, lat: 12.7855, lon: 45.0187 },
  { name: "荷台达", level: GeoLevel.City, lat: 14.7978, lon: 42.9545 },
  { name: "德黑兰", level: GeoLevel.City, lat: 35.6892, lon: 51.389 },
  { name: "巴格达", level: GeoLevel.City, lat: 33.3152, lon: 44.3661 },
  { name: "喀布尔", level: GeoLevel.City, lat: 34.5553, lon: 69.2075 },
  { name: "的黎波里", level: GeoLevel.City, lat: 32.8872, lon: 13.1913 },
  { name: "喀土穆", level: GeoLevel.City, lat: 15.5007, lon: 32.5599 },
  { name: "摩加迪沙", level: GeoLevel.City, lat: 2.0469, lon: 45.3182 },
  { name: "仰光", level: GeoLevel.City, lat: 16.8661, lon: 96.1951 },
  { name: "曼德勒", level: GeoLevel.City, lat: 21.9588, lon: 96.0891  },
  { name: "内比都", level: GeoLevel.City, lat: 19.7633, lon: 96.0785  },

  // ── 亚洲主要城市 ──
  { name: "东京", level: GeoLevel.City, lat: 35.6762, lon: 139.6503 },
  { name: "大阪", level: GeoLevel.City, lat: 34.6937, lon: 135.5023 },
  { name: "首尔", level: GeoLevel.City, lat: 37.5665, lon: 126.978, aliases: ["汉城"]  },
  { name: "平壤", level: GeoLevel.City, lat: 39.0392, lon: 125.7625  },
  { name: "台北", level: GeoLevel.City, lat: 25.033, lon: 121.5654 },
  { name: "马尼拉", level: GeoLevel.City, lat: 14.5995, lon: 120.9842 },
  { name: "河内", level: GeoLevel.City, lat: 21.0278, lon: 105.8342  },
  { name: "曼谷", level: GeoLevel.City, lat: 13.7563, lon: 100.5018 },
  { name: "雅加达", level: GeoLevel.City, lat: -6.2088, lon: 106.8456 },
  { name: "吉隆坡", level: GeoLevel.City, lat: 3.139, lon: 101.6869 },
  { name: "新加坡", level: GeoLevel.City, lat: 1.3521, lon: 103.8198 },
  { name: "新德里", level: GeoLevel.City, lat: 28.6139, lon: 77.209  },
  { name: "孟买", level: GeoLevel.City, lat: 19.076, lon: 72.8777 },
  { name: "伊斯兰堡", level: GeoLevel.City, lat: 33.6844, lon: 73.0479  },
  { name: "加德满都", level: GeoLevel.City, lat: 27.7172, lon: 85.324  },
  { name: "迪拜", level: GeoLevel.City, lat: 25.2048, lon: 55.2708 },
  { name: "利雅得", level: GeoLevel.City, lat: 24.7136, lon: 46.6753 },
  { name: "多哈", level: GeoLevel.City, lat: 25.2854, lon: 51.531 },
  { name: "安卡拉", level: GeoLevel.City, lat: 39.9334, lon: 32.8597 },
  { name: "伊斯坦布尔", level: GeoLevel.City, lat: 41.0082, lon: 28.9784 },
  { name: "第比利斯", level: GeoLevel.City, lat: 41.7151, lon: 44.8271 },
  { name: "埃里温", level: GeoLevel.City, lat: 40.1792, lon: 44.4991 },
  { name: "巴库", level: GeoLevel.City, lat: 40.4093, lon: 49.8671 },

  // ── 欧洲主要城市 ──
  { name: "莫斯科", level: GeoLevel.City, lat: 55.7558, lon: 37.6173 },
  { name: "圣彼得堡", level: GeoLevel.City, lat: 59.9311, lon: 30.3609 },
  { name: "明斯克", level: GeoLevel.City, lat: 53.9006, lon: 27.559 },
  { name: "华沙", level: GeoLevel.City, lat: 52.2297, lon: 21.0122 },
  { name: "柏林", level: GeoLevel.City, lat: 52.52, lon: 13.405 },
  { name: "巴黎", level: GeoLevel.City, lat: 48.8566, lon: 2.3522 },
  { name: "伦敦", level: GeoLevel.City, lat: 51.5074, lon: -0.1278 },
  { name: "罗马", level: GeoLevel.City, lat: 41.9028, lon: 12.4964 },
  { name: "马德里", level: GeoLevel.City, lat: 40.4168, lon: -3.7038 },
  { name: "布鲁塞尔", level: GeoLevel.City, lat: 50.8503, lon: 4.3517 },
  { name: "日内瓦", level: GeoLevel.City, lat: 46.2044, lon: 6.1432 },
  { name: "维也纳", level: GeoLevel.City, lat: 48.2082, lon: 16.3738 },
  { name: "阿姆斯特丹", level: GeoLevel.City, lat: 52.3676, lon: 4.9041 },
  { name: "斯德哥尔摩", level: GeoLevel.City, lat: 59.3293, lon: 18.0686 },
  { name: "赫尔辛基", level: GeoLevel.City, lat: 60.1699, lon: 24.9384 },
  { name: "雅典", level: GeoLevel.City, lat: 37.9838, lon: 23.7275 },
  { name: "贝尔格莱德", level: GeoLevel.City, lat: 44.7866, lon: 20.4489 },
  { name: "萨拉热窝", level: GeoLevel.City, lat: 43.8563, lon: 18.4131 },

  // ── 美洲 / 非洲 / 大洋洲主要城市 ──
  { name: "华盛顿", level: GeoLevel.City, lat: 38.9072, lon: -77.0369 },
  { name: "纽约", level: GeoLevel.City, lat: 40.7128, lon: -74.006 },
  { name: "洛杉矶", level: GeoLevel.City, lat: 34.0522, lon: -118.2437 },
  { name: "渥太华", level: GeoLevel.City, lat: 45.4215, lon: -75.6972 },
  { name: "墨西哥城", level: GeoLevel.City, lat: 19.4326, lon: -99.1332 },
  { name: "巴西利亚", level: GeoLevel.City, lat: -15.7975, lon: -47.8919 },
  { name: "布宜诺斯艾利斯", level: GeoLevel.City, lat: -34.6037, lon: -58.3816 },
  { name: "开罗", level: GeoLevel.City, lat: 30.0444, lon: 31.2357 },
  { name: "内罗毕", level: GeoLevel.City, lat: -1.2921, lon: 36.8219 },
  { name: "约翰内斯堡", level: GeoLevel.City, lat: -26.2041, lon: 28.0473 },
  { name: "比勒陀利亚", level: GeoLevel.City, lat: -25.7479, lon: 28.2293, aliases: ["比陀"] },
  { name: "亚的斯亚贝巴", level: GeoLevel.City, lat: 9.032, lon: 38.7469 },
  { name: "吉布提市", level: GeoLevel.City, lat: 11.5721, lon: 43.1456 },
  { name: "悉尼", level: GeoLevel.City, lat: -33.8688, lon: 151.2093 },
  { name: "堪培拉", level: GeoLevel.City, lat: -35.2809, lon: 149.13 },
  { name: "惠灵顿", level: GeoLevel.City, lat: -41.2865, lon: 174.7762 },

  // ── 中国城市（用于国内新闻，避免全部吸附到北京）──
  { name: "香港", level: GeoLevel.City, lat: 22.3193, lon: 114.1694 , isDomestic: true },
  { name: "澳门", level: GeoLevel.City, lat: 22.1987, lon: 113.5439 , isDomestic: true },
  { name: "上海", level: GeoLevel.City, lat: 31.2304, lon: 121.4737  , isDomestic: true },
  { name: "广州", level: GeoLevel.City, lat: 23.1291, lon: 113.2644  , isDomestic: true },
  { name: "深圳", level: GeoLevel.City, lat: 22.5431, lon: 114.0579  , isDomestic: true },
  { name: "重庆", level: GeoLevel.City, lat: 29.563, lon: 106.5516  , isDomestic: true },
  { name: "天津", level: GeoLevel.City, lat: 39.3434, lon: 117.3616  , isDomestic: true },
  { name: "成都", level: GeoLevel.City, lat: 30.5728, lon: 104.0668  , isDomestic: true },
  { name: "武汉", level: GeoLevel.City, lat: 30.5928, lon: 114.3055  , isDomestic: true },
  { name: "西安", level: GeoLevel.City, lat: 34.3416, lon: 108.9398  , isDomestic: true },
  { name: "南京", level: GeoLevel.City, lat: 32.0603, lon: 118.7969  , isDomestic: true },
  { name: "杭州", level: GeoLevel.City, lat: 30.2741, lon: 120.1551  , isDomestic: true },
  { name: "沈阳", level: GeoLevel.City, lat: 41.8057, lon: 123.4315  , isDomestic: true },
  { name: "乌鲁木齐", level: GeoLevel.City, lat: 43.8256, lon: 87.6168  , isDomestic: true },
  { name: "拉萨", level: GeoLevel.City, lat: 29.652, lon: 91.1721  , isDomestic: true },
  { name: "昆明", level: GeoLevel.City, lat: 24.8801, lon: 102.8329  , isDomestic: true },
  { name: "哈尔滨", level: GeoLevel.City, lat: 45.8038, lon: 126.534  , isDomestic: true },
  { name: "长春", level: GeoLevel.City, lat: 43.8171, lon: 125.3235  , isDomestic: true },
  { name: "三亚", level: GeoLevel.City, lat: 18.2528, lon: 109.5119  , isDomestic: true },
  { name: "福州", level: GeoLevel.City, lat: 26.0745, lon: 119.2965  , isDomestic: true },
  { name: "厦门", level: GeoLevel.City, lat: 24.4798, lon: 118.0894  , isDomestic: true },
  { name: "郑州", level: GeoLevel.City, lat: 34.7466, lon: 113.6254  , isDomestic: true },
  { name: "长沙", level: GeoLevel.City, lat: 28.2282, lon: 112.9388  , isDomestic: true },
  { name: "合肥", level: GeoLevel.City, lat: 31.8206, lon: 117.2272  , isDomestic: true },
  { name: "青岛", level: GeoLevel.City, lat: 36.0671, lon: 120.3826  , isDomestic: true },
  { name: "大连", level: GeoLevel.City, lat: 38.914, lon: 121.6147  , isDomestic: true },
  { name: "宁波", level: GeoLevel.City, lat: 29.8683, lon: 121.544  , isDomestic: true },
  { name: "石家庄", level: GeoLevel.City, lat: 38.0428, lon: 114.5149  , isDomestic: true },
  { name: "南宁", level: GeoLevel.City, lat: 22.817, lon: 108.3665  , isDomestic: true },
  { name: "贵阳", level: GeoLevel.City, lat: 26.6477, lon: 106.6302  , isDomestic: true },
  { name: "兰州", level: GeoLevel.City, lat: 36.0611, lon: 103.8343  , isDomestic: true },
  { name: "银川", level: GeoLevel.City, lat: 38.4872, lon: 106.2309  , isDomestic: true },
  { name: "西宁", level: GeoLevel.City, lat: 36.6171, lon: 101.7782  , isDomestic: true },
  { name: "呼和浩特", level: GeoLevel.City, lat: 40.8414, lon: 111.7519  , isDomestic: true },
  { name: "太原", level: GeoLevel.City, lat: 37.8706, lon: 112.5489  , isDomestic: true },
  { name: "济南", level: GeoLevel.City, lat: 36.6512, lon: 117.1201  , isDomestic: true },
  { name: "南昌", level: GeoLevel.City, lat: 28.682, lon: 115.8579  , isDomestic: true },
  { name: "台北市", level: GeoLevel.City, lat: 25.033, lon: 121.5654  },
  { name: "西藏", level: GeoLevel.City, lat: 29.65, lon: 91.1  , isDomestic: true },
  { name: "新疆", level: GeoLevel.City, lat: 43.8, lon: 87.6  , isDomestic: true },
  { name: "南海", level: GeoLevel.City, lat: 14.0, lon: 114.0 },
  { name: "台海", level: GeoLevel.City, lat: 24.5, lon: 119.5 },
  { name: "台湾海峡", level: GeoLevel.City, lat: 24.5, lon: 119.5 },

  // ══════════════════════════════════════════════════════════════════════════
  // 二、国家
  // ══════════════════════════════════════════════════════════════════════════
  { name: "乌克兰", level: GeoLevel.Country, lat: 49.0, lon: 32.0 },
  { name: "俄罗斯", level: GeoLevel.Country, lat: 61.5, lon: 105.3, aliases: ["俄国", "俄方"] },
  { name: "白俄罗斯", level: GeoLevel.Country, lat: 53.7, lon: 27.9 },
  { name: "波兰", level: GeoLevel.Country, lat: 51.9, lon: 19.1 },
  { name: "德国", level: GeoLevel.Country, lat: 51.2, lon: 10.4 },
  { name: "法国", level: GeoLevel.Country, lat: 46.2, lon: 2.2 },
  { name: "英国", level: GeoLevel.Country, lat: 55.4, lon: -3.4, aliases: ["英方"] },
  { name: "意大利", level: GeoLevel.Country, lat: 41.9, lon: 12.6 },
  { name: "西班牙", level: GeoLevel.Country, lat: 40.5, lon: -3.7 },
  { name: "荷兰", level: GeoLevel.Country, lat: 52.1, lon: 5.3 },
  { name: "比利时", level: GeoLevel.Country, lat: 50.5, lon: 4.5 },
  { name: "瑞典", level: GeoLevel.Country, lat: 60.1, lon: 18.6 },
  { name: "芬兰", level: GeoLevel.Country, lat: 61.9, lon: 25.7 },
  { name: "挪威", level: GeoLevel.Country, lat: 60.5, lon: 8.5 },
  { name: "丹麦", level: GeoLevel.Country, lat: 56.3, lon: 9.5 },
  { name: "瑞士", level: GeoLevel.Country, lat: 46.8, lon: 8.2 },
  { name: "奥地利", level: GeoLevel.Country, lat: 47.5, lon: 14.6 },
  { name: "希腊", level: GeoLevel.Country, lat: 39.1, lon: 21.8 },
  { name: "塞尔维亚", level: GeoLevel.Country, lat: 44.0, lon: 20.9 },
  { name: "波黑", level: GeoLevel.Country, lat: 43.9, lon: 17.7, aliases: ["波斯尼亚"] },
  { name: "匈牙利", level: GeoLevel.Country, lat: 47.2, lon: 19.5 },
  { name: "罗马尼亚", level: GeoLevel.Country, lat: 45.9, lon: 25.0 },
  { name: "保加利亚", level: GeoLevel.Country, lat: 42.7, lon: 25.5 },
  { name: "捷克", level: GeoLevel.Country, lat: 49.8, lon: 15.5 },
  { name: "葡萄牙", level: GeoLevel.Country, lat: 39.4, lon: -8.2 },
  { name: "爱尔兰", level: GeoLevel.Country, lat: 53.1, lon: -7.7 },
  { name: "格鲁吉亚", level: GeoLevel.Country, lat: 42.3, lon: 43.4 },

  { name: "巴勒斯坦", level: GeoLevel.Country, lat: 31.9, lon: 35.2 },
  { name: "以色列", level: GeoLevel.Country, lat: 31.5, lon: 34.9 },
  { name: "黎巴嫩", level: GeoLevel.Country, lat: 33.9, lon: 35.9 },
  { name: "叙利亚", level: GeoLevel.Country, lat: 35.0, lon: 38.0 },
  { name: "也门", level: GeoLevel.Country, lat: 15.6, lon: 48.5 },
  { name: "伊朗", level: GeoLevel.Country, lat: 32.4, lon: 53.7, aliases: ["伊方"] },
  { name: "伊拉克", level: GeoLevel.Country, lat: 33.2, lon: 43.7 },
  { name: "阿富汗", level: GeoLevel.Country, lat: 33.9, lon: 67.7 },
  { name: "沙特阿拉伯", level: GeoLevel.Country, lat: 23.9, lon: 45.1, aliases: ["沙特"] },
  { name: "阿联酋", level: GeoLevel.Country, lat: 23.4, lon: 53.8 },
  { name: "卡塔尔", level: GeoLevel.Country, lat: 25.3, lon: 51.2 },
  { name: "科威特", level: GeoLevel.Country, lat: 29.3, lon: 47.5 },
  { name: "约旦", level: GeoLevel.Country, lat: 30.6, lon: 36.2 },
  { name: "土耳其", level: GeoLevel.Country, lat: 38.9, lon: 35.2, aliases: ["土方"] },
  { name: "亚美尼亚", level: GeoLevel.Country, lat: 40.1, lon: 45.0 },
  { name: "阿塞拜疆", level: GeoLevel.Country, lat: 40.1, lon: 47.6 },

  { name: "朝鲜", level: GeoLevel.Country, lat: 40.3, lon: 127.5, aliases: ["北朝鲜"]  },
  { name: "韩国", level: GeoLevel.Country, lat: 36.5, lon: 127.8, aliases: ["南韩"]  },
  { name: "日本", level: GeoLevel.Country, lat: 36.2, lon: 138.3, aliases: ["日方"] },
  { name: "菲律宾", level: GeoLevel.Country, lat: 12.9, lon: 121.8 },
  { name: "越南", level: GeoLevel.Country, lat: 14.1, lon: 108.3 },
  { name: "泰国", level: GeoLevel.Country, lat: 15.9, lon: 101.0 },
  { name: "马来西亚", level: GeoLevel.Country, lat: 4.2, lon: 101.9 },
  { name: "印度尼西亚", level: GeoLevel.Country, lat: -0.8, lon: 113.9, aliases: ["印尼"] },
  { name: "印度", level: GeoLevel.Country, lat: 20.6, lon: 79.0  },
  { name: "巴基斯坦", level: GeoLevel.Country, lat: 30.4, lon: 69.3 },
  { name: "孟加拉国", level: GeoLevel.Country, lat: 23.7, lon: 90.4, aliases: ["孟加拉"]  },
  { name: "尼泊尔", level: GeoLevel.Country, lat: 28.4, lon: 84.1  },
  { name: "斯里兰卡", level: GeoLevel.Country, lat: 7.9, lon: 80.8 },
  { name: "缅甸", level: GeoLevel.Country, lat: 19.2, lon: 96.7  },
  { name: "蒙古", level: GeoLevel.Country, lat: 46.9, lon: 103.8  },
  { name: "哈萨克斯坦", level: GeoLevel.Country, lat: 48.0, lon: 66.9 },
  { name: "吉尔吉斯斯坦", level: GeoLevel.Country, lat: 41.2, lon: 74.8  },
  { name: "塔吉克斯坦", level: GeoLevel.Country, lat: 38.9, lon: 71.3 },
  { name: "乌兹别克斯坦", level: GeoLevel.Country, lat: 41.4, lon: 64.6 },
  { name: "土库曼斯坦", level: GeoLevel.Country, lat: 38.97, lon: 59.56 },
  { name: "新加坡国", level: GeoLevel.Country, lat: 1.35, lon: 103.8 },
  { name: "柬埔寨", level: GeoLevel.Country, lat: 12.6, lon: 104.9 },
  { name: "老挝", level: GeoLevel.Country, lat: 19.9, lon: 102.5  },
  { name: "文莱", level: GeoLevel.Country, lat: 4.5, lon: 114.7 },

  { name: "美国", level: GeoLevel.Country, lat: 37.1, lon: -95.7, aliases: ["美方", "特朗普政府"] },
  { name: "加拿大", level: GeoLevel.Country, lat: 56.1, lon: -106.3 },
  { name: "墨西哥", level: GeoLevel.Country, lat: 23.6, lon: -102.6 },
  { name: "古巴", level: GeoLevel.Country, lat: 21.5, lon: -77.8 },
  { name: "海地", level: GeoLevel.Country, lat: 19.0, lon: -72.3 },
  { name: "委内瑞拉", level: GeoLevel.Country, lat: 6.4, lon: -66.6 },
  { name: "哥伦比亚", level: GeoLevel.Country, lat: 4.6, lon: -74.3 },
  { name: "巴西", level: GeoLevel.Country, lat: -14.2, lon: -51.9 },
  { name: "阿根廷", level: GeoLevel.Country, lat: -38.4, lon: -63.6 },
  { name: "智利", level: GeoLevel.Country, lat: -35.7, lon: -71.5 },
  { name: "秘鲁", level: GeoLevel.Country, lat: -9.2, lon: -75.0 },
  { name: "巴拿马", level: GeoLevel.Country, lat: 8.5, lon: -80.8 },

  { name: "苏丹", level: GeoLevel.Country, lat: 12.9, lon: 30.2 },
  { name: "南苏丹", level: GeoLevel.Country, lat: 7.9, lon: 30.0 },
  { name: "索马里", level: GeoLevel.Country, lat: 5.2, lon: 46.2 },
  { name: "吉布提", level: GeoLevel.Country, lat: 11.8, lon: 42.6 },
  { name: "埃塞俄比亚", level: GeoLevel.Country, lat: 9.1, lon: 40.5 },
  { name: "厄立特里亚", level: GeoLevel.Country, lat: 15.2, lon: 39.8 },
  { name: "肯尼亚", level: GeoLevel.Country, lat: -0.02, lon: 37.9 },
  { name: "坦桑尼亚", level: GeoLevel.Country, lat: -6.4, lon: 34.9 },
  { name: "乌干达", level: GeoLevel.Country, lat: 1.4, lon: 32.3 },
  { name: "尼日利亚", level: GeoLevel.Country, lat: 9.1, lon: 8.7 },
  { name: "尼日尔", level: GeoLevel.Country, lat: 17.6, lon: 8.1 },
  { name: "马里", level: GeoLevel.Country, lat: 17.6, lon: -3.9 },
  { name: "利比亚", level: GeoLevel.Country, lat: 26.3, lon: 17.2 },
  { name: "埃及", level: GeoLevel.Country, lat: 26.8, lon: 30.8 },
  { name: "摩洛哥", level: GeoLevel.Country, lat: 31.8, lon: -7.1 },
  { name: "阿尔及利亚", level: GeoLevel.Country, lat: 28.0, lon: 1.7 },
  { name: "突尼斯", level: GeoLevel.Country, lat: 33.9, lon: 9.5 },
  { name: "南非", level: GeoLevel.Country, lat: -30.6, lon: 22.9 },
  { name: "刚果", level: GeoLevel.Country, lat: -4.0, lon: 21.8, aliases: ["刚果民主共和国", "刚果（金）"] },
  { name: "卢旺达", level: GeoLevel.Country, lat: -1.9, lon: 29.9 },
  { name: "津巴布韦", level: GeoLevel.Country, lat: -19.0, lon: 29.2 },
  { name: "莫桑比克", level: GeoLevel.Country, lat: -18.7, lon: 35.5 },

  { name: "澳大利亚", level: GeoLevel.Country, lat: -25.3, lon: 133.8 },
  { name: "新西兰", level: GeoLevel.Country, lat: -40.9, lon: 174.9 },

  // ══════════════════════════════════════════════════════════════════════════
  // 三、大区域（兜底，精度低，置信度相应降低）
  // ══════════════════════════════════════════════════════════════════════════
  { name: "中东", level: GeoLevel.Region, lat: 29.3, lon: 42.5 },
  { name: "东南亚", level: GeoLevel.Region, lat: 12.0, lon: 105.0, aliases: ["东盟"] },
  { name: "中亚", level: GeoLevel.Region, lat: 45.0, lon: 64.0 },
  { name: "南亚", level: GeoLevel.Region, lat: 22.0, lon: 78.0  },
  { name: "东亚", level: GeoLevel.Region, lat: 34.0, lon: 118.0  },
  { name: "亚太", level: GeoLevel.Region, lat: 20.0, lon: 120.0  },
  { name: "欧洲", level: GeoLevel.Region, lat: 50.8, lon: 4.4, aliases: ["欧盟", "欧元区"] },
  { name: "北美", level: GeoLevel.Region, lat: 45.0, lon: -100.0 },
  { name: "拉丁美洲", level: GeoLevel.Region, lat: -15.0, lon: -60.0, aliases: ["拉美"] },
  { name: "非洲", level: GeoLevel.Region, lat: 8.8, lon: 21.1, aliases: ["中非"] },
  { name: "撒哈拉以南非洲", level: GeoLevel.Region, lat: 0.0, lon: 20.0 },
  { name: "北非", level: GeoLevel.Region, lat: 28.0, lon: 10.0 },
  { name: "东欧", level: GeoLevel.Region, lat: 49.0, lon: 30.0 },
  { name: "巴尔干", level: GeoLevel.Region, lat: 43.0, lon: 21.0 },
  { name: "波罗的海", level: GeoLevel.Region, lat: 57.5, lon: 23.0 },
  { name: "黑海", level: GeoLevel.Region, lat: 43.5, lon: 34.0 },
  { name: "红海", level: GeoLevel.Region, lat: 20.0, lon: 38.5 },
  { name: "波斯湾", level: GeoLevel.Region, lat: 26.5, lon: 52.0, aliases: ["海湾地区"] },
  { name: "地中海", level: GeoLevel.Region, lat: 35.0, lon: 18.0 },
  { name: "大洋洲", level: GeoLevel.Region, lat: -25.0, lon: 140.0 },
  { name: "太平洋", level: GeoLevel.Region, lat: 0.0, lon: -160.0 },
  { name: "印度洋", level: GeoLevel.Region, lat: -20.0, lon: 80.0 },
  { name: "加勒比", level: GeoLevel.Region, lat: 15.0, lon: -75.0 },

  // ══════════════════════════════════════════════════════════════════════════
  // 四、中国兜底锚点（仅在没有其他任何候选时使用）
  // ══════════════════════════════════════════════════════════════════════════
  { name: "中国", level: GeoLevel.Fallback, lat: 35.9, lon: 104.2  , isDomestic: true },
  { name: "北京", level: GeoLevel.Fallback, lat: 39.9, lon: 116.4  , isDomestic: true },
];

/**
 * 判断某地名是否属于「国内」。
 *
 * ─── 为什么需要过滤国内新闻 ──────────────────────────────────────────────────
 *   本项目的选题是「地区冲突资讯雷达」，关注**境外冲突地区**。
 *   而中新网的「要闻/即时」频道含大量国内地方新闻（河北赛事洽谈、新疆奇石文旅、
 *   广州天气、云南演讲比赛、网球赛事……），既无冲突信息，又会把地图标记堆到国内，
 *   稀释真正有用的情报。
 *
 * ─── 为什么用「显式地名清单」而不是坐标包围盒 ──────────────────────────────
 *   最初尝试用中国大陆矩形框（经 73–135.5、纬 18–53.6）判定，实测把大量**邻国**
 *   误判为国内：朝鲜、韩国、越南、蒙古、印度、尼泊尔、孟加拉国、缅甸、老挝、
 *   吉尔吉斯斯坦等全部落在框内。据此过滤会把这些国家的新闻一并丢掉，属严重错误。
 *
 *   因此改为在 GEO_ENTRIES 上显式标注 `isDomestic: true`：
 *     · 只有确定为国内城市/省级行政区/全国兜底的条目才带该标记；
 *     · 邻国一律不带，不会被误伤；
 *     · 清单可审计、可增删，行为可预测。
 *
 * ─── 港澳台的取舍 ────────────────────────────────────────────────────────────
 *   港澳标记为国内（常作为新闻发稿地出现，且非冲突议题）。
 *   **台湾/台海/南海不标记**：台海局势属于本项目真正关心的议题，
 *   不应随大陆地方新闻一起被过滤。如需一并过滤，给对应条目加 isDomestic 即可。
 *
 * 注意：本函数定义在 GEO_ENTRIES **之后**，因为它在模块初始化时就会读取该常量；
 * 若写在声明之前，会因 const 的暂时性死区（TDZ）在运行时抛错。
 */
export function isDomesticPlace(name: string | null): boolean {
  if (!name) return false;
  const entry = GEO_ENTRIES.find((e) => e.name === name);
  return entry?.isDomestic === true;
}

/**
 * 体育 / 文体语境词。
 *
 * ─── 为何需要（实测发现的严重误判）──────────────────────────────────────────
 *   子串匹配在中文里极易产生"跨词巧合"。实测案例：
 *     「郑钦文创造历史 首夺**中网**女单冠军」
 *   文本中恰好存在顺序相邻的「中」与「俄」，于是被判为**俄罗斯**，
 *   而它实际是中国网球公开赛的体育新闻。
 *
 *   因此当文本命中体育/文体词汇时，**整体放弃国家匹配**，
 *   因为这类栏目下的国名多为队名、赛事名、艺人国籍，不构成事件发生地。
 */
const SPORTS_CULTURE_HINTS = [
  // 赛制与轮次
  "女单", "男单", "女双", "男双", "混双", "单打", "双打",
  "赛季", "积分榜", "小组赛", "淘汰赛", "八强", "四强", "半决赛", "决赛",
  "夺冠", "冠军", "亚军", "季军", "卫冕", "惜败", "出局", "晋级", "落败",
  // 赛事名（含中文简称，实测"中网""大师赛"是最易漏的）
  "世界杯", "奥运会", "亚运会", "全运会", "锦标赛", "公开赛", "巡回赛",
  "大师赛", "大满贯", "网球", "中超", "中甲", "中乙", "联赛",
  "英超", "西甲", "意甲", "德甲", "法甲", "NBA", "CBA", "WTT", "WTA", "ATP",
  // 角色与动作
  "球员", "球队", "选手", "主教练", "转会", "进球", "点球", "赛场", "比赛",
  // 文体娱乐
  "演唱会", "音乐剧", "话剧", "电影节", "首映", "票房", "综艺", "选秀",
  "专辑", "单曲", "巡演", "选美",
];

/** 判断文本是否属于体育/文体语境 */
export function isSportsOrCulture(text: string): boolean {
  return SPORTS_CULTURE_HINTS.some((w) => text.includes(w));
}

/**
 * 电头（发稿地）识别。
 *
 * 中文新闻普遍以「中新社北京10月11日电」「新华社东京6月5日电」
 * 「人民网巴黎6月4日电」等形式开头，其中紧跟通讯社名的地名是**记者发稿地**，
 * 是全文中最可靠的地点信号，因此单独提取并给予最高置信度。
 *
 * 匹配模式：通讯社/媒体名 + 地名 + 数字（月/日） + "电"
 */
const DATELINE_RE =
  /(?:社|网|报|台|新华社|中新社|中新网|人民网|央视|环球时报)\s*([\u4e00-\u9fa5]{2,6}?)\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*(?:电|讯)/;

/** 从文本中提取电头地名（原始字符串，未做库内匹配） */
export function extractDateline(text: string): string | null {
  const m = text.match(DATELINE_RE);
  return m ? m[1] : null;
}

export interface GeoCandidate {
  /** 规范地名 */
  name: string;
  lat: number;
  lon: number;
  level: GeoLevel;
  /** 置信度 0–1 */
  confidence: number;
  /** 该候选是怎么被识别出来的，便于调试与人工复核 */
  reason: string;
}

export interface GeoResult {
  /** 最终采用的地名；无可用结果时为 null */
  place: string | null;
  lat: number | null;
  lon: number | null;
  /** 最终采用的置信度；无结果时为 0 */
  confidence: number;
  /** 全部候选，按置信度降序；供调试、日志与后续人工复核使用 */
  candidates: GeoCandidate[];
  /** 是否因体育/文体语境被整体排除 */
  excludedAsSports: boolean;
}

/** 判断是否为纯 ASCII 词（英文/拉丁字母），用于确定词边界规则 */
function isAsciiWord(w: string): boolean {
  return /^[\x20-\x7E]+$/.test(w);
}

/**
 * 在 text 中判断词 w 是否出现，并返回出现位置。
 *
 * 中文无空格分词，用 includes 即可；但对纯英文词（如 GDELT 相关的地名译名）
 * 需加词边界检查，避免 "Mali" 命中 "Somalia" 这类子串巧合。
 */
function findWord(text: string, w: string): number {
  if (isAsciiWord(w)) {
    const idx = text.toLowerCase().indexOf(w.toLowerCase());
    if (idx < 0) return -1;
    const before = idx === 0 ? "" : text[idx - 1];
    const after = idx + w.length >= text.length ? "" : text[idx + w.length];
    const isBoundary = (c: string) => c === "" || !/[A-Za-z0-9]/.test(c);
    return isBoundary(before) && isBoundary(after) ? idx : -1;
  }
  return text.indexOf(w);
}

/**
 * 识别文本中的地名，返回带置信度的候选列表。
 *
 * @param title   新闻标题（信息密度最高，权重最大）
 * @param summary 摘要或正文开头
 */
export function identifyPlaces(title: string, summary = ""): GeoResult {
  const haystack = `${title} ${summary}`;

  // 体育/文体语境整体排除：此类文本中的国名多为队名或赛事名
  if (isSportsOrCulture(haystack)) {
    return { place: null, lat: null, lon: null, confidence: 0, candidates: [], excludedAsSports: true };
  }

  const dateline = extractDateline(summary) ?? extractDateline(title);

  // 按 level 升序（越具体越先）、同级按词长降序（长词优先，避免"爱尔兰"截胡"北爱尔兰"）
  const ordered = [...GEO_ENTRIES].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return b.name.length - a.name.length;
  });

  const candidates: GeoCandidate[] = [];

  for (const entry of ordered) {
    const words = [entry.name, ...(entry.aliases ?? [])];

    for (const w of words) {
      const inTitle = findWord(title, w) >= 0;
      const inSummary = !inTitle && findWord(summary, w) >= 0;
      if (!inTitle && !inSummary) continue;

      // 电头命中：最高置信度（仅当电头地名与本次匹配的词一致或互为别名）
      const isDateline = dateline !== null && (w === dateline || dateline.includes(w) || w.includes(dateline));

      let confidence: number;
      let reason: string;

      if (isDateline && entry.level <= GeoLevel.Country) {
        confidence = 0.98;
        reason = `电头「${dateline}」命中`;
      } else {
        // 基础分：由地域层级决定；出现在标题再加权
        const base =
          entry.level === GeoLevel.City ? 0.9
          : entry.level === GeoLevel.Country ? 0.9
          : entry.level === GeoLevel.Region ? 0.6
          : 0.35; // Fallback 中国锚点
        confidence = inTitle ? base : base - 0.15;
        if (entry.level === GeoLevel.Region && inTitle) confidence = Math.min(confidence, 0.7);
        reason = inTitle ? `标题命中「${w}」` : `摘要命中「${w}」`;
        if (entry.level === GeoLevel.Fallback) reason += "（中国兜底锚点）";
      }

      candidates.push({
        name: entry.name,
        lat: entry.lat,
        lon: entry.lon,
        level: entry.level,
        confidence: Number(confidence.toFixed(2)),
        reason,
      });

      // 同一个地名只记一次（别名可能多次命中）
      break;
    }
  }

  if (candidates.length === 0) {
    return { place: null, lat: null, lon: null, confidence: 0, candidates: [], excludedAsSports: false };
  }

  // 按置信度降序；同分时优先更具体的地域层级
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.level - b.level;
  });

  /**
   * 多候选一致性加权。
   *
   * 若最高分候选与次高分候选属于**不同的大洲**且分数接近，说明存在歧义，
   * 此时主动降低置信度，使其落入"需人工确认"区间，而不是自信地给出错误坐标。
   * 这是纯规则方案能做的最接近"不确定性表达"的处理。
   */
  let confidence = candidates[0].confidence;
  if (candidates.length > 1) {
    const second = candidates[1];
    const sameLevel = second.level === candidates[0].level;
    if (sameLevel && candidates[0].confidence - second.confidence < 0.1) {
      confidence = Number((confidence - 0.2).toFixed(2));
      candidates[0].reason += `；与候选「${second.name}」得分接近，存在歧义，已下调置信度`;
    }
  }

  const top = candidates[0];
  return {
    place: top.name,
    lat: top.lat,
    lon: top.lon,
    confidence,
    candidates,
    excludedAsSports: false,
  };
}
