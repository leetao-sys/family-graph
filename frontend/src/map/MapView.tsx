import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, MapPin, Search, X } from "lucide-react";
import { get, put } from "../api";
import { useAuth } from "../auth";
import { useThemeVersion } from "../theme";
import type { PersonBrief } from "../types";
import { Avatar, Empty, ErrorState, ListSkeleton } from "../ui";
import { avatarOf } from "../avatars";
import { geocodeWithTimeout, loadAMap, type AMapNS } from "./amap";

interface MapItem {
  person: PersonBrief;
  source: "burial_place" | "residence" | "marriage_place" | "birth_place_modern" | "birth_place" | "native_place";
  source_label: string;
  address: string;
  original_address?: string | null;
}
interface PlaceCoord {
  lat: number | null;
  lng: number | null;
  formatted: string | null;
}
interface MapData {
  items: MapItem[];
  places: Record<string, PlaceCoord>;
  missing: PersonBrief[];
}
interface Group {
  address: string;
  coord: PlaceCoord | undefined;
  items: MapItem[];
  originals: string[];
}

const SOURCE_CLASS: Record<string, string> = { burial_place: "primary", residence: "primary", marriage_place: "kin", birth_place_modern: "kin", birth_place: "kin", native_place: "" };

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches);
}



/** 地图：按“现居地 > 出生地 > 籍贯”在高德地图上标注每个人的位置。 */
export default function MapView({
  onPick,
  focusPersonId,
}: {
  onPick: (id: number) => void;
  focusPersonId?: number | null;
}) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<{ key: string; code: string } | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapNS>(null);
  const AMapRef = useRef<AMapNS>(null);
  const markersRef = useRef<AMapNS[]>([]);
  const onPickRef = useRef(onPick);
  const focusedPerson = useRef<number | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const themeVersion = useThemeVersion();

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    Promise.all([get<{ amap_key: string; amap_security_code: string }>("/api/settings"), get<MapData>("/api/map/persons")])
      .then(([s, d]) => {
        setCfg({ key: s.amap_key, code: s.amap_security_code });
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, []);

  // —— 初始化地图 ——
  useEffect(() => {
    if (!cfg?.key || !boxRef.current) return;
    let destroyed = false;
    loadAMap(cfg.key, cfg.code)
      .then((AMap) => {
        if (destroyed || !boxRef.current) return;
        AMapRef.current = AMap;
        const map = new AMap.Map(boxRef.current, {
          zoom: window.innerWidth > 820 ? 4.4 : 3.6,
          center: [110, 30],
          viewMode: "2D",
          mapStyle: isDark() ? "amap://styles/dark" : "amap://styles/normal",
        });
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ position: { right: "16px", bottom: "40px" } }));
        mapRef.current = map;
        setReady(true);
      })
      .catch((e) => setMapError(e.message));
    return () => {
      destroyed = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      setReady(false);
    };
  }, [cfg]);

  useEffect(() => {
    mapRef.current?.setMapStyle(isDark() ? "amap://styles/dark" : "amap://styles/normal");
  }, [themeVersion]);

  // —— 未缓存的地址：浏览器端地理编码后回写服务器缓存 ——
  useEffect(() => {
    if (!ready || !data) return;
    const counts = new Map<string, number>();
    for (const it of data.items) counts.set(it.address, (counts.get(it.address) ?? 0) + 1);
    const todo = [...new Set(data.items.map((i) => i.address))]
      .filter((a) => data.places[a] === undefined)
      // 先解析人多的地点，这样地图能尽快出现主要内容，而不是被一个生僻古地名卡住
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b, "zh-CN"));
    if (!todo.length) return;
    let cancelled = false;
    let cursor = 0;
    let done = 0;
    let failed = 0;
    setMapError("");
    setProgress({ done: 0, total: todo.length });

    (async () => {
      const AMap = AMapRef.current;
      if (!AMap) return;
      const worker = async () => {
        const geocoder = new AMap.Geocoder({ city: "全国" });
        while (!cancelled) {
          const i = cursor++;
          if (i >= todo.length) return;
          const address = todo[i];
          let coord: PlaceCoord | null = null;
          try {
            coord = await geocodeWithTimeout(geocoder, address, 5000);
          } catch {
            failed += 1;
          }
          try {
            const saved = await put<PlaceCoord & { address: string }>("/api/places", {
              address,
              lat: coord?.lat ?? null,
              lng: coord?.lng ?? null,
              formatted: coord?.formatted ?? null,
            });
            if (cancelled) return;
            setData((d) => (d ? { ...d, places: { ...d.places, [address]: saved } } : d));
          } catch {
            /* 缓存写入失败时跳过这一条，不影响后续地址 */
          }
          done += 1;
          if (!cancelled) setProgress({ done, total: todo.length });
        }
      };
      // 高德 JS API 建议少量并发；4 路能在“尽快出点”和限频之间取得平衡
      await Promise.all(Array.from({ length: Math.min(4, todo.length) }, () => worker()));
      if (!cancelled) {
        setProgress(null);
        if (failed === todo.length && todo.length > 0) {
          setMapError("地址解析全部失败，请确认高德 Key 已开通“Web端(JS API)”服务，并检查域名白名单与安全密钥。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // 只在地图就绪、首次拿到数据时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data === null]);
  const groups: Group[] = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, Group>();
    for (const it of data.items) {
      if (!m.has(it.address)) m.set(it.address, { address: it.address, coord: data.places[it.address], items: [], originals: [] });
      const g = m.get(it.address)!;
      g.items.push(it);
      if (it.original_address && !g.originals.includes(it.original_address)) g.originals.push(it.original_address);
    }
    return [...m.values()].sort((a, b) => b.items.length - a.items.length || a.address.localeCompare(b.address, "zh-CN"));
  }, [data]);
  const focusGroup = groups.find((g) => g.coord?.lat != null && g.coord?.lng != null);
  const hintGroup = (selected ? groups.find((g) => g.address === selected) : null) ?? focusGroup;

  // —— 标记 ——
  useEffect(() => {
    const map = mapRef.current;
    const AMap = AMapRef.current;
    if (!ready || !map || !AMap) return;
    map.remove(markersRef.current);
    const markers = groups
      .filter((g) => g.coord?.lat != null && g.coord?.lng != null)
      .map((g) => {
        const active = g.address === selected;
        const shown = g.items.slice(0, 4);
        const content = document.createElement("div");
        content.className = `amap-avatar-cluster${shown.length === 1 ? " single" : ""}${active ? " active" : ""}`;
        shown.forEach((it, i) => {
          const p = it.person;
          const img = document.createElement("img");
          img.className = `amap-avatar${!p.is_living ? " is-deceased" : ""} ${p.avatar ? "custom-avatar" : "default-avatar"}`;
          img.src = avatarOf(p);
          img.alt = p.name;
          img.title = `${p.name}${p.birth_year ? ` · ${p.birth_year}` : ""}`;
          img.draggable = false;
          img.style.setProperty("--i", String(i));
          img.addEventListener("click", (ev) => {
            ev.stopPropagation();
            onPickRef.current(p.id);
          });
          content.appendChild(img);
        });
        const m = new AMap.Marker({
          position: [g.coord!.lng, g.coord!.lat],
          anchor: "bottom-center",
          title: `${g.address}（${g.items.length} 人）`,
          zIndex: active ? 300 : 100 + g.items.length,
          content,
        });
        m.on("click", () => setSelected(g.address));
        return m;
      });
    map.add(markers);
    markersRef.current = markers;
    if (!fitted.current && markers.length && !progress) {
      fitted.current = true;
      // 首次进入自动聚焦到人数最多的地点（列表已按人数倒序）
      if (focusGroup?.coord?.lat != null && focusGroup.coord.lng != null) {
        map.setZoomAndCenter(12, [focusGroup.coord.lng, focusGroup.coord.lat]);
      } else {
        map.setZoomAndCenter(window.innerWidth > 820 ? 4.4 : 3.6, [110, 30]);
      }
    }
  }, [ready, groups, selected, progress, focusGroup]);

  // 右侧人物笺切换到某个人物时，地图飞到该人物的地点
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!focusPersonId) {
      focusedPerson.current = null;
      return;
    }
    if (focusedPerson.current === focusPersonId) return;
    if (!groups.length) return;
    const target = groups.find(
      (g) => g.coord?.lat != null && g.coord?.lng != null && g.items.some((it) => it.person.id === focusPersonId),
    );
    focusedPerson.current = focusPersonId;
    if (!target?.coord || target.coord.lng == null || target.coord.lat == null) return;
    setSelected((cur) => (cur === target.address ? cur : target.address));
    map.setZoomAndCenter(12, [target.coord.lng, target.coord.lat]);
  }, [ready, focusPersonId, groups]);


  const select = (address: string) => {
    setSelected(address);
    const g = groups.find((x) => x.address === address);
    if (g?.coord?.lat != null && mapRef.current) mapRef.current.setZoomAndCenter(10, [g.coord.lng, g.coord.lat]);
  };
  const showAll = () => {
    setSelected(null);
    mapRef.current?.setZoomAndCenter(window.innerWidth > 820 ? 4.4 : 3.6, [110, 30]);
  };

  if (error) return <ErrorState message={error} />;
  if (!cfg || !data) return <div className="page"><ListSkeleton /></div>;
  if (!cfg.key) {
    return (
      <Empty
        title="尚未配置高德地图"
        hint="地图功能使用高德地图 JS API，需要管理员在“管理后台 → 系统设置”中填写高德 Key 与安全密钥。"
        action={user?.role === "admin" ? <Link className="btn btn-primary" to="/admin/settings">去配置</Link> : undefined}
      />
    );
  }

  const kw = q.trim();
  const filtered = kw ? groups.filter((g) => g.address.includes(kw) || g.items.some((i) => i.person.name.includes(kw))) : groups;
  const current = groups.find((g) => g.address === selected);
  const unlocated = groups.filter((g) => g.coord && g.coord.lat == null);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={boxRef} className="map-surface" aria-label="人物地址地图" />
      <div className="floating map-panel">
        <div className="picker-input" style={{ margin: 12 }}>
          <Search size={16} />
          <input className="input" placeholder="搜索地点或人名" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null); }} aria-label="搜索地点或人名" />
          {q && (
            <button className="icon-btn" style={{ position: "absolute", right: 2, top: 1 }} aria-label="清除" onClick={() => setQ("")}>
              <X size={16} />
            </button>
          )}
        </div>
        {hintGroup && (
          <div className="map-focus-hint">
            <span title={hintGroup.address}>{selected ? "当前" : "默认聚焦"}：{hintGroup.address} · {hintGroup.items.length} 人</span>
            <button className="btn btn-ghost btn-sm" onClick={showAll}>全览</button>
          </div>
        )}
        <div className="map-panel-body">
          {mapError && <div className="alert danger small" style={{ marginBottom: 10 }}>{mapError}</div>}
          {progress && <div className="alert info small" style={{ marginBottom: 10 }}>正在定位地址 {progress.done}/{progress.total}…</div>}
          {current ? (
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setSelected(null)}>
                <ArrowLeft size={14} /> 全部地点
              </button>
              <div>
                <h2 style={{ fontSize: 20 }}>{current.address}</h2>
                <div className="muted small">
                  {current.coord?.formatted && current.coord.formatted !== current.address ? `${current.coord.formatted} · ` : ""}
                  {current.items.length} 人
                </div>
                {current.originals.length > 0 && (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    旧地名：{current.originals.slice(0, 3).join(" / ")}{current.originals.length > 3 ? ` 等 ${current.originals.length} 处` : ""}
                  </div>
                )}
              </div>
              <ul className="rel-list">
                {current.items.map((it) => (
                  <li key={it.person.id} style={{ cursor: "pointer" }} onClick={() => onPick(it.person.id)}>
                    <Avatar person={it.person} size={36} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="name">{it.person.name}{!it.person.is_living && <span className="muted small">（已故）</span>}</div>
                      <div className="muted small">{it.person.birth_year ? `${it.person.birth_year} 年生` : ""}</div>
                    </div>
                    <span className={`badge ${SOURCE_CLASS[it.source]}`}>{it.source_label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              <div className="muted small">按 安葬地 &gt; 现居地 &gt; 出嫁地 &gt; 出生地（今） 标注 · {groups.length} 个地点 · {data.items.length} 人</div>
              {filtered.length === 0 && <div className="muted small" style={{ padding: "12px 0" }}>没有匹配的地点</div>}
              <ul className="rel-list">
                {filtered.map((g) => (
                  <li key={g.address} style={{ cursor: "pointer" }} onClick={() => select(g.address)}>
                    <MapPin size={18} color={g.coord?.lat != null ? "#e5484d" : "var(--text-3)"} style={{ flex: "none" }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.address}</div>
                      <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {g.items.slice(0, 4).map((i) => i.person.name).join("、")}{g.items.length > 4 ? " 等" : ""}
                      </div>
                      {g.originals.length > 0 && (
                        <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.82 }}>
                          旧：{g.originals.slice(0, 2).join(" / ")}{g.originals.length > 2 ? " …" : ""}
                        </div>
                      )}
                    </div>
                    <span className="badge">{g.items.length}</span>
                  </li>
                ))}
              </ul>
              {unlocated.length > 0 && <div className="muted small">{unlocated.length} 个地址未能在地图上定位，可改写为更完整的地址（如“湖南省长沙市”）。</div>}
              {data.missing.length > 0 && (
                <div className="small">
                  <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => setShowMissing((s) => !s)}>
                    {showMissing ? "收起" : "查看"}未填写地址的 {data.missing.length} 人
                  </button>
                  {showMissing && (
                    <div className="row wrap" style={{ gap: 4 }}>
                      {data.missing.map((p) => (
                        <button key={p.id} className="chip" onClick={() => onPick(p.id)}>{p.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
