"""农历工具：干支纪年、农历日期中文写法、农历生日换算为公历（依赖 lunardate，支持 1900–2099 年）。"""
from datetime import date

from lunardate import LunarDate

HEAVENLY_STEMS = "甲乙丙丁戊己庚辛壬癸"
EARTHLY_BRANCHES = tuple("子丑寅卯辰巳午未申酉戌亥")
LUNAR_MONTHS = ("正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月")
_DAY_TENS = ("初", "十", "廿", "三")
_DIGITS = "一二三四五六七八九十"


def ganzhi_year(year: int) -> str:
    """农历年的干支，如 2026 → 丙午。"""
    return HEAVENLY_STEMS[(year - 4) % 10] + EARTHLY_BRANCHES[(year - 4) % 12]


def lunar_day_name(day: int) -> str:
    if day == 10:
        return "初十"
    if day == 20:
        return "二十"
    if day == 30:
        return "三十"
    return _DAY_TENS[day // 10] + _DIGITS[day % 10 - 1]


def format_lunar(birth: str | None, leap: bool = False, hour: str | None = None) -> str | None:
    """'2025-02-02' + 寅 → '乙巳年二月初二寅时（2025）'。支持只有年或年月。"""
    if not birth:
        return None
    parts = [int(x) for x in birth.split("-")]
    text = f"{ganzhi_year(parts[0])}年"
    if len(parts) > 1:
        text += ("闰" if leap else "") + LUNAR_MONTHS[parts[1] - 1]
    if len(parts) > 2:
        text += lunar_day_name(parts[2])
        if hour:
            text += f"{hour}时"
    return f"{text}（{parts[0]}）"


def lunar_to_solar(year: int, month: int, day: int, leap: bool = False) -> date | None:
    """农历转公历。当年没有该闰月时按正常月；小月没有三十时按廿九。超出范围返回 None。"""
    for lp in ((leap, False) if leap else (False,)):
        for d in (day, day - 1) if day == 30 else (day,):
            try:
                return LunarDate(year, month, d, lp).to_solar_date()
            except ValueError:
                continue
    return None


def next_solar_birthday(month: int, day: int, today: date) -> date:
    for y in (today.year, today.year + 1):
        try:
            d = date(y, month, day)
        except ValueError:  # 2 月 29 日在平年按 2 月 28 日
            d = date(y, month, 28)
        if d >= today:
            return d
    raise AssertionError("unreachable")


def next_lunar_birthday(month: int, day: int, leap: bool, today: date) -> tuple[date, int] | None:
    """返回 (下一个农历生日对应的公历日期, 该生日所在农历年)。"""
    for y in (today.year - 1, today.year, today.year + 1):
        d = lunar_to_solar(y, month, day, leap)
        if d and d >= today:
            return d, y
    return None
