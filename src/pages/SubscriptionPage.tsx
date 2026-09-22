import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";

const PLANS = [
    { id: "free", name: "免费版", price: 0, features: ["10 次/月生成", "3 个画布", "基础功能"] },
    { id: "pro", name: "Pro", price: 29, features: ["500 次/月生成", "50 个画布", "高级功能", "优先支持"] },
    { id: "team", name: "团队版", price: 99, features: ["无限生成", "无限画布", "团队协作", "专属支持"] },
];

export default function SubscriptionPage() {
    const navigate = useNavigate();
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState("");

    useEffect(() => {
        const u = localStorage.getItem("user");
        if (u) setUser(JSON.parse(u));
    }, []);

    const subscribe = async (plan: string) => {
        setLoading(plan);
        const token = localStorage.getItem("token");

        // 60秒超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        try {
            const res = await fetch("/api/billing/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ plan }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            // 401未登录，跳登录页
            if (res.status === 401) {
                localStorage.removeItem("token");
                localStorage.removeItem("user");
                alert("登录已过期，请重新登录");
                navigate("/login");
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                const msg = typeof data.error === 'string' ? data.error : (data.error?.message || '订阅失败');
                throw new Error(msg);
            }
            alert(`已订阅：${PLANS.find(p => p.id === plan)?.name}`);
        } catch (e: any) {
            if (e.name === 'AbortError') {
                alert("请求超时，请检查网络");
            } else if (e.message === 'Failed to fetch') {
                alert("网络连接失败，请检查网络");
            } else {
                alert(e.message);
            }
        } finally {
            clearTimeout(timeoutId);
            setLoading("");
        }
    };

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold text-white mb-8">订阅套餐</h1>
            <div className="grid grid-cols-3 gap-6 max-w-4xl">
                {PLANS.map((plan) => (
                    <div key={plan.id} className={`p-6 rounded-2xl border ${user?.plan === plan.id ? "border-[#5051F8] bg-[#ffffff]" : "border-[#e2e2e8] bg-[#ffffff]"}`}>
                        <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                        <p className="text-3xl font-bold text-white mt-2">
                            ¥{plan.price}<span className="text-sm text-gray-500">/月</span>
                        </p>
                        <ul className="mt-4 space-y-2">
                            {plan.features.map((f) => (
                                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                                    <Check size={16} className="text-[#5051F8]" />
                                    {f}
                                </li>
                            ))}
                        </ul>
                        {user?.plan === plan.id ? (
                            <button disabled className="mt-6 w-full py-2 rounded-lg bg-[#e5e5ea] text-gray-500">当前套餐</button>
                        ) : (
                            <button
                                onClick={() => subscribe(plan.id)}
                                disabled={!!loading}
                                className="mt-6 w-full py-2 rounded-lg bg-[#5051F8] text-white hover:bg-[#3f40e6] disabled:opacity-50"
                            >
                                {loading === plan.id ? "处理中..." : "订阅"}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}