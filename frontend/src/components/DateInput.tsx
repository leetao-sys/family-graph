import { LUNAR_DAYS, LUNAR_MONTHS } from "../lunar";

/** 公历某月的天数；未选年份时按闰年处理（允许 2 月 29 日） */
export function daysInMonth(year: number | null, month: number) {
  return new Date(year || 2000, month, 0).getDate();
}

/** 校验 YYYY / YYYY-MM / YYYY-MM-DD 的公历日期是否真实存在；返回错误文字或 null */
export function solarDateError(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(v);
  if (!m) return "请填写 4 位年份";
  const [y, mo, d] = [Number(m[1]), m[2] ? Number(m[2]) : null, m[3] ? Number(m[3]) : null];
  if (mo !== null && (mo < 1 || mo > 12)) return `月份不存在：${v}`;
  if (mo !== null && d !== null && (d < 1 || d > daysInMonth(y, mo))) return `日期不存在：${v}`;
  return null;
}

/**
 * 日期选择：年（4 位数字）+ 月（下拉）+ 日（下拉，按当月天数生成）。
 * 支持只填年或年月，结果写成 YYYY[-MM[-DD]]。农历时月份为正月…腊月、日为初一…三十，并可选闰月。
 */
export default function DateInput({
  value,
  onChange,
  calendar = "solar",
  leap = false,
  onLeapChange,
  invalid,
  label = "日期",
}: {
  value: string;
  onChange: (value: string) => void;
  calendar?: "solar" | "lunar";
  leap?: boolean;
  onLeapChange?: (leap: boolean) => void;
  invalid?: boolean;
  label?: string;
}) {
  const lunar = calendar === "lunar";
  const [y = "", m = "", d = ""] = (value || "").split("-");
  const year = /^\d{4}$/.test(y) ? Number(y) : null;
  const month = m ? Number(m) : 0;
  const dayCount = lunar ? 30 : month ? daysInMonth(year, month) : 31;
  const dayInvalid = !!d && Number(d) > dayCount;

  const compose = (ny: string, nm: string, nd: string) => {
    if (!ny && !nm) return onChange("");
    const parts = [ny];
    if (nm) parts.push(nm.padStart(2, "0"));
    if (nm && nd) {
      // 换月份 / 年份后当天不存在（如 3 月 31 日改成 4 月）→ 清空“日”，让用户重新选，不悄悄改成别的日子
      const max = lunar ? 30 : daysInMonth(/^\d{4}$/.test(ny) ? Number(ny) : null, Number(nm));
      if (Number(nd) <= max) parts.push(nd.padStart(2, "0"));
    }
    onChange(parts.join("-"));
  };

  const prefix = lunar ? "农历" : "";
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <input
          className={`input ${invalid ? "invalid" : ""}`}
          style={{ width: 84 }}
          inputMode="numeric"
          maxLength={4}
          placeholder="年"
          aria-label={`${label}${prefix}年`}
          value={y}
          onChange={(e) => compose(e.target.value.replace(/\D/g, "").slice(0, 4), m, d)}
        />
        <select
          className="select"
          aria-label={`${label}${prefix}月`}
          value={month ? String(month) : ""}
          onChange={(e) => {
            compose(y, e.target.value, d);
            if (!e.target.value) onLeapChange?.(false);
          }}
          style={{ width: lunar ? 96 : 84 }}
        >
          <option value="">月</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i + 1}>
              {lunar ? `${leap ? "闰" : ""}${LUNAR_MONTHS[i]}` : `${i + 1} 月`}
            </option>
          ))}
        </select>
        <select
          className={`select ${dayInvalid ? "invalid" : ""}`}
          aria-label={`${label}${prefix}日`}
          value={d && !dayInvalid ? String(Number(d)) : ""}
          disabled={!month}
          onChange={(e) => compose(y, m, e.target.value)}
          style={{ width: 84 }}
        >
          <option value="">日</option>
          {Array.from({ length: dayCount }, (_, i) => (
            <option key={i} value={i + 1}>
              {lunar ? LUNAR_DAYS[i] : `${i + 1} 日`}
            </option>
          ))}
        </select>
        {lunar && (
          <label className="checkbox" title="闰月" style={{ whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={leap} disabled={!month} onChange={(e) => onLeapChange?.(e.target.checked)} /> 闰月
          </label>
        )}
      </div>
      {dayInvalid && <span className="error">原日期 {value} 不存在，请重新选择日</span>}
    </div>
  );
}
