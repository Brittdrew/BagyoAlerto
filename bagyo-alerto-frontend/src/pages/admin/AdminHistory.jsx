import { useState, useEffect, useMemo, useCallback } from "react"
import axios from "axios"
import { Loader, Inbox, Filter, Radio, RefreshCw, Download } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = "http://127.0.0.1:8000/api"
const POLL_MS = 5000
const PAGE_SIZE = 8

const SEV = {
    low: { label: "Low", color: "#1D9E75", bg: "#E1F5EE" },
    moderate: { label: "Moderate", color: "#BA7517", bg: "#FAEEDA" },
    high: { label: "High", color: "#D85A30", bg: "#FAECE7" },
    critical: { label: "Critical", color: "#A32D2D", bg: "#FCEBEB" },
}

export default function AdminHistory() {
    const { authHeaders } = useAdminAuth()
    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState(null)
    const [sevFilter, setSevFilter] = useState("all")
    const [lastUpdated, setLastUpdated] = useState(null)
    const [currentPage, setCurrentPage] = useState(1)

    const fetchLogs = useCallback(async (silent = false) => {
        if (!silent) setLoading(true)
        else setRefreshing(true)
        if (!silent) setError(null)
        try {
            const res = await axios.get(`${API_BASE}/admin/recommendations`, { headers: authHeaders() })
            setLogs(res.data)
            setLastUpdated(new Date())
            setError(null)
        } catch {
            if (!silent) setError("Failed to load recommendation history.")
        }
        setLoading(false)
        setRefreshing(false)
    }, [authHeaders])

    useEffect(() => {
        fetchLogs(false)
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                fetchLogs(true)
            }
        }, POLL_MS)
        return () => clearInterval(interval)
    }, [fetchLogs])

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : null

    // --- Color helpers for temperature & humidity ---
    const getTempColor = (val) => {
        if (val == null) return "#999"
        const t = parseFloat(val)
        if (t < 20) return "#1565c0"
        if (t <= 32) return "#1a1a2e"
        if (t <= 36) return "#D85A30"
        return "#A32D2D"
    }
    const getHumidColor = (val) => {
        if (val == null) return "#999"
        const h = parseFloat(val)
        if (h < 60) return "#1a1a2e"
        if (h <= 75) return "#EF9F27"
        if (h <= 90) return "#D85A30"
        return "#A32D2D"
    }

    // --- CSV Export ---
    const handleExportCSV = () => {
        const headers = ["ID", "Barangay", "Severity", "Wind (km/h)", "Rainfall (mm)", "Pressure (hPa)", "Temperature (°C)", "Humidity (%)", "Evacuation Center"]
        const rows = filtered.map((rec) => [
            rec.id,
            rec.barangay?.name || "-",
            (SEV[rec.typhoon_log?.severity_level] || SEV.low).label,
            rec.typhoon_log?.wind_speed ?? "-",
            rec.typhoon_log?.rainfall ?? "-",
            rec.typhoon_log?.pressure ?? "-",
            rec.typhoon_log?.temperature != null ? `${parseFloat(rec.typhoon_log.temperature).toFixed(1)}` : "-",
            rec.typhoon_log?.humidity != null ? `${parseFloat(rec.typhoon_log.humidity).toFixed(1)}` : "-",
            rec.evacuation_center?.name || "-",
        ])
        const csvContent = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `bagyo-alerto-history-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const filtered = useMemo(() => {
        if (sevFilter === "all") return logs
        return logs.filter((l) => l.typhoon_log?.severity_level === sevFilter)
    }, [logs, sevFilter])

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

    useEffect(() => {
        setCurrentPage(1)
    }, [sevFilter])

    useEffect(() => {
        setCurrentPage((p) => Math.min(p, totalPages))
    }, [totalPages])

    return (
        <AdminLayout title="History">
            <div style={styles.liveBar}>
                <span style={styles.liveBadge}>
                    <Radio size={12} />
                    Live
                </span>
                <span style={styles.liveText}>New evacuation recommendations appear automatically</span>
                {lastUpdatedStr && (
                    <span style={styles.liveMeta}>
                        <RefreshCw size={11} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
                        Updated {lastUpdatedStr}
                    </span>
                )}
            </div>

            <div style={styles.toolbar}>
                <div style={styles.filterRow}>
                    <Filter size={14} color="#888" />
                    <span style={styles.filterLabel}>Severity:</span>
                    {["all", "low", "moderate", "high", "critical"].map((s) => (
                        <div
                            key={s}
                            onClick={() => setSevFilter(s)}
                            style={{
                                ...styles.filterBtn,
                                background: sevFilter === s ? "#1a237e" : "#fff",
                                color: sevFilter === s ? "#fff" : "#555",
                                border: sevFilter === s ? "1px solid #1a237e" : "1px solid #ddd",
                            }}
                        >
                            {s === "all" ? "All" : SEV[s]?.label || s}
                        </div>
                    ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={styles.count}>{filtered.length} record{filtered.length !== 1 ? "s" : ""}</div>
                    <button onClick={handleExportCSV} disabled={filtered.length === 0} style={{ ...styles.exportBtn, opacity: filtered.length === 0 ? 0.4 : 1 }}>
                        <Download size={13} /> Export CSV
                    </button>
                </div>
            </div>

            {error && <div style={styles.errorBox}>{error}</div>}

            <div style={styles.tableWrap}>
                {loading ? (
                    <div style={styles.center}>
                        <Loader size={24} color="#1a237e" style={{ animation: "spin 1s linear infinite" }} />
                        <span style={{ color: "#888", marginTop: 10 }}>Loading history...</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={styles.center}>
                        <Inbox size={36} color="#ccc" />
                        <span style={{ color: "#888", marginTop: 10 }}>No recommendations found.</span>
                    </div>
                ) : (
                    <>
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={styles.th}>ID</th>
                                    <th style={styles.th}>Barangay</th>
                                    <th style={styles.th}>Severity</th>
                                    <th style={styles.th}>Wind (km/h)</th>
                                    <th style={styles.th}>Rainfall (mm)</th>
                                    <th style={styles.th}>Pressure (hPa)</th>
                                    <th style={styles.th}>Temp. (°C)</th>
                                    <th style={styles.th}>Humidity (%)</th>
                                    <th style={styles.th}>Evac. Center</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((rec) => {
                                    const sev = rec.typhoon_log?.severity_level || "low"
                                    const cfg = SEV[sev] || SEV.low
                                    return (
                                        <tr key={rec.id} style={styles.tr}>
                                            <td style={styles.td}>#{rec.id}</td>
                                            <td style={styles.td}>{rec.barangay?.name || "—"}</td>
                                            <td style={styles.td}>
                                                <span
                                                    style={{
                                                        ...styles.badge,
                                                        background: cfg.bg,
                                                        color: cfg.color,
                                                    }}
                                                >
                                                    {cfg.label}
                                                </span>
                                            </td>
                                            <td style={styles.td}>{rec.typhoon_log?.wind_speed ?? "—"}</td>
                                            <td style={styles.td}>{rec.typhoon_log?.rainfall ?? "—"}</td>
                                            <td style={styles.td}>{rec.typhoon_log?.pressure ?? "—"}</td>
                                            <td style={{ ...styles.td, fontWeight: 600, color: getTempColor(rec.typhoon_log?.temperature) }}>
                                                {rec.typhoon_log?.temperature != null ? `${parseFloat(rec.typhoon_log.temperature).toFixed(1)}°C` : "—"}
                                            </td>
                                            <td style={{ ...styles.td, fontWeight: 600, color: getHumidColor(rec.typhoon_log?.humidity) }}>
                                                {rec.typhoon_log?.humidity != null ? `${parseFloat(rec.typhoon_log.humidity).toFixed(1)}%` : "—"}
                                            </td>
                                            <td style={styles.td}>{rec.evacuation_center?.name || "—"}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>

                        <div style={styles.pagination}>
                            <span style={styles.pageInfo}>
                                Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} records
                            </span>
                            <div style={{ display: "flex", gap: 4 }}>
                                <button
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    style={{ ...styles.pageBtn, opacity: currentPage === 1 ? 0.4 : 1 }}
                                >
                                    Prev
                                </button>
                                {Array.from({ length: totalPages }, (_, i) => i + 1)
                                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                                    .reduce((acc, p, idx, arr) => {
                                        if (idx > 0 && p - arr[idx - 1] > 1) acc.push("...")
                                        acc.push(p)
                                        return acc
                                    }, [])
                                    .map((p, idx) =>
                                        p === "..." ? (
                                            <span key={`ellipsis-${idx}`} style={{ padding: "3px 6px", fontSize: 12, color: "#bbb" }}>...</span>
                                        ) : (
                                            <button
                                                key={p}
                                                onClick={() => setCurrentPage(p)}
                                                style={{
                                                    ...styles.pageBtn,
                                                    background: currentPage === p ? "#1a237e" : "white",
                                                    color: currentPage === p ? "white" : "#555",
                                                    borderColor: currentPage === p ? "#1a237e" : "#e0e0e0",
                                                }}
                                            >
                                                {p}
                                            </button>
                                        )
                                    )}
                                <button
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    style={{ ...styles.pageBtn, opacity: currentPage === totalPages ? 0.4 : 1 }}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </AdminLayout>
    )
}

const styles = {
    toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 },
    filterRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    filterLabel: { fontSize: 12, color: "#888", fontWeight: 500 },
    filterBtn: {
        padding: "5px 12px", borderRadius: 20, fontSize: 12,
        fontWeight: 500, cursor: "pointer",
    },
    count: { fontSize: 13, color: "#888" },
    tableWrap: { background: "#fff", borderRadius: 10, border: "1px solid #e8ecf0", overflow: "hidden", minHeight: 200 },
    table: { width: "100%", borderCollapse: "collapse" },
    th: {
        textAlign: "left", padding: "12px 16px", fontSize: 11, fontWeight: 600,
        color: "#888", textTransform: "uppercase", letterSpacing: 0.5,
        background: "#f8f9fc", borderBottom: "1px solid #e8ecf0",
    },
    tr: { borderBottom: "1px solid #f0f0f0" },
    td: { padding: "12px 16px", fontSize: 13, color: "#333" },
    badge: { padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 },
    center: { display: "flex", flexDirection: "column", alignItems: "center", padding: 48 },
    errorBox: { background: "#fcebeb", color: "#a32d2d", padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13 },
    liveBar: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 16,
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
    liveText: { fontSize: 12, color: "#555", flex: 1, minWidth: 180 },
    liveMeta: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        color: "#888",
    },
    pagination: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderTop: "1px solid #f0f4f8",
        background: "#fafbff",
    },
    pageInfo: { fontSize: 11, color: "#888" },
    pageBtn: {
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid #e0e0e0",
        background: "white",
        color: "#555",
        cursor: "pointer",
        fontWeight: 500,
    },
    exportBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 12px",
        borderRadius: 6,
        border: "1px solid #c5cae9",
        background: "#f0f4ff",
        color: "#1a237e",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
    },
}
