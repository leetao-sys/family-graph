export type Gender = "male" | "female" | "unknown";

export interface PersonBrief {
  id: number;
  name: string;
  gender: Gender;
  is_living: boolean;
  birth_year: string | null;
  avatar: string | null;
  generation: number | null;
  generation_name: string | null;
  hint?: string | null; // 搜索结果中用于区分同名人物：父母 / 配偶 / 分支
}

export interface Person extends PersonBrief {
  surname: string;
  given_name: string;
  former_name: string | null;
  courtesy_name: string | null;
  honorific: string | null; // 封赠 / 功名，如 例赠登仕郎
  nickname: string | null;
  birth_date: string | null;
  birth_lunar: boolean;
  birth_lunar_leap: boolean;
  birth_hour: string | null;
  death_date: string | null;
  death_lunar: boolean;
  death_lunar_leap: boolean;
  death_hour: string | null;
  birth_order: number | null;
  branch: string | null;
  hall_name: string | null;
  native_place: string | null;
  ethnicity: string | null;
  phone: string | null;
  email: string | null;
  residence: string | null;
  employer: string | null;
  occupation: string | null;
  birth_place: string | null;
  birth_place_modern: string | null;
  burial_place: string | null;
  marriage_place: string | null;
  marriage_inferred: boolean;
  bio: string | null;
  bio_format: "markdown" | "html";
  notes?: string | null;
  privacy?: Record<string, string>;
  hidden_fields?: string[];
  avatar_large: string | null;
  has_account: boolean;
  can_edit: boolean;
}

export interface User {
  id: number;
  username: string;
  role: "admin" | "member";
  person_id: number | null;
  person: PersonBrief | null;
  must_change_password: boolean;
  can_use_social: boolean; // 社会关系功能：管理员始终可用，成员需管理员开通
}

export interface RelationType {
  id: number;
  code: string;
  name: string;
  category: "kin" | "social";
  symmetric: boolean;
  forward_name: string;
  reverse_name: string;
  kinship_role: string | null;
  sort: number;
  color: string;
  builtin: boolean;
}

export interface NetNode extends PersonBrief {
  depth: number;
  kin_term: string | null;
  has_account: boolean;
}

export interface NetEdge {
  id: number | string;
  source: number;
  target: number;
  type_id: number;
  type_code: string;
  type_name: string;
  category: "kin" | "social";
  label: string;
  directed: boolean;
  status: string;
  is_public?: boolean;
  color: string;
  detail: string;
}

export interface NetworkData {
  center: number;
  depth: number;
  nodes: NetNode[];
  edges: NetEdge[];
  truncated: boolean;
}

export interface PersonRelation {
  id: number | string; // 推导出的兄弟姐妹为 "d{a}-{b}"
  type_id: number;
  type_name: string;
  category: "kin" | "social";
  color: string;
  label: string;
  role_of_other: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  note: string | null;
  is_public: boolean;
  created_by: number | null;
  person_a_id: number;
  person_b_id: number;
  other: PersonBrief;
  can_edit: boolean;
}

export interface KinStep {
  id: number;
  name: string;
  token: string | null;
  label: string;
}

export interface KinPath {
  term: string;
  chain: string;
  description: string;
  steps: KinStep[];
  matched: boolean;
}

export interface KinResult {
  term: string | null;
  found: boolean;
  reason?: string;
  paths: KinPath[];
}

export interface TreePerson extends PersonBrief {
  death_date: string | null;
  birth_date: string | null;
  birth_lunar?: boolean;
  birth_lunar_leap?: boolean;
  birth_hour?: string | null;
  death_lunar?: boolean;
  death_lunar_leap?: boolean;
  death_hour?: string | null;
  has_account: boolean;
  birth_order: number | null;
}

export interface TreeData {
  root: number;
  mode: "ancestors" | "descendants" | "hourglass" | "blood";
  gen: number;
  persons: Record<string, TreePerson>;
  parents: { child: number; parent: number; kind: string }[];
  spouses: { a: number; b: number; active: boolean; widowed?: boolean; start: string | null }[];
  siblings?: { a: number; b: number }[]; // 单独登记的兄弟姐妹关系（未录入共同父母）
}

export const GENDER_LABEL: Record<Gender, string> = { male: "男", female: "女", unknown: "未知" };
