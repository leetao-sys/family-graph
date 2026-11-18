export class ApiError extends Error {
  status: number;
  warnings: string[];
  constructor(status: number, message: string, warnings: string[] = []) {
    super(message);
    this.status = status;
    this.warnings = warnings;
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

function messageOf(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI 422 校验错误
    return detail
      .map((d: { msg?: string; loc?: unknown[] }) => (d.msg || "").replace(/^Value error, /, ""))
      .join("；");
  }
  if (detail && typeof detail === "object" && "warnings" in detail) return "需要确认";
  return status >= 500 ? "服务器开小差了，请稍后重试" : `请求失败（${status}）`;
}

export async function api<T = any>(path: string, options: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = options;
  const init: RequestInit = {
    credentials: "same-origin",
    ...rest,
    headers: {
      "X-Requested-With": "family-graph",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers || {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  };
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "网络连接失败，请检查网络后重试");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    unauthorizedListeners.forEach((fn) => fn());
  }
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = isJson ? (data as { detail?: unknown }).detail : data;
    const warnings =
      detail && typeof detail === "object" && "warnings" in (detail as object)
        ? ((detail as { warnings: string[] }).warnings ?? [])
        : [];
    throw new ApiError(res.status, messageOf(detail, res.status), warnings);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {} });
export const put = <T = any>(path: string, json?: unknown) => api<T>(path, { method: "PUT", json: json ?? {} });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
export const upload = <T = any>(path: string, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return api<T>(path, { method: "POST", body: fd });
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  });
  return s.toString();
}
