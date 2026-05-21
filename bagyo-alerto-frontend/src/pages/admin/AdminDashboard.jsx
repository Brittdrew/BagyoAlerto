import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { Loader, BarChart2, MapPin, School, Users, Radio, RefreshCw, Download, Plus } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = "http://127.0.0.1:8000/api"
const POLL_MS = 2000

const SEV_COLORS = {
    low: "#1D9E75",
    moderate: "#F59E0B",
    high: "#F0703F",
    critical: "#D85A30",
}

const STATUS_COLOR = {
    Online: "#1D9E75",
    Delayed: "#F59E0B",
    Down: "#D85A30",
}

function StatCard({ icon, label, value, sub, color }) {
    return (
        <div style={styles.statCard}>
            <div style={{ ...styles.statIcon, background: `${color}1A`, color }}>{icon}</div>
            <div style={styles.statLabel}>{label}</div>
            <div style={{ ...styles.statValue, color }}>{value ?? "—"}</div>
            {sub && <div style={styles.statSub}>{sub}</div>}
        </div>
    )
}

function Sparkline({ data = [], color = "#1565c0", width = 140, height = 40 }) {
    if (!data || data.length === 0) return <div style={{ fontSize: 12, color: "#888" }}>No data</div>
    const max = Math.max(...data)
    const min = Math.min(...data)
    const len = data.length
    const step = width / Math.max(1, len - 1)
    const points = data
        .map((v, i) => {
            const x = i * step
            const y = max === min ? height / 2 : height - ((v - min) / (max - min)) * height
            return `${x},${y}`
        })
        .join(" ")
    return (
        <svg width={width} height={height} style={{ display: "block" }}>
            <polyline fill="none" stroke={color} strokeWidth={2} points={points} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    )
}

function StackedBar({ segments = [] }) {
    const total = segments.reduce((s, seg) => s + (seg.value || 0), 0) || 1
    return (
        <div style={styles.stackedBar}>
            {segments.map((seg, i) => (
                <div key={i} style={{ ...styles.stackedSegment, width: `${Math.round((seg.value / total) * 100)}%`, background: seg.color }} />
            ))}
        </div>
    )
}

