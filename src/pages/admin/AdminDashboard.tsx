import { useState, useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";
// 与后端 KEY_MAX_CONCURRENCY 默认值保持一致
const keyMaxConcurrency = 5;

interface ApiKey {
    id: number;
    name: string;
    provider: string;
    base_url: string;
    model: string;
    max_concurrency: number | null;
    is_active: number;
    api_key_masked: string;
    created_at: number;
}

// 仅用于卡片展示：把模型 id 转成更美观的写法，不改原始值
const MODEL_TOKEN: Record<string, string> = {
    "gpt": "GPT", "grok": "Grok", "gemini": "Gemini", "claude": "Claude",
    "deepseek": "DeepSeek", "qwen": "Qwen", "sora": "Sora", "veo": "Veo",
    "kling": "Kling", "hailuo": "Hailuo", "wan": "Wan", "flux": "Flux",
    "sd": "SD", "tts": "TTS", "image": "Image", "imagine": "Imagine",
    "video": "Video", "flash": "Flash", "pro": "Pro", "eco": "Eco",
    "auto": "Auto", "native": "Native", "quality": "Quality", "flare": "Flare",
    "sunburst": "Sunburst",
};
const prettyModel = (m: string) =>
    m.split("-").map(seg => {
        const token = MODEL_TOKEN[seg.toLowerCase()];
        if (token) return token;
        if (/^[0-9.]+$/.test(seg) || !seg) return seg;
        return seg[0].toUpperCase() + seg.slice(1);
    }).join(" ");

// 提取模型基础系列：取到第一个版本号段为止（如 gpt-image-2.5-flare -> gpt-image-2.5）
const seriesOf = (m: string) => {
    const parts = m.split("-");
    const out: string[] = [];
    for (const p of parts) {
        out.push(p);
        if (/^\d+(\.\d+)?$/.test(p)) break;
    }
    return out.join("-");
};

// 能力小标签的底色与文字色：只作用在能力名这一小块上
const CAP_BG: Record<string, string> = {
    "图片": "bg-sky-500/15",
    "视频": "bg-purple-500/15",
    "文本": "bg-emerald-500/15",
    "音频": "bg-amber-500/15",
    "其他": "bg-gray-500/15",
};
const CAP_TEXT: Record<string, string> = {
    "图片": "text-sky-300",
    "视频": "text-purple-300",
    "文本": "text-emerald-300",
    "音频": "text-amber-300",
    "其他": "text-gray-600",
};
// 每张卡片顶部一条细色线区分：按卡片 id 取色，稳定不随排序变化
const CARD_ACCENTS = ["#f87171", "#fb923c", "#fbbf24", "#34d399", "#22d3ee", "#60a5fa", "#818cf8", "#c084fc", "#f472b6", "#4ade80"];

// 选择模型弹窗用：按厂商 / 能力识别（与卡片展示同一套规则）
const brandOrder = ["GPT", "Grok", "Gemini", "Claude", "DeepSeek", "Qwen", "Doubao", "MiniMax", "Nano Banana", "GLM", "Kimi", "DALL·E", "Flux", "Stable Diffusion", "Sora", "Veo", "Kling", "Hailuo", "Wan", "其他"];
const brandOf = (m: string): string => {
    const lower = m.toLowerCase();
    if (lower.includes("gpt")) return "GPT";
    if (lower.includes("grok")) return "Grok";
    if (lower.includes("gemini")) return "Gemini";
    if (lower.includes("claude")) return "Claude";
    if (lower.includes("deepseek")) return "DeepSeek";
    if (lower.includes("qwen")) return "Qwen";
    if (lower.includes("doubao") || lower.includes("seedance") || lower.includes("seedream")) return "Doubao";
    if (lower.includes("minimax")) return "MiniMax";
    if (lower.includes("nano-banana") || lower.includes("nanobanana")) return "Nano Banana";
    if (lower.includes("glm")) return "GLM";
    if (lower.includes("kimi")) return "Kimi";
    if (lower.includes("dall-e") || lower.includes("dalle")) return "DALL·E";
    if (lower.includes("flux")) return "Flux";
    if (lower.includes("stable-diffusion")) return "Stable Diffusion";
    if (lower.includes("sora")) return "Sora";
    if (lower.includes("veo")) return "Veo";
    if (lower.includes("kling")) return "Kling";
    if (lower.includes("hailuo")) return "Hailuo";
    if (lower.includes("wan")) return "Wan";
    return "其他";
};

// 知名厂商内置头像：圆底 + 本地官方 logo 文件（/brands/*.svg，simple-icons 官方矢量，离线可用）；无官方 logo 的回退首字母
const BRAND_LOGO: Record<string, { bg: string; fg: string; char: string; file?: string }> = {
    "GPT": { bg: "#10a37f", fg: "#ffffff", char: "G", file: "openai.svg" },
    "Grok": { bg: "#000000", fg: "#ffffff", char: "X", file: "x.svg" },
    "Gemini": { bg: "#4285F4", fg: "#ffffff", char: "G", file: "googlegemini.svg" },
    "Claude": { bg: "#D97757", fg: "#ffffff", char: "C", file: "anthropic.svg" },
    "DeepSeek": { bg: "#4D6BFE", fg: "#ffffff", char: "D", file: "deepseek.svg" },
    "Qwen": { bg: "#FF6A00", fg: "#ffffff", char: "Q", file: "qwen.svg" },
    "Doubao": { bg: "#325AB4", fg: "#ffffff", char: "豆", file: "bytedance.svg" },
    "MiniMax": { bg: "#5B5BD6", fg: "#ffffff", char: "M", file: "minimax.svg" },
    "Nano Banana": { bg: "#FBBC04", fg: "#202124", char: "N", file: "googlegemini.svg" },
    "GLM": { bg: "#3B82F6", fg: "#ffffff", char: "智" },
    "Kimi": { bg: "#7C3AED", fg: "#ffffff", char: "K", file: "kimi.svg" },
    "Sora": { bg: "#10a37f", fg: "#ffffff", char: "S", file: "openai.svg" },
    "Veo": { bg: "#34A853", fg: "#ffffff", char: "V", file: "googlegemini.svg" },
};
const brandLogo = (b: string) => BRAND_LOGO[b] || { bg: "#e5e5ea", fg: "#9ca3af", char: b[0] };
const capOf = (m: string): string => {
    const lower = m.toLowerCase();
    if (lower.includes("image") || lower.includes("dall-e") || lower.includes("flux") || lower.includes("sd") || lower.includes("stable-diffusion")) return "图片";
    if (lower.includes("video") || lower.includes("sora") || lower.includes("veo") || lower.includes("kling") || lower.includes("wan") || lower.includes("hailuo")) return "视频";
    if (lower.includes("tts") || lower.includes("audio") || lower.includes("speech") || lower.includes("voice")) return "音频";
    if (lower.includes("gpt") || lower.includes("claude") || lower.includes("llama") || lower.includes("gemini") || lower.includes("qwen") || lower.includes("deepseek")) return "文本";
    return "其他";
};

const PROVIDERS = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "google", label: "Google Gemini" },
    { value: "xai", label: "xAI (Grok)" },
    { value: "deepseek", label: "DeepSeek" },
    { value: "qwen", label: "通义千问 (Qwen)" },
    { value: "doubao", label: "豆包 (Doubao)" },
    { value: "moonshot", label: "Moonshot (Kimi)" },
    { value: "zhipu", label: "智谱 (GLM)" },
    { value: "minimax", label: "MiniMax" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "other", label: "其他" },
];

