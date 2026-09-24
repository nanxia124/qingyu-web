import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PolicyModal from "./PolicyModal"
import { QingyuLogoIcon } from "./layout/SidebarIcons";
import { getOAuthErrorMessage, useAuthStore } from "@/stores/useAuthStore";
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

    const { login, register, isLoading, forgotPassword, loginWithOAuth } = useAuthStore();

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("oauth_error") !== "1") return;
        const detail = params.get("error_description") || params.get("error") || "OAuth provider returned an error";
        console.error("[oauth] callback failed", {
            error: params.get("error"),
            errorDescription: params.get("error_description"),
            currentOrigin: window.location.origin,
        });
        setError(getOAuthErrorMessage(detail));
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
    }, []);

    const validateEmail = () => {
        if (!email.trim()) { setError(t('auth.emailRequired')); return false; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError(t('auth.emailInvalid')); return false; }
        return true;
    };

    const validatePassword = () => {
        if (!password.trim()) { setError(t('auth.passwordRequired')); return false; }
        if (password.length < 6) { setError(t('auth.passwordMin')); return false; }
        return true;
    };

    const validateName = () => {
        if (!name.trim()) { setError(t('auth.nicknameRequired')); return false; }
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
        if (!forgotEmail.trim()) { setError(t('auth.emailRequired')); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) { setError(t('auth.emailInvalid')); return; }
        try {
            await forgotPassword(forgotEmail);
            setForgotSent(true);
        } catch (err: any) {
            if (err instanceof AppwriteException) {
                setError(err.message || t('auth.sendFailed'));
            } else {
                setError(t('auth.sendFailedRetry'));
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
                setError(err.message || t('auth.opFailed'));
            } else {
                setError(t('auth.opFailedRetry'));
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
                    <img src="/litzone-wordmark.svg" alt="litzone" className="mt-6 h-8 w-40 object-contain brightness-0 invert" />
                    <p className="mt-2 text-center text-white/80 text-sm leading-relaxed">
                        {t('auth.brandPlaceholder')}
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
                    <h2 className="text-2xl font-bold text-center text-text flex items-center justify-center gap-2">
                        {t('brand.welcome')}
                        <img src="/litzone-wordmark.svg" alt="LITZONE" className="h-10 w-auto object-contain dark:invert" />
                    </h2>
                    <p className="text-center text-gray-500 mt-2">
                        {mode === 'login' ? t('auth.subtitleLogin') : t('auth.subtitleRegister')}
                    </p>
                </div>

                {/* 第三方登录按钮 */}
                <div className="flex flex-col gap-3 mb-6">
                    <button
                        onClick={() => { setError(""); loginWithOAuth("google").catch((err) => { console.error("[oauth] Google login failed", err); setError(getOAuthErrorMessage(err)); }); }}
                        className="w-full flex items-center justify-center gap-3 py-3 rounded-[12px] bg-card border border-border hover:bg-surface-hover transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        <span className="text-text font-medium">{t("auth.useGoogle")}</span>
                    </button>

                    <button
                        onClick={() => { setError(""); loginWithOAuth("apple").catch((err) => { console.error("[oauth] Apple login failed", err); setError(getOAuthErrorMessage(err)); }); }}
                        className="w-full flex items-center justify-center gap-3 py-3 rounded-[12px] bg-card border border-border hover:bg-surface-hover transition-colors"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8.98-.2 1.92-.88 3.23-.81 1.56.13 2.73.74 3.51 1.86-3.12 1.87-2.48 5.97.19 7.12-.57 1.5-1.31 2.99-3.01 4.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                        </svg>
                        <span className="text-text font-medium">{t("auth.useApple")}</span>
                    </button>
                </div>

                {/* 分隔线 */}
                <div className="relative mb-6">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-border"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                        <span className="px-4 bg-card text-gray-500">{t("auth.or")}</span>
                    </div>
                </div>

                {/* 找回密码表单 */}
                {showForgot ? (
                    <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4">
                        <h3 className="text-lg font-semibold text-text text-center">{t("auth.forgotTitle")}</h3>
                        {forgotSent ? (
                            <div className="text-center py-4">
                                <p className="text-green-400 mb-2">{t("auth.resetSent")}</p>
                                <p className="text-gray-500 text-sm">{t("auth.resetSentHint")}</p>
                                <button
                                    type="button"
                                    onClick={() => { setShowForgot(false); setForgotSent(false); setError(""); }}
                                    className="mt-4 text-accent text-sm hover:underline"
                                >
                                    {t("auth.backLogin")}
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="text-gray-500 text-sm text-center">{t("auth.forgotHint")}</p>
                                <input
                                    type="email"
                                    placeholder={t("auth.email")}
                                    value={forgotEmail}
                                    onChange={(e) => setForgotEmail(e.target.value)}
                                    autoFocus
                                    className="w-full px-4 py-3 rounded-[12px] bg-card border border-border text-text placeholder:text-gray-500 focus:border-accent outline-none"
                                />
                                {error && <p className="text-red-400 text-sm">{error}</p>}
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full py-3 rounded-[12px] bg-brand text-brand-foreground font-semibold hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isLoading ? t("auth.sending") : t("auth.sendReset")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setShowForgot(false); setError(""); }}
                                    className="w-full py-2 text-gray-500 text-sm hover:text-text"
                                >
                                    ← {t("auth.backLogin")}
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
                            placeholder={t("auth.nickname")}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-4 py-3 rounded-[12px] bg-card border border-border text-text placeholder:text-gray-500 focus:border-accent outline-none"
                        />
                    )}
                    <input
                        type="email"
                        placeholder={t("auth.email")}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={step === "password"}
                        className="w-full px-4 py-3 rounded-[12px] bg-card border border-border text-text placeholder:text-gray-500 focus:border-accent outline-none disabled:opacity-50"
                    />
                    {step === "password" && (
                        <div>
                            <input
                                type="password"
                                placeholder={t("auth.password")}
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
                                    {t("auth.forgot")}
                                </button>
                            )}
                        </div>
                    )}
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    <button
                        type="submit"
                        disabled={isLoading || !email}
                        className="w-full py-3 rounded-[12px] bg-brand text-brand-foreground font-semibold hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isLoading ? t("auth.processing") : step === "email" ? t("auth.continue") : (mode === 'login' ? t("auth.login") : t("auth.register"))}
                    </button>
                    {step === "password" && (
                        <button
                            type="button"
                            onClick={() => { setStep("email"); setError(""); }}
                            className="w-full py-2 text-gray-500 text-sm hover:text-text"
                        >
                            {t("auth.backStep")}
                        </button>
                    )}
                </form>
                )}

                {/* 底部切换 + 条款 */}
                <div className="mt-6 flex flex-col gap-4">
                    <p className="text-center text-xs text-gray-500">
                        {mode === 'login' ? (
                            <>{t("auth.noAccount")}<span className="text-brand cursor-pointer font-medium" onClick={() => switchMode('register')}>{t("auth.signUpNow")}</span></>
                        ) : (
                            <>{t("auth.hasAccount")}<span className="text-brand cursor-pointer font-medium" onClick={() => switchMode('login')}>{t("auth.loginNow")}</span></>
                        )}
                    </p>
                    <p className="text-center text-xs text-gray-500">
                        {t("auth.agree")}{" "}
                        <span className="underline cursor-pointer hover:text-gray-600" onClick={() => setShowPolicy("terms")}>{t("auth.terms")}</span>{" "}
                        {t("auth.and")}{" "}
                        <span className="underline cursor-pointer hover:text-gray-600" onClick={() => setShowPolicy("privacy")}>{t("auth.privacy")}</span>
                    </p>
                </div>
                </div>
            </div>

            {showPolicy && <PolicyModal type={showPolicy} onClose={() => setShowPolicy(null)} />}
        </div>
    );
}
