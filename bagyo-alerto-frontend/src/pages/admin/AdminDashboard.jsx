import { useState, useEffect, useCallback } from "react"
import axios from "axios"
import { Loader, BarChart2, Wind, MapPin, School, Users, Radio, RefreshCw } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = "http://127.0.0.1:8000/api"
const POLL_MS = 5000 // refresh every 5s while page is open

const SEV_COLORS = {
    low: "#1D9E75",
    moderate: "#BA7517",
    high: "#D85A30",
    critical: "#A32D2D",
}

function StatCard({ icon, label, value, sub, color }) {
    return (
        <div style={styles.statCard}>
            <div style={{ ...styles.statIcon, background: `${color}18`, color }}>{icon}</div>
            <div style={styles.statLabel}>{label}</div>
            <div style={{ ...styles.statValue, color }}>{value ?? "—"}</div>
            {sub && <div style={styles.statSub}>{sub}</div>}
        </div>
    )
}

export default function AdminDashboard() {
    const { authHeaders } = useAdminAuth()
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)

    const fetchStats = useCallback(async (silent = false) => {
        if (!silent) setLoading(true)
        else setRefreshing(true)
        if (!silent) setError(null)
        try {
            const res = await axios.get(`${API_BASE}/admin/stats`, { headers: authHeaders() })
            setStats(res.data)
            setLastUpdated(new Date())
            setError(null)
        } catch {
            if (!silent) setError("Failed to load dashboard stats.")
        }
        setLoading(false)
        setRefreshing(false)
    }, [authHeaders])

    useEffect(() => {
        fetchStats(false)
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                fetchStats(true)
            }
        }, POLL_MS)
        return () => clearInterval(interval)
    }, [fetchStats])

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : null

    return (
        <AdminLayout title="Dashboard">
            <div style={styles.liveBar}>
                <span style={styles.liveBadge}>
                    <Radio size={12} />
                    Live
                </span>
                <span style={styles.liveText}>
                    Auto-updates when residents run Assess on the dashboard
                </span>
                {lastUpdatedStr && (
                    <span style={styles.liveMeta}>
                        <RefreshCw
                            size={11}
                            style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}
                        />
                        Updated {lastUpdatedStr}
                    </span>
                )}
            </div>

            {error && <div style={styles.errorBox}>{error}</div>}

            {loading ? (
                <div style={styles.center}>
                    <Loader size={28} color="#1a237e" style={{ animation: "spin 1s linear infinite" }} />
                    <span style={{ color: "#888", marginTop: 12 }}>Loading stats...</span>
                </div>
            ) : stats ? (
                <>
                    <div style={styles.grid}>
                        <StatCard
                            icon={<BarChart2 size={20} />}
                            label="Total Assessments"
                            value={stats.total_assessments}
                            sub="Typhoon severity evaluations"
                            color="#1a237e"
                        />
                        <StatCard
                            icon={<School size={20} />}
                            label="Total Capacity"
                            value={stats.total_capacity?.toLocaleString()}
                            sub="Evacuation center seats"
                            color="#3949ab"
                        />
                        <StatCard
                            icon={<MapPin size={20} />}
                            label="Barangays"
                            value={stats.total_barangays}
                            sub="Registered barangays"
                            color="#5c6bc0"
                        />
                        <StatCard
                            icon={<Users size={20} />}
                            label="Recommendations"
                            value={stats.total_recommendations}
                            sub="Evacuation assignments made"
                            color="#7986cb"
                        />
                    </div>

                    <div style={styles.section}>
                        <div style={styles.sectionTitle}>
                            <Wind size={18} color="#1a237e" />
                            Severity Breakdown
                        </div>
                        <div style={styles.sevGrid}>
                            {["low", "moderate", "high", "critical"].map((sev) => (
                                <div key={sev} style={styles.sevCard}>
                                    <div style={{ ...styles.sevDot, background: SEV_COLORS[sev] }} />
                                    <div style={styles.sevLabel}>{sev.charAt(0).toUpperCase() + sev.slice(1)}</div>
                                    <div style={{ ...styles.sevCount, color: SEV_COLORS[sev] }}>
                                        {stats.severity_counts?.[sev] ?? 0}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={styles.section}>
                        <div style={styles.sectionTitle}>Evacuation Centers</div>
                        <div style={styles.infoRow}>
                            <span>Active centers registered</span>
                            <strong style={{ color: "#1a237e" }}>{stats.total_evacuation_centers}</strong>
                        </div>
                    </div>
                </>
            ) : null}
        </AdminLayout>
    )
}

const styles = {
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 16,
        marginBottom: 28,
    },
    statCard: {
        background: "#fff",
        borderRadius: 10,
        padding: "20px",
        border: "1px solid #e8ecf0",
        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    },
    statIcon: {
        width: 40,
        height: 40,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 12,
    },
    statLabel: { fontSize: 12, color: "#888", fontWeight: 500, marginBottom: 4 },
    statValue: { fontSize: 28, fontWeight: 700 },
    statSub: { fontSize: 11, color: "#aaa", marginTop: 4 },
    section: {
        background: "#fff",
        borderRadius: 10,
        padding: "20px 24px",
        border: "1px solid #e8ecf0",
        marginBottom: 16,
    },
    sectionTitle: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 15,
        fontWeight: 600,
        color: "#1a237e",
        marginBottom: 16,
    },
    sevGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 12,
    },
    sevCard: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px",
        background: "#f8f9fc",
        borderRadius: 8,
        gap: 6,
    },
    sevDot: { width: 10, height: 10, borderRadius: "50%" },
    sevLabel: { fontSize: 12, color: "#666", textTransform: "capitalize" },
    sevCount: { fontSize: 24, fontWeight: 700 },
    infoRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 14,
        color: "#555",
    },
    center: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 60,
    },
    errorBox: {
        background: "#fcebeb",
        color: "#a32d2d",
        padding: "10px 14px",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 13,
    },
    liveBar: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 20,
        padding: "10px 14px",
        background: "#f0f4ff",
        borderRadius: 8,
        border: "1px solid #c5cae9",
    },
    liveBadge: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 700,
        color: "#00c853",
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    liveText: {
        fontSize: 12,
        color: "#555",
        flex: 1,
        minWidth: 200,
    },
    liveMeta: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        color: "#888",
    },
}
