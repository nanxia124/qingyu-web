import { useState, useEffect, useRef } from "react";
import { useTranslation } from 'react-i18next'
import { ChevronRight, Save, RefreshCw } from "lucide-react";
import ModelCatalog from "./ModelCatalog";
import { App } from 'antd';
import { adminBillingApi } from "@/lib/billing";
import { PasswordInput } from "@/components/PasswordInput";

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

type HistoryRange = "all" | "d1" | "d3" | "d7" | "d30" | "d90" | "d365" | "custom";
type ApiUsageEntry = {
    id: string;
    requestId: string | null;
    occurredAt: string;
    completedAt: string | null;
    userEmail: string;
    provider: string;
    model: string;
    quantity: number;
    status: "reserved" | "committed" | "released" | "failed" | "unknown";
    latencyMs: number | null;
    targetPath: string;
    statusCode: number | null;
    phase: string;
};
type ApiUsagePage = { total: number; limit: number; offset: number; items: ApiUsageEntry[] };

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
  const [activeTab, setActiveTab] = useState<"channels" | "supplier" | "catalog" | "prompts">("channels");
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ name: "", provider: "openai", base_url: "", api_key: "", model: "", max_concurrency: "" });
    const [formErrors, setFormErrors] = useState<{ name: string; base_url: string; api_key: string }>({ name: "", base_url: "", api_key: "" });
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [testingId, setTestingId] = useState<number | null>(null);
    const [testResult, setTestResult] = useState<Record<number, { ok: boolean; message: string }>>({});
    const [editId, setEditId] = useState<number | null>(null);
    const [showChangePw, setShowChangePw] = useState(false);
    const [pwForm, setPwForm] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" });
    const [pwError, setPwError] = useState("");
    const [pwSuccess, setPwSuccess] = useState(false);
    const [pwOldError, setPwOldError] = useState("");
    const [pwNewError, setPwNewError] = useState("");
    const [pwConfirmError, setPwConfirmError] = useState("");
    const pwOldRef = useRef<HTMLInputElement>(null);
    const pwNewRef = useRef<HTMLInputElement>(null);
    const pwConfirmRef = useRef<HTMLInputElement>(null);
    const [models, setModels] = useState<string[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [showModelsModal, setShowModelsModal] = useState(false);
    const [capTab, setCapTab] = useState("全部");
    const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});
    const [providerOpen, setProviderOpen] = useState(false);
    const providerRef = useRef<HTMLDivElement>(null);
    const [keyStats, setKeyStats] = useState<Record<number, any>>({});
    const [keyHistoryByRange, setKeyHistoryByRange] = useState<Record<string, Record<number, any>>>({});
    const [rangeByKey, setRangeByKey] = useState<Record<number, HistoryRange>>({});
    const [customByKey, setCustomByKey] = useState<Record<number, { start: string; end: string }>>({});
    const [expandedUsageKey, setExpandedUsageKey] = useState<string | null>(null);
    const [usagePages, setUsagePages] = useState<Record<string, ApiUsagePage>>({});
    const [usageErrors, setUsageErrors] = useState<Record<string, string>>({});
    const [loadingUsageKey, setLoadingUsageKey] = useState<string | null>(null);
    // 卡片模型分组折叠状态：key 为 `${cardId}:${brand}`，未记录即默认折叠
    const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
    // 卡片级折叠：key 为卡片 id，默认折叠；折叠后整张卡片下方模型区全部收起
    const [cardCollapsed, setCardCollapsed] = useState<Record<number, boolean>>({});
    // 单个模型行展开：key 为 `${cardId}:${model}`，展开后显示该模型近7天/近30天数据
    const [expandedModelRows, setExpandedModelRows] = useState<Record<string, boolean>>({});

    // MaiziAI 上游中转站配置
    const [maiziSettings, setMaiziSettings] = useState<any>(null);
    const [maiziConfigDraft, setMaiziConfigDraft] = useState({ enabled: false, apiKey: "", balanceToken: "", baseUrl: "" });
    const [maiziBalance, setMaiziBalance] = useState<any>(null);
    const [maiziKeyLimits, setMaiziKeyLimits] = useState<any>(null);
    const [maiziLoading, setMaiziLoading] = useState(false);
    const [maiziModels, setMaiziModels] = useState<any[]>([]);
    const [maiziModelsLoading, setMaiziModelsLoading] = useState(false);
    const [maiziAnnouncements, setMaiziAnnouncements] = useState<any[]>([]);
    const [maiziAnnouncementsLoading, setMaiziAnnouncementsLoading] = useState(false);
    const [maiziConfirm, setMaiziConfirm] = useState<{ open: boolean; message: string; onConfirm: (() => void) | null }>({ open: false, message: "", onConfirm: null });
    // 添加 Key 的方式：manual = 手动填，builtin = 选内置供应商
    const [addMode, setAddMode] = useState<"manual" | "builtin">("manual");
    const [builtinSelectedModels, setBuiltinSelectedModels] = useState<string[]>([]);
    const [builtinName, setBuiltinName] = useState("MaiziAI 中转站");

    const loadMaiziSettings = async () => {
        try {
            const s = await adminBillingApi.getSettings();
            setMaiziSettings(s);
            const sup = s.supplier?.maizitech || {};
            setMaiziConfigDraft({
                enabled: sup.enabled || false,
                apiKey: sup.apiKey || "",
                balanceToken: sup.balanceToken || "",
                baseUrl: sup.baseUrl || "https://www.maizitech.ai",
            });
        } catch (e: any) {
            message.error(e.message || "加载中转站配置失败");
        }
    };

    useEffect(() => { loadMaiziSettings(); }, []);

    const showMaiziConfirm = (msg: string, onConfirm: () => void) => {
        setMaiziConfirm({ open: true, message: msg, onConfirm });
    };

    const handleMaiziConfirmOk = () => {
        if (maiziConfirm.onConfirm) maiziConfirm.onConfirm();
        setMaiziConfirm({ open: false, message: "", onConfirm: null });
    };

    const saveMaiziConfig = () => {
        showMaiziConfirm("确认保存 MaiziAI 中转站配置？", async () => {
            try {
                await adminBillingApi.updateSettings({
                    ...maiziSettings,
                    supplier: {
                        ...maiziSettings.supplier,
                        maizitech: { ...maiziConfigDraft },
                    },
                });
                message.success("中转站配置已保存");
                loadMaiziSettings();
            } catch (e: any) {
                message.error(e.message || "保存失败");
            }
        });
    };

    const queryMaiziBalance = async () => {
        setMaiziLoading(true);
        setMaiziBalance(null);
        setMaiziKeyLimits(null);
        try {
            const [bal, limits] = await Promise.all([
                adminBillingApi.supplierBalance().catch(e => ({ error: e.message })),
                adminBillingApi.supplierKeyLimits().catch(e => ({ error: e.message })),
            ]);
            setMaiziBalance(bal);
            setMaiziKeyLimits(limits);
        } finally {
            setMaiziLoading(false);
        }
    };

    const queryMaiziModels = async () => {
        setMaiziModelsLoading(true);
        setMaiziModels([]);
        try {
            const res = await adminBillingApi.supplierModels();
            setMaiziModels(res.data || []);
        } catch (e: any) {
            message.error(e.message || "查询模型价格失败");
        } finally {
            setMaiziModelsLoading(false);
        }
    };

    const queryMaiziAnnouncements = async () => {
        setMaiziAnnouncementsLoading(true);
        setMaiziAnnouncements([]);
        try {
            const res = await adminBillingApi.supplierAnnouncements();
            setMaiziAnnouncements(Array.isArray(res) ? res : []);
        } catch (e: any) {
            message.error(e.message || "查询公告失败");
        } finally {
            setMaiziAnnouncementsLoading(false);
        }
    };


    const fetchKeyStats = async () => {
        try {
            const res = await fetch(`${API}/api/admin/key-stats`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) setKeyStats(await res.json());
        } catch { /* 忽略 */ }
    };

    const fetchKeyHistoryRange = async (rangeKey: string) => {
        try {
            let url = `${API}/api/admin/key-history?range=`;
            if (rangeKey.startsWith("custom:")) {
                const parts = rangeKey.split(":");
                url += `custom&start=${encodeURIComponent(parts[1])}&end=${encodeURIComponent(parts[2])}`;
            } else {
                url += encodeURIComponent(rangeKey);
            }
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setKeyHistoryByRange(cur => ({ ...cur, [rangeKey]: data }));
            }
        } catch { /* 忽略 */ }
    };

    const rangeKeyFor = (channelId: number): string | null => {
        const r = rangeByKey[channelId] || "d7";
        if (r === "custom") {
            const c = customByKey[channelId];
            if (!c || !c.start || !c.end) return null;
            return `custom:${c.start}:${c.end}`;
        }
        return r;
    };

    const usageDetailKey = (channelId: number, range: HistoryRange, capability: string, start?: string, end?: string) =>
        `${channelId}:${range}:${capability}:${range === "custom" ? `${start || ""}:${end || ""}` : ""}`;

    const loadKeyUsage = async (channelId: number, range: HistoryRange, capability: string, offset = 0, start?: string, end?: string) => {
        const detailKey = usageDetailKey(channelId, range, capability, start, end);
        setLoadingUsageKey(detailKey);
        setUsageErrors(current => ({ ...current, [detailKey]: "" }));
        try {
            const params = new URLSearchParams({ range, capability, limit: "50", offset: String(offset) });
            if (range === "custom" && start && end) { params.set("start", start); params.set("end", end); }
            const response = await fetch(`${API}/api/admin/api-keys/${channelId}/usage?${params}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            setUsagePages(current => ({ ...current, [detailKey]: data }));
        } catch (error: any) {
            setUsageErrors(current => ({ ...current, [detailKey]: error?.message || "调用明细读取失败" }));
        } finally {
            setLoadingUsageKey(current => current === detailKey ? null : current);
        }
    };

    const toggleKeyUsage = (channelId: number, range: HistoryRange, capability = "全部", start?: string, end?: string) => {
        const detailKey = usageDetailKey(channelId, range, capability, start, end);
        if (expandedUsageKey === detailKey) {
            setExpandedUsageKey(null);
            return;
        }
        setExpandedUsageKey(detailKey);
        void loadKeyUsage(channelId, range, capability, 0, start, end);
    };

    const renderKeyUsageDetails = (channelId: number, range: HistoryRange, capability: string, start?: string, end?: string) => {
        const detailKey = usageDetailKey(channelId, range, capability);
        if (expandedUsageKey !== detailKey) return null;
        const page = usagePages[detailKey];
        const formatUsageTime = (value: string | null) => value
            ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(new Date(value))
            : "尚未完成";
        const statusLabel: Record<ApiUsageEntry["status"], string> = {
            reserved: "进行中", committed: "成功", released: "已释放", failed: "失败", unknown: "结果未知",
        };
        return (
            <div className="mt-2 w-full basis-full space-y-2 rounded-lg bg-secondary p-3 text-xs text-gray-400">
                {loadingUsageKey === detailKey && <div>正在读取调用明细…</div>}
                {usageErrors[detailKey] && <div role="alert" className="flex items-center justify-between gap-2 text-red-300"><span>{usageErrors[detailKey]}</span><button type="button" onClick={() => void loadKeyUsage(channelId, range, capability, page?.offset || 0, start, end)} className="rounded px-2 py-1 hover:bg-border">重试</button></div>}
                {page && page.items.map(entry => (
                    <div key={entry.id} className="space-y-1 rounded-md bg-input px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>{formatUsageTime(entry.occurredAt)}</span>
                            <span className={entry.status === "committed" ? "text-emerald-300" : entry.status === "failed" ? "text-red-300" : "text-amber-300"}>{statusLabel[entry.status]}</span>
                            <span>{entry.userEmail}</span>
                            <span>{entry.model || "未记录模型"}</span>
                            <span>{entry.targetPath || "未记录路径"}</span>
                            {entry.statusCode !== null && <span>HTTP {entry.statusCode}</span>}
                            {entry.latencyMs !== null && <span>{entry.latencyMs}ms</span>}
                        </div>
                        <div className="break-all font-mono text-[10px] text-gray-600" title={entry.id}>记录 {entry.id} · 请求 {entry.requestId || "无外部请求编号"} · 完成 {formatUsageTime(entry.completedAt)}</div>
                    </div>
                ))}
                {page && page.total === 0 && <div>所选时间和类型没有调用记录。</div>}
                {page && page.total > page.limit && (
                    <div className="flex items-center justify-between pt-1">
                        <span>{page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} / {page.total}</span>
                        <div className="flex gap-2">
                            <button type="button" disabled={page.offset === 0 || loadingUsageKey === detailKey} onClick={() => void loadKeyUsage(channelId, range, capability, Math.max(0, page.offset - page.limit), start, end)} className="rounded bg-input px-2 py-1 disabled:opacity-40">上一页</button>
                            <button type="button" disabled={page.offset + page.limit >= page.total || loadingUsageKey === detailKey} onClick={() => void loadKeyUsage(channelId, range, capability, page.offset + page.limit, start, end)} className="rounded bg-input px-2 py-1 disabled:opacity-40">下一页</button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    useEffect(() => {
        fetchKeyStats();
        fetchKeyHistoryRange("d7");
        const t = setInterval(fetchKeyStats, 3000);
        const t2 = setInterval(() => {
            Object.keys(keyHistoryByRange).forEach(rk => { void fetchKeyHistoryRange(rk); });
        }, 15000);
        return () => { clearInterval(t); clearInterval(t2); };
    }, [token]);

    useEffect(() => {
        const need = new Set<string>();
        for (const id of Object.keys(rangeByKey)) {
            const rk = rangeKeyFor(Number(id));
            if (rk) need.add(rk);
        }
        need.forEach(rk => { if (!keyHistoryByRange[rk]) void fetchKeyHistoryRange(rk); });
    }, [rangeByKey, customByKey, keys]);

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

        // 内置供应商模式：自动带地址和 Key，模型用勾选的
        if (!editId && addMode === "builtin") {
            if (!builtinName.trim()) {
                message.error("请填写名称");
                return;
            }
            if (builtinSelectedModels.length === 0) {
                message.error("请至少勾选一个模型");
                return;
            }
            if (!maiziConfigDraft.baseUrl || !maiziConfigDraft.apiKey) {
                message.error("请先到「内置供应商」页配置 MaiziAI 的地址和 Key");
                return;
            }
            const payload = {
                name: builtinName.trim(),
                provider: "openai",
                base_url: maiziConfigDraft.baseUrl,
                api_key: maiziConfigDraft.apiKey,
                model: builtinSelectedModels.join(","),
                max_concurrency: keyMaxConcurrency,
            };
            try {
                const res = await fetch(`${API}/api/admin/api-keys`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify(payload),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    message.error(t("pages.admin.dashboard.saveFailed") + (data.error || `HTTP ${res.status}`));
                    return;
                }
                message.success(`已创建内置供应商渠道，包含 ${builtinSelectedModels.length} 个模型`);
                setShowAdd(false);
                setBuiltinSelectedModels([]);
                setBuiltinName("MaiziAI 中转站");
                fetchKeys();
            } catch (err: any) {
                message.error(t("pages.admin.dashboard.saveFailed") + (err.message || err));
            }
            return;
        }

        const modelStr = selectedModels.length > 0 ? selectedModels.join(",") : form.model;
        const payload = { ...form, model: modelStr };

        // 新增模式：前端先校验必填项，字段级报错
        if (!editId) {
            const errs = { name: "", base_url: "", api_key: "" };
            if (!payload.name) errs.name = t("pages.admin.dashboard.nameRequired");
            if (!payload.base_url) errs.base_url = t("pages.admin.dashboard.apiUrlRequired");
            if (!payload.api_key) errs.api_key = t("pages.admin.dashboard.apiKeyRequired");
            if (errs.name || errs.base_url || errs.api_key) {
                setFormErrors(errs);
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
            message.success(editId ? t("pages.admin.dashboard.saveSuccess") : t("pages.admin.dashboard.createSuccess"));
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
            if (!form.api_key && !editId) {
                message.error(t("pages.admin.dashboard.apiKeyFirst"));
                return;
            }
            // 已保存渠道由服务端使用密钥拉取；新渠道需先保存后再拉取模型。
        if (!editId) {
            message.error(t("pages.admin.dashboard.saveFirstToPull"));
            return;
        }
        const res = await fetch(`${API}/api/admin/fetch-models`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id: editId }),
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
            const res = await fetch(`${API}/api/admin/api-keys/${id}/test`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
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

    const validatePw = (pw: string): string => {
        if (pw.length < 8) return t("pages.admin.dashboard.pwMin");
        if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return t("pages.admin.dashboard.pwNeedLetterAndDigit");
        return "";
    };
    const handlePwOldChange = (v: string) => {
        setPwForm({ ...pwForm, oldPassword: v });
        if (pwOldError) setPwOldError("");
    };
    const handlePwNewChange = (v: string) => {
        setPwForm({ ...pwForm, newPassword: v });
        if (pwNewError) setPwNewError("");
        if (pwForm.confirmPassword) {
            setPwConfirmError(v !== pwForm.confirmPassword ? t("pages.admin.dashboard.pwMismatch") : "");
        }
    };
    const handlePwConfirmChange = (v: string) => {
        setPwForm({ ...pwForm, confirmPassword: v });
        if (!v) { setPwConfirmError(""); return; }
        setPwConfirmError(v !== pwForm.newPassword ? t("pages.admin.dashboard.pwMismatch") : "");
    };
    const handleChangePw = async (e: React.FormEvent) => {
        e.preventDefault();
        setPwError("");
        setPwSuccess(false);
        let firstError: "old" | "new" | "confirm" | null = null;
        if (!pwForm.oldPassword) { setPwOldError(t("pages.admin.dashboard.pwOldRequired")); firstError = "old"; }
        const newErr = validatePw(pwForm.newPassword);
        if (newErr) { setPwNewError(newErr); if (!firstError) firstError = "new"; }
        if (pwForm.newPassword && pwForm.confirmPassword !== pwForm.newPassword) {
            setPwConfirmError(t("pages.admin.dashboard.pwMismatch"));
            if (!firstError) firstError = "confirm";
        }
        if (firstError) {
            if (firstError === "old") pwOldRef.current?.focus();
            else if (firstError === "new") pwNewRef.current?.focus();
            else pwConfirmRef.current?.focus();
            return;
        }
        try {
            const res = await fetch(`${API}/api/admin/change-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ oldPassword: pwForm.oldPassword, newPassword: pwForm.newPassword, confirmPassword: pwForm.confirmPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            setPwSuccess(true);
            setPwForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
            setPwOldError(""); setPwNewError(""); setPwConfirmError("");
            setTimeout(() => setShowChangePw(false), 2000);
        } catch (err: any) {
            if (err && err.message && err.message.indexOf("原密码") !== -1) {
                setPwOldError(err.message);
            } else {
                setPwError(err.message);
            }
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
                    <button onClick={() => setActiveTab("supplier")}
                        className={`rounded-md px-4 py-1.5 text-sm transition-colors ${activeTab === "supplier" ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                        内置供应商
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
                ) : activeTab === "supplier" ? (<>
                {/* MaiziAI 上游中转站配置 */}
                <div className="mb-6 space-y-4">
                    <div className="rounded-xl bg-card p-5 space-y-4">
                        <div className="text-sm font-medium text-white">MaiziAI 上游中转站配置</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Base URL</label>
                                <input type="text" value={maiziConfigDraft.baseUrl} onChange={e => setMaiziConfigDraft({ ...maiziConfigDraft, baseUrl: e.target.value })} className="w-full rounded-lg bg-secondary px-3 py-2 text-white text-sm outline-none focus:ring-1 focus:ring-accent" />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">API Key (sk-...)</label>
                                <input type="password" value={maiziConfigDraft.apiKey} onChange={e => setMaiziConfigDraft({ ...maiziConfigDraft, apiKey: e.target.value })} placeholder="sk-..." className="w-full rounded-lg bg-secondary px-3 py-2 text-white text-sm outline-none focus:ring-1 focus:ring-accent" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs text-gray-500 mb-1">余额 Token (bt-mz-...)</label>
                                <input type="password" value={maiziConfigDraft.balanceToken} onChange={e => setMaiziConfigDraft({ ...maiziConfigDraft, balanceToken: e.target.value })} placeholder="控制台「个人中心」生成" className="w-full rounded-lg bg-secondary px-3 py-2 text-white text-sm outline-none focus:ring-1 focus:ring-accent" />
                            </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={saveMaiziConfig} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5051F8] text-white text-sm hover:bg-accent-hover">
                                <Save size={14} /> 保存配置
                            </button>
                            <button onClick={queryMaiziBalance} disabled={maiziLoading} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-white text-sm hover:bg-secondary/80 disabled:opacity-50">
                                <RefreshCw size={14} className={maiziLoading ? "animate-spin" : ""} />
                                {maiziLoading ? "查询中..." : "查询余额"}
                            </button>
                            <button onClick={queryMaiziModels} disabled={maiziModelsLoading} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-white text-sm hover:bg-secondary/80 disabled:opacity-50">
                                <RefreshCw size={14} className={maiziModelsLoading ? "animate-spin" : ""} />
                                {maiziModelsLoading ? "加载中..." : "查询模型价格"}
                            </button>
                            <button onClick={queryMaiziAnnouncements} disabled={maiziAnnouncementsLoading} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-white text-sm hover:bg-secondary/80 disabled:opacity-50">
                                <RefreshCw size={14} className={maiziAnnouncementsLoading ? "animate-spin" : ""} />
                                {maiziAnnouncementsLoading ? "加载中..." : "查看公告"}
                            </button>

                        </div>
                    </div>

                    {(maiziBalance || maiziKeyLimits) && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="rounded-xl bg-card p-5">
                                <div className="text-sm font-medium text-white mb-4">账号余额</div>
                                {maiziBalance?.error ? (
                                    <div className="text-sm text-red-400">{maiziBalance.error}</div>
                                ) : maiziBalance ? (
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-500">可用充值余额</span>
                                            <span className="text-xl font-bold text-white">${maiziBalance.balance?.toFixed(2) || "0.00"}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-500">奖励余额</span>
                                            <span className="text-base text-green-400">${maiziBalance.bonus_balance?.toFixed(2) || "0.00"}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-500">冻结余额</span>
                                            <span className="text-base text-amber-400">${maiziBalance.frozen_balance?.toFixed(2) || "0.00"}</span>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                            <div className="rounded-xl bg-card p-5">
                                <div className="text-sm font-medium text-white mb-4">API Key 限额</div>
                                {maiziKeyLimits?.error ? (
                                    <div className="text-sm text-red-400">{maiziKeyLimits.error}</div>
                                ) : maiziKeyLimits ? (
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-500">消费限额</span>
                                            <span className="text-base text-white">{maiziKeyLimits.unlimited ? "无限制" : maiziKeyLimits.spend_limit ? "$" + maiziKeyLimits.spend_limit.toFixed(2) : "未设置"}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-500">已消费</span>
                                            <span className="text-base text-white">${maiziKeyLimits.spent_amount?.toFixed(2) || "0.00"}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-500">剩余额度</span>
                                            <span className="text-xl font-bold text-accent">
                                                {maiziKeyLimits.unlimited ? "∞" : maiziKeyLimits.remaining_amount != null ? "$" + maiziKeyLimits.remaining_amount.toFixed(2) : "-"}
                                            </span>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {maiziModels.length > 0 && (
                        <div className="rounded-xl bg-card overflow-hidden">
                            <div className="px-5 py-3 text-sm font-medium text-white bg-secondary">中转站模型价格表</div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-secondary/50">
                                        <tr>
                                            <th className="text-left px-5 py-2.5 text-gray-500 font-normal">模型名称</th>
                                            <th className="text-left px-5 py-2.5 text-gray-500 font-normal">类型</th>
                                            <th className="text-right px-5 py-2.5 text-gray-500 font-normal">价格</th>
                                            <th className="text-left px-5 py-2.5 text-gray-500 font-normal">特性</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(() => {
                                            const grouped: Record<string, any[]> = {};
                                            maiziModels.forEach(m => {
                                                const b = brandOf(m.id);
                                                (grouped[b] = grouped[b] || []).push(m);
                                            });
                                            const keys = Object.keys(grouped).sort((a, b) => brandOrder.indexOf(a) - brandOrder.indexOf(b));
                                            return keys.flatMap(b => [
                                                <tr key={b} className="bg-secondary/40">
                                                    <td colSpan={4} className="px-5 py-2 text-xs font-semibold text-gray-400">{b} · {grouped[b].length}</td>
                                                </tr>,
                                                ...grouped[b].map((m: any) => (
                                                    <tr key={m.id} className="border-t border-border/50">
                                                        <td className="px-5 py-3 text-white">{m.display_name || m.id}</td>
                                                        <td className="px-5 py-3 text-gray-500">
                                                            <span className="px-2 py-0.5 rounded text-xs bg-secondary">{m.type}</span>
                                                        </td>
                                                        <td className="px-5 py-3 text-right text-white font-mono">${typeof m.pricing === "number" ? m.pricing.toFixed(4) : (typeof m.pricing === "string" ? m.pricing : "-")}</td>
                                                        <td className="px-5 py-3 text-gray-500 text-xs">
                                                            {(m.features || []).slice(0, 3).join("、")}
                                                        </td>
                                                    </tr>
                                                ))
                                            ]);
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {maiziAnnouncements.length > 0 && (
                        <div className="space-y-3">
                            <div className="text-sm font-medium text-white">中转站公告</div>
                            {maiziAnnouncements.map((a: any) => (
                                <div key={a.id} className="rounded-xl bg-card p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        {a.pinned && <span className="px-1.5 py-0.5 rounded text-xs bg-red-500/10 text-red-400">置顶</span>}
                                        <span className="text-sm font-medium text-white">{a.title}</span>
                                        <span className="text-xs text-gray-500 ml-auto">{new Date(a.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <div className="text-sm text-gray-400 whitespace-pre-wrap">{a.content}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                </>
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
                                <PasswordInput value={pwForm.oldPassword} onChange={handlePwOldChange} error={!!pwOldError} inputRef={pwOldRef} />
                                {pwOldError && <p className="mt-1 text-xs text-red-400">{pwOldError}</p>}
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.newPw")}</label>
                                <PasswordInput value={pwForm.newPassword} onChange={handlePwNewChange} error={!!pwNewError} inputRef={pwNewRef} />
                                {pwNewError && <p className="mt-1 text-xs text-red-400">{pwNewError}</p>}
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.confirmPw")}</label>
                                <PasswordInput value={pwForm.confirmPassword} onChange={handlePwConfirmChange} error={!!pwConfirmError} inputRef={pwConfirmRef} />
                                {pwConfirmError ? <p className="mt-1 text-xs text-red-400">{pwConfirmError}</p> : (pwForm.newPassword && pwForm.confirmPassword === pwForm.newPassword) ? <p className="mt-1 text-xs text-green-400">{t("pages.admin.dashboard.pwMatch")}</p> : null}
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
                    <button onClick={() => { setAddMode("manual"); setBuiltinSelectedModels([]); setShowAdd(!showAdd); }} className="rounded-lg bg-[#5051F8] px-4 py-2 text-white hover:bg-accent-hover">
                        {t("pages.admin.dashboard.addBtn")}
                    </button>
                </div>

                {showAdd && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
                        <form onSubmit={handleAdd} className="relative w-full max-w-2xl rounded-2xl bg-card p-6 max-h-[85vh] overflow-y-auto thin-scrollbar">
                        <h2 className="mb-4 text-lg font-semibold text-white">{editId ? t("pages.admin.dashboard.editTitle") : t("pages.admin.dashboard.newTitle")}</h2>
                        <button type="button" onClick={() => setShowAdd(false)} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-lg text-gray-500 hover:bg-border hover:text-white">×</button>
                        {!editId && (
                            <div className="mb-4 flex gap-1 rounded-lg bg-secondary p-1 w-fit">
                                <button type="button" onClick={() => setAddMode("manual")}
                                    className={`rounded-md px-3 py-1 text-xs transition-colors ${addMode === "manual" ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                                    手动添加
                                </button>
                                <button type="button" onClick={() => { setAddMode("builtin"); if (maiziModels.length === 0) queryMaiziModels(); }}
                                    className={`rounded-md px-3 py-1 text-xs transition-colors ${addMode === "builtin" ? "bg-[#5051F8] text-white" : "text-gray-500 hover:text-gray-300"}`}>
                                    内置供应商
                                </button>
                            </div>
                        )}
                        {editId || addMode === "manual" ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.name")}</label>
                                <input value={form.name} onChange={e => { setForm({...form, name: e.target.value}); if (formErrors.name) setFormErrors({...formErrors, name: ""}); }}
                                    className={`w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none ${formErrors.name ? "ring-1 ring-red-500" : "focus:ring-1 focus:ring-accent"}`} placeholder={t("pages.admin.dashboard.namePh")} />
                                {formErrors.name && <p className="mt-1 text-xs text-red-400">{formErrors.name}</p>}
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
                                <input value={form.base_url} onChange={e => { setForm({...form, base_url: e.target.value}); if (formErrors.base_url) setFormErrors({...formErrors, base_url: ""}); }}
                                    className={`w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none ${formErrors.base_url ? "ring-1 ring-red-500" : "focus:ring-1 focus:ring-accent"}`} placeholder="https://api.openai.com/v1" />
                                {formErrors.base_url && <p className="mt-1 text-xs text-red-400">{formErrors.base_url}</p>}
                            </div>
                            <div className="col-span-2">
                                <label className="mb-1 block text-sm text-gray-500">{t("pages.admin.dashboard.apiKey")}{editId && t("pages.admin.dashboard.apiKeyEdit")}</label>
                                <PasswordInput value={form.api_key} onChange={v => { setForm({...form, api_key: v}); if (formErrors.api_key) setFormErrors({...formErrors, api_key: ""}); }}
                                    error={!!formErrors.api_key} placeholder={editId ? t("pages.admin.dashboard.apiKeyEdit") : "sk-..."} />
                                {formErrors.api_key && <p className="mt-1 text-xs text-red-400">{formErrors.api_key}</p>}
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
                                                                                        <div key={m} className={`group/row flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${sel ? "bg-[#5051F8]/15" : "bg-secondary hover:bg-surface-hover"}`}>
                                                                                            {rowLogo}
                                                                                            <span className={`truncate text-sm ${sel ? "text-white" : "text-gray-300"}`}>{prettyModel(m)}</span>
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
                        ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm text-gray-500">渠道名称</label>
                                <input value={builtinName} onChange={e => setBuiltinName(e.target.value)}
                                    className="w-full rounded-lg bg-secondary px-3 py-2 text-white outline-none" placeholder="MaiziAI 中转站" />
                            </div>
                            <div className="rounded-lg bg-secondary p-3 text-sm text-gray-500 space-y-1">
                                <div>供应商：MaiziAI（地址和 Key 自动从「内置供应商」页带入）</div>
                                <div>地址：{maiziConfigDraft.baseUrl || "未配置"}</div>
                            </div>
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <label className="text-sm text-gray-500">选择模型（已选 {builtinSelectedModels.length} 个）</label>
                                    <button type="button" onClick={() => {
                                        if (builtinSelectedModels.length === maiziModels.length && maiziModels.length > 0) setBuiltinSelectedModels([]);
                                        else setBuiltinSelectedModels(maiziModels.map((m: any) => m.id));
                                    }} className="text-xs text-accent">
                                        {builtinSelectedModels.length === maiziModels.length && maiziModels.length > 0 ? "全不选" : "全选"}
                                    </button>
                                </div>
                                <div className="max-h-64 overflow-y-auto thin-scrollbar space-y-1 rounded-lg bg-secondary p-2">
                                    {maiziModelsLoading && <div className="p-3 text-sm text-gray-500">正在加载模型列表...</div>}
                                    {!maiziModelsLoading && maiziModels.length === 0 && (
                                        <div className="p-3 text-sm text-gray-500">未加载到模型，请先到「内置供应商」页点"查询模型价格"</div>
                                    )}
                                    {maiziModels.map((m: any) => {
                                        const sel = builtinSelectedModels.includes(m.id);
                                        return (
                                            <label key={m.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-border cursor-pointer">
                                                <input type="checkbox" checked={sel} onChange={() => {
                                                    setBuiltinSelectedModels(prev => sel ? prev.filter(x => x !== m.id) : [...prev, m.id]);
                                                }} className="accent-[#5051F8]" />
                                                <span className="text-sm text-white flex-1">{m.display_name || m.id}</span>
                                                <span className="text-xs text-gray-500">${typeof m.pricing === "number" ? m.pricing.toFixed(4) : (typeof m.pricing === "string" ? m.pricing : "-")}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        )}
                        <div className="mt-4 flex items-center gap-2">
                            {(editId || addMode === "manual") && (
                            <button type="button" onClick={async () => {
                                await fetchModels();
                                setCapTab("全部");
                                setShowModelsModal(true);
                            }} disabled={loadingModels}
                                className="rounded-lg bg-secondary px-4 py-2 text-sm text-gray-600 hover:bg-border disabled:opacity-50">
                                {loadingModels ? t("pages.admin.dashboard.pulling") : t("pages.admin.dashboard.pullModels")}
                            </button>
                            )}
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
                                                        const curRange = rangeByKey[k.id] || "d7";
                                                        const rk = rangeKeyFor(k.id);
                                                        const h = rk ? keyHistoryByRange[rk]?.[k.id] : null;
                                                        const custom = customByKey[k.id];
                                                        const s = custom?.start || "";
                                                        const e = custom?.end || "";
                                                        const fmtCalls = (n: number) => n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
                                                        const pct = (v: number | null) => v == null ? "—" : v + "%";
                                                        const rateCls = (v: number | null) =>
                                                            v == null ? "text-gray-500" : v >= 90 ? "text-emerald-300" : v >= 60 ? "text-amber-300" : "text-red-300";
                                                        const failCls = (n: number) => n > 0 ? "text-red-300" : "text-emerald-300";
                                                        const CAPS = ["图片", "文本", "视频"];
                                                        const RANGE_BUTTONS: Array<{ key: HistoryRange; label: string }> = [
                                                            { key: "all", label: t("pages.admin.dashboard.rangeAll") },
                                                            { key: "d1", label: t("pages.admin.dashboard.rangeD1") },
                                                            { key: "d3", label: t("pages.admin.dashboard.rangeD3") },
                                                            { key: "d7", label: t("pages.admin.dashboard.rangeD7") },
                                                            { key: "d30", label: t("pages.admin.dashboard.rangeD30") },
                                                            { key: "d90", label: t("pages.admin.dashboard.rangeD90") },
                                                            { key: "d365", label: t("pages.admin.dashboard.rangeD365") },
                                                            { key: "custom", label: t("pages.admin.dashboard.rangeCustom") },
                                                        ];
                                                        return (
                                                            <div className="space-y-1.5 border-t border-border pt-2">
                                                                <div className="flex flex-wrap items-center gap-1">
                                                                    {RANGE_BUTTONS.map(rg => (
                                                                        <button key={rg.key} type="button"
                                                                            onClick={() => setRangeByKey(p => ({ ...p, [k.id]: rg.key }))}
                                                                            className={`rounded px-2 py-0.5 text-xs ${curRange === rg.key ? "bg-[#5051F8] text-white" : "bg-secondary text-gray-400 hover:text-gray-200"}`}>
                                                                            {rg.label}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                                {curRange === "custom" && (
                                                                    <div className="flex flex-wrap items-center gap-2 pl-1 text-xs text-gray-400">
                                                                        <input type="date" value={s}
                                                                            onChange={ev => setCustomByKey(p => ({ ...p, [k.id]: { start: ev.target.value, end: p[k.id]?.end || "" } }))}
                                                                            className="rounded bg-secondary px-2 py-0.5 text-gray-200" />
                                                                        <span>—</span>
                                                                        <input type="date" value={e}
                                                                            onChange={ev => setCustomByKey(p => ({ ...p, [k.id]: { start: p[k.id]?.start || "", end: ev.target.value } }))}
                                                                            className="rounded bg-secondary px-2 py-0.5 text-gray-200" />
                                                                    </div>
                                                                )}
                                                                {!h ? (
                                                                    <div className="pl-1 text-xs text-gray-500">{t("pages.admin.dashboard.loading")}</div>
                                                                ) : (
                                                                    <>
                                                                        {h._all && h._all.calls > 0 && (
                                                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-1 text-xs">
                                                                                <span className="text-gray-500">{t("pages.admin.dashboard.calls")} <span className="text-gray-200">{fmtCalls(h._all.calls)}</span></span>
                                                                                <span className="text-gray-500">{t("pages.admin.dashboard.success")} <span className="text-emerald-300">{h._all.successes}</span></span>
                                                                                <span className="text-gray-500">{t("pages.admin.dashboard.fail")} <span className={failCls(h._all.failures)}>{h._all.failures}</span></span>
                                                                                <span className="text-gray-500">{t("pages.admin.dashboard.inFlight")} <span className="text-amber-300">{h._all.inFlight}</span></span>
                                                                                <span className="text-gray-500">{t("pages.admin.dashboard.released")} <span>{h._all.released}</span></span>
                                                                                <span className="text-gray-500">{t("pages.admin.dashboard.unknown")} <span className="text-amber-300">{h._all.unknown}</span></span>
                                                                                <button type="button" onClick={() => toggleKeyUsage(k.id, curRange, "全部", s, e)} className="rounded bg-secondary px-2 py-0.5 text-gray-300 hover:text-white">{t("pages.admin.dashboard.detail")}</button>
                                                                                {renderKeyUsageDetails(k.id, curRange, "全部", s, e)}
                                                                            </div>
                                                                        )}
                                                                        {CAPS.filter(c => (h[c]?.calls || 0) > 0).map(c => {
                                                                            const m = h[c];
                                                                            return (
                                                                                <div key={c} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-2 text-xs">
                                                                                    <span className="w-8 shrink-0 text-gray-500">{c}</span>
                                                                                    <span className="text-gray-500">{t("pages.admin.dashboard.calls")} <span className="text-gray-200">{fmtCalls(m.calls)}</span></span>
                                                                                    <span className="text-gray-500">{t("pages.admin.dashboard.success")} <span className="text-emerald-300">{m.successes}</span></span>
                                                                                    <span className="text-gray-500">{t("pages.admin.dashboard.fail")} <span className={failCls(m.failures)}>{m.failures}</span></span>
                                                                                    <span className="text-gray-500">{t("pages.admin.dashboard.successRate")} <span className={rateCls(m.successRate)}>{pct(m.successRate)}</span></span>
                                                                                    <span className="text-gray-500">{t("pages.admin.dashboard.failRate")} <span className={rateCls(m.failRate)}>{pct(m.failRate)}</span></span>
                                                                                    <span className="text-gray-500">{t("pages.admin.dashboard.connRate")} <span className={rateCls(m.connRate)}>{pct(m.connRate)}</span></span>
                                                                                    {m.avgLatencyMs != null && <span className="text-gray-500">{t("pages.admin.dashboard.avgLatency")} <span className="text-gray-200">{m.avgLatencyMs}ms</span></span>}
                                                                                    <button type="button" onClick={() => toggleKeyUsage(k.id, curRange, c, s, e)} className="rounded bg-secondary px-2 py-0.5 text-gray-300 hover:text-white">{t("pages.admin.dashboard.detail")}</button>
                                                                                    {renderKeyUsageDetails(k.id, curRange, c, s, e)}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {(!h._all || h._all.calls === 0) && (
                                                                            <div className="pl-1 text-xs text-gray-500">{t("pages.admin.dashboard.noUsageInRange")}</div>
                                                                        )}
                                                                    </>
                                                                )}
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
                                                                                                    const hh = keyHistoryByRange[rangeKeyFor(k.id) || "d7"]?.[k.id];
                                                                                                    const d7m = hh?.models?.[m];
                                                                                                    const d30m = null;
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

                {maiziConfirm.open && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMaiziConfirm({ open: false, message: "", onConfirm: null })}>
                        <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={e => e.stopPropagation()}>
                            <div className="text-sm text-white mb-6 whitespace-pre-line">{maiziConfirm.message}</div>
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setMaiziConfirm({ open: false, message: "", onConfirm: null })} className="px-4 py-2 rounded-lg bg-secondary text-white text-sm hover:bg-secondary/80">
                                    取消
                                </button>
                                <button onClick={handleMaiziConfirmOk} className="px-4 py-2 rounded-lg bg-[#5051F8] text-white text-sm hover:bg-accent-hover">
                                    确认
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
