/** 农历显示：干支纪年、月日中文写法、时辰。与后端 app/lunar.py 保持一致。 */
const STEMS = "甲乙丙丁戊己庚辛壬癸";
export const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
export const LUNAR_MONTHS = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
const TENS = ["初", "十", "廿", "三"];
const DIGITS = "一二三四五六七八九十";

/** 时辰对应的钟点，如 丑 → 01–03 时 */
export function hourRange(branch: string) {
  const i = BRANCHES.indexOf(branch);
  const start = (i * 2 + 23) % 24;
  return `${String(start).padStart(2, "0")}–${String((start + 2) % 24).padStart(2, "0")} 时`;
}

export function ganzhiYear(year: number) {
  return STEMS[(((year - 4) % 10) + 10) % 10] + BRANCHES[(((year - 4) % 12) + 12) % 12];
}

export function lunarDayName(day: number) {
  if (day === 10) return "初十";
  if (day === 20) return "二十";
  if (day === 30) return "三十";
  return TENS[Math.floor(day / 10)] + DIGITS[(day % 10) - 1];
}

export const LUNAR_DAYS = Array.from({ length: 30 }, (_, i) => lunarDayName(i + 1));

/** "2025-02-02" + 寅 → "乙巳年二月初二寅时（2025）"；支持只有年 / 年月 */
export function formatLunar(birth: string | null | undefined, leap = false, hour?: string | null) {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number);
  if (!y) return birth;
  let text = `${ganzhiYear(y)}年`;
  if (m) text += (leap ? "闰" : "") + (LUNAR_MONTHS[m - 1] ?? `${m}月`);
  if (m && d) {
    text += lunarDayName(d);
    if (hour) text += `${hour}时`;
  }
  return `${text}（${y}）`;
}

/** 日期显示：农历 → "农历戊午年二月初二寅时（1798）"；公历原样，完整日期带时辰时附上 */
export function dateText(d: string | null | undefined, o: { lunar?: boolean; leap?: boolean; hour?: string | null } = {}) {
  if (!d) return null;
  const hour = d.length === 10 ? o.hour : null;
  if (o.lunar) return `农历${formatLunar(d, o.leap, hour)}`;
  return hour ? `${d} ${hour}时` : d;
}

export interface LifeDates {
  birth_date?: string | null;
  birth_year?: string | null;
  birth_lunar?: boolean;
  birth_lunar_leap?: boolean;
  birth_hour?: string | null;
  death_date?: string | null;
  death_lunar?: boolean;
  death_lunar_leap?: boolean;
  death_hour?: string | null;
}

export function birthText(p: LifeDates) {
  return dateText(p.birth_date || p.birth_year, { lunar: p.birth_lunar, leap: p.birth_lunar_leap, hour: p.birth_date ? p.birth_hour : null });
}

export function deathText(p: LifeDates) {
  return dateText(p.death_date, { lunar: p.death_lunar, leap: p.death_lunar_leap, hour: p.death_hour });
}
