import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { del, get, post, put, qs } from "../api";
import { RichEditor, type TextFormat } from "../components/RichText";
import ArticleReader from "../components/ArticleReader";
import { Empty, ErrorState, ListSkeleton, PageHeading, Pagination, useConfirm, useDebounced, useToast } from "../ui";
import { useAuth } from "../auth";

interface ArticleBrief {
  id: number;
  title: string;
  summary: string | null;
  excerpt: string;
  format: TextFormat;
  author: { id: number | null; name: string };
  created_at: string | null;
  updated_at: string | null;
  can_edit: boolean;
}
interface Article extends ArticleBrief {
  content: string;
}
interface ArticleExport {
  version: number;
  exported_at: string;
  articles: Array<{ title: string; summary: string | null; content: string; format: TextFormat }>;
}

const PAGE = 20;

function fmtTime(s: string | null) {
  if (!s) return "";
  const d = new Date(s.endsWith("Z") ? s : `${s}Z`);
  return d.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ArticleList() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ioBusy, setIoBusy] = useState(false);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: ArticleBrief[] } | null>(null);
  const [error, setError] = useState("");
  const dq = useDebounced(q, 300);

  const load = useCallback(() => {
    setError("");
    get(`/api/articles?${qs({ q: dq, mine: mine || undefined, page, size: PAGE })}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [dq, mine, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [dq, mine]);

  const exportAll = async () => {
    setIoBusy(true);
    try {
      const data = await get<ArticleExport>("/api/articles/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `李氏家谱文章-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("success", `已导出 ${data.articles.length} 篇文章`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setIoBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setIoBusy(true);
    try {
      const raw = JSON.parse(await file.text()) as ArticleExport | ArticleExport["articles"];
      const articles = Array.isArray(raw) ? raw : raw.articles;
      if (!Array.isArray(articles) || articles.length === 0) throw new Error("文件中没有可导入的文章");
      if (!(await confirm({
        title: "导入文章",
        message: `准备导入 ${articles.length} 篇文章。标题相同的文章会用导入内容覆盖，标题不同的会新增。是否继续？`,
        okText: "导入",
      }))) return;
      const result = await post<{ created: number; updated: number }>("/api/articles/import", { articles });
      toast("success", `导入完成：新增 ${result.created} 篇，更新 ${result.updated} 篇`);
      load();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setIoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };


  return (
    <div className="page">
      <PageHeading mark="文" title="谱牒文章" sub="族人手记 · 族史考证" />
      <div className="card">
        <div className="card-body stack">
          <div className="row wrap">
            <span className="kicker">文章列表</span>
            <span className="spacer" />
            <div className="row" style={{ position: "relative" }}>
              <Search size={16} style={{ position: "absolute", left: 10, color: "var(--text-3)" }} />
              <input className="input" style={{ paddingLeft: 32, width: 220 }} placeholder="搜索标题或内容" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索文章" />
            </div>
            <div className="segmented" role="group" aria-label="范围">
              <button aria-pressed={!mine} onClick={() => setMine(false)}>全部</button>
              <button aria-pressed={mine} onClick={() => setMine(true)}>我写的</button>
            </div>
            {user?.role === "admin" && (
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={ioBusy}>
                <Upload size={15} /> 导入
              </button>
            )}
            <button className="btn btn-sm" onClick={exportAll} disabled={ioBusy}>
              <Download size={15} /> 导出
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
              }}
            />
            <Link className="btn btn-primary" to="/articles/new">
              <Plus size={16} /> 写文章
            </Link>
          </div>
          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : !data ? (
            <ListSkeleton />
          ) : data.items.length === 0 ? (
            <Empty title={q || mine ? "没有找到文章" : "还没有文章"} hint="记录家族故事、族史考证、人物传记…" />
          ) : (
            <>
              <ul className="article-list">
                {data.items.map((a) => (
                  <li key={a.id}>
                    <Link to={`/articles/${a.id}`}>
                      <div className="article-title">{a.title}</div>
                      {a.excerpt && <div className="muted small" style={{ marginTop: 4 }}>{a.excerpt}</div>}
                      <div className="muted small" style={{ marginTop: 6 }}>
                        {a.author.name} · 更新于 {fmtTime(a.updated_at)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pagination page={page} size={PAGE} total={data.total} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ArticleView() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [a, setA] = useState<Article | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setA(null);
    get<Article>(`/api/articles/${id}`).then(setA).catch((e) => setError(e.message));
  }, [id]);

  const remove = async () => {
    if (!a) return;
    if (!(await confirm({ title: "删除文章", message: `确定删除《${a.title}》吗？删除后无法恢复。`, danger: true, okText: "删除" }))) return;
    try {
      await del(`/api/articles/${a.id}`);
      toast("success", "已删除");
      nav("/articles");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  };

  if (error) return <div className="page"><ErrorState message={error} /></div>;
  if (!a) return <div className="page"><ListSkeleton /></div>;
  return (
    <div className="page">
      <PageHeading mark="文" title="谱牒文章" sub="族人手记 · 族史考证" />
      <div className="card">
        <div className="card-body stack" style={{ gap: 16 }}>
          <div className="row wrap">
            <Link className="btn btn-sm btn-ghost" to="/articles">
              <ArrowLeft size={14} /> 返回列表
            </Link>
            <span className="spacer" />
            {a.can_edit && (
              <>
                <Link className="btn btn-sm" to={`/articles/${a.id}/edit`}>
                  <Pencil size={14} /> 编辑
                </Link>
                <button className="btn btn-sm btn-danger" onClick={remove}>
                  <Trash2 size={14} /> 删除
                </button>
              </>
            )}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <h1 style={{ fontSize: 24 }}>{a.title}</h1>
            <div className="muted small">
              {a.author.name} · 发表于 {fmtTime(a.created_at)}
              {a.updated_at && a.updated_at !== a.created_at && ` · 更新于 ${fmtTime(a.updated_at)}`}
            </div>
            {a.summary && <div className="alert info small">{a.summary}</div>}
          </div>
          {a.content.trim() ? (
            <ArticleReader content={a.content} format={a.format} className="article-body" />
          ) : (
            <span className="muted">（无正文）</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArticleEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<TextFormat>("markdown");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    get<Article>(`/api/articles/${id}`)
      .then((a) => {
        if (!a.can_edit) return setError("只能修改自己发表的文章");
        setTitle(a.title);
        setSummary(a.summary || "");
        setContent(a.content);
        setFormat(a.format);
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("请填写标题");
    setError("");
    setBusy(true);
    try {
      const body = { title: title.trim(), summary: summary.trim() || null, content, format };
      const saved = id ? await put<Article>(`/api/articles/${id}`, body) : await post<Article>("/api/articles", body);
      toast("success", id ? "已保存" : "已发表");
      nav(`/articles/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <div className="page">{error ? <ErrorState message={error} /> : <ListSkeleton />}</div>;
  return (
    <div className="page">
      <form className="card" onSubmit={submit} noValidate>
        <div className="card-body stack" style={{ gap: 14 }}>
          <div className="row">
            <FileText size={20} />
            <h1 style={{ fontSize: 20 }}>{id ? "编辑文章" : "写文章"}</h1>
          </div>
          <div className="field">
            <label htmlFor="art-title">标题</label>
            <input id="art-title" className="input" maxLength={128} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文章标题" />
          </div>
          <div className="field">
            <label htmlFor="art-summary">摘要（可选）</label>
            <input id="art-summary" className="input" maxLength={256} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="不填则自动截取正文开头" />
          </div>
          <div className="field">
            <label htmlFor="art-content">正文</label>
            <RichEditor
              id="art-content"
              value={content}
              format={format}
              minHeight={360}
              onChange={(v, f) => {
                setContent(v);
                setFormat(f);
              }}
            />
          </div>
          {error && <div className="alert danger">{error}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => nav(id ? `/articles/${id}` : "/articles")}>
              取消
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "保存中…" : id ? "保存" : "发表"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function Articles() {
  return (
    <Routes>
      <Route index element={<ArticleList />} />
      <Route path="new" element={<ArticleEdit />} />
      <Route path=":id" element={<ArticleView />} />
      <Route path=":id/edit" element={<ArticleEdit />} />
    </Routes>
  );
}
