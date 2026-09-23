import { useState } from "react";
import { useTranslation } from 'react-i18next'
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/useAuthStore";

export default function LoginPage() {
  const { t } = useTranslation()
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
            setError(t("pages.authPage.fillBoth"));
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setError(t("pages.authPage.emailInvalid"));
            return;
        }
        if (password.length < 6) {
            setError(t("pages.authPage.pwdMin"));
            return;
        }

        try {
            if (isLogin) {
                await login(email, password);
            } else {
                if (!name.trim()) {
                    setError(t("pages.authPage.fillNick"));
                    return;
                }
                await register(name, email, password);
            }
            navigate("/");
        } catch (err: any) {
            // Appwrite 错误信息
            const msg = err?.message || err?.toString() || t("pages.authPage.opFailed");
            setError(msg);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-card">
            <div className="w-full max-w-sm p-8 rounded-2xl bg-card border border-border">
                <h1 className="text-2xl font-bold text-white mb-6 text-center">
                    {isLogin ? t("pages.authPage.login") : t("pages.authPage.register")}
                </h1>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {!isLogin && (
                        <input
                            type="text"
                            placeholder={t("pages.authPage.nickname")}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-3 rounded-lg bg-secondary text-white border border-border focus:border-accent outline-none"
                        />
                    )}
                    <input
                        type="email"
                        placeholder={t("pages.authPage.email")}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg bg-secondary text-white border border-border focus:border-accent outline-none"
                    />
                    <input
                        type="password"
                        placeholder={t("pages.authPage.password")}
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
                        {isLoading ? t("pages.authPage.loading") : isLogin ? t("pages.authPage.login") : t("pages.authPage.register")}
                    </button>
                </form>
                <p className="mt-4 text-center text-gray-500 text-sm">
                    {isLogin ? t("pages.authPage.noAccount") : t("pages.authPage.hasAccount")}
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className="text-accent ml-1"
                    >
                        {isLogin ? t("pages.authPage.register") : t("pages.authPage.login")}
                    </button>
                </p>
            </div>
        </div>
    );
}