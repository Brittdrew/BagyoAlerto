import { useNavigate, useLocation } from "react-router-dom"
import axios from "axios"
import {
    LayoutDashboard,
    MapPin,
    School,
    Clock,
    Settings,
    LogOut,
    Shield,
    Tornado,
    Cloud,
    Map,
    MessageCircle,
} from "lucide-react"
import { useAdminAuth } from "../context/AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE

const navItems = [
    { id: "dashboard", label: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard },
    { id: "weather", label: "Weather Monitor", path: "/admin/weather", icon: Cloud },
    { id: "weather-map", label: "Weather Map", path: "/admin/weather-map", icon: Map },
    { id: "barangays", label: "Barangays", path: "/admin/barangays", icon: MapPin },
    { id: "evacuation-centers", label: "Evacuation Centers", path: "/admin/evacuation-centers", icon: School },
    { id: "chat", label: "AI Assistant", path: "/admin/chat", icon: MessageCircle },
    { id: "history", label: "History", path: "/admin/history", icon: Clock },
    { id: "settings", label: "Settings", path: "/admin/settings", icon: Settings },
]

export default function AdminSidebar() {
    const navigate = useNavigate()
    const location = useLocation()
    const { logout, authHeaders, admin } = useAdminAuth()

    const handleLogout = async () => {
        try {
            await axios.post(`${API_BASE}/admin/logout`, {}, { headers: authHeaders() })
        } catch {
            // Clear local session even if API call fails
        }
        logout()
        navigate("/admin/login")
    }

    return (
        <aside style={styles.sidebar}>
            <div style={styles.logo}>
                <Tornado size={22} style={{ flexShrink: 0 }} />
                <div>
                    <div style={styles.logoTitle}>BagyoAlerto</div>
                    <div style={styles.logoSub}>Admin Panel</div>
                </div>
            </div>

            <div style={styles.adminBadge}>
                <Shield size={14} />
                <span>{admin?.name || "Admin"}</span>
            </div>

            <div style={styles.navSection}>Navigation</div>
            {navItems.map(({ id, label, path, icon: Icon }) => {
                const isActive = location.pathname === path
                return (
                    <div
                        key={id}
                        onClick={() => navigate(path)}
                        style={{
                            ...styles.navItem,
                            background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
                            borderLeft: isActive ? "3px solid #fff" : "3px solid transparent",
                            fontWeight: isActive ? 600 : 400,
                        }}
                    >
                        <Icon size={16} />
                        <span>{label}</span>
                    </div>
                )
            })}

            <div style={styles.spacer} />

            <div onClick={handleLogout} style={styles.logoutBtn}>
                <LogOut size={16} />
                <span>Logout</span>
            </div>
        </aside>
    )
}

const styles = {
    sidebar: {
        width: 250,
        minWidth: 250,
        background: "#1a237e",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "sticky",
        top: 0,
        overflowY: "auto",
    },
    logo: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "20px 18px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
    },
    logoTitle: {
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 0.3,
    },
    logoSub: {
        fontSize: 10,
        opacity: 0.7,
        marginTop: 2,
    },
    adminBadge: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "12px 14px",
        padding: "8px 12px",
        background: "rgba(255,255,255,0.1)",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
    },
    navSection: {
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 1,
        opacity: 0.5,
        padding: "8px 18px 6px",
        fontWeight: 600,
    },
    navItem: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 18px",
        cursor: "pointer",
        fontSize: 13,
        transition: "background 0.15s",
    },
    spacer: { flex: 1 },
    logoutBtn: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 18px",
        margin: "0 0 16px",
        cursor: "pointer",
        fontSize: 13,
        borderTop: "1px solid rgba(255,255,255,0.12)",
        color: "rgba(255,255,255,0.85)",
    },
}