function ProgressBar({ value = 0, color = "#1565c0" }) {
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0))
    return (
        <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${safeValue}%`, background: color }} />
        </div>
    )
}

export default function AdminDashboard() {
    const navigate = useNavigate()
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
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [authHeaders])

    useEffect(() => {
        fetchStats()
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                fetchStats(true)
            }
        }, POLL_MS)
        
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                fetchStats(true)
            }
        }
        document.addEventListener("visibilitychange", handleVisibilityChange)
        
        return () => {
            clearInterval(interval)
            document.removeEventListener("visibilitychange", handleVisibilityChange)
        }
    }, [fetchStats])

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
        : null

    const exportSummary = () => {
        if (!stats) return
        const rows = [
            ["Metric", "Value"],
            ["Total assessments", stats.total_assessments || 0],
            ["Total capacity", stats.total_capacity || 0],
            ["Barangays", stats.total_barangays || 0],
            ["Recommendations", stats.total_recommendations || 0],
        ]
        const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n")
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
        const link = document.createElement("a")
        link.href = url
        link.download = "bagyo_alerto_dashboard_summary.csv"
        link.click()
        URL.revokeObjectURL(url)
    }

    const totalSeverity = stats?.severity_counts || {}
    const currentRisk = ["critical", "high", "moderate", "low"].find((level) => totalSeverity[level] > 0) || "low"
    const totalSeverityCount = Object.values(totalSeverity).reduce((sum, value) => sum + value, 0) || 1
    const capacityTrend = stats?.capacity_trend || []
    const latestCapacityUsage = capacityTrend.length > 0 ? capacityTrend[capacityTrend.length - 1] : 0
    const systemStatus = [
        { label: "Backend API", status: error ? "Down" : "Online" },
        { label: "Open-Meteo API", status: "Online" },
        { label: "PAGASA feed", status: "Delayed" },
    ]

    return (
        <AdminLayout>
            <div style={styles.pageShell}>
                <div style={styles.headerRow}>
                    <div>
                        <div style={styles.pageTitle}>Dashboard</div>
                        <div style={styles.pageSubtitle}>Current overview of alerts, capacity, and system health.</div>
                    </div>
                    <div style={styles.actionRow}>
                        <button type="button" style={styles.outlineButton} onClick={exportSummary}>
                            <Download size={14} /> Export summary
                        </button>
                        <button type="button" style={styles.primaryButton} onClick={() => navigate("/admin/barangays")}> 
                            <Plus size={14} /> Add barangay
                        </button>
                    </div>
                </div>

                <div style={styles.statusBar}>
                    <div style={styles.liveChip}>
                        <Radio size={10} /> Live
                    </div>
                    <div style={{ ...styles.liveChip, ...styles.riskBadge, background: `${SEV_COLORS[currentRisk]}20`, color: SEV_COLORS[currentRisk] }}>
                        Current risk: {currentRisk.charAt(0).toUpperCase() + currentRisk.slice(1)}
                    </div>
                    <div style={styles.statusText}>Auto-refreshes while the dashboard is open.</div>
                    {lastUpdatedStr && <div style={styles.updatedText}>Updated {lastUpdatedStr}</div>}
                </div>

                {error && <div style={styles.errorBox}>{error}</div>}

                {loading ? (
                    <div style={styles.loaderWrap}>
                        <Loader size={28} color="#1a237e" style={{ animation: "spin 1s linear infinite" }} />
                        <span style={styles.loadingText}>Loading dashboard...</span>
                    </div>
                ) : (
                    stats && (
                        <>
                            <div style={styles.grid}>
                                <StatCard
                                    icon={<BarChart2 size={20} />}
                                    label="Total assessments"
                                    value={stats.total_assessments?.toLocaleString() ?? "—"}
                                    sub="Typhoon severity evaluations"
                                    color="#1a237e"
                                />
                                <StatCard
                                    icon={<School size={20} />}
                                    label="Total capacity"
                                    value={stats.total_capacity?.toLocaleString() ?? "—"}
                                    sub="Evacuation center seats"
                                    color="#1565c0"
                                />
                                <StatCard
                                    icon={<MapPin size={20} />}
                                    label="Barangays"
                                    value={stats.total_barangays?.toLocaleString() ?? "—"}
                                    sub="Registered barangays"
                                    color="#5c6bc0"
                                />
                                <StatCard
                                    icon={<Users size={20} />}
                                    label="Recommendations"
                                    value={stats.total_recommendations?.toLocaleString() ?? "—"}
                                    sub="Evacuation assignments"
                                    color="#3949ab"
                                />
                            </div>

                            <div style={styles.summaryRow}>
                                <div style={styles.summaryCard}>
                                    <div style={styles.summaryLabel}>Active centers</div>
                                    <div style={styles.summaryValue}>{stats.total_evacuation_centers ?? 0}</div>
                                </div>
                                <div style={styles.summaryCard}>
                                    <div style={styles.summaryLabel}>Critical alerts</div>
                                    <div style={styles.summaryValue}>{totalSeverity.critical ?? 0}</div>
                                </div>
                                <div style={styles.summaryCard}>
                                    <div style={styles.summaryLabel}>Most recent refresh</div>
                                    <div style={styles.summaryValue}>{lastUpdatedStr || "—"}</div>
                                </div>
                            </div>

                            <div style={styles.sectionSplit}>
                                <div style={styles.sectionCard}>
                                    <div style={styles.sectionTitle}>Severity breakdown</div>
                                    <div style={styles.sevGrid}>
                                        {(["low", "moderate", "high", "critical"]).map((level) => (
                                            <div key={level} style={styles.sevCard}>
                                                <div style={{ ...styles.sevDot, background: SEV_COLORS[level] }} />
                                                <div style={styles.sevLabel}>{level.charAt(0).toUpperCase() + level.slice(1)}</div>
                                                <div style={{ ...styles.sevCount, color: SEV_COLORS[level] }}>{totalSeverity[level] ?? 0}</div>
                                            </div>
                                        ))}
                                    </div>

                                    <div style={styles.chartsRow}>
                                        <div style={styles.chartCard}>
                                            <div style={styles.chartLabel}>Assessments (recent)</div>
                                            <Sparkline data={stats?.assessments_over_time || stats?.assessments_history || []} color="#1a237e" />
                                            <div style={styles.recentList}>
                                                {(stats?.recent_assessments || []).length === 0 ? (
                                                    <div style={styles.recentEmpty}>No recent barangay assessments.</div>
                                                ) : (
                                                    (stats?.recent_assessments || []).map((item) => (
                                                        <div key={item.id} style={styles.recentItem}>
                                                            <span style={styles.recentBarangay}>{item.barangay_name}</span>
                                                            <span
                                                                style={{
                                                                    ...styles.recentSeverity,
                                                                    background: `${SEV_COLORS[item.severity_level] || SEV_COLORS.low}1A`,
                                                                    color: SEV_COLORS[item.severity_level] || SEV_COLORS.low,
                                                                }}
                                                            >
                                                                {item.severity_level}
                                                            </span>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>

                                        <div style={styles.chartCard}>
                                            <div style={styles.chartLabel}>Capacity usage</div>
                                            <div style={styles.capacityValue}>{latestCapacityUsage}%</div>
                                            <ProgressBar value={latestCapacityUsage} color="#1565c0" />
                                            <div style={styles.capacityHint}>Latest center utilization estimate</div>
                                        </div>

                                        <div style={styles.chartCard}>
                                            <div style={styles.chartLabel}>Risk distribution</div>
                                            <StackedBar
                                                segments={[
                                                    { value: totalSeverity.low || 0, color: SEV_COLORS.low },
                                                    { value: totalSeverity.moderate || 0, color: SEV_COLORS.moderate },
                                                    { value: totalSeverity.high || 0, color: SEV_COLORS.high },
                                                    { value: totalSeverity.critical || 0, color: SEV_COLORS.critical },
                                                ]}
                                            />
                                        </div>
                                    </div> 
                                </div>

                                <div style={styles.sectionCard}>
                                    <div style={styles.sectionTitle}>System health</div>
                                    <div style={styles.statusList}>
                                        {systemStatus.map((item) => (
                                            <div key={item.label} style={styles.statusRow}>
                                                <div style={styles.statusLabel}>{item.label}</div>
                                                <div style={{ ...styles.statusBadge, background: `${STATUS_COLOR[item.status]}20`, color: STATUS_COLOR[item.status] }}>
                                                    {item.status}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={styles.quickActions}>
                                        <button type="button" style={styles.primaryButtonBlock} onClick={() => navigate("/admin/barangays")}>Add barangay</button>
                                        <button type="button" style={styles.outlineButtonBlock} onClick={() => navigate("/admin/evacuation-centers")}>Add evac. center</button>
                                        <button type="button" style={styles.dangerButtonBlock} onClick={() => window.alert("Mass alert sent.")}>Send mass alert</button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )
                )}
            </div>
        </AdminLayout>
    )
}

const styles = {
    pageShell: {
        minHeight: "100vh",
        background: "#f0f4f8",
        padding: 20,
        fontFamily: "system-ui, sans-serif",
    },
    headerRow: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
    },
    pageTitle: {
        fontSize: 20,
        fontWeight: 700,
        color: "#1a1a2e",
        marginBottom: 6,
    },
    pageSubtitle: {
        fontSize: 13,
        color: "#666",
        maxWidth: 540,
        lineHeight: 1.5,
    },
    actionRow: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
    },
    statusBar: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 20,
        fontSize: 12,
        color: "#666",
    },
    liveChip: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: "#e8f7ed",
        color: "#1D9E75",
        fontWeight: 700,
    },
    statusText: {
        color: "#666",
    },
    updatedText: {
        color: "#888",
    },
    outlineButton: {
        border: "1px solid #dfe4ee",
        background: "#fff",
        color: "#1a237e",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
    },
    primaryButton: {
        border: "1px solid #1a237e",
        background: "#1a237e",
        color: "#fff",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
    },
    primaryButtonBlock: {
        width: "100%",
        border: "1px solid #1a237e",
        background: "#1a237e",
        color: "#fff",
        borderRadius: 10,
        padding: "12px 14px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
    },
    outlineButtonBlock: {
        width: "100%",
        border: "1px solid #dfe4ee",
        background: "#fff",
        color: "#1a237e",
        borderRadius: 10,
        padding: "12px 14px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        marginTop: 12,
    },
    errorBox: {
        background: "#fcebeb",
        color: "#a32d2d",
        padding: "12px 16px",
        borderRadius: 10,
        border: "0.5px solid #f2c7c2",
        marginBottom: 16,
        fontSize: 13,
    },
    loaderWrap: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 60,
        background: "#fff",
        borderRadius: 10,
        border: "0.5px solid #e8ecf0",
    },
    loadingText: {
        marginTop: 14,
        color: "#888",
        fontSize: 13,
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 16,
        marginBottom: 20,
    },
    statCard: {
        background: "#fff",
        borderRadius: 10,
        padding: "20px",
        border: "0.5px solid #e8ecf0",
        minHeight: 150,
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    statIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        marginBottom: 8,
    },
    statLabel: {
        fontSize: 12,
        color: "#666",
        textTransform: "uppercase",
        letterSpacing: 0.8,
        fontWeight: 700,
    },
    statValue: {
        fontSize: 28,
        fontWeight: 700,
        color: "#1a1a2e",
    },
    statSub: {
        fontSize: 12,
        color: "#888",
        lineHeight: 1.5,
    },
    summaryRow: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 16,
        marginBottom: 20,
    },
    summaryCard: {
        background: "#fff",
        borderRadius: 10,
        padding: "18px",
        border: "0.5px solid #e8ecf0",
        display: "flex",
        flexDirection: "column",
        gap: 6,
    },
    summaryLabel: {
        fontSize: 12,
        color: "#666",
        textTransform: "uppercase",
        letterSpacing: 0.8,
    },
    summaryValue: {
        fontSize: 24,
        fontWeight: 700,
        color: "#1a1a2e",
    },
    sectionSplit: {
        display: "grid",
        gridTemplateColumns: "2fr 1fr",
        gap: 16,
    },
    sectionCard: {
        background: "#fff",
        borderRadius: 10,
        padding: "22px",
        border: "0.5px solid #e8ecf0",
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: 700,
        color: "#1a1a2e",
        marginBottom: 16,
    },
    sevGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 12,
    },
    sevCard: {
        display: "grid",
        gap: 8,
        padding: "14px",
        borderRadius: 10,
        background: "#f7f8fc",
    },
    sevDot: {
        width: 10,
        height: 10,
        borderRadius: "50%",
    },
    sevLabel: {
        fontSize: 12,
        color: "#666",
        textTransform: "capitalize",
    },
    sevCount: {
        fontSize: 22,
        fontWeight: 700,
    },
    chartsRow: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 12,
        marginTop: 12,
    },
    chartCard: {
        background: "#fff",
        borderRadius: 10,
        padding: "12px 14px",
        border: "0.5px solid #e8ecf0",
        minHeight: 72,
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    chartLabel: {
        fontSize: 12,
        color: "#666",
        fontWeight: 700,
    },
    capacityValue: {
        fontSize: 22,
        fontWeight: 700,
        color: "#1565c0",
        lineHeight: 1.1,
    },
    capacityHint: {
        fontSize: 11,
        color: "#888",
    },
    progressTrack: {
        width: "100%",
        height: 10,
        borderRadius: 999,
        background: "#e8edf5",
        overflow: "hidden",
        border: "0.5px solid #dfe6f0",
    },
    progressFill: {
        height: "100%",
        borderRadius: 999,
        transition: "width 0.3s ease",
    },
    recentList: {
        marginTop: 4,
        display: "grid",
        gap: 6,
    },
    recentItem: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
    },
    recentBarangay: {
        color: "#1a1a2e",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    recentSeverity: {
        borderRadius: 999,
        padding: "2px 8px",
        textTransform: "capitalize",
        fontWeight: 700,
        fontSize: 10,
        flexShrink: 0,
    },
    recentEmpty: {
        fontSize: 11,
        color: "#999",
    },
    stackedBar: {
        height: 12,
        borderRadius: 999,
        display: "flex",
        overflow: "hidden",
        border: "0.5px solid #eef2f6",
    },
    stackedSegment: {
        height: "100%",
    },
    miniChart: {},
    miniBar: {},

    statusList: {
        display: "grid",
        gap: 12,
        marginBottom: 20,
    },
    statusRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
        color: "#1a1a2e",
    },
    statusLabel: {
        color: "#666",
    },
    statusBadge: {
        borderRadius: 999,
        padding: "6px 12px",
        fontSize: 11,
        fontWeight: 700,
    },
    quickActions: {
        display: "grid",
        gap: 10,
    },
    riskBadge: {
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
    },
    dangerButtonBlock: {
        width: "100%",
        border: "1px solid #D85A30",
        background: "#fff2f0",
        color: "#D85A30",
        borderRadius: 10,
        padding: "12px 14px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
    },
}
