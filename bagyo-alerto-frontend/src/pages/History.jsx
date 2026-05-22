import { useState, useEffect, useMemo } from "react"
import axios from "axios"
import { useNavigate } from "react-router-dom"
import { Tornado, BarChart2, Clock, RefreshCw, Download, Search, Loader, AlertTriangle, Inbox, MapPin, School, Trash2 } from "lucide-react"
import Sidebar from "../components/Sidebar"
import BagyoBot from "../components/BagyoBot"

const API_BASE = "http://127.0.0.1:8000/api"
const PAGE_SIZE = 8

// ─── Severity config ──────────────────────────────────────────────────────────
const SEV = {
    low: { label: "Low", signal: "Signal #1", dot: "#1D9E75", bg: "#E1F5EE", text: "#085041", border: "#9FE1CB" },
    moderate: { label: "Moderate", signal: "Signal #2", dot: "#EF9F27", bg: "#FAEEDA", text: "#633806", border: "#FAC775" },
    high: { label: "High", signal: "Signal #3", dot: "#D85A30", bg: "#FAECE7", text: "#4A1B0C", border: "#F0997B" },
    critical: { label: "Critical", signal: "Signal #4–5", dot: "#E24B4A", bg: "#FCEBEB", text: "#501313", border: "#F09595" },
}

function SeverityBadge({ severity }) {
    const cfg = SEV[severity] || SEV.low
    return (
        <div>
            <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 600, padding: "3px 9px",
                borderRadius: 20, background: cfg.bg, color: cfg.text,
                border: `0.5px solid ${cfg.border}`,
            }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: cfg.dot, display: "inline-block", flexShrink: 0 }} />
                {cfg.label}
            </span>
            <div style={{ marginTop: 3 }}>
                <span style={{
                    fontSize: 10, color: "#888", background: "#f5f5f5",
                    padding: "2px 7px", borderRadius: 10, border: "0.5px solid #e8e8e8",
                }}>
                    PAGASA {cfg.signal}
                </span>
            </div>
        </div>
    )
}

function StatCard({ label, value, sub, valueColor }) {
    return (
        <div style={styles.statCard}>
            <div style={styles.statLabel}>{label}</div>
            <div style={{ ...styles.statVal, color: valueColor || "var(--color-text-primary, #1a1a2e)" }}>{value}</div>
            <div style={styles.statSub}>{sub}</div>
        </div>
    )
}

