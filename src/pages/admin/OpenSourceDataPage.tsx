import { ExternalLink, GitBranch, Database, RefreshCw, CheckCircle2 } from "lucide-react";

const projects = [
  {
    name: "qingyu-web",
    description: "青语 AI 工作台主站与管理后台",
    repo: "https://github.com/nanxia124/qingyu-web",
    branch: "main",
    updated: "刚刚同步",
    status: "已连接",
  },
  {
    name: "api-data",
    description: "模型目录、计费套餐和公开服务配置",
    repo: "https://github.com/nanxia124/qingyu-web/tree/main/api-data",
    branch: "main",
    updated: "今天 09:40",
    status: "已连接",
  },
];

const datasets = [
  { name: "模型目录", file: "api-data/model_catalog.json", rows: "128 个模型", sync: "已同步" },
  { name: "计费套餐", file: "api-data/billing_plans.json", rows: "3 个套餐", sync: "已同步" },
  { name: "公开配置", file: "api-data/public_config.json", rows: "12 项配置", sync: "已同步" },
];

export default function OpenSourceDataPage() {
  return (
    <div className="min-h-full bg-bg px-6 py-7 text-text md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">OPEN SOURCE</p>
            <h1 className="mt-2 text-2xl font-bold">开源项目与数据</h1>
            <p className="mt-2 text-sm text-text-muted">把网站公开项目、数据文件和同步状态放在一个地方管理。</p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">
            <RefreshCw size={15} /> 立即同步
          </button>
        </div>

        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2"><GitBranch size={17} className="text-accent" /><h2 className="font-semibold">开源项目</h2></div>
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <article key={project.name} className="rounded-2xl bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-semibold">{project.name}</h3><p className="mt-1 text-sm text-text-muted">{project.description}</p></div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-500"><CheckCircle2 size={13} />{project.status}</span>
                </div>
                <div className="mt-5 flex items-center justify-between text-xs text-text-muted"><span>分支 · {project.branch}</span><span>{project.updated}</span></div>
                <a href={project.repo} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">查看仓库 <ExternalLink size={14} /></a>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2"><Database size={17} className="text-accent" /><h2 className="font-semibold">公开数据文件</h2></div>
          <div className="overflow-hidden rounded-2xl bg-card">
            <div className="grid grid-cols-[1.2fr_1.6fr_0.8fr_0.8fr] gap-4 bg-secondary px-5 py-3 text-xs font-semibold text-text-muted"><span>名称</span><span>文件路径</span><span>数据量</span><span>状态</span></div>
            {datasets.map((dataset) => <div key={dataset.file} className="grid grid-cols-[1.2fr_1.6fr_0.8fr_0.8fr] gap-4 px-5 py-4 text-sm"><span className="font-semibold">{dataset.name}</span><code className="truncate text-xs text-text-muted">{dataset.file}</code><span className="text-text-muted">{dataset.rows}</span><span className="text-emerald-500">{dataset.sync}</span></div>)}
          </div>
        </section>
      </div>
    </div>
  );
}
