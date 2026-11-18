import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * 页面级错误边界：某个页面渲染出错时只替换该页面内容，显示错误信息与重新加载按钮，
 * 不会让整个应用白屏。resetKey 变化（如切换路由）时自动恢复。
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("页面渲染出错：", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <div className="card card-body stack" style={{ maxWidth: 640, margin: "40px auto", gap: 12 }}>
          <div className="row" style={{ gap: 8, color: "var(--danger)" }}>
            <AlertTriangle size={20} />
            <strong>页面出错了</strong>
          </div>
          <div className="muted small">
            该页面在显示时发生错误，其他页面仍可正常使用。请先尝试重新加载；如果问题重复出现，请把下面的错误信息发给管理员。
          </div>
          <pre className="alert danger small" style={{ whiteSpace: "pre-wrap", margin: 0, maxHeight: 200, overflow: "auto" }}>
            {error.message || String(error)}
          </pre>
          <div className="row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              <RotateCcw size={16} /> 重新加载页面
            </button>
            <button className="btn" onClick={() => this.setState({ error: null })}>
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }
}