// ─── Main History Page ────────────────────────────────────────────────────────
export default function History() {
    const navigate = useNavigate()

    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [sevFilter, setSevFilter] = useState("all")
    const [periodFilter, setPeriodFilter] = useState("all")
    const [barangayFilter, setBarangayFilter] = useState("all")
    const [currentPage, setCurrentPage] = useState(1)
    const [deletingId, setDeletingId] = useState(null)
    const [sidebarActive, setSidebarActive] = useState("history")

    useEffect(() => { fetchLogs() }, [])

    const fetchLogs = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await axios.get(`${API_BASE}/recommendations`)
            setLogs(res.data)
        } catch {
            setError("Failed to load history. Please check your connection.")
        }
        setLoading(false)
    }

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this assessment record?")) return
        setDeletingId(id)
        try {
            await axios.delete(`${API_BASE}/recommendations/${id}`)
            setLogs(prev => prev.filter(l => l.id !== id))
        } catch {
            alert("Failed to delete. Please try again.")
        }
        setDeletingId(null)
    }

    // ── CSV Export — now includes Temperature & Humidity ──────────────────────
    const handleExportCSV = () => {
        if (filtered.length === 0) return
        const headers = [
            "#", "Barangay", "City", "Date", "Severity", "PAGASA Signal",
            "Wind (km/h)", "Rainfall (mm/hr)", "Pressure (hPa)",
            "Temperature (°C)", "Humidity (%)",   // ← NEW
            "Evacuation Center"
        ]
        const rows = filtered.map((log, i) => [
            filtered.length - i,
            log.barangay?.name || "—",
            log.barangay?.city || "—",
            formatDate(log.recommended_at),
            log.typhoon_log?.severity_level || "—",
            SEV[log.typhoon_log?.severity_level]?.signal || "—",
            log.typhoon_log?.wind_speed || "—",
            log.typhoon_log?.rainfall || "—",
            log.typhoon_log?.pressure || "—",
            log.typhoon_log?.temperature ?? "—",   // ← NEW
            log.typhoon_log?.humidity ?? "—",       // ← NEW
            log.evacuation_center?.name || "—",
        ])
        const csv = [headers, ...rows].map(r => r.join(",")).join("\n")
        const blob = new Blob([csv], { type: "text/csv" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = "bagyo_alerto_history.csv"; a.click()
        URL.revokeObjectURL(url)
    }

    const formatDate = (str) => {
        if (!str) return "—"
        return new Date(str).toLocaleString("en-PH", {
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit",
        })
    }

    const formatDateShort = (str) => {
        if (!str) return "—"
        return new Date(str).toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric",
        })
    }

    const formatTime = (str) => {
        if (!str) return ""
        return new Date(str).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
    }

    // ── Filter logic ────────────────────────────────────────────────────────────
    const filtered = useMemo(() => {
        const now = new Date()
        return logs.filter(log => {
            const sev = log.typhoon_log?.severity_level || ""
            const name = (log.barangay?.name || "").toLowerCase()
            const city = (log.barangay?.city || "").toLowerCase()
            const evac = (log.evacuation_center?.name || "").toLowerCase()
            const q = searchQuery.toLowerCase()
            const date = new Date(log.recommended_at)

            if (q && !name.includes(q) && !city.includes(q) && !evac.includes(q)) return false
            if (sevFilter !== "all" && sev !== sevFilter) return false
            if (barangayFilter !== "all" && log.barangay?.name !== barangayFilter) return false

            if (periodFilter === "7d") { const d = new Date(now); d.setDate(d.getDate() - 7); if (date < d) return false }
            if (periodFilter === "30d") { const d = new Date(now); d.setDate(d.getDate() - 30); if (date < d) return false }
            if (periodFilter === "year") { if (date.getFullYear() !== now.getFullYear()) return false }

            return true
        })
    }, [logs, searchQuery, sevFilter, periodFilter, barangayFilter])

    // Pagination
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

    // Reset page when filters change
    useEffect(() => { setCurrentPage(1) }, [searchQuery, sevFilter, periodFilter, barangayFilter])

    // ── Stats ───────────────────────────────────────────────────────────────────
    const stats = useMemo(() => {
        const total = logs.length
        const critical = logs.filter(l => l.typhoon_log?.severity_level === "critical").length
        const winds = logs.map(l => parseFloat(l.typhoon_log?.wind_speed || 0)).filter(Boolean)
        const avgWind = winds.length ? Math.round(winds.reduce((a, b) => a + b, 0) / winds.length) : 0

        const barangayCounts = {}
        logs.forEach(l => {
            const n = l.barangay?.name
            if (n) barangayCounts[n] = (barangayCounts[n] || 0) + 1
        })
        const topBarangay = Object.entries(barangayCounts).sort((a, b) => b[1] - a[1])[0]

        return { total, critical, avgWind, topBarangay }
    }, [logs])

    // Unique barangays for sidebar filter
    const barangayOptions = useMemo(() => {
        const names = [...new Set(logs.map(l => l.barangay?.name).filter(Boolean))]
        return names.sort()
    }, [logs])

    return (
        <div style={styles.page}>
            <style>{`
        @keyframes ticker { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        .h-sb-item:hover { background: #f0f4ff !important; color: #185FA5 !important; }
        .h-row:hover { background: #fafbff !important; }
        .h-del:hover { background: #f7c1c1 !important; }
        .h-page-btn:hover { background: #E6F1FB !important; color: #185FA5 !important; }
        .h-refresh:hover { opacity: 0.85; }
        .h-export:hover { background: #f0f0f0 !important; }
      `}</style>

            {/* ── Layout ─────────────────────────────────────────────────────── */}
            <div style={styles.layout}>

                {/* ── Sidebar ────────────────────────────────────────────────── */}
                <Sidebar activePage="history">
                    <div style={styles.sbSection}>Filter by barangay</div>
                    <div style={{ padding: "0 12px 12px" }}>
                        <select
                            value={barangayFilter}
                            onChange={e => setBarangayFilter(e.target.value)}
                            style={styles.sbSelect}
                        >
                            <option value="all">All barangays</option>
                            {barangayOptions.map(n => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                    </div>

                    {/* Severity legend */}
                    <div style={styles.sbSection}>Severity legend</div>
                    <div style={{ padding: "0 12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                        {Object.entries(SEV).map(([key, cfg]) => (
                            <div key={key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#555" }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
                                <span style={{ flex: 1 }}>{cfg.label}</span>
                                <span style={{ fontSize: 10, color: "#aaa" }}>{cfg.signal}</span>
                            </div>
                        ))}
                    </div>
                </Sidebar>

                {/* ── Main content ───────────────────────────────────────────── */}
                <main style={styles.main}>

                    {/* Topbar */}
                    <div style={styles.topbar}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={styles.tbTitle}>Assessment history</span>
                            <span style={styles.tbCount}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button className="h-refresh" onClick={fetchLogs} style={styles.btnRefresh}>
                                <RefreshCw size={12} /> Refresh
                            </button>
                            <button className="h-export" onClick={handleExportCSV} style={styles.btnExport} disabled={filtered.length === 0}>
                                <Download size={12} /> Export CSV
                            </button>
                        </div>
                    </div>

                    <div style={styles.content}>

                        {/* ── Summary stats ─────────────────────────────────────── */}
                        <div style={styles.statsRow}>
                            <StatCard label="Total assessments" value={stats.total} sub="All time" />
                            <StatCard label="Critical events" value={stats.critical} sub="Signal #4–5" valueColor="#A32D2D" />
                            <StatCard
                                label="Avg. wind speed"
                                value={<>{stats.avgWind} <span style={{ fontSize: 13, fontWeight: 400, color: "#aaa" }}>km/h</span></>}
                                sub="Across all records"
                            />
                            <StatCard
                                label="Most assessed"
                                value={<span style={{ fontSize: 14 }}>{stats.topBarangay?.[0] || "—"}</span>}
                                sub={stats.topBarangay ? `${stats.topBarangay[1]} assessments` : "No data yet"}
                            />
                        </div>

                        {/* ── Filters ───────────────────────────────────────────── */}
                        <div style={styles.filtersRow}>
                            <div style={styles.searchWrap}>
                                <Search size={14} style={{ color: "#bbb" }} />
                                <input
                                    type="text"
                                    placeholder="Search barangay or evacuation center..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    style={styles.searchInput}
                                />
                                {searchQuery && (
                                    <span onClick={() => setSearchQuery("")} style={{ cursor: "pointer", color: "#bbb", fontSize: 14, lineHeight: 1 }}>✕</span>
                                )}
                            </div>
                            <div style={styles.filterGroup}>
                                <span style={styles.filterLabel}>Severity</span>
                                <select value={sevFilter} onChange={e => setSevFilter(e.target.value)} style={styles.filterSelect}>
                                    <option value="all">All</option>
                                    <option value="low">Low</option>
                                    <option value="moderate">Moderate</option>
                                    <option value="high">High</option>
                                    <option value="critical">Critical</option>
                                </select>
                            </div>
                            <div style={styles.filterGroup}>
                                <span style={styles.filterLabel}>Period</span>
                                <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} style={styles.filterSelect}>
                                    <option value="all">All time</option>
                                    <option value="7d">Last 7 days</option>
                                    <option value="30d">Last 30 days</option>
                                    <option value="year">This year</option>
                                </select>
                            </div>
                        </div>

                        {/* ── Loading ───────────────────────────────────────────── */}
                        {loading && (
                            <div style={styles.stateBox}>
                                <Loader size={32} style={{ color: "#185FA5", animation: "spin 1.5s linear infinite" }} />
                                <span style={{ fontSize: 13, color: "#aaa", marginTop: 8 }}>Loading history...</span>
                            </div>
                        )}

                        {/* ── Error ─────────────────────────────────────────────── */}
                        {!loading && error && (
                            <div style={{ ...styles.stateBox, background: "#FCEBEB", border: "0.5px solid #F09595" }}>
                                <AlertTriangle size={32} style={{ color: "#A32D2D" }} />
                                <span style={{ fontSize: 13, color: "#A32D2D", marginTop: 8 }}>{error}</span>
                                <button onClick={fetchLogs} style={{ marginTop: 10, padding: "7px 16px", background: "#1565c0", color: "white", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                                    Try again
                                </button>
                            </div>
                        )}

                        {/* ── Empty state ───────────────────────────────────────── */}
                        {!loading && !error && filtered.length === 0 && (
                            <div style={styles.stateBox}>
                                <Inbox size={36} style={{ color: "#ccc" }} />
                                <span style={{ fontSize: 14, color: "#333", fontWeight: 600, marginTop: 10 }}>
                                    {logs.length === 0 ? "No assessments yet" : "No results match your filters"}
                                </span>
                                <span style={{ fontSize: 12, color: "#aaa", marginTop: 4, textAlign: "center" }}>
                                    {logs.length === 0
                                        ? "Go to the dashboard and run your first assessment."
                                        : "Try adjusting your search or filter settings."}
                                </span>
                                {logs.length === 0 && (
                                    <button onClick={() => navigate("/")} style={{ marginTop: 12, padding: "8px 20px", background: "#1565c0", color: "white", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
                                        Go to Dashboard
                                    </button>
                                )}
                            </div>
                        )}

                        {/* ── Table ─────────────────────────────────────────────── */}
                        {!loading && !error && filtered.length > 0 && (
                            <div style={styles.tableWrap}>

                                {/* Table header — now includes Temp & Humidity */}
                                <div style={styles.tableHead}>
                                    <div style={styles.th}>#</div>
                                    <div style={styles.th}>Barangay / date</div>
                                    <div style={styles.th}>Severity</div>
                                    <div style={styles.th}>Wind</div>
                                    <div style={styles.th}>Rainfall</div>
                                    <div style={styles.th}>Pressure</div>
                                    <div style={styles.th}>Temp.</div>       {/* ← NEW */}
                                    <div style={styles.th}>Humidity</div>    {/* ← NEW */}
                                    <div style={styles.th}>Evac. center</div>
                                    <div style={styles.th}>Action</div>
                                </div>

                                {/* Table rows */}
                                {paginated.map((log, i) => {
                                    const globalIndex = filtered.length - ((currentPage - 1) * PAGE_SIZE) - i
                                    const sev = log.typhoon_log?.severity_level || "low"
                                    const hasEvac = !!log.evacuation_center?.name

                                    // ── Temperature color coding ──────────────────
                                    const temp = log.typhoon_log?.temperature
                                    const tempColor = temp == null ? "#aaa"
                                        : temp >= 36 ? "#A32D2D"
                                            : temp >= 32 ? "#D85A30"
                                                : temp < 20 ? "#1565c0"
                                                    : "#1a1a2e"

                                    // ── Humidity color coding ─────────────────────
                                    const humidity = log.typhoon_log?.humidity
                                    const humidityColor = humidity == null ? "#aaa"
                                        : humidity >= 90 ? "#A32D2D"
                                            : humidity >= 75 ? "#D85A30"
                                                : humidity >= 60 ? "#EF9F27"
                                                    : "#1a1a2e"

                                    return (
                                        <div
                                            key={log.id}
                                            className="h-row"
                                            style={{
                                                ...styles.tableRow,
                                                borderBottom: i < paginated.length - 1 ? "0.5px solid #f0f4f8" : "none",
                                                opacity: deletingId === log.id ? 0.4 : 1,
                                                transition: "opacity 0.2s",
                                            }}
                                        >
                                            {/* # */}
                                            <div style={styles.rowNum}>{globalIndex}</div>

                                            {/* Barangay + date */}
                                            <div>
                                                <div style={{ ...styles.rowBname, display: "flex", alignItems: "center", gap: 4 }}>
                                                    <MapPin size={12} style={{ color: "#888" }} /> {log.barangay?.name || "—"}{log.barangay?.city ? `, ${log.barangay.city}` : ""}
                                                </div>
                                                <div style={{ ...styles.rowBdate, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                                                    <Clock size={11} style={{ color: "#bbb" }} /> {formatDateShort(log.recommended_at)} · {formatTime(log.recommended_at)}
                                                </div>
                                            </div>

                                            {/* Severity badge */}
                                            <SeverityBadge severity={sev} />

                                            {/* Wind */}
                                            <div>
                                                <div style={styles.metricVal}>{log.typhoon_log?.wind_speed ?? "—"}</div>
                                                <div style={styles.metricUnit}>km/h</div>
                                            </div>

                                            {/* Rainfall */}
                                            <div>
                                                <div style={styles.metricVal}>{log.typhoon_log?.rainfall ?? "—"}</div>
                                                <div style={styles.metricUnit}>mm/hr</div>
                                            </div>

                                            {/* Pressure */}
                                            <div>
                                                <div style={styles.metricVal}>{log.typhoon_log?.pressure ?? "—"}</div>
                                                <div style={styles.metricUnit}>hPa</div>
                                            </div>

                                            {/* Temperature ← NEW */}
                                            <div>
                                                <div style={{ ...styles.metricVal, color: tempColor }}>
                                                    {temp != null ? temp : "—"}
                                                </div>
                                                <div style={styles.metricUnit}>°C</div>
                                            </div>

                                            {/* Humidity ← NEW */}
                                            <div>
                                                <div style={{ ...styles.metricVal, color: humidityColor }}>
                                                    {humidity != null ? humidity : "—"}
                                                </div>
                                                <div style={styles.metricUnit}>%</div>
                                            </div>

                                            {/* Evacuation center */}
                                            <div style={{ fontSize: 11, color: hasEvac ? "#555" : "#bbb" }}>
                                                {hasEvac ? (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                            <School size={12} style={{ color: "#666" }} /> {log.evacuation_center.name}
                                                        </div>
                                                        {log.evacuation_center.distance !== undefined && log.evacuation_center.distance !== null && (
                                                            <div style={{ fontSize: 10, color: "#1565c0", fontWeight: 600, paddingLeft: 16 }}>
                                                                📍 {parseFloat(log.evacuation_center.distance).toFixed(1)} km away
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : "— None needed"}
                                            </div>

                                            {/* Delete */}
                                            <div>
                                                <button
                                                    className="h-del"
                                                    onClick={() => handleDelete(log.id)}
                                                    disabled={!!deletingId}
                                                    style={styles.deleteBtn}
                                                    title="Delete record"
                                                >
                                                    <Trash2 size={11} /> Delete
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}

                                {/* Pagination */}
                                <div style={styles.pagination}>
                                    <span style={styles.pageInfo}>
                                        Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} records
                                    </span>
                                    <div style={{ display: "flex", gap: 4 }}>
                                        <button
                                            className="h-page-btn"
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            style={{ ...styles.pageBtn, opacity: currentPage === 1 ? 0.4 : 1 }}
                                        >
                                            ‹ Prev
                                        </button>
                                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                                            .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                                            .reduce((acc, p, idx, arr) => {
                                                if (idx > 0 && p - arr[idx - 1] > 1) acc.push("...")
                                                acc.push(p)
                                                return acc
                                            }, [])
                                            .map((p, idx) =>
                                                p === "..." ? (
                                                    <span key={`ellipsis-${idx}`} style={{ padding: "3px 6px", fontSize: 12, color: "#bbb" }}>…</span>
                                                ) : (
                                                    <button
                                                        key={p}
                                                        className="h-page-btn"
                                                        onClick={() => setCurrentPage(p)}
                                                        style={{
                                                            ...styles.pageBtn,
                                                            background: currentPage === p ? "#185FA5" : "white",
                                                            color: currentPage === p ? "white" : "#555",
                                                            borderColor: currentPage === p ? "#185FA5" : "#e0e0e0",
                                                        }}
                                                    >
                                                        {p}
                                                    </button>
                                                )
                                            )}
                                        <button
                                            className="h-page-btn"
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                            style={{ ...styles.pageBtn, opacity: currentPage === totalPages ? 0.4 : 1 }}
                                        >
                                            Next ›
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>
                </main>
            </div>
            <BagyoBot />
        </div>
    )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = {
    page: { minHeight: "100vh", background: "#f0f4f8", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" },

    layout: { display: "flex", flex: 1 },

    sbSection: { fontSize: 10, color: "#bbb", padding: "10px 14px 4px", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" },
    sbItem: { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", fontSize: 12, transition: "background 0.15s, color 0.15s" },
    sbSelect: { width: "100%", fontSize: 12, padding: "6px 8px", borderRadius: 7, border: "0.5px solid #e0e0e0", background: "#fafafa", color: "#333", outline: "none" },

    main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
    topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "linear-gradient(135deg, #1a237e, #1565c0)", borderBottom: "0.5px solid #1a237e", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" },
    tbTitle: { fontSize: 14, fontWeight: 600, color: "white" },
    tbCount: { fontSize: 11, color: "#90caf9", background: "rgba(255, 255, 255, 0.15)", padding: "2px 10px", borderRadius: 20, border: "0.5px solid rgba(255, 255, 255, 0.2)" },

    btnRefresh: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "white", background: "rgba(255, 255, 255, 0.15)", border: "0.5px solid rgba(255, 255, 255, 0.25)", padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontWeight: 500, transition: "opacity 0.15s" },
    btnExport: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "white", background: "rgba(255, 255, 255, 0.08)", border: "0.5px solid rgba(255, 255, 255, 0.15)", padding: "5px 12px", borderRadius: 7, cursor: "pointer", transition: "background 0.15s" },

    content: { padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 },

    statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 },
    statCard: { background: "#f8f9fb", borderRadius: 10, padding: "10px 13px" },
    statLabel: { fontSize: 11, color: "#aaa", marginBottom: 4 },
    statVal: { fontSize: 22, fontWeight: 600, lineHeight: 1, color: "#1a1a2e" },
    statSub: { fontSize: 10, color: "#bbb", marginTop: 3 },

    filtersRow: { display: "flex", alignItems: "center", gap: 8 },
    searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "white", border: "0.5px solid #e0e0e0", borderRadius: 8, padding: "6px 12px", flex: 1.5 },
    searchInput: { border: "none", background: "transparent", fontSize: 12, color: "#333", outline: "none", width: "100%" },
    filterGroup: { display: "flex", alignItems: "center", gap: 6 },
    filterLabel: { fontSize: 11, color: "#aaa", whiteSpace: "nowrap" },
    filterSelect: { fontSize: 12, padding: "6px 9px", borderRadius: 7, border: "0.5px solid #e0e0e0", background: "white", color: "#333", outline: "none" },

    stateBox: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", background: "white", borderRadius: 12, border: "0.5px solid #e8ecf0" },

    tableWrap: { background: "white", borderRadius: 12, border: "0.5px solid #e8ecf0", overflow: "hidden" },

    // ← Updated grid to include Temp + Humidity columns
    tableHead: { display: "grid", gridTemplateColumns: "36px 1.6fr 110px 70px 70px 75px 65px 70px 130px 72px", padding: "8px 16px", background: "#f8f9fb", borderBottom: "0.5px solid #e8ecf0", alignItems: "center" },
    th: { fontSize: 10, fontWeight: 600, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.06em" },
    tableRow: { display: "grid", gridTemplateColumns: "36px 1.6fr 110px 70px 70px 75px 65px 70px 130px 72px", padding: "10px 16px", alignItems: "center", transition: "background 0.1s" },

    rowNum: { fontSize: 11, color: "#bbb", fontWeight: 600 },
    rowBname: { fontSize: 12, fontWeight: 600, color: "#1a1a2e" },
    rowBdate: { fontSize: 10, color: "#aaa", marginTop: 2 },
    metricVal: { fontSize: 13, fontWeight: 600, color: "#1a1a2e" },
    metricUnit: { fontSize: 10, color: "#aaa" },
    deleteBtn: { display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#A32D2D", background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontWeight: 600, transition: "background 0.15s" },

    pagination: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: "0.5px solid #f0f4f8", background: "#fafbff" },
    pageInfo: { fontSize: 11, color: "#aaa" },
    pageBtn: { fontSize: 11, padding: "4px 10px", borderRadius: 6, border: "0.5px solid #e0e0e0", background: "white", color: "#555", cursor: "pointer", fontWeight: 500, transition: "background 0.15s, color 0.15s" },
}