import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

const THEME_KEY = "zp.theme";
const MOTION_KEY = "zp.motion";

function read(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下忽略 */
  }
}
function systemIsDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function resolve(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemIsDark() ? "dark" : "light") : pref;
}
function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export function applyStoredPrefs() {
  applyTheme(read(THEME_KEY, "light") as ThemePref);
  if (read(MOTION_KEY, "normal") === "reduce") document.documentElement.dataset.motion = "reduce";
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => read(THEME_KEY, "light") as ThemePref);
  useEffect(() => {
    write(THEME_KEY, pref);
    applyTheme(pref);
    window.dispatchEvent(new Event("fg-theme"));
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyTheme("system");
      window.dispatchEvent(new Event("fg-theme"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  return [pref, setPref] as const;
}

export function useReducedMotion() {
  const [reduce, setReduce] = useState(() => read(MOTION_KEY, "normal") === "reduce");
  useEffect(() => {
    write(MOTION_KEY, reduce ? "reduce" : "normal");
    if (reduce) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [reduce]);
  return [reduce, setReduce] as const;
}

export function prefersReducedMotion() {
  return (
    document.documentElement.dataset.motion === "reduce" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 读取当前生效的 CSS 变量（用于 Canvas / SVG 导出） */
export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 主题（含跟随系统）变化时递增，供画布重绘 */
export function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    window.addEventListener("fg-theme", bump);
    return () => {
      mq.removeEventListener("change", bump);
      window.removeEventListener("fg-theme", bump);
    };
  }, []);
  return v;
}
