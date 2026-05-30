import { useState, useEffect, useMemo, useCallback } from "react"
import axios from "axios"
import { Loader, Inbox, Filter, Radio, RefreshCw, Download, Search, Trash2, Calendar, X } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"
import { calculateSeverityScore, getSeverityConfig } from "../Dashboard"

const API_BASE = "http://127.0.0.1:8000/api"
const POLL_MS = 5000
const PAGE_SIZE = 8

const FILTER_LABELS = {
    all: "All",
    normal: "Normal",
    watch: "Watch",
    elevated: "Elevated",
    signal1: "Signal 1",
    signal2_3: "Signal 2–3",
    signal4_5: "Signal 4–5",
}

// ─── Q&A History Row Component ───────────────────────────────────────────────
function QAHistoryRow({ log, onDelete }) {
    const [expanded, setExpanded] = useState(false)

    const getSeverityBadgeStyle = (severity) => {
        if (!severity) return { bg: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }
        const sev = severity.toLowerCase()
        if (sev.includes("normal"))   return { bg: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" }
        if (sev.includes("watch"))    return { bg: "#e0f2fe", color: "#075985", border: "1px solid #bae6fd" }
        if (sev.includes("elevated")) return { bg: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }
        if (sev.includes("signal 1")) return { bg: "#ffedd5", color: "#9a3412", border: "1px solid #fed7aa" }
        if (sev.includes("signal 2")) return { bg: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }
        if (sev.includes("signal 3")) return { bg: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" }
        if (sev.includes("signal 4")) return { bg: "#fca5a5", color: "#7f1d1d", border: "1px solid #fca5a5" }
        if (sev.includes("signal 5")) return { bg: "#fca5a5", color: "#7f1d1d", border: "1px solid #fca5a5" }
        return { bg: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }
    }

    const badgeStyle = getSeverityBadgeStyle(log.severity)

    return (
        <tr key={log.id} style={styles.tr}>
            <td style={styles.td}>#{log.id}</td>
            <td style={{ ...styles.td, fontWeight: 600 }}>{log.barangay_name || <span style={{ color: "#888", fontWeight: 400 }}>General</span>}</td>
            <td style={{ ...styles.td, maxWidth: "220px", wordBreak: "break-word" }}>{log.question}</td>
            <td style={{ ...styles.td, maxWidth: "380px", wordBreak: "break-word" }}>
                <div style={{ fontSize: "0.825rem", lineHeight: "1.4" }}>
                    {expanded ? log.answer : `${log.answer.substring(0, 120)}${log.answer.length > 120 ? "..." : ""}`}
                    {log.answer.length > 120 && (
                        <button
                            onClick={() => setExpanded(!expanded)}
                            style={{
                                background: "none",
                                border: "none",
                                color: "#1a237e",
                                cursor: "pointer",
                                fontSize: "0.7rem",
                                fontWeight: "700",
                                marginLeft: "6px",
                                padding: 0,
                                textDecoration: "underline",
                            }}
                        >
                            {expanded ? "Show Less" : "Read More"}
                        </button>
                    )}
                </div>
            </td>
            <td style={styles.td}>
                {log.severity ? (
                    <span style={{ ...styles.badge, background: badgeStyle.bg, color: badgeStyle.color, border: badgeStyle.border }}>
                        {log.severity}
                    </span>
                ) : (
                    <span style={{ color: "#aaa" }}>—</span>
                )}
            </td>
            <td style={styles.td}>
                <div style={{ fontSize: "0.75rem", color: "#555" }}>
                    {new Date(log.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#999" }}>
                    {new Date(log.created_at).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}
                </div>
            </td>
            <td style={styles.td}>
                <button
                    onClick={() => onDelete(log.id)}
                    style={styles.deleteBtn}
                    title="Delete log entry"
                >
                    <Trash2 size={13} />
                </button>
            </td>
        </tr>
    )
}

export default function AdminHistory() {
    const { authHeaders } = useAdminAuth()
    const [activeTab, setActiveTab] = useState("recommendations") // "recommendations" | "qa"

    // ── Recommendations States
    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState(null)
    const [sevFilter, setSevFilter] = useState("all")
    const [lastUpdated, setLastUpdated] = useState(null)
    const [currentPage, setCurrentPage] = useState(1)

    // ── Q&A History States
    const [qaLogs, setQaLogs] = useState([])
    const [qaLoading, setQaLoading] = useState(false)
    const [qaError, setQaError] = useState(null)
    const [qaCurrentPage, setQaCurrentPage] = useState(1)
    const [qaTotalPages, setQaTotalPages] = useState(1)
    const [qaTotalRecords, setQaTotalRecords] = useState(0)
    const [qaSearchInput, setQaSearchInput] = useState("")
    const [qaSearch, setQaSearch] = useState("")
    const [qaBarangay, setQaBarangay] = useState("all")
    const [qaStartDate, setQaStartDate] = useState("")
    const [qaEndDate, setQaEndDate] = useState("")

    // Shared list of barangays
    const [barangayList, setBarangayList] = useState([])

    // ── Load Barangays on mount
    useEffect(() => {
        axios.get(`${API_BASE}/barangays`)
            .then(res => setBarangayList(res.data))
            .catch(err => console.error("Failed to load barangays:", err))
    }, [])

    // ── Fetch Recommendations
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
        if (activeTab === "recommendations") {
            fetchLogs(false)
        }
    }, [fetchLogs, activeTab])

    // Recommendations Polling
    useEffect(() => {
        if (activeTab !== "recommendations") return
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                fetchLogs(true)
            }
        }, POLL_MS)
        return () => clearInterval(interval)
    }, [fetchLogs, activeTab])

    // ── Fetch Q&A Chat Logs
    const fetchQALogs = useCallback(async () => {
        setQaLoading(true)
        setQaError(null)
        try {
            const params = {
                page: qaCurrentPage,
                barangay: qaBarangay,
                search: qaSearch,
                start_date: qaStartDate,
                end_date: qaEndDate,
            }
            const res = await axios.get(`${API_BASE}/chat/history`, {
                params,
                headers: authHeaders(),
            })
            setQaLogs(res.data.data || [])
            setQaTotalPages(res.data.last_page || 1)
            setQaTotalRecords(res.data.total || 0)
        } catch {
            setQaError("Failed to load Q&A history.")
        } finally {
            setQaLoading(false)
        }
    }, [qaCurrentPage, qaBarangay, qaSearch, qaStartDate, qaEndDate, authHeaders])

    useEffect(() => {
        if (activeTab === "qa") {
            fetchQALogs()
        }
    }, [fetchQALogs, activeTab])

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

    // --- CSV Export (Recommendations) ---
    const handleExportCSV = () => {
        const headers = ["ID", "Barangay", "Severity", "Wind (km/h)", "Rainfall (mm)", "Pressure (hPa)", "Temperature (°C)", "Humidity (%)", "Evacuation Center"]
        const rows = filtered.map((rec) => {
            const tLog = rec.typhoon_log
            const score = tLog ? calculateSeverityScore(
                parseFloat(tLog.wind_speed) || 0,
                parseFloat(tLog.rainfall) || 0,
                parseFloat(tLog.pressure) || 0,
                parseFloat(tLog.temperature) || 0,
                parseFloat(tLog.humidity) || 0
            ) : 0
            const cfg = getSeverityConfig(
                score,
                tLog ? parseFloat(tLog.wind_speed) || 0 : 0,
                tLog ? parseFloat(tLog.rainfall) || 0 : 0,
                tLog ? parseFloat(tLog.pressure) || 1013 : 1013
            )
            return [
                rec.id,
                rec.barangay?.name || "-",
                cfg.label,
                rec.typhoon_log?.wind_speed ?? "-",
                rec.typhoon_log?.rainfall ?? "-",
                rec.typhoon_log?.pressure ?? "-",
                rec.typhoon_log?.temperature != null ? `${parseFloat(rec.typhoon_log.temperature).toFixed(1)}` : "-",
                rec.typhoon_log?.humidity != null ? `${parseFloat(rec.typhoon_log.humidity).toFixed(1)}` : "-",
                rec.evacuation_center?.name || "-",
            ]
        })
        const csvContent = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `bagyo-alerto-recommendations-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // --- CSV Export (Q&A History) ---
    const handleExportQACSV = () => {
        const headers = ["ID", "Barangay", "Question", "Answer", "Severity", "Wind (km/h)", "Rainfall (mm)", "Pressure (hPa)", "Temperature (°C)", "Humidity (%)", "Asked By", "Date"]
        const rows = qaLogs.map((log) => [
            log.id,
            log.barangay_name || "General",
            log.question,
            log.answer,
            log.severity || "—",
            log.wind ?? "—",
            log.rainfall ?? "—",
            log.pressure ?? "—",
            log.temperature ?? "—",
            log.humidity ?? "—",
            log.asked_by,
            new Date(log.created_at).toLocaleString("en-PH")
        ])
        const csvContent = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `bagyo-alerto-qa-history-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    // --- Delete Single Q&A Entry ---
    const handleDeleteQAEntry = async (id) => {
        if (!window.confirm("Are you sure you want to delete this chat entry from history?")) return
        try {
            await axios.delete(`${API_BASE}/chat/history/${id}`, { headers: authHeaders() })
            setQaLogs(prev => prev.filter(log => log.id !== id))
            setQaTotalRecords(prev => prev - 1)
        } catch (err) {
            alert("Failed to delete chat record.")
        }
    }

    // --- Clear All Q&A History ---
    const handleClearQAHistory = async () => {
        if (!window.confirm("WARNING: This will permanently delete ALL chat history logs from the database. Are you sure?")) return
        try {
            await axios.delete(`${API_BASE}/chat/history`, { headers: authHeaders() })
            setQaLogs([])
            setQaTotalRecords(0)
            setQaCurrentPage(1)
            setQaTotalPages(1)
        } catch (err) {
            alert("Failed to clear chat history.")
        }
    }

    // --- Q&A Filter Submit / Clear ---
    const handleSearchSubmit = (e) => {
        e.preventDefault()
        setQaCurrentPage(1)
        setQaSearch(qaSearchInput)
    }

    const handleClearFilters = () => {
        setQaSearchInput("")
        setQaSearch("")
        setQaBarangay("all")
        setQaStartDate("")
        setQaEndDate("")
        setQaCurrentPage(1)
    }

    const filtered = useMemo(() => {
        return logs.filter((log) => {
            const tLog = log.typhoon_log
            if (!tLog) return false
            const score = calculateSeverityScore(
                parseFloat(tLog.wind_speed) || 0,
                parseFloat(tLog.rainfall) || 0,
                parseFloat(tLog.pressure) || 0,
                parseFloat(tLog.temperature) || 0,
                parseFloat(tLog.humidity) || 0
            )
            const cfg = getSeverityConfig(
                score,
                parseFloat(tLog.wind_speed) || 0,
                parseFloat(tLog.rainfall) || 0,
                parseFloat(tLog.pressure) || 1013
            )
            if (sevFilter === "all") return true
            if (sevFilter === "normal") return cfg.label === "Normal / Clear"
            if (sevFilter === "watch") return cfg.label === "Watch / LPA"
            if (sevFilter === "elevated") return cfg.label === "Elevated Alert"
            if (sevFilter === "signal1") return cfg.label === "PAGASA Signal 1"
            if (sevFilter === "signal2_3") return cfg.label === "PAGASA Signal 2–3"
            if (sevFilter === "signal4_5") return cfg.label === "PAGASA Signal 4–5"
            return true
        })
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
            {/* ── Tabs Navigator ── */}
            <div style={styles.tabContainer}>
                <button
                    style={{
                        ...styles.tabBtn,
                        borderBottom: activeTab === "recommendations" ? "3px solid #1a237e" : "3px solid transparent",
                        color: activeTab === "recommendations" ? "#1a237e" : "#555",
                        fontWeight: activeTab === "recommendations" ? "700" : "500",
                    }}
                    onClick={() => setActiveTab("recommendations")}
                >
                    Evacuation Recommendations
                </button>
                <button
                    style={{
                        ...styles.tabBtn,
                        borderBottom: activeTab === "qa" ? "3px solid #1a237e" : "3px solid transparent",
                        color: activeTab === "qa" ? "#1a237e" : "#555",
                        fontWeight: activeTab === "qa" ? "700" : "500",
                    }}
                    onClick={() => setActiveTab("qa")}
                >
                    Q&A Chat History
                </button>
            </div>

            {activeTab === "recommendations" ? (
                <>
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
                            {["all", "normal", "watch", "elevated", "signal1", "signal2_3", "signal4_5"].map((s) => (
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
                                    {FILTER_LABELS[s]}
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
                                             const tLog = rec.typhoon_log
                                             const score = tLog ? calculateSeverityScore(
                                                 parseFloat(tLog.wind_speed) || 0,
                                                 parseFloat(tLog.rainfall) || 0,
                                                 parseFloat(tLog.pressure) || 0,
                                                 parseFloat(tLog.temperature) || 0,
                                                 parseFloat(tLog.humidity) || 0
                                             ) : 0
                                             const cfg = getSeverityConfig(
                                                 score,
                                                 tLog ? parseFloat(tLog.wind_speed) || 0 : 0,
                                                 tLog ? parseFloat(tLog.rainfall) || 0 : 0,
                                                 tLog ? parseFloat(tLog.pressure) || 1013 : 1013
                                             )
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
                </>
            ) : (
                /* ── Q&A Chat History Content ── */
                <>
                    {/* ── Advanced Q&A Filters Toolbar ── */}
                    <div style={styles.qaSearchPanel}>
                        <form onSubmit={handleSearchSubmit} style={styles.searchForm}>
                            <div style={styles.inputWithIcon}>
                                <Search size={14} style={styles.searchIcon} />
                                <input
                                    type="text"
                                    placeholder="Search Q&A questions or responses..."
                                    value={qaSearchInput}
                                    onChange={(e) => setQaSearchInput(e.target.value)}
                                    style={styles.searchInputField}
                                />
                            </div>

                            <div style={styles.filterGroup}>
                                <Filter size={13} color="#888" />
                                <select
                                    value={qaBarangay}
                                    onChange={(e) => {
                                        setQaCurrentPage(1)
                                        setQaBarangay(e.target.value)
                                    }}
                                    style={styles.selectDropdown}
                                >
                                    <option value="all">All Barangays</option>
                                    <option value="General">General / No Barangay</option>
                                    {barangayList.map((b) => (
                                        <option key={b.id} value={b.name}>{b.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div style={styles.dateGroup}>
                                <Calendar size={13} color="#888" />
                                <input
                                    type="date"
                                    value={qaStartDate}
                                    onChange={(e) => {
                                        setQaCurrentPage(1)
                                        setQaStartDate(e.target.value)
                                    }}
                                    style={styles.dateField}
                                    title="Start Date"
                                />
                                <span style={{ color: "#aaa", fontSize: "11px" }}>to</span>
                                <input
                                    type="date"
                                    value={qaEndDate}
                                    onChange={(e) => {
                                        setQaCurrentPage(1)
                                        setQaEndDate(e.target.value)
                                    }}
                                    style={styles.dateField}
                                    title="End Date"
                                />
                            </div>

                            <div style={{ display: "flex", gap: "6px" }}>
                                <button type="submit" style={styles.searchBtn}>
                                    Filter
                                </button>
                                {(qaSearch || qaBarangay !== "all" || qaStartDate || qaEndDate) && (
                                    <button
                                        type="button"
                                        onClick={handleClearFilters}
                                        style={styles.clearFiltersBtn}
                                        title="Clear filters"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>

                    <div style={styles.toolbar}>
                        <div style={styles.count}>
                            Found {qaTotalRecords} chat question{qaTotalRecords !== 1 ? "s" : ""}
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button
                                onClick={handleExportQACSV}
                                disabled={qaLogs.length === 0}
                                style={{ ...styles.exportBtn, opacity: qaLogs.length === 0 ? 0.4 : 1 }}
                            >
                                <Download size={13} /> Export CSV
                            </button>
                            <button
                                onClick={handleClearQAHistory}
                                disabled={qaLogs.length === 0}
                                style={{ ...styles.dangerBtn, opacity: qaLogs.length === 0 ? 0.4 : 1 }}
                            >
                                <Trash2 size={13} /> Clear All History
                            </button>
                        </div>
                    </div>

                    {qaError && <div style={styles.errorBox}>{qaError}</div>}

                    <div style={styles.tableWrap}>
                        {qaLoading ? (
                            <div style={styles.center}>
                                <Loader size={24} color="#1a237e" style={{ animation: "spin 1s linear infinite" }} />
                                <span style={{ color: "#888", marginTop: 10 }}>Loading chat history...</span>
                            </div>
                        ) : qaLogs.length === 0 ? (
                            <div style={styles.center}>
                                <Inbox size={36} color="#ccc" />
                                <span style={{ color: "#888", marginTop: 10 }}>No Q&A records found matching the criteria.</span>
                            </div>
                        ) : (
                            <>
                                <table style={styles.table}>
                                    <thead>
                                        <tr>
                                            <th style={{ ...styles.th, width: "6%" }}>ID</th>
                                            <th style={{ ...styles.th, width: "15%" }}>Barangay</th>
                                            <th style={{ ...styles.th, width: "30%" }}>Question</th>
                                            <th style={{ ...styles.th, width: "34%" }}>Answer Response</th>
                                            <th style={{ ...styles.th, width: "15%" }}>Severity</th>
                                            <th style={{ ...styles.th, width: "15%" }}>Asked At</th>
                                            <th style={{ ...styles.th, width: "5%" }}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {qaLogs.map((log) => (
                                            <QAHistoryRow
                                                key={log.id}
                                                log={log}
                                                onDelete={handleDeleteQAEntry}
                                            />
                                        ))}
                                    </tbody>
                                </table>

                                {/* ── Q&A Server Side Pagination ── */}
                                <div style={styles.pagination}>
                                    <span style={styles.pageInfo}>
                                        Showing page {qaCurrentPage} of {qaTotalPages} ({qaTotalRecords} total questions)
                                    </span>
                                    <div style={{ display: "flex", gap: 4 }}>
                                        <button
                                            onClick={() => setQaCurrentPage((p) => Math.max(1, p - 1))}
                                            disabled={qaCurrentPage === 1}
                                            style={{ ...styles.pageBtn, opacity: qaCurrentPage === 1 ? 0.4 : 1 }}
                                        >
                                            Prev
                                        </button>
                                        {Array.from({ length: qaTotalPages }, (_, i) => i + 1)
                                            .filter((p) => p === 1 || p === qaTotalPages || Math.abs(p - qaCurrentPage) <= 1)
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
                                                        onClick={() => setQaCurrentPage(p)}
                                                        style={{
                                                            ...styles.pageBtn,
                                                            background: qaCurrentPage === p ? "#1a237e" : "white",
                                                            color: qaCurrentPage === p ? "white" : "#555",
                                                            borderColor: qaCurrentPage === p ? "#1a237e" : "#e0e0e0",
                                                        }}
                                                    >
                                                        {p}
                                                    </button>
                                                )
                                            )}
                                        <button
                                            onClick={() => setQaCurrentPage((p) => Math.min(qaTotalPages, p + 1))}
                                            disabled={qaCurrentPage === qaTotalPages}
                                            style={{ ...styles.pageBtn, opacity: qaCurrentPage === qaTotalPages ? 0.4 : 1 }}
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </>
            )}
        </AdminLayout>
    )
}

const styles = {
    tabContainer: {
        display: "flex",
        borderBottom: "1px solid #e2e8f0",
        marginBottom: "20px",
        gap: "24px",
    },
    tabBtn: {
        background: "none",
        border: "none",
        fontSize: "14px",
        padding: "10px 4px",
        cursor: "pointer",
        transition: "all 0.2s ease-in-out",
        outline: "none",
    },
    qaSearchPanel: {
        background: "#fff",
        borderRadius: "10px",
        padding: "14px 16px",
        border: "1px solid #e8ecf0",
        marginBottom: "16px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
    },
    searchForm: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "12px",
    },
    inputWithIcon: {
        display: "flex",
        alignItems: "center",
        flex: 1,
        minWidth: "220px",
        background: "#f8fafc",
        border: "1px solid #cbd5e1",
        borderRadius: "8px",
        padding: "0 12px",
    },
    searchIcon: {
        color: "#64748b",
        marginRight: "8px",
    },
    searchInputField: {
        width: "100%",
        background: "transparent",
        border: "none",
        padding: "8px 0",
        fontSize: "13px",
        outline: "none",
        color: "#1e293b",
    },
    filterGroup: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "#f8fafc",
        border: "1px solid #cbd5e1",
        borderRadius: "8px",
        padding: "0 10px",
    },
    selectDropdown: {
        background: "transparent",
        border: "none",
        padding: "8px 4px",
        fontSize: "13px",
        outline: "none",
        color: "#475569",
        cursor: "pointer",
    },
    dateGroup: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "#f8fafc",
        border: "1px solid #cbd5e1",
        borderRadius: "8px",
        padding: "0 10px",
    },
    dateField: {
        background: "transparent",
        border: "none",
        padding: "7px 0",
        fontSize: "12px",
        outline: "none",
        color: "#475569",
    },
    searchBtn: {
        padding: "8px 16px",
        background: "#1a237e",
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        fontSize: "13px",
        fontWeight: "600",
        cursor: "pointer",
        transition: "background 0.2s",
    },
    clearFiltersBtn: {
        padding: "8px",
        background: "#f1f5f9",
        color: "#475569",
        border: "1px solid #cbd5e1",
        borderRadius: "8px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    deleteBtn: {
        background: "#fef2f2",
        border: "1px solid #fee2e2",
        borderRadius: "6px",
        color: "#ef4444",
        padding: "5px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.15s",
    },
    dangerBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 12px",
        borderRadius: 6,
        border: "1px solid #fca5a5",
        background: "#fef2f2",
        color: "#b91c1c",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
    },
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
