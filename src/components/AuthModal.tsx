import { useState } from "react";
import { useTranslation } from "react-i18next";
import PolicyModal from "./PolicyModal"
import { QingyuLogoIcon } from "./layout/SidebarIcons";
import { useAuthStore } from "@/stores/useAuthStore";
import { AppwriteException } from "appwrite";

export default function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [step, setStep] = useState<"email" | "password">("email");
    const [showForgot, setShowForgot] = useState(false);
    const [forgotEmail, setForgotEmail] = useState("");
    const [forgotSent, setForgotSent] = useState(false);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [showPolicy, setShowPolicy] = useState<"terms" | "privacy" | null>(null);

    const { login, register, isLoading, forgotPassword } = useAuthStore();

    const validateEmail = () => {
        if (!email.trim()) { setError("请输入邮箱"); return false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("邮箱格式不正确"); return false; }
        return true;
    };

    const validatePassword = () => {
        if (!password.trim()) { setError("请输入密码"); return false; }
        if (password.length < 6) { setError("密码至少 6 位"); return false; }
        return true;
    };

    const validateName = () => {
        if (!name.trim()) { setError("请输入昵称"); return false; }
        return true;
    };

    const switchMode = (m: 'login' | 'register') => {
        setMode(m);
        setStep("email");
        setError("");
        setPassword("");
        setShowForgot(false);
        setForgotSent(false);
    };

    const handleForgotSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        if (!forgotEmail.trim()) { setError("请输入邮箱"); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) { setError("邮箱格式不正确"); return; }
        try {
            await forgotPassword(forgotEmail);
            setForgotSent(true);
        } catch (err: any) {
            if (err instanceof AppwriteException) {
                setError(err.message || "发送失败");
            } else {
                setError("发送失败，请稍后重试");
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        // 注册模式先验证昵称
        if (mode === 'register' && step === 'email') {
            if (!validateName()) return;
        }

        // 第一步：验证邮箱
        if (step === "email") {
            if (!validateEmail()) return;
            setStep("password");
            return;
        }

        // 第二步：验证密码并提交
        if (!validatePassword()) return;

        try {
            if (mode === 'login') {
                await login(email, password);
            } else {
                await register(name, email, password);
            }
            onSuccess();
            onClose();
        } catch (err: any) {
            if (err instanceof AppwriteException) {
                setError(err.message || "操作失败");
            } else {
                setError("操作失败，请稍后重试");
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
            <div
                className="relative w-full max-w-4xl rounded-[24px] bg-card shadow-2xl flex overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 左侧品牌图区域（后续替换为实际图片） */}
                <div className="hidden md:flex w-[44%] relative bg-gradient-to-br from-accent via-accent to-accent-hover flex-col items-center justify-center p-10 text-white">
                    <QingyuLogoIcon className="w-16 h-16 text-white" />
                    <h3 className="mt-6 text-2xl font-bold">{t('brand.name')}</h3>
                    <p className="mt-2 text-center text-white/80 text-sm leading-relaxed">
                        在这里放置品牌介绍图
                    </p>
                </div>

                {/* 右侧表单 */}
                <div className="relative flex-1 p-8 md:p-10 flex flex-col min-w-0">
                {/* 关闭按钮 */}
                <button onClick={onClose} className="absolute right-6 top-6 text-gray-500 hover:text-gray-600">
                    ✕
                </button>

                {/* 标题 */}
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-center text-text">
                        {t('brand.welcome')}
                    </h2>
                    <p className="text-center text-gray-500 mt-2">
                        {mode === 'login' ? '登录或注册以继续' : '创建新账号'}
                    </p>
                </div>

                {/* 第三方登录按钮 */}
                <div className="flex flex-col gap-3 mb-6">
                    <button
                        onClick={() => setError("第三方登录暂未开通，请使用邮箱登录")}
                        className="w-full flex items-center justify-center gap-3 py-3 rounded-[12px] bg-card border border-border hover:bg-surface-hover transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        <span className="text-text font-medium">使用 Google</span>
                    </button>

                    <button
                        onClick={() => setError("第三方登录暂未开通，请使用邮箱登录")}
                        className="w-full flex items-center justify-center gap-3 py-3 rounded-[12px] bg-card border border-border hover:bg-surface-hover transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8.98-.2 1.92-.88 3.23-.81 1.56.13 2.73.74 3.51 1.86-3.12 1.87-2.48 5.97.19 7.12-.57 1.5-1.31 2.99-3.01 4.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                        </svg>
                        <span className="text-text font-medium">使用 Apple</span>
                    </button>
                </div>

                {/* 分隔线 */}
                <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-4 bg-card text-gray-500">或</span>
                    </div>
                </div>

                {/* 找回密码表单 */}
                {showForgot ? (
                    <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4">
                        <h3 className="text-lg font-semibold text-text text-center">找回密码</h3>
                        {forgotSent ? (
                            <div className="text-center py-4">
                                <p className="text-green-400 mb-2">重置邮件已发送</p>
                                <p className="text-gray-500 text-sm">请查收邮箱并点击链接重置密码</p>
                                <button
                                    type="button"
                                    onClick={() => { setShowForgot(false); setForgotSent(false); setError(""); }}
                                    className="mt-4 text-accent text-sm hover:underline"
                                >
                                    返回登录
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="text-gray-500 text-sm text-center">输入注册邮箱，我们将发送重置链接</p>
                                <input
                                    type="email"
                                    placeholder="电子邮箱"
                                    value={forgotEmail}
                                    onChange={(e) => setForgotEmail(e.target.value)}
                                    autoFocus
                                    className="w-full px-4 py-3 rounded-[12px] bg-card border border-border text-text placeholder:text-gray-500 focus:border-accent outline-none"
                                />
                                {error && <p className="text-red-400 text-sm">{error}</p>}
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full py-3 rounded-[12px] bg-accent text-accent-foreground font-medium hover:bg-accent-hover disabled:cursor-not-allowed"
                                >
                                    {isLoading ? "发送中..." : "发送重置邮件"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setShowForgot(false); setError(""); }}
                                    className="w-full py-2 text-gray-500 text-sm hover:text-text"
                                >
                                    ← 返回登录
                                </button>
                            </>
                        )}
                    </form>
                ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* 注册模式显示昵称 */}
                    {mode === 'register' && step === 'email' && (
                        <input
                            type="text"
                            placeholder="昵称"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-3 rounded-[12px] bg-card border border-border text-text placeholder:text-gray-500 focus:border-accent outline-none"
                        />
                    )}
                    <input
                        type="email"
                        placeholder="电子邮箱"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={step === "password"}
                        className="w-full px-4 py-3 rounded-[12px] bg-card border border-border text-text placeholder:text-gray-500 focus:border-accent outline-none disabled:opacity-50"
                    />
                    {step === "password" && (
                        <div>
                            <input
                                type="password"
                                placeholder="密码（至少6位）"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoFocus
                                className="w-full px-4 py-3 rounded-[12px] bg-card border border-border text-text placeholder:text-gray-500 focus:border-accent outline-none"
                            />
                            {mode === 'login' && (
                                <button
                                    type="button"
                                    onClick={() => { setShowForgot(true); setError(""); setForgotSent(false); }}
                                    className="mt-2 text-xs text-accent hover:underline"
                                >
                                    忘记密码？
                                </button>
                            )}
                        </div>
                    )}
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    <button
                        type="submit"
                        disabled={isLoading || !email}
                        className="w-full py-3 rounded-[12px] bg-accent text-accent-foreground font-medium hover:bg-accent-hover disabled:cursor-not-allowed"
                    >
                        {isLoading ? "处理中..." : step === "email" ? "继续" : (mode === 'login' ? "登录" : "注册")}
                    </button>
                    {step === "password" && (
                        <button
                            type="button"
                            onClick={() => { setStep("email"); setError(""); }}
                            className="w-full py-2 text-gray-500 text-sm hover:text-text"
                        >
                            ← 返回上一步
                        </button>
                    )}
                </form>
                )}

                {/* 底部切换 + 条款 */}
                <div className="mt-6 flex flex-col gap-4">
                    <p className="text-center text-xs text-gray-500">
                        {mode === 'login' ? (
                            <>还没有账号？<span className="text-accent cursor-pointer" onClick={() => switchMode('register')}>立即注册</span></>
                        ) : (
                            <>已有账号？<span className="text-accent cursor-pointer" onClick={() => switchMode('login')}>直接登录</span></>
                        )}
                    </p>
                    <p className="text-center text-xs text-gray-500">
                        继续即表示您同意{" "}
                        <span className="underline cursor-pointer hover:text-gray-600" onClick={() => setShowPolicy("terms")}>使用条款</span>{" "}
                        和{" "}
                        <span className="underline cursor-pointer hover:text-gray-600" onClick={() => setShowPolicy("privacy")}>隐私政策</span>
                    </p>
                </div>
                </div>
            </div>

            {showPolicy && <PolicyModal type={showPolicy} onClose={() => setShowPolicy(null)} />}
        </div>
    );
}