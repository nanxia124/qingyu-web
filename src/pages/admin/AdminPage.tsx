import { useState, useEffect } from "react";
import AdminLogin from "./AdminLogin";
import AdminConsole from "./AdminConsole";

export default function AdminPage() {
    const [token, setToken] = useState<string | null>(localStorage.getItem("admin_token"));

    if (!token) {
        return <AdminLogin onLogin={(t) => { setToken(t); }} />;
    }

    return <AdminConsole token={token} onLogout={() => { localStorage.removeItem("admin_token"); setToken(null); }} />;
}
