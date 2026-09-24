import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, BarChart3, BookOpen, Database, KeyRound, LogOut, Receipt, ShieldCheck, Users, Building2, Menu, X } from "lucide-react";
import AdminDashboard from "./AdminDashboard";
import AdminUsersPage from "./AdminUsersPage";
import AdminTenantsPage from "./AdminTenantsPage";
import AdminAuditsPage from "./AdminAuditsPage";
import AdminOpsPage from "./AdminOpsPage";
import AdminBillingPage from "./AdminBillingPage";
import MonitorPage from "../MonitorPage";
import OpenSourceDataPage from "./OpenSourceDataPage";

type Section = "api" | "open-source" | "users" | "tenants" | "billing" | "audits" | "ops" | "monitor";
const nav = [
  { id: "api" as const, label: "API 与模型", icon: KeyRound, group: "核心配置" },
  { id: "open-source" as const, label: "开源项目与数据", icon: BookOpen, group: "核心配置" },
  { id: "users" as const, label: "注册用户", icon: Users, group: "用户与运营" },
  { id: "tenants" as const, label: "团队与租户", icon: Building2, group: "用户与运营" },
  { id: "billing" as const, label: "计费管理", icon: Receipt, group: "用户与运营" },
  { id: "audits" as const, label: "审计日志", icon: ShieldCheck, group: "系统" },
  { id: "ops" as const, label: "对账与告警", icon: AlertTriangle, group: "系统" },
  { id: "monitor" as const, label: "运行监控", icon: Activity, group: "系统" },
];

export default function AdminConsole({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSection = (searchParams.get("section") as Section) || "api";
  const [section, setSection] = useState<Section>(nav.some((item) => item.id === initialSection) ? initialSection : "api");
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = nav.find((item) => item.id === section)!;
  const content = { api: <AdminDashboard token={token} onLogout={onLogout} />, "open-source": <OpenSourceDataPage />, users: <AdminUsersPage />, tenants: <AdminTenantsPage />, billing: <AdminBillingPage />, audits: <AdminAuditsPage />, ops: <AdminOpsPage />, monitor: <MonitorPage /> }[section];
  const select = (id: Section) => { setSection(id); setSearchParams(id === "api" ? {} : { section: id }); setMobileOpen(false); };
  return <div className="min-h-screen bg-bg text-text">
    <header className="flex h-16 items-center justify-between bg-card px-5 shadow-sm md:px-7">
      <div className="flex items-center gap-3"><button className="rounded-lg p-2 hover:bg-secondary md:hidden" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={20} /></button><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white"><BarChart3 size={18} /></div><div><div className="font-bold">青语管理中心</div><div className="text-[11px] text-text-muted">统一配置与运营后台</div></div></div>
      <button onClick={onLogout} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-secondary hover:text-text"><LogOut size={16} />退出登录</button>
    </header>
    <div className="flex min-h-[calc(100vh-4rem)]">
      <aside className={`${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"} fixed inset-y-16 left-0 z-40 w-64 bg-card p-4 shadow-lg transition-transform md:static md:shadow-none`}><div className="mb-3 flex items-center justify-between px-2 text-xs font-semibold text-text-muted"><span>后台导航</span><button className="md:hidden" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>{["核心配置", "用户与运营", "系统"].map(group => <div key={group} className="mb-5"><div className="mb-2 px-2 text-[11px] font-semibold tracking-wide text-text-muted">{group}</div>{nav.filter(i => i.group === group).map(item => <button key={item.id} onClick={() => select(item.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${section === item.id ? "bg-accent-soft text-accent-soft-text" : "text-text-secondary hover:bg-secondary"}`}><item.icon size={17} />{item.label}</button>)}</div>)}</aside>
      {mobileOpen && <button aria-label="关闭导航" className="fixed inset-16 z-30 bg-black/30 md:hidden" onClick={() => setMobileOpen(false)} />}
      <main className="min-w-0 flex-1"><div className="hidden items-center gap-2 px-6 pt-6 text-sm text-text-muted md:flex"><span>管理后台</span><span>/</span><span className="text-text">{current.label}</span></div>{content}</main>
    </div>
  </div>;
}
