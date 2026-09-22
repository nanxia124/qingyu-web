import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "";

export default function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await fetch(`${API}/api/admin/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "登录失败");
            localStorage.setItem("admin_token", data.token);
            onLogin(data.token);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#f4f4f6]">
            <div className="w-full max-w-sm rounded-2xl bg-[#ffffff] p-8">
                <h1 className="text-xl font-bold text-white mb-6 text-center">管理后台登录</h1>
                {error && <p className="mb-4 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm text-gray-500">用户名</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[#5051F8]"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm text-gray-500">密码</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-lg bg-[#e5e5ea] px-3 py-2 text-white outline-none focus:ring-2 focus:ring-[#5051F8]"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-lg bg-[#5051F8] py-2 font-medium text-white hover:bg-[#3f40e6] disabled:opacity-50"
                    >
                        {loading ? "登录中..." : "登录"}
                    </button>
                </form>
            </div>
        </div>
    );
}
