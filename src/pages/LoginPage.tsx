import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/useAuthStore";

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const navigate = useNavigate();
    const { login, register, isLoading } = useAuthStore();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        // 前端校验
        if (!email.trim() || !password.trim()) {
            setError("请填写邮箱和密码");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setError("邮箱格式不正确");
            return;
        }
        if (password.length < 6) {
            setError("密码至少 6 位");
            return;
        }

        try {
            if (isLogin) {
                await login(email, password);
            } else {
                if (!name.trim()) {
                    setError("请填写昵称");
                    return;
                }
                await register(name, email, password);
            }
            navigate("/");
        } catch (err: any) {
            // Appwrite 错误信息
            const msg = err?.message || err?.toString() || "操作失败，请重试";
            setError(msg);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-card">
            <div className="w-full max-w-sm p-8 rounded-2xl bg-card border border-border">
                <h1 className="text-2xl font-bold text-white mb-6 text-center">
                    {isLogin ? "登录" : "注册"}
                </h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {!isLogin && (
                        <input
                            type="text"
                            placeholder="昵称"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-3 rounded-lg bg-secondary text-white border border-border focus:border-accent outline-none"
                        />
                    )}
                    <input
                        type="email"
                        placeholder="邮箱"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg bg-secondary text-white border border-border focus:border-accent outline-none"
                    />
                    <input
                        type="password"
                        placeholder="密码（至少6位）"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg bg-secondary text-white border border-border focus:border-accent outline-none"
                    />
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-3 rounded-lg bg-[#5051F8] text-white font-medium hover:bg-accent-hover disabled:opacity-50"
                    >
                        {isLoading ? "加载中..." : isLogin ? "登录" : "注册"}
                    </button>
                </form>
                <p className="mt-4 text-center text-gray-500 text-sm">
                    {isLogin ? "还没有账号？" : "已有账号？"}
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className="text-accent ml-1"
                    >
                        {isLogin ? "注册" : "登录"}
                    </button>
                </p>
            </div>
        </div>
    );
}