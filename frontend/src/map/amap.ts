/** 高德地图 JS API 2.0 加载器（Key 与安全密钥由管理员在“系统设置”中配置）。 */

// 高德 JS API 没有官方类型定义，这里只声明用到的部分
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AMapNS = any;

declare global {
  interface Window {
    AMap?: AMapNS;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

let loading: Promise<AMapNS> | null = null;
let loadedKey = "";

export function loadAMap(key: string, securityCode: string): Promise<AMapNS> {
  if (loading && loadedKey === key) return loading;
  loadedKey = key;
  window._AMapSecurityConfig = { securityJsCode: securityCode };
  loading = new Promise((resolve, reject) => {
    if (window.AMap) return resolve(window.AMap);
    const s = document.createElement("script");
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Geocoder,AMap.Scale,AMap.ToolBar`;
    s.async = true;
    s.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error("高德地图加载失败，请检查 Key 是否正确、本站域名是否已加入 Key 的白名单")));
    s.onerror = () => {
      loading = null;
      reject(new Error("无法连接高德地图服务，请检查网络"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface GeoResult {
  lat: number;
  lng: number;
  formatted: string;
}

/** 高德 Geocoder 对部分历史地名可能永不回调，必须加超时，否则整个定位队列会卡住 */
export function geocodeWithTimeout(
  geocoder: AMapNS,
  address: string,
  ms = 5000,
): Promise<GeoResult | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("地理编码超时"));
    }, ms);
    geocode(geocoder, address).then((r) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(r);
    }).catch((e) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(e);
    });
  });
}

/** 地址 → 坐标；未找到返回 null，Key 无效等错误抛出 */
export function geocode(geocoder: AMapNS, address: string): Promise<GeoResult | null> {
  return new Promise((resolve, reject) => {
    geocoder.getLocation(address, (status: string, result: AMapNS) => {
      if (status === "complete" && result?.geocodes?.length) {
        const g = result.geocodes[0];
        resolve({ lat: g.location.lat, lng: g.location.lng, formatted: g.formattedAddress || address });
      } else if (status === "no_data" || (status === "complete" && !result?.geocodes?.length)) {
        resolve(null);
      } else {
        reject(new Error(typeof result === "string" ? result : result?.info || "地理编码失败"));
      }
    });
  });
}
