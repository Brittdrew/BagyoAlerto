import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { Tornado, Loader, Shield } from "lucide-react"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = "http://127.0.0.1:8000/api"

export default function AdminLogin() {
    const navigate = useNavigate()
    const { login, isAuthenticated } = useAdminAuth()

    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (isAuthenticated) {
            navigate("/admin/dashboard", { replace: true })
        }
    }, [isAuthenticated, navigate])

    const handleLogin = async () => {
        if (!username.trim() || !password.trim()) {
            setError("Please enter username and password.")
            return
        }
        setLoading(true)
        setError(null)
        try {
            const res = await axios.post(`${API_BASE}/admin/login`, { username, password })
            login(res.data.token, res.data.admin)
            navigate("/admin/dashboard")
        } catch (err) {
            setError(err.response?.data?.message || "Login failed. Please check your credentials.")
        }
        setLoading(false)
    }

    return (
        <div style={styles.page}>
            <div style={styles.card}>
                <div style={styles.logoRow}>
                    <Tornado size={32} color="#1a237e" />
                    <div>
                        <div style={styles.title}>BagyoAlerto</div>
                        <div style={styles.subtitle}>Admin Panel</div>
                    </div>
                </div>

                <div style={styles.badge}>
                    <Shield size={14} color="#1a237e" />
                    <span>Secure Admin Access</span>
                </div>

                {error && <div style={styles.errorBox}>{error}</div>}

                <div style={styles.field}>
                    <label style={styles.label}>Username</label>
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                        style={styles.input}
                        placeholder="Enter username"
                    />
                </div>

                <div style={styles.field}>
                    <label style={styles.label}>Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                        style={styles.input}
                        placeholder="Enter password"
                    />
                </div>

                <div
                    onClick={!loading ? handleLogin : undefined}
                    style={{
                        ...styles.btn,
                        opacity: loading ? 0.7 : 1,
                        cursor: loading ? "not-allowed" : "pointer",
                    }}
                >
                    {loading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
                    {loading ? "Signing in..." : "Sign In"}
                </div>

                <div style={styles.hint}>Default: admin / admin123</div>
            </div>
        </div>
    )
}

const styles = {
    page: {
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #1a237e 0%, #283593 50%, #3949ab 100%)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
    },
    card: {
        background: "#fff",
        borderRadius: 12,
        padding: "36px 40px",
        width: "100%",
        maxWidth: 400,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
    },
    logoRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 20,
    },
    title: { fontSize: 22, fontWeight: 700, color: "#1a237e" },
    subtitle: { fontSize: 12, color: "#888", marginTop: 2 },
    badge: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#f0f4ff",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 12,
        color: "#1a237e",
        marginBottom: 20,
    },
    field: { marginBottom: 16 },
    label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 },
    input: {
        width: "100%",
        padding: "10px 12px",
        border: "1px solid #ddd",
        borderRadius: 8,
        fontSize: 14,
        boxSizing: "border-box",
        outline: "none",
    },
    btn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "#1a237e",
        color: "#fff",
        padding: "12px",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 14,
        marginTop: 8,
    },
    errorBox: {
        background: "#fcebeb",
        color: "#a32d2d",
        padding: "10px 12px",
        borderRadius: 8,
        fontSize: 13,
        marginBottom: 16,
        border: "1px solid #f09595",
    },
    hint: {
        textAlign: "center",
        fontSize: 11,
        color: "#aaa",
        marginTop: 16,
    },
}