export default function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ name: "", provider: "openai", base_url: "", api_key: "", model: "", max_concurrency: "" });
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [testingId, setTestingId] = useState<number | null>(null);
    const [testResult, setTestResult] = useState<Record<number, { ok: boolean; message: string }>>({});
    const [editId, setEditId] = useState<number | null>(null);
    const [showChangePw, setShowChangePw] = useState(false);
    const [pwForm, setPwForm] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" });
    const [pwError, setPwError] = useState("");
    const [pwSuccess, setPwSuccess] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [showModelsModal, setShowModelsModal] = useState(false);
    const [capTab, setCapTab] = useState("全部");
    const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});
    const [providerOpen, setProviderOpen] = useState(false);
    const providerRef = useRef<HTMLDivElement>(null);
    const [keyStats, setKeyStats] = useState<Record<number, any>>({});
    const [keyHistory, setKeyHistory] = useState<Record<number, any>>({});
    // 卡片模型分组折叠状态：key 为 `${cardId}:${brand}`，未记录即默认折叠
    const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
    // 卡片级折叠：key 为卡片 id，默认折叠；折叠后整张卡片下方模型区全部收起
    const [cardCollapsed, setCardCollapsed] = useState<Record<number, boolean>>({});
    // 单个模型行展开：key 为 `${cardId}:${model}`，展开后显示该模型近7天/近30天数据
    const [expandedModelRows, setExpandedModelRows] = useState<Record<string, boolean>>({});

    const fetchKeyStats = async () => {
        try {
            const res = await fetch(`${API}/api/admin/key-stats`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setKeyStats(await res.json());
        } catch { /* 忽略 */ }
    };

    const fetchKeyHistory = async () => {
        try {
            const res = await fetch(`${API}/api/admin/key-history`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setKeyHistory(await res.json());
        } catch { /* 忽略 */ }
    };

    useEffect(() => {
        fetchKeyStats();
        fetchKeyHistory();
        const t = setInterval(fetchKeyStats, 3000);
        const t2 = setInterval(fetchKeyHistory, 15000);
        return () => { clearInterval(t); clearInterval(t2); };
    }, [token]);

    const fetchKeys = async () => {
        try {
            const res = await fetch(`${API}/api/admin/api-keys`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            setKeys(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchKeys(); }, []);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        const modelStr = selectedModels.length > 0 ? selectedModels.join(",") : form.model;
        const payload = { ...form, model: modelStr };

        // 新增模式：前端先校验必填项
        if (!editId) {
            if (!payload.name || !payload.base_url || !payload.api_key) {
                alert("请填写完整信息：名称、API 地址、API Key 为必填项");
                return;
            }
        } else if (!payload.api_key) {
            // 编辑模式：Key 留空表示不修改
            delete payload.api_key;
        }

        try {
            const url = editId
                ? `${API}/api/admin/api-keys/${editId}`
                : `${API}/api/admin/api-keys`;
            const res = await fetch(url, {
                method: editId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            // 关键：HTTP 4xx/5xx 时 fetch 不会抛异常，必须显式检查 res.ok
            if (!res.ok) {
                alert("保存失败：" + (data.error || `HTTP ${res.status}`));
                return; // 保留弹窗，方便用户改完重存
            }
            // 只有成功才关闭并刷新列表
            setShowAdd(false);
            setEditId(null);
            setForm({ name: "", provider: "openai", base_url: "", api_key: "", model: "", max_concurrency: "" });
            setSelectedModels([]);
            setModels([]);
            fetchKeys();
        } catch (err: any) {
            alert("保存失败：" + (err.message || err));
        }
    };

    const handleToggle = async (id: number, isActive: boolean) => {
        await fetch(`${API}/api/admin/api-keys/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ is_active: !isActive }),
        });
        fetchKeys();
    };

    const handleDelete = async (id: number) => {
        if (!confirm("确定删除？")) return;
        await fetch(`${API}/api/admin/api-keys/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        fetchKeys();
    };

    const fetchModels = async () => {
        if (!form.base_url) {
            alert("请先填写 API 地址");
            return;
        }
        setLoadingModels(true);
        try {
            // 编辑模式下 Key 留空，从后端获取完整 Key
            let apiKey = form.api_key;
            if (!apiKey && editId) {
                const res = await fetch(`${API}/api/admin/api-keys/${editId}/full`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                apiKey = data.api_key;
            }
            if (!apiKey) {
                alert("请先填写 API Key");
                return;
            }
            // 通过后端代理拉取供应商 /models（服务端请求，规避浏览器跨域）
            const res = await fetch(`${API}/api/admin/fetch-models`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ base_url: form.base_url, api_key: apiKey }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                alert("拉取失败：" + (data.error || `HTTP ${res.status}`));
                return;
            }
            if (data.data) {
                setModels(data.data.map((m: any) => m.id));
            } else {
                alert("拉取失败：" + (data.error?.message || "未知错误"));
            }
        } catch (err: any) {
            alert("拉取失败：" + err.message);
        } finally {
            setLoadingModels(false);
        }
    };

    // 按能力分组模型
    const groupModels = (modelList: string[]) => {
        const groups: Record<string, string[]> = {
            图片: [],
            视频: [],
            文本: [],
            音频: [],
            其他: [],
        };
        modelList.forEach(m => {
            const lower = m.toLowerCase();
            if (lower.includes("image") || lower.includes("dall-e") || lower.includes("flux") || lower.includes("sd") || lower.includes("stable-diffusion")) {
                groups["图片"].push(m);
            } else if (lower.includes("video") || lower.includes("sora") || lower.includes("veo") || lower.includes("kling") || lower.includes("wan") || lower.includes("hailuo")) {
                groups["视频"].push(m);
            } else if (lower.includes("tts") || lower.includes("audio") || lower.includes("speech") || lower.includes("voice")) {
                groups["音频"].push(m);
            } else if (lower.includes("gpt") || lower.includes("claude") || lower.includes("llama") || lower.includes("gemini") || lower.includes("qwen") || lower.includes("deepseek")) {
                groups["文本"].push(m);
            } else {
                groups["其他"].push(m);
            }
        });
        return Object.fromEntries(Object.entries(groups).filter(([_, v]) => v.length > 0));
    };

    // 配置卡片展示：先按模型厂商分组，组内再按能力分组
    const groupByBrand = (modelList: string[]) => {
        const byBrand: Record<string, string[]> = {};
        modelList.forEach(m => {
            const b = brandOf(m);
            (byBrand[b] = byBrand[b] || []).push(m);
        });
        const ordered = Object.keys(byBrand).sort(
            (a, b) => brandOrder.indexOf(a) - brandOrder.indexOf(b)
        );
        const result: Record<string, Record<string, string[]>> = {};
        ordered.forEach(b => {
            const groups = groupModels(byBrand[b]);
            // 同能力内按基础系列排序，同系列模型排在一起
            Object.values(groups).forEach(list => {
                list.sort((x, y) => {
                    const sx = seriesOf(x), sy = seriesOf(y);
                    return sx === sy ? x.localeCompare(y) : sx.localeCompare(sy);
                });
            });
            result[b] = groups;
        });
        return result;
    };

    const startEdit = async (k: ApiKey) => {
        setEditId(k.id);
        setForm({
            name: k.name,
            provider: k.provider,
            base_url: k.base_url,
            api_key: "",
            model: k.model || "",
            max_concurrency: k.max_concurrency != null ? String(k.max_concurrency) : "",
        });
        setSelectedModels((k.model || "").split(",").filter(Boolean));
        setShowAdd(true);
    };

    const testConnection = async (id: number) => {
        setTestingId(id);
        const startTime = Date.now();
        try {
            // 先拿完整 Key
            const keyRes = await fetch(`${API}/api/admin/api-keys/${id}/full`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const keyData = await keyRes.json();
            const key = keys.find(k => k.id === id);
            if (!key) throw new Error("配置不存在");

            // 测试 /models 接口
            const url = key.base_url.replace(/\/$/, "") + "/models";
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${keyData.api_key}` },
            });
            if (res.ok) {
                const ms = Date.now() - startTime;
                setTestResult(prev => ({ ...prev, [id]: { ok: true, message: `${ms}ms` } }));
            } else {
                const data = await res.json().catch(() => ({}));
                setTestResult(prev => ({ ...prev, [id]: { ok: false, message: data.error?.message || `HTTP ${res.status}` } }));
            }
        } catch (err: any) {
            setTestResult(prev => ({ ...prev, [id]: { ok: false, message: err.message } }));
        } finally {
            setTestingId(null);
        }
    };

    const handleChangePw = async (e: React.FormEvent) => {
        e.preventDefault();
        setPwError("");
        setPwSuccess(false);
        if (pwForm.newPassword !== pwForm.confirmPassword) {
            setPwError("两次新密码不一致");
            return;
        }
        if (pwForm.newPassword.length < 8) {
            setPwError("新密码至少 8 位");
            return;
        }
        try {
            const res = await fetch(`${API}/api/admin/change-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ oldPassword: pwForm.oldPassword, newPassword: pwForm.newPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setPwSuccess(true);
            setPwForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
            setTimeout(() => setShowChangePw(false), 2000);
        } catch (err: any) {
            setPwError(err.message);
        }
    };

    return (
        <div className="min-h-screen bg-[#f4f4f6] p-8">
            <div className="mx-auto max-w-5xl">
                <div className="mb-8 flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-white">API 配置管理</h1>
                    <div className="flex gap-2">
                        <button onClick={() => setShowChangePw(true)} className="rounded-lg bg-[#e5e5ea] px-4 py-2 text-sm text-gray-600 hover:bg-[#c7c7cd]">
                            修改密码
                        </button>
                        <button onClick={onLogout} className="rounded-lg bg-[#e5e5ea] px-4 py-2 text-sm text-gray-600 hover:bg-[#c7c7cd]">
                            退出登录
                        </button>
                    </div>
                </div>

                {showChangePw && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                        <form onSubmit={handleChangePw} className="relative w-full max-w-md rounded-2xl bg-[#ffffff] p-6">
                        <h2 className="mb-4 text-lg font-semibold text-white">修改密码</h2>
                        <button type="button" onClick={() => setShowChangePw(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#e5e5ea] text-lg text-gray-500 hover:bg-[#c7c7cd] hover:text-white">×</button>
                        {pwError && <p className="mb-4 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">{pwError}</p>}
                        {pwSuccess && <p className="mb-4 rounded bg-green-500/10 px-3 py-2 text-sm text-green-400">密码修改成功</p>}
                        <div className="grid gap-4">
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">旧密码</label>
                                <input type="password" value={pwForm.oldPassword} onChange={e => setPwForm({...pwForm, oldPassword: e.target.value})}
                                    className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">新密码（至少 8 位）</label>
                                <input type="password" value={pwForm.newPassword} onChange={e => setPwForm({...pwForm, newPassword: e.target.value})}
                                    className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">确认新密码</label>
                                <input type="password" value={pwForm.confirmPassword} onChange={e => setPwForm({...pwForm, confirmPassword: e.target.value})}
                                    className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none" />
                            </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                            <button type="submit" className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-[#3f40e6]">确认修改</button>
                            <button type="button" onClick={() => setShowChangePw(false)} className="rounded-lg bg-[#e5e5ea] px-4 py-2 text-gray-600">取消</button>
                        </div>
                        </form>
                    </div>
                )}

                <div className="mb-6 flex justify-end">
                    <button onClick={() => setShowAdd(!showAdd)} className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-[#3f40e6]">
                        + 添加 API 配置
                    </button>
                </div>

                {showAdd && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                        <form onSubmit={handleAdd} className="relative w-full max-w-2xl rounded-2xl bg-[#ffffff] p-6 max-h-[85vh] overflow-y-auto thin-scrollbar">
                        <h2 className="mb-4 text-lg font-semibold text-white">{editId ? "编辑配置" : "新增配置"}</h2>
                        <button type="button" onClick={() => setShowAdd(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#e5e5ea] text-lg text-gray-500 hover:bg-[#c7c7cd] hover:text-white">×</button>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">名称</label>
                                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                                    className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none" placeholder="比如：OpenAI 主 Key" />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">提供商</label>
                                <div className="relative" ref={providerRef}>
                                    <button type="button" onClick={() => setProviderOpen(v => !v)}
                                        className="flex w-full items-center justify-between rounded-lg bg-[#e5e5ea] px-3 py-2 text-sm text-white outline-none">
                                        <span>{PROVIDERS.find(p => p.value === form.provider)?.label || form.provider}</span>
                                        <svg className="text-gray-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm text-gray-500">API 地址</label>
                                <input value={form.base_url} onChange={e => setForm({...form, base_url: e.target.value})}
                                    className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none" placeholder="https://api.openai.com/v1" />
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm text-gray-500">API Key{editId && "（留空则不修改）"}</label>
                                <input type="password" value={form.api_key} onChange={e => setForm({...form, api_key: e.target.value})}
                                    className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none" placeholder="sk-..." />
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm text-gray-500">单 key 最大并发（留空用全局默认 {keyMaxConcurrency}）</label>
                                <input type="number" min="1" value={form.max_concurrency} onChange={e => setForm({...form, max_concurrency: e.target.value})}
                                    className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none" placeholder="如 5" />
                            </div>
                            <div className="col-span-2">
                                <span className="text-sm text-gray-500">模型已选 {selectedModels.length} 个</span>
                                {showModelsModal && (() => {
                                    const allCaps = ["图片", "视频", "文本", "音频", "其他"];
                                    const tabs = ["全部", ...allCaps.filter(c => models.some(m => capOf(m) === c))];
                                    const counts: Record<string, number> = { "全部": models.length };
                                    allCaps.forEach(c => { counts[c] = models.filter(m => capOf(m) === c).length; });
                                    const filtered = capTab === "全部" ? models : models.filter(m => capOf(m) === capTab);
                                    const byBrand: Record<string, string[]> = {};
                                    filtered.forEach(m => { const b = brandOf(m); (byBrand[b] = byBrand[b] || []).push(m); });
                                    const brandKeys = Object.keys(byBrand).sort((a, b) => brandOrder.indexOf(a) - brandOrder.indexOf(b));
                                    const toggleModel = (m: string) => setSelectedModels(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
                                    const toggleBrand = (list: string[]) => {
                                        const allIn = list.every(m => selectedModels.includes(m));
                                        setSelectedModels(prev => allIn ? prev.filter(m => !list.includes(m)) : Array.from(new Set([...prev, ...list])));
                                    };
                                    const toggleExpand = (b: string) => setExpandedBrands(prev => ({ ...prev, [b]: !(prev[b] ?? true) }));
                                    const allExpanded = brandKeys.every(b => expandedBrands[b] ?? true);
                                    const setAllExpanded = (v: boolean) => setExpandedBrands(() => Object.fromEntries(brandKeys.map(b => [b, v])));
                                    const allFilteredIn = filtered.length > 0 && filtered.every(m => selectedModels.includes(m));
                                    return (
                                    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70">
                                        <div className="relative flex h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-[#ffffff] p-6">
                                            <h3 className="mb-4 text-xl font-semibold text-white">选择模型</h3>
                                            <button type="button" onClick={() => setShowModelsModal(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-[#e5e5ea] text-lg text-gray-500 hover:bg-[#c7c7cd] hover:text-white">×</button>
                                            <div className="mb-4 flex flex-wrap items-center gap-5 border-b border-[#e5e5ea] pb-3">
                                                {tabs.map(t => (
                                                    <button key={t} type="button" onClick={() => setCapTab(t)}
                                                        className={`text-sm ${capTab === t ? "font-medium text-white" : "text-gray-500 hover:text-gray-600"}`}>
                                                        {t} <span className={capTab === t ? "text-[#4446d8]" : "text-gray-600"}>{counts[t] || 0}</span>
                                                    </button>
                                                ))}
                                                <button type="button" onClick={() => setAllExpanded(!allExpanded)}
                                                    className="ml-auto rounded bg-[#e5e5ea] px-3 py-1 text-xs text-gray-600 hover:bg-[#c7c7cd]">
                                                    {allExpanded ? "折叠全部" : "展开全部"}
                                                </button>
                                                <button type="button" onClick={() => toggleBrand(filtered)}
                                                    className={`rounded px-3 py-1 text-xs ${allFilteredIn ? "bg-[#5051F8]/15 text-[#4446d8]" : "bg-[#e5e5ea] text-gray-600 hover:bg-[#c7c7cd]"}`}>
                                                    {allFilteredIn ? "取消全选" : "全选"}
                                                </button>
                                            </div>
                                            <div className="flex-1 space-y-3 overflow-y-auto thin-scrollbar">
                                                {brandKeys.map(b => {
                                                    const list = byBrand[b];
                                                    const allIn = list.every(m => selectedModels.includes(m));
                                                    const open = expandedBrands[b] ?? true;
                                                    const lg = brandLogo(b);
                                                    // 圆底浅灰，内部用本地官方 logo 文件；无文件的回退首字母
                                                    const headLogo = (
                                                        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#3f3f46]">
                                                            {lg.file
                                                                ? <img src={`/brands/${lg.file}`} alt={b} className="h-[18px] w-[18px] object-contain" />
                                                                : <span className="text-xs font-bold text-gray-700">{lg.char}</span>}
                                                        </span>
                                                    );
                                                    const rowLogo = (
                                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#3f3f46]">
                                                            {lg.file
                                                                ? <img src={`/brands/${lg.file}`} alt={b} className="h-[13px] w-[13px] object-contain" />
                                                                : <span className="text-[11px] font-bold text-gray-700">{lg.char}</span>}
                                                        </span>
                                                    );
                                                    return (
                                                        <div key={b} className="group rounded-lg bg-[#ffffff]">
                                                            <div className="flex items-center gap-2 px-3 py-2.5">
                                                                <button type="button" onClick={() => toggleExpand(b)} className="flex items-center text-gray-500"><ChevronRight size={14} className="transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} /></button>
                                                                {headLogo}
                                                                <span className="text-base font-semibold text-gray-100">{b}</span>
                                                                <span className="rounded-full bg-[#5051F8]/20 px-1.5 text-xs text-[#4446d8]">{list.length}</span>
                                                                <button type="button" onClick={() => toggleBrand(list)} title={allIn ? "取消添加全部" : "添加全部"}
                                                                    className={`ml-auto flex h-4 w-4 items-center justify-center rounded-full transition-all ${allIn ? "bg-[#5051F8] text-white" : "border border-gray-600 text-gray-500 opacity-0 hover:border-gray-300 hover:text-white group-hover:opacity-100"}`}>
                                                                    {allIn ? (
                                                                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                                                    ) : (
                                                                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                                                                    )}
                                                                </button>
                                                            </div>
                                                            {open && (
                                                                <div className="ml-6 space-y-4 px-2 pb-2">
                                                                    {(() => {
                                                                        const sorted = [...list].sort((x, y) => {
                                                                            const sx = seriesOf(x), sy = seriesOf(y);
                                                                            return sx === sy ? x.localeCompare(y) : sx.localeCompare(sy);
                                                                        });
                                                                        const runs: { key: string; items: string[] }[] = [];
                                                                        sorted.forEach(m => {
                                                                            const s = seriesOf(m);
                                                                            const last = runs[runs.length - 1];
                                                                            if (last && last.key === s) last.items.push(m);
                                                                            else runs.push({ key: s, items: [m] });
                                                                        });
                                                                        return runs.map(run => (
                                                                            <div key={run.key} className="space-y-1.5">
                                                                                {run.items.map(m => {
                                                                                    const sel = selectedModels.includes(m);
                                                                                    return (
                                                                                        <div key={m} className="group/row flex items-center gap-2 rounded-lg bg-[#e5e5ea] px-2.5 py-2 hover:bg-[#e4e4e9]">
                                                                                            {rowLogo}
                                                                                            <span className="truncate text-sm text-gray-600">{prettyModel(m)}</span>
                                                                                            <button type="button" onClick={() => toggleModel(m)} title={sel ? "移除" : "添加"}
                                                                                                className={`ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all ${sel ? "bg-[#5051F8] text-white" : "border border-gray-600 text-gray-500 opacity-0 hover:border-gray-300 hover:text-white group-hover/row:opacity-100"}`}>
                                                                                                {sel ? (
                                                                                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                                                                                                ) : (
                                                                                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                                                                                                )}
                                                                                            </button>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        ));
                                                                    })()}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                {brandKeys.length === 0 && <p className="py-8 text-center text-sm text-gray-500">该分类下没有模型</p>}
                                            </div>
                                            <div className="mt-4 flex justify-end border-t border-[#e5e5ea] pt-4">
                                                <button type="button" onClick={() => setShowModelsModal(false)} className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-[#3f40e6]">完成（已选 {selectedModels.length} 个）</button>
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })()}
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                            <button type="button" onClick={async () => {
                                await fetchModels();
                                setCapTab("全部");
                                setShowModelsModal(true);
                            }} disabled={loadingModels}
                                className="rounded-lg bg-[#e5e5ea] px-4 py-2 text-sm text-gray-600 hover:bg-[#c7c7cd] disabled:opacity-50">
                                {loadingModels ? "拉取中..." : "拉取模型"}
                            </button>
                            <div className="ml-auto flex gap-2">
                                <button type="submit" className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-[#3f40e6]">保存</button>
                                <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg bg-[#e5e5ea] px-4 py-2 text-gray-600">取消</button>
                            </div>
                        </div>
                        </form>
                    </div>
                )}

                {showAdd && providerOpen && (() => {
                    const r = providerRef.current?.getBoundingClientRect();
                    if (!r) return null;
                    return (
                        <>
                            <div className="fixed inset-0 z-[60]" onClick={() => setProviderOpen(false)} />
                            <div className="fixed z-[61] max-h-72 overflow-y-auto rounded-lg bg-[#e5e5ea] py-1 shadow-lg shadow-black/50 thin-scrollbar"
                                style={{ left: r.left, top: r.bottom + 4, width: r.width }}>
                                {PROVIDERS.map(p => (
                                    <button key={p.value} type="button"
                                        onClick={() => { setForm({ ...form, provider: p.value }); setProviderOpen(false); }}
                                        className={`block w-full px-3 py-1.5 text-left text-sm ${p.value === form.provider ? "bg-[#5051F8]/15 text-[#4446d8]" : "text-gray-600 hover:bg-[#e8e8ec]"}`}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    );
                })()}

                {loading ? (
                    <p className="text-gray-500">加载中...</p>
                ) : keys.length === 0 ? (
                    <p className="text-gray-500">还没有配置，点上面"添加 API 配置"开始</p>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(keys.reduce((acc: Record<string, typeof keys>, k) => {
                            if (!acc[k.provider]) acc[k.provider] = [];
                            acc[k.provider].push(k);
                            return acc;
                        }, {})).map(([provider, providerKeys]) => (
                            <div key={provider}>
                                <h3 className="mb-3 text-sm font-medium text-gray-500">{provider}</h3>
                                <div className="space-y-4">
                                    {providerKeys.map(k => {
                                        const modelList = k.model ? k.model.split(",").map(s => s.trim()).filter(Boolean) : [];
                                        const brandGroups = modelList.length ? groupByBrand(modelList) : null;
                                        return (
                                        <div key={k.id} className="flex flex-col rounded-xl border-t-2 bg-[#ffffff] p-8" style={{ borderTopColor: CARD_ACCENTS[k.id % CARD_ACCENTS.length] }}>
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1 space-y-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-white">{k.name}</span>
                                                        {k.is_active ? (
                                                            <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-400">启用中</span>
                                                        ) : (
                                                            <span className="rounded bg-gray-500/10 px-2 py-0.5 text-xs text-gray-500">已停用</span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-gray-500">{k.base_url}</p>
                                                    <p className="text-xs text-gray-500">Key: {k.api_key_masked}</p>
                                                    {(() => {
                                                        const st = keyStats[k.id] || {};
                                                        const s = st.success || 0, f = st.failure || 0;
                                                        const total = s + f;
                                                        const rate = total > 0 ? Math.round((s / total) * 100) : 100;
                                                        const max = st.maxConcurrency || k.max_concurrency || keyMaxConcurrency;
                                                        return (
                                                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                                                <span className={`rounded-md px-2.5 py-1 text-sm font-medium ${st.inFlight > 0 ? "bg-blue-500/20 text-blue-300" : "bg-[#e5e5ea] text-gray-500"}`}>
                                                                    并发 {st.inFlight || 0}/{max}
                                                                </span>
                                                                <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-300">成功 {s}</span>
                                                                <span className={`rounded-md px-2.5 py-1 text-sm font-medium ${f > 0 ? "bg-red-500/15 text-red-300" : "bg-[#e5e5ea] text-gray-500"}`}>失败 {f}</span>
                                                                <span className={`rounded-md px-2.5 py-1 text-sm font-medium ${total === 0 ? "bg-[#e5e5ea] text-gray-500" : rate >= 90 ? "bg-emerald-500/15 text-emerald-300" : rate >= 60 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300"}`}>
                                                                    {total === 0 ? "—" : rate + "%"}
                                                                </span>
                                                                {st.avgLatencyMs > 0 && <span className="rounded-md bg-[#e5e5ea] px-2.5 py-1 text-sm font-medium text-gray-600">{st.avgLatencyMs}ms</span>}
                                                                {st.cooling && <span className="rounded-md bg-red-500/20 px-2.5 py-1 text-sm font-semibold text-red-300">熔断中</span>}
                                                            </div>
                                                        );
                                                    })()}
                                                    {(() => {
                                                        const h = keyHistory[k.id];
                                                        if (!h) return null;
                                                        const fmtCalls = (n: number) => n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
                                                        const pct = (v: number | null) => v == null ? "—" : v + "%";
                                                        const rateCls = (v: number | null) =>
                                                            v == null ? "text-gray-500" : v >= 90 ? "text-emerald-300" : v >= 60 ? "text-amber-300" : "text-red-300";
                                                        const failCls = (n: number) => n > 0 ? "text-red-300" : "text-emerald-300";
                                                        const CAPS = ["图片", "文本", "视频"];
                                                        // 整体汇总（不分能力）
                                                        const today = h.d1?._all;
                                                        const week = h.d7?._all;
                                                        const windowRows = (wKey: string, label: string, showLatency: boolean) => {
                                                            const w = h[wKey] || {};
                                                            const caps = CAPS.filter(c => (w[c]?.calls || 0) > 0);
                                                            if (caps.length === 0) return null;
                                                            return (
                                                                <div className="space-y-0.5">
                                                                    <div className="text-xs text-gray-500">{label}</div>
                                                                    {caps.map(c => {
                                                                        const m = w[c];
                                                                        return (
                                                                            <div key={c} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-2 text-xs">
                                                                                <span className="w-8 shrink-0 text-gray-500">{c}</span>
                                                                                <span className="text-gray-500">调用 <span className="text-gray-200">{fmtCalls(m.calls)}</span></span>
                                                                                <span className="text-gray-500">成功率 <span className={rateCls(m.successRate)}>{pct(m.successRate)}</span></span>
                                                                                <span className="text-gray-500">失败率 <span className={rateCls(m.failRate)}>{pct(m.failRate)}</span></span>
                                                                                <span className="text-gray-500">连接率 <span className={rateCls(m.connRate)}>{pct(m.connRate)}</span></span>
                                                                                {showLatency && <span className="text-gray-500">日均连接率 <span className={rateCls(m.avgConnRate)}>{pct(m.avgConnRate)}</span></span>}
                                                                                {showLatency && m.avgLatencyMs != null && <span className="text-gray-500">平均延迟 <span className="text-gray-200">{m.avgLatencyMs}ms</span></span>}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        };
                                                        const d7 = windowRows("d7", "近7天分能力", true);
                                                        const d30 = windowRows("d30", "近30天分能力", false);
                                                        const hasSummary = (today && today.calls > 0) || (week && week.calls > 0);
                                                        if (!hasSummary && !d7 && !d30) return null;
                                                        return (
                                                            <div className="space-y-2 border-t border-[#f0f0f2] pt-2">
                                                                {hasSummary && (
                                                                    <div className="space-y-0.5">
                                                                        {today && today.calls > 0 && (
                                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-2 text-xs">
                                                                                <span className="w-16 shrink-0 text-gray-600">今日调用</span>
                                                                                <span className="text-gray-500">调用 <span className="text-gray-200">{fmtCalls(today.calls)}</span></span>
                                                                                <span className="text-gray-500">成功 <span className="text-emerald-300">{today.successes}</span></span>
                                                                                <span className="text-gray-500">失败 <span className={failCls(today.failures)}>{today.failures}</span></span>
                                                                            </div>
                                                                        )}
                                                                        {week && week.calls > 0 && (
                                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-2 text-xs">
                                                                                <span className="w-16 shrink-0 text-gray-600">近7天调用</span>
                                                                                <span className="text-gray-500">调用 <span className="text-gray-200">{fmtCalls(week.calls)}</span></span>
                                                                                <span className="text-gray-500">成功 <span className="text-emerald-300">{week.successes}</span></span>
                                                                                <span className="text-gray-500">失败 <span className={failCls(week.failures)}>{week.failures}</span></span>
                                                                                <span className="text-gray-500">成功率 <span className={rateCls(week.successRate)}>{pct(week.successRate)}</span></span>
                                                                                <span className="text-gray-500">失败率 <span className={rateCls(week.failRate)}>{pct(week.failRate)}</span></span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {d7}
                                                                {d30}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                                    <button onClick={() => startEdit(k)} className="rounded bg-[#e5e5ea] px-3 py-1 text-sm text-gray-600 hover:bg-[#c7c7cd]">
                                                        编辑
                                                    </button>
                                                    <button onClick={() => testConnection(k.id)} className="rounded bg-[#e5e5ea] px-3 py-1 text-sm text-gray-600 hover:bg-[#c7c7cd]">
                                                        {testingId === k.id ? "测试中..." : "测试连接"}
                                                    </button>
                                                    {testResult[k.id] && (
                                                        <span className={`rounded px-2 py-1 text-xs ${testResult[k.id].ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                                                            {testResult[k.id].ok ? "正常" : "失败"}
                                                        </span>
                                                    )}
                                                    <button onClick={() => handleToggle(k.id, !!k.is_active)} className="rounded bg-[#e5e5ea] px-3 py-1 text-sm text-gray-600 hover:bg-[#c7c7cd]">
                                                        {k.is_active ? "停用" : "启用"}
                                                    </button>
                                                    <button onClick={() => handleDelete(k.id)} className="rounded bg-red-500/10 px-3 py-1 text-sm text-red-400 hover:bg-red-500/20">
                                                        删除
                                                    </button>
                                                </div>
                                            </div>
                                            {brandGroups && (() => {
                                                const brands = Object.keys(brandGroups);
                                                // 默认折叠：未记录即收起整张卡片下方模型区
                                                const collapsed = cardCollapsed[k.id] ?? true;
                                                const setAll = (open: boolean) => {
                                                    setCardCollapsed(prev => ({ ...prev, [k.id]: !open }));
                                                    if (open) {
                                                        // 展开全部：同时把所有厂商分组打开
                                                        setExpandedModels(prev => {
                                                            const next = { ...prev };
                                                            brands.forEach(b => { next[`${k.id}:${b}`] = true; });
                                                            return next;
                                                        });
                                                    }
                                                };
                                                return (
                                                    <div className="mt-5 space-y-4 border-t border-[#f0f0f2] pt-3">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button onClick={() => setAll(collapsed)} className="rounded bg-[#e5e5ea] px-3 py-1 text-xs text-gray-600 hover:bg-[#c7c7cd]">{collapsed ? "展开全部" : "折叠全部"}</button>
                                                        </div>
                                                        {!collapsed && brands.map(brand => {
                                                            const caps = brandGroups[brand];
                                                            const open = expandedModels[`${k.id}:${brand}`] ?? true;
                                                            return (
                                                                <div key={brand} className="space-y-3">
                                                                    <button type="button" onClick={() => setExpandedModels(prev => ({ ...prev, [`${k.id}:${brand}`]: !open }))}
                                                                        className="flex items-center gap-1.5 text-left">
                                                                        <ChevronRight size={12} className="shrink-0 text-gray-500 transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
                                                                        <span className="text-xs font-medium text-gray-600">{brand}</span>
                                                                    </button>
                                                                    {open && Object.entries(caps).map(([cap, ms]) => {
                                                                        // ms 已按系列排序，切成连续的系列段，段间用更大留白分开
                                                                        const runs: { key: string; items: string[] }[] = [];
                                                                        ms.forEach(m => {
                                                                            const s = seriesOf(m);
                                                                            const last = runs[runs.length - 1];
                                                                            if (last && last.key === s) last.items.push(m);
                                                                            else runs.push({ key: s, items: [m] });
                                                                        });
                                                                        return (
                                                                            <div key={cap} className="space-y-2 rounded-lg bg-[#ffffff] p-3">
                                                                                <div className={`rounded px-2.5 py-1 ${CAP_BG[cap] || CAP_BG["其他"]}`}>
                                                                                    <span className={`text-xs ${CAP_TEXT[cap] || "text-gray-600"}`}>{cap}</span>
                                                                                </div>
                                                                                <div className="space-y-5">
                                                                                    {runs.map(run => (
                                                                                        <div key={run.key}>
                                                                                            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                                                                                                {run.items.map(m => {
                                                                                                    const rowKey = `${k.id}:${m}`;
                                                                                                    const open = expandedModelRows[rowKey] ?? false;
                                                                                                    const hh = keyHistory[k.id];
                                                                                                    const d7m = hh?.d7?.models?.[m];
                                                                                                    const d30m = hh?.d30?.models?.[m];
                                                                                                    const pctTxt = (v: number | null | undefined) => (v == null ? "—" : v + "%");
                                                                                                    const rateTxt = (v: number | null | undefined) => v == null ? "text-gray-500" : v >= 90 ? "text-emerald-300" : v >= 60 ? "text-amber-300" : "text-red-300";
                                                                                                    const has = (d7m?.calls || 0) > 0 || (d30m?.calls || 0) > 0;
                                                                                                    return (
                                                                                                        <div key={m} className="flex flex-col gap-1">
                                                                                                            <button onClick={() => setExpandedModelRows(p => ({ ...p, [rowKey]: !open }))}
                                                                                                                className="flex items-center justify-between rounded bg-[#e5e5ea] px-2.5 py-1 text-left text-xs leading-4 text-gray-500 hover:bg-[#c7c7cd]">
                                                                                                                <span className="truncate">{prettyModel(m)}</span>
                                                                                                                <ChevronRight size={12} className="shrink-0 text-gray-600 transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
                                                                                                            </button>
                                                                                                            {open && (
                                                                                                                <div className="rounded bg-[#f0f0f2] px-2 py-1.5 text-[11px] leading-5 text-gray-500">
                                                                                                                    {!has && <div className="text-gray-600">暂无数据</div>}
                                                                                                                    {has && (
                                                                                                                        <>
                                                                                                                            <div>近7天 调用 {d7m?.calls ?? 0} · 成功 <span className="text-emerald-300">{d7m?.successes ?? 0}</span> · 失败 <span className={(d7m?.failures ?? 0) > 0 ? "text-red-300" : "text-emerald-300"}>{d7m?.failures ?? 0}</span> · 成功率 <span className={rateTxt(d7m?.successRate)}>{pctTxt(d7m?.successRate)}</span></div>
                                                                                                                            <div>近30天 调用 {d30m?.calls ?? 0} · 成功 <span className="text-emerald-300">{d30m?.successes ?? 0}</span> · 失败 <span className={(d30m?.failures ?? 0) > 0 ? "text-red-300" : "text-emerald-300"}>{d30m?.failures ?? 0}</span> · 成功率 <span className={rateTxt(d30m?.successRate)}>{pctTxt(d30m?.successRate)}</span></div>
                                                                                                                        </>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
