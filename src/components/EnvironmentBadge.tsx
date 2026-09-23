export default function EnvironmentBadge() {
  if (typeof window === "undefined") return null;
  const hostname = window.location.hostname;
  const isProduction = hostname === "litzone.art" || hostname === "www.litzone.art";
  if (isProduction) return null;
  const label = hostname === "localhost" || hostname === "127.0.0.1" ? "本地开发" : "开发预览";
  const color = "bg-amber-500/15 text-amber-500";
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 ${color}`}>{label}</span>;
}
