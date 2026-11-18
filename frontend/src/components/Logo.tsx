/** 李氏图腾 Logo（虎 · 木 · 子），源文件见 public/logo.svg。 */
export default function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`brand-logo ${className}`}
      style={{ display: "block", flexShrink: 0, width: size, height: size }}
    />
  );
}
