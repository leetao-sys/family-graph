import type { Gender } from "./types";

/** 默认头像：宣纸底、墨色剪影、一点朱砂 / 黛青。 */
const wrap = (bg: string, ink: string, accent: string, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
  `<circle cx="48" cy="48" r="47" fill="${bg}"/>` +
  `<circle cx="48" cy="48" r="43" fill="none" stroke="${accent}" stroke-width="2.2" opacity=".9"/>` +
  extra +
  `<circle cx="48" cy="37" r="14" fill="${ink}"/>` +
  `<path d="M20 86c2.5-17 14-26 28-26s25.5 9 28 26a48 48 0 0 1-56 0z" fill="${ink}"/>` +
  `<path d="M34 68c4 5 9 7 14 7s10-2 14-7" fill="none" stroke="${bg}" stroke-width="1.6" opacity=".75"/>` +
  `</svg>`;

// 在世：男性靛蓝 / 女性绛红 / 未知茶褐
const MALE = wrap(
  "#3f5d82",
  "#f3e8d4",
  "#a9c7e8",
  `<path d="M34 34c0-9 6-14 14-14s14 5 14 14c-4-5-8-7-14-7s-10 2-14 7z" fill="#263b53"/>`,
);
const FEMALE = wrap(
  "#9a4c5d",
  "#f8ebe1",
  "#e7b9c6",
  `<path d="M30 47c-3-8-3-16 1-22 4-8 10-11 17-11s13 3 17 11c4 6 4 14 1 22-2-7-5-11-9-14-3 4-8 6-17 6-5 0-8 3-10 8z" fill="#6b2939"/>`,
);
const UNKNOWN = wrap("#8a7a62", "#f2e9d9", "#d1c3ab");

// 已故：低饱和灰蓝 / 灰绛，和“在世”的鲜明色拉开，同时保留性别区分
const DECEASED_MALE = wrap(
  "#466077",
  "#e9e3d7",
  "#a8bed0",
  `<path d="M34 34c0-9 6-14 14-14s14 5 14 14c-4-5-8-7-14-7s-10 2-14 7z" fill="#354a5c"/>`,
);
const DECEASED_FEMALE = wrap(
  "#835a66",
  "#f0e5df",
  "#cfb0bb",
  `<path d="M30 47c-3-8-3-16 1-22 4-8 10-11 17-11s13 3 17 11c4 6 4 14 1 22-2-7-5-11-9-14-3 4-8 6-17 6-5 0-8 3-10 8z" fill="#5d3f49"/>`,
);
const DECEASED_UNKNOWN = wrap("#706d65", "#eee6d8", "#b8b1a5");

const toUri = (s: string) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;

export const DEFAULT_AVATARS: Record<Gender, string> = {
  male: toUri(MALE),
  female: toUri(FEMALE),
  unknown: toUri(UNKNOWN),
};

export const DECEASED_AVATARS: Record<Gender, string> = {
  male: toUri(DECEASED_MALE),
  female: toUri(DECEASED_FEMALE),
  unknown: toUri(DECEASED_UNKNOWN),
};

export function avatarOf(p: { avatar: string | null; gender: Gender; is_living?: boolean }): string {
  if (p.avatar) return p.avatar;
  if (p.is_living === false) return DECEASED_AVATARS[p.gender] || DECEASED_AVATARS.unknown;
  return DEFAULT_AVATARS[p.gender] || DEFAULT_AVATARS.unknown;
}

/** 性别在墨线纸面中的语义色：靛青 / 绛红 / 灰墨 */
export const GENDER_COLOR: Record<Gender, string> = {
  male: "#40587a",
  female: "#9a4f5f",
  unknown: "#8b8272",
};

export const GENDER_SOFT: Record<Gender, string> = {
  male: "rgba(64, 88, 122, 0.09)",
  female: "rgba(154, 79, 95, 0.09)",
  unknown: "rgba(139, 130, 114, 0.09)",
};
