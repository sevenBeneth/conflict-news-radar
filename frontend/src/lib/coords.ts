/**
 * CNR · 坐标系转换工具
 * ============================================================================
 *
 * ─── 为什么需要这个文件（关键，勿删）─────────────────────────────────────────
 *
 * 国内地图服务使用的坐标系与国际通用的 WGS-84 并不一致，直接把 WGS-84 的
 * 经纬度画到国内底图上，会产生**数百米的系统性偏移**。对军事/冲突情报场景
 * 而言，这个偏移会直接导致把事件标到错误的行政区甚至错误的城市，属于不可
 * 接受的数据错误。
 *
 * 三种坐标系：
 *   · WGS-84    国际标准（GPS 原始输出）。本项目所有入库坐标均为此系：
 *               GDELT、ACLED、OpenSky、AIS 以及 Nominatim 地理编码。
 *   · GCJ-02    中国国家测绘局制定的加密坐标系，俗称「火星坐标」。
 *               高德、腾讯、Google 中国版使用。
 *   · BD-09     百度在 GCJ-02 基础上二次加密。百度地图使用。
 *
 * 国内底图选型与坐标系的对应关系：
 *   · 天地图（tianditu）→ CGCS2000，与 WGS-84 在民用精度下可视为一致
 *                        **无需偏移**，故设为本项目默认底图。
 *   · 高德（amap）      → GCJ-02，必须对 WGS-84 数据施加偏移后再显示。
 *
 * ─── 实现说明 ────────────────────────────────────────────────────────────────
 * 采用业界通行的 WGS-84 ⇄ GCJ-02 偏移算法（国内公开的标准实现）。
 * 逆变换（GCJ-02 → WGS-84）使用迭代逼近，收敛精度优于 1e-7 度（约 1 厘米），
 * 足以覆盖地图交互所需精度。
 */

const PI = Math.PI;
const A = 6378245.0;              // 克拉索夫斯基椭球长半轴
const EE = 0.00669342162296594323; // 椭球偏心率平方

/** 是否在中国境外（境外不做偏移；粗略矩形范围，覆盖中国大陆及港澳） */
export function isOutOfChina(lon: number, lat: number): boolean {
  return !(lon > 73.66 && lon < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

/**
 * WGS-84 → GCJ-02
 * 用于：把库中的国际坐标系数据搬到高德等 GCJ-02 底图上显示。
 */
export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (isOutOfChina(lon, lat)) return [lon, lat];

  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);

  return [lon + dLon, lat + dLat];
}

/**
 * GCJ-02 → WGS-84
 * 用于：把用户在高德底图上点击/框选得到的坐标还原为国际坐标系，
 *       再写入数据库或用于查询，避免污染库中统一的 WGS-84 数据。
 * 采用迭代逼近，精度优于 1e-7 度。
 */
export function gcj02ToWgs84(lon: number, lat: number): [number, number] {
  if (isOutOfChina(lon, lat)) return [lon, lat];

  let wgsLon = lon;
  let wgsLat = lat;

  // 迭代逼近：反复用 wgs→gcj 正变换校正，直至残差小于阈值
  for (let i = 0; i < 30; i++) {
    const [testLon, testLat] = wgs84ToGcj02(wgsLon, wgsLat);
    const dLon = testLon - lon;
    const dLat = testLat - lat;
    if (Math.abs(dLon) < 1e-7 && Math.abs(dLat) < 1e-7) break;
    wgsLon -= dLon;
    wgsLat -= dLat;
  }
  return [wgsLon, wgsLat];
}

/** GCJ-02 → BD-09（预留：若后续改用百度底图） */
export function gcj02ToBd09(lon: number, lat: number): [number, number] {
  const z = Math.sqrt(lon * lon + lat * lat) + 0.00002 * Math.sin(lat * PI * 3000.0 / 180.0);
  const theta = Math.atan2(lat, lon) + 0.000003 * Math.cos(lon * PI * 3000.0 / 180.0);
  return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
}

/** BD-09 → GCJ-02（预留） */
export function bd09ToGcj02(lon: number, lat: number): [number, number] {
  const x = lon - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * PI * 3000.0 / 180.0);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * PI * 3000.0 / 180.0);
  return [z * Math.cos(theta), z * Math.sin(theta)];
}

/** 坐标系标识 */
export type CoordSystem = "WGS84" | "GCJ02" | "BD09";

/**
 * 把 WGS-84 坐标转换为指定底图坐标系（用于绘制）。
 * 天地图（CGCS2000）视为与 WGS-84 一致，直接返回原值。
 */
export function toMapCoord(
  lon: number,
  lat: number,
  target: CoordSystem
): [number, number] {
  switch (target) {
    case "GCJ02":
      return wgs84ToGcj02(lon, lat);
    case "BD09": {
      const [gLon, gLat] = wgs84ToGcj02(lon, lat);
      return gcj02ToBd09(gLon, gLat);
    }
    case "WGS84":
    default:
      return [lon, lat];
  }
}

/**
 * 把底图坐标还原为 WGS-84（用于用户交互产生的坐标写库）。
 * 这是 toMapCoord 的逆运算，务必成对使用，否则会造成坐标在两种体系间漂移。
 */
export function fromMapCoord(
  lon: number,
  lat: number,
  source: CoordSystem
): [number, number] {
  switch (source) {
    case "GCJ02":
      return gcj02ToWgs84(lon, lat);
    case "BD09": {
      const [gLon, gLat] = bd09ToGcj02(lon, lat);
      return gcj02ToWgs84(gLon, gLat);
    }
    case "WGS84":
    default:
      return [lon, lat];
  }
}

/**
 * 换算一个 bbox（minLon,minLat,maxLon,maxLat）。
 * 用于把用户在 GCJ-02 底图上框选的范围转为 WGS-84 请求参数。
 *
 * 注意：偏移是随位置缓慢变化的，此处对左下与右上两个角点分别换算，
 * 对中小范围（区域级态势关注）误差可忽略；若将来需要跨省级大范围框选，
 * 应改为对四角分别换算后取包络。
 */
export function bboxFromMapCoord(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
  source: CoordSystem
): [number, number, number, number] {
  if (source === "WGS84") return [minLon, minLat, maxLon, maxLat];
  const [wMinLon, wMinLat] = fromMapCoord(minLon, minLat, source);
  const [wMaxLon, wMaxLat] = fromMapCoord(maxLon, maxLat, source);
  return [wMinLon, wMinLat, wMaxLon, wMaxLat];
}
