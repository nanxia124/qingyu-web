import { useState, useEffect, useRef } from "react";
import { useTranslation } from 'react-i18next'
import { ChevronRight } from "lucide-react";
import ModelCatalog from "./ModelCatalog";
import { App } from 'antd';

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

const DEFAULT_BLEND_PROMPT = `请对这张图片进行光影融合优化，保持图片中所有物体的形状、颜色、位置和细节完全不变，仅修正不自然的光影过渡：
1. 统一整体光源方向，消除矛盾的阴影
2. 优化明暗交界线，让过渡更自然柔和
3. 修正局部过曝或过暗区域，保持整体曝光平衡
4. 增强画面的立体感和空间感
5. 不要添加任何新元素，不要移除任何现有内容，仅做光影层面的自然融合`

function PromptConfig() {
    const { message } = App.useApp()
    const [blendPrompt, setBlendPrompt] = useState('')
    const [originalPrompt, setOriginalPrompt] = useState('')
    const [isEditing, setIsEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        fetch('/api/config/blend-prompt')
            .then((res) => res.json())
            .then((data) => {
                setBlendPrompt(data.prompt || DEFAULT_BLEND_PROMPT)
                setOriginalPrompt(data.prompt || DEFAULT_BLEND_PROMPT)
            })
            .catch(() => {
                setBlendPrompt(DEFAULT_BLEND_PROMPT)
                setOriginalPrompt(DEFAULT_BLEND_PROMPT)
            })
    }, [])

    const save = () => {
        setSaving(true)
        fetch('/api/config/blend-prompt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: blendPrompt }),
        })
            .then(() => {
                setSaved(true)
                setOriginalPrompt(blendPrompt)
                setIsEditing(false)
                setTimeout(() => setSaved(false), 2000)
            })
            .catch(() => message.error('保存失败'))
            .finally(() => setSaving(false))
    }

    return (
        <div className="max-w-3xl">
            <h2 className="mb-4 text-lg font-medium text-white">融图提示词配置</h2>
            <p className="mb-4 text-sm text-gray-500">
                配置融图页面使用的内置提示词。用户上传图片后，系统会自动使用此提示词调用生图模型进行光影融合。
            </p>
            {isEditing ? (
                <>
                    <textarea
                        value={blendPrompt}
                        onChange={(e) => setBlendPrompt(e.target.value)}
                        rows={10}
                        placeholder="输入融图提示词…"
                        className="w-full resize-none rounded-lg bg-secondary px-4 py-3 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-[#5051F8]" style={{ borderRadius: "8px" }}
                    />
                    <div className="mt-4 flex items-center gap-3">
                        <button
                            onClick={save}
                            disabled={saving}
                            className="rounded-lg bg-[#5051F8] px-6 py-2 text-sm font-medium text-white hover:bg-[#4041E8] disabled:opacity-50"
                        >
                            {saving ? '保存中…' : '保存'}
                        </button>
                        <button
                            onClick={() => { setBlendPrompt(originalPrompt); setIsEditing(false); }}
                            className="rounded-lg bg-secondary px-6 py-2 text-sm text-gray-400 hover:bg-border"
                        >
                            取消
                        </button>
                        {saved && <span className="text-sm text-green-400">已保存</span>}
                    </div>
                </>
            ) : (
                <>
                    <div className="whitespace-pre-wrap rounded-lg bg-secondary px-4 py-3 text-sm text-gray-300">
                        {blendPrompt}
                    </div>
                    <div className="mt-4">
                        <button
                            onClick={() => setIsEditing(true)}
                            className="rounded-lg bg-secondary px-6 py-2 text-sm text-gray-300 hover:bg-border"
                        >
                            编辑
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}

export default function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [activeTab, setActiveTab] = useState<"channels" | "catalog" | "prompts">("channels");
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
                message.error(t("pages.admin.dashboard.fillRequired"));
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
                message.error(t("pages.admin.dashboard.saveFailed") + (data.error || `HTTP ${res.status}`));
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
            message.error(t("pages.admin.dashboard.saveFailed") + (err.message || err));
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
        if (!confirm(t("pages.admin.dashboard.confirmDelete"))) return;
        await fetch(`${API}/api/admin/api-keys/${id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
        });
        fetchKeys();
    };

    const fetchModels = async () => {
        if (!form.base_url) {
            message.error(t("pages.admin.dashboard.apiUrlFirst"));
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
                message.error(t("pages.admin.dashboard.apiKeyFirst"));
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
                message.error(t("pages.admin.dashboard.pullFailed") + (data.error || `HTTP ${res.status}`));
                return;
            }
            if (data.data) {
                setModels(data.data.map((m: any) => m.id));
            } else {
                message.error(t("pages.admin.dashboard.pullFailed") + (data.error?.message || t("pages.admin.dashboard.unknownErr")));
            }
        } catch (err: any) {
            message.error(t("pages.admin.dashboard.pullFailed") + err.message);
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
            if (!key) throw new Error(t("pages.admin.dashboard.configNotExist"));

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
            setPwError(t("pages.admin.dashboard.pwMismatch"));
            return;
        }
        if (pwForm.newPassword.length < 8) {
            setPwError(t("pages.admin.dashboard.pwMin"));
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
        <div className="min-h-screen bg-bg p-8">
            <div className="mx-auto max-w-5xl">
                <div className="mb-8 flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-white">{t("pages.admin.dashboard.title")}</h1>
                    <div className="flex gap-2">
                        <button onClick={() => setShowChangePw(true)} className="rounded-lg bg-secondary px-4 py-2 text-sm text-gray-600 hover:bg-border">
                            修改密码
                        </button>
                        <button onClick={onLogout} className="rounded-lg bg-secondary px-4 py-2 text-sm text-gray-600 hover:bg-border">
                            退出登录
                        </button>
                    </div>
                </div>

                {/* Tab 切换 */}
                <div className="mb-6 flex gap-1 rounded-lg bg-secondary p-1 w-fit">
                    <button onClick={() => setActiveTab("channels")}
                        className={`rounded-md px-4 py-1.5 text-sm transition-colors ${activeTab === "channels" ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                        API 渠道
                    </button>
                    <button onClick={() => setActiveTab("catalog")}
                        className={`rounded-md px-4 py-1.5 text-sm transition-colors ${activeTab === "catalog" ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                        模型目录
                    </button>
                    <button onClick={() => setActiveTab("prompts")}
                        className={`rounded-md px-4 py-1.5 text-sm transition-colors ${activeTab === "prompts" ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                        提示词配置
                    </button>
                </div>

                {activeTab === "prompts" ? (
                    <PromptConfig />
                ) : activeTab === "catalog" ? (
                    <ModelCatalog />
                ) : (<>
                {showChangePw && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                        <form onSubmit={handleChangePw} className="relative w-full max-w-md rounded-2xl bg-card p-6">
                        <h2 className="mb-4 text-lg font-semibold text-white">{t("pages.admin.dashboard.changePw")}</h2>
                        <button type="button" onClick={() => setShowChangePw(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-lg text-gray-500 hover:bg-border hover:text-white">×</button>
                        {pwError && <p className="mb-4 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">{pwError}</p>}
                        {pwSuccess && <p className="mb-4 rounded bg-green-500/10 px-3 py-2 text-sm text-green-400">{t("pages.admin.dashboard.pwSuccess")}</p>}
                        <div className="grid gap-4">
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.oldPw")}</label>
                                <input type="password" value={pwForm.oldPassword} onChange={e => setPwForm({...pwForm, oldPassword: e.target.value})}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.newPw")}</label>
                                <input type="password" value={pwForm.newPassword} onChange={e => setPwForm({...pwForm, newPassword: e.target.value})}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.confirmPw")}</label>
                                <input type="password" value={pwForm.confirmPassword} onChange={e => setPwForm({...pwForm, confirmPassword: e.target.value})}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" />
                            </div>
                        </div>
                        <div className="mt-4 flex gap-2">
                            <button type="submit" className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-accent-hover">{t("pages.admin.dashboard.confirm")}</button>
                            <button type="button" onClick={() => setShowChangePw(false)} className="rounded-lg bg-secondary px-4 py-2 text-gray-600">取消</button>
                        </div>
                        </form>
                    </div>
                )}

                <div className="mb-6 flex justify-end">
                    <button onClick={() => setShowAdd(!showAdd)} className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-accent-hover">
                        {t("pages.admin.dashboard.addBtn")}
                    </button>
                </div>

                {showAdd && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                        <form onSubmit={handleAdd} className="relative w-full max-w-2xl rounded-2xl bg-card p-6 max-h-[85vh] overflow-y-auto thin-scrollbar">
                        <h2 className="mb-4 text-lg font-semibold text-white">{editId ? t("pages.admin.dashboard.editTitle") : t("pages.admin.dashboard.newTitle")}</h2>
                        <button type="button" onClick={() => setShowAdd(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-lg text-gray-500 hover:bg-border hover:text-white">×</button>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.name")}</label>
                                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" placeholder={t("pages.admin.dashboard.namePh")} />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.provider")}</label>
                                <div className="relative" ref={providerRef}>
                                    <button type="button" onClick={() => setProviderOpen(v => !v)}
                                        className="flex w-full items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm text-white outline-none">
                                        <span>{PROVIDERS.find(p => p.value === form.provider)?.label || form.provider}</span>
                                        <svg className="text-gray-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.apiUrl")}</label>
                                <input value={form.base_url} onChange={e => setForm({...form, base_url: e.target.value})}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" placeholder="https://api.openai.com/v1" />
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm text-gray-500">t("pages.admin.dashboard.apiKey"){editId && t("pages.admin.dashboard.apiKeyEdit")}</label>
                                <input type="password" value={form.api_key} onChange={e => setForm({...form, api_key: e.target.value})}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" placeholder="sk-..." />
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.concurrency")} {keyMaxConcurrency}）</label>
                                <input type="number" min="1" value={form.max_concurrency} onChange={e => setForm({...form, max_concurrency: e.target.value})}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" placeholder="如 5" />
                            </div>
                            <div className="col-span-2">
                                <span className="text-sm text-gray-500">{t("pages.admin.dashboard.selectedModels", { count: selectedModels.length })}</span>
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
                                        <div className="relative flex h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-card p-6">
                                            <h3 className="mb-4 text-xl font-semibold text-white">{t("pages.admin.dashboard.selectModels")}</h3>
                                            <button type="button" onClick={() => setShowModelsModal(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-lg text-gray-500 hover:bg-border hover:text-white">×</button>
                                            <div className="mb-4 flex flex-wrap items-center gap-5 border-b border-border pb-3">
                                                {tabs.map(t => (
                                                    <button key={t} type="button" onClick={() => setCapTab(t)}
                                                        className={`text-sm ${capTab === t ? "font-medium text-white" : "text-gray-500 hover:text-gray-600"}`}>
                                                        {t} <span className={capTab === t ? "text-accent-soft-text" : "text-gray-600"}>{counts[t] || 0}</span>
                                                    </button>
                                                ))}
                                                <button type="button" onClick={() => setAllExpanded(!allExpanded)}
                                                    className="ml-auto rounded bg-secondary px-3 py-1 text-xs text-gray-600 hover:bg-border">
                                                    {allExpanded ? t("pages.admin.dashboard.collapseAll") : t("pages.admin.dashboard.expandAll")}
                                                </button>
                                                <button type="button" onClick={() => toggleBrand(filtered)}
                                                    className={`rounded px-3 py-1 text-xs ${allFilteredIn ? "bg-[#5051F8]/15 text-accent-soft-text" : "bg-secondary text-gray-600 hover:bg-border"}`}>
                                                    {allFilteredIn ? t("pages.admin.dashboard.deselectAll") : t("pages.admin.dashboard.selectAll")}
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
                                                        <div key={b} className="group rounded-lg bg-card">
                                                            <div className="flex items-center gap-2 px-3 py-2.5">
                                                                <button type="button" onClick={() => toggleExpand(b)} className="flex items-center text-gray-500"><ChevronRight size={14} className="transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} /></button>
                                                                {headLogo}
                                                                <span className="text-base font-semibold text-gray-100">{b}</span>
                                                                <span className="rounded-full bg-[#5051F8]/20 px-1.5 text-xs text-accent-soft-text">{list.length}</span>
                                                                <button type="button" onClick={() => toggleBrand(list)}
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
                                                                                        <div key={m} className="group/row flex items-center gap-2 rounded-lg bg-secondary px-2.5 py-2 hover:bg-surface-hover">
                                                                                            {rowLogo}
                                                                                            <span className="truncate text-sm text-gray-600">{prettyModel(m)}</span>
                                                                                            <button type="button" onClick={() => toggleModel(m)}
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
                                                {brandKeys.length === 0 && <p className="py-8 text-center text-sm text-gray-500">{t("pages.admin.dashboard.noModelInCat")}</p>}
                                            </div>
                                            <div className="mt-4 flex justify-end border-t border-border pt-4">
                                                <button type="button" onClick={() => setShowModelsModal(false)} className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-accent-hover">{t("pages.admin.dashboard.doneSelected", { count: selectedModels.length })}</button>
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
                                className="rounded-lg bg-secondary px-4 py-2 text-sm text-gray-600 hover:bg-border disabled:opacity-50">
                                {loadingModels ? t("pages.admin.dashboard.pulling") : t("pages.admin.dashboard.pullModels")}
                            </button>
                            <div className="ml-auto flex gap-2">
                                <button type="submit" className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-accent-hover">{t("pages.admin.dashboard.save")}</button>
                                <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg bg-secondary px-4 py-2 text-gray-600">取消</button>
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
                            <div className="fixed z-[61] max-h-72 overflow-y-auto rounded-lg bg-secondary py-1 shadow-lg shadow-black/50 thin-scrollbar"
                                style={{ left: r.left, top: r.bottom + 4, width: r.width }}>
                                {PROVIDERS.map(p => (
                                    <button key={p.value} type="button"
                                        onClick={() => { setForm({ ...form, provider: p.value }); setProviderOpen(false); }}
                                        className={`block w-full px-3 py-1.5 text-left text-sm ${p.value === form.provider ? "bg-[#5051F8]/15 text-accent-soft-text" : "text-gray-600 hover:bg-surface-hover"}`}>
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    );
                })()}

                {loading ? (
                    <p className="text-gray-500">{t("pages.admin.dashboard.loading")}</p>
                ) : keys.length === 0 ? (
                    <p className="text-gray-500">{t("pages.admin.dashboard.emptyHint")}</p>
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
                                        <div key={k.id} className="flex flex-col rounded-xl border border-border bg-card p-8">
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1 space-y-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-white">{k.name}</span>
                                                        {k.is_active ? (
                                                            <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs text-green-400">{t("pages.admin.dashboard.active")}</span>
                                                        ) : (
                                                            <span className="rounded bg-gray-500/10 px-2 py-0.5 text-xs text-gray-500">{t("pages.admin.dashboard.inactive")}</span>
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
                                                                <span className={`rounded-md px-2.5 py-1 text-sm font-medium ${st.inFlight > 0 ? "bg-blue-500/20 text-blue-300" : "bg-secondary text-gray-500"}`}>
                                                                    {t("pages.admin.dashboard.concurrencyLabel")} {st.inFlight || 0}/{max}
                                                                </span>
                                                                <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-300">{t("pages.admin.dashboard.success")} {s}</span>
                                                                <span className={`rounded-md px-2.5 py-1 text-sm font-medium ${f > 0 ? "bg-red-500/15 text-red-300" : "bg-secondary text-gray-500"}`}>{t("pages.admin.dashboard.fail")} {f}</span>
                                                                <span className={`rounded-md px-2.5 py-1 text-sm font-medium ${total === 0 ? "bg-secondary text-gray-500" : rate >= 90 ? "bg-emerald-500/15 text-emerald-300" : rate >= 60 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300"}`}>
                                                                    {total === 0 ? "—" : rate + "%"}
                                                                </span>
                                                                {st.avgLatencyMs > 0 && <span className="rounded-md bg-secondary px-2.5 py-1 text-sm font-medium text-gray-600">{st.avgLatencyMs}ms</span>}
                                                                {st.cooling && <span className="rounded-md bg-red-500/20 px-2.5 py-1 text-sm font-semibold text-red-300">{t("pages.admin.dashboard.cooling")}</span>}
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
                                                            <div className="space-y-2 border-t border-border pt-2">
                                                                {hasSummary && (
                                                                    <div className="space-y-0.5">
                                                                        {today && today.calls > 0 && (
                                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-2 text-xs">
                                                                                <span className="w-16 shrink-0 text-gray-600">{t("pages.admin.dashboard.todayCalls")}</span>
                                                                                <span className="text-gray-500">调用 <span className="text-gray-200">{fmtCalls(today.calls)}</span></span>
                                                                                <span className="text-gray-500">成功 <span className="text-emerald-300">{today.successes}</span></span>
                                                                                <span className="text-gray-500">失败 <span className={failCls(today.failures)}>{today.failures}</span></span>
                                                                            </div>
                                                                        )}
                                                                        {week && week.calls > 0 && (
                                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-2 text-xs">
                                                                                <span className="w-16 shrink-0 text-gray-600">{t("pages.admin.dashboard.weekCalls")}</span>
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
                                                    <button onClick={() => startEdit(k)} className="rounded bg-secondary px-3 py-1 text-sm text-gray-600 hover:bg-border">
                                                        编辑
                                                    </button>
                                                    <button onClick={() => testConnection(k.id)} className="rounded bg-secondary px-3 py-1 text-sm text-gray-600 hover:bg-border">
                                                        {testingId === k.id ? t("pages.admin.dashboard.testing") : t("pages.admin.dashboard.testConn")}
                                                    </button>
                                                    {testResult[k.id] && (
                                                        <span className={`rounded px-2 py-1 text-xs ${testResult[k.id].ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                                                            {testResult[k.id].ok ? t("pages.admin.dashboard.normal") : t("pages.admin.dashboard.fail")}
                                                        </span>
                                                    )}
                                                    <button onClick={() => handleToggle(k.id, !!k.is_active)} className="rounded bg-secondary px-3 py-1 text-sm text-gray-600 hover:bg-border">
                                                        {k.is_active ? t("pages.admin.dashboard.disable") : t("pages.admin.dashboard.enable")}
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
                                                    <div className="mt-5 space-y-4 border-t border-border pt-3">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button onClick={() => setAll(collapsed)} className="rounded bg-secondary px-3 py-1 text-xs text-gray-600 hover:bg-border">{collapsed ? t("pages.admin.dashboard.expandAll2") : t("pages.admin.dashboard.collapseAll2")}</button>
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
                                                                            <div key={cap} className="space-y-2 rounded-lg bg-card p-3">
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
                                                                                                                className="flex items-center justify-between rounded bg-secondary px-2.5 py-1 text-left text-xs leading-4 text-gray-500 hover:bg-border">
                                                                                                                <span className="truncate">{prettyModel(m)}</span>
                                                                                                                <ChevronRight size={12} className="shrink-0 text-gray-600 transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
                                                                                                            </button>
                                                                                                            {open && (
                                                                                                                <div className="rounded bg-secondary px-2 py-1.5 text-[11px] leading-5 text-gray-500">
                                                                                                                    {!has && <div className="text-gray-600">{t("pages.admin.dashboard.noData")}</div>}
                                                                                                                    {has && (
                                                                                                                        <>
                                                                                                                            <div>{t("pages.admin.dashboard.d7")} {t("pages.admin.dashboard.calls")} {d7m?.calls ?? 0} · 成功 <span className="text-emerald-300">{d7m?.successes ?? 0}</span> · 失败 <span className={(d7m?.failures ?? 0) > 0 ? "text-red-300" : "text-emerald-300"}>{d7m?.failures ?? 0}</span> · 成功率 <span className={rateTxt(d7m?.successRate)}>{pctTxt(d7m?.successRate)}</span></div>
                                                                                                                            <div>{t("pages.admin.dashboard.d30")} {t("pages.admin.dashboard.calls")} {d30m?.calls ?? 0} · 成功 <span className="text-emerald-300">{d30m?.successes ?? 0}</span> · 失败 <span className={(d30m?.failures ?? 0) > 0 ? "text-red-300" : "text-emerald-300"}>{d30m?.failures ?? 0}</span> · 成功率 <span className={rateTxt(d30m?.successRate)}>{pctTxt(d30m?.successRate)}</span></div>
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
                </>)}
            </div>
        </div>
    );
}
