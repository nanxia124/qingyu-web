import { useState, useEffect } from "react";
import AdminLogin from "./AdminLogin";
import AdminDashboard from "./AdminDashboard";

export default function AdminPage() {
    const [token, setToken] = useState<string | null>(localStorage.getItem("admin_token"));

    if (!token) {
        return <AdminLogin onLogin={(t) => { setToken(t); }} />;
    }

    return <AdminDashboard token={token} onLogout={() => { localStorage.removeItem("admin_token"); setToken(null); }} />;
}
