import { useState, useEffect, useCallback } from "react"
import axios from "axios"
import {
    RefreshCw,
    Wind,
    CloudRain,
    Gauge,
    Thermometer,
    Inbox,
    Sun,
    CloudSun,
    Cloud,
    Snowflake,
    CloudLightning,
    MapPin,
    AlertTriangle,
} from "lucide-react"
import AdminLayout from "../../components/AdminLayout"

const API_BASE = "http://127.0.0.1:8000/api"
const REFRESH_MS = 10 * 60 * 1000

const RISK_COLORS = {
    low: { bg: "#E1F5EE", color: "#085041", border: "#1D9E75" },
    moderate: { bg: "#FAEEDA", color: "#633806", border: "#EF9F27" },
    high: { bg: "#FAECE7", color: "#4A1B0C", border: "#D85A30" },
    critical: { bg: "#FCEBEB", color: "#501313", border: "#E24B4A" },
}

const SEV_STYLES = {
    low: { label: "LOW", signal: "Signal #1", color: "#1D9E75", bg: "#E1F5EE", border: "#1D9E75", text: "#085041" },
    moderate: { label: "MODERATE", signal: "Signal #2", color: "#BA7517", bg: "#FAEEDA", border: "#EF9F27", text: "#633806" },
    high: { label: "HIGH", signal: "Signal #3", color: "#D85A30", bg: "#FAECE7", border: "#D85A30", text: "#4A1B0C" },
    critical: { label: "CRITICAL", signal: "Signal #4–5", color: "#E24B4A", bg: "#FCEBEB", border: "#E24B4A", text: "#501313" },
}

function getWeatherIcon(code, size = 28) {
    const s = { flexShrink: 0 }
    if (code === 0) return <Sun size={size} style={{ ...s, color: "#ffb300" }} />
    if (code <= 3) return <CloudSun size={size} style={{ ...s, color: "#ffe082" }} />
    if (code <= 48) return <Cloud size={size} style={{ ...s, color: "#b0bec5" }} />
    if (code <= 67) return <CloudRain size={size} style={{ ...s, color: "#64b5f6" }} />
    if (code <= 77) return <Snowflake size={size} style={{ ...s, color: "#90caf9" }} />
    if (code <= 82) return <CloudRain size={size} style={{ ...s, color: "#42a5f5" }} />
    if (code <= 99) return <CloudLightning size={size} style={{ ...s, color: "#ba68c8" }} />
    return <Gauge size={size} style={{ ...s, color: "#888" }} />
}

function getWeatherDesc(code) {
    if (code === 0) return "Clear Sky"
    if (code <= 3) return "Partly Cloudy"
    if (code <= 48) return "Foggy"
    if (code <= 67) return "Rainy"
    if (code <= 82) return "Showers"
    if (code <= 99) return "Thunderstorms"
    return "Mild"
}

/** PAGASA wind-based AI severity (admin monitor thresholds) */
function calculateWindSeverity(windKmh) {
    const w = parseFloat(windKmh) || 0
    if (w > 170) return SEV_STYLES.critical
    if (w >= 121) return SEV_STYLES.high
    if (w >= 61) return SEV_STYLES.moderate
    if (w >= 30) return SEV_STYLES.low
    return { ...SEV_STYLES.low, signal: "Below Signal #1", label: "LOW" }
}

function getSeverityKey(windKmh) {
    const w = parseFloat(windKmh) || 0
    if (w > 170) return "critical"
    if (w >= 121) return "high"
    if (w >= 61) return "moderate"
    return "low"
}

async function fetchBarangayWeather(barangay) {
    const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${barangay.latitude}&longitude=${barangay.longitude}` +
        `&current=wind_speed_10m,precipitation,surface_pressure,temperature_2m,weathercode` +
        `&timezone=Asia%2FManila`
    const res = await axios.get(url)
    const current = res.data.current
    const wind = current.wind_speed_10m
    const severity = calculateWindSeverity(wind)
    return {
        status: "success",
        weather: current,
        severity,
        severityKey: getSeverityKey(wind),
        fetchedAt: new Date(),
    }
}

function formatTime(d) {
    if (!d) return "—"
    return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function SkeletonCard() {
    return (
        <div style={styles.card}>
            <div style={styles.skeletonHeader}>
                <div style={{ ...styles.skel, width: "55%", height: 18 }} />
                <div style={{ ...styles.skel, width: 70, height: 22, borderRadius: 20 }} />
            </div>
            <div style={styles.metricGrid}>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} style={styles.metricCell}>
                        <div style={{ ...styles.skel, width: "40%", height: 10, marginBottom: 8 }} />
                        <div style={{ ...styles.skel, width: "70%", height: 16 }} />
                    </div>
                ))}
            </div>
            <div style={{ ...styles.skel, height: 36, borderRadius: 8, marginTop: 12 }} />
            <div style={{ fontSize: 12, color: "#888", marginTop: 12, textAlign: "center" }}>
                ⏳ Fetching weather...
            </div>
        </div>
    )
}

function WeatherCard({ entry }) {
    const { barangay, status, weather, severity, fetchedAt, error } = entry
    const risk = RISK_COLORS[barangay.risk_level] || RISK_COLORS.low
    const borderColor = status === "success" ? severity?.border : status === "error" ? "#E24B4A" : "#e0e0e0"

    if (status === "loading") {
        return <SkeletonCard />
    }

    if (status === "error") {
        return (
            <div style={{ ...styles.card, borderLeft: `4px solid #E24B4A` }}>
                <div style={styles.cardHeader}>
                    <div>
                        <div style={styles.cardTitle}>{barangay.name}</div>
                        <div style={styles.cardCity}>{barangay.city}</div>
                    </div>
                    <span style={{ ...styles.riskBadge, background: risk.bg, color: risk.color, border: `1px solid ${risk.border}` }}>
                        {barangay.risk_level}
                    </span>
                </div>
                <div style={styles.errorBody}>
                    <AlertTriangle size={20} color="#E24B4A" />
                    <span>{error || "Failed to fetch weather"}</span>
                </div>
                <div style={styles.fetchedAt}>Last attempt: {formatTime(fetchedAt)}</div>
            </div>
        )
    }

    const code = weather.weathercode

    return (
        <div style={{ ...styles.card, borderLeft: `4px solid ${borderColor}` }}>
            <div style={styles.cardHeader}>
                <div>
                    <div style={styles.cardTitle}>{barangay.name}</div>
                    <div style={styles.cardCity}>
                        <MapPin size={11} style={{ marginRight: 4, verticalAlign: "middle" }} />
                        {barangay.city}
                    </div>
                </div>
                <span style={{ ...styles.riskBadge, background: risk.bg, color: risk.color, border: `1px solid ${risk.border}` }}>
                    {barangay.risk_level}
                </span>
            </div>

            <div style={styles.metricGrid}>
                <div style={styles.metricCell}>
                    <div style={styles.metricLabel}><Thermometer size={12} /> Temperature</div>
                    <div style={styles.metricValue}>{Math.round(weather.temperature_2m)}°C</div>
                </div>
                <div style={styles.metricCell}>
                    <div style={styles.metricLabel}><Wind size={12} /> Wind Speed</div>
                    <div style={styles.metricValue}>{weather.wind_speed_10m} km/h</div>
                </div>
                <div style={styles.metricCell}>
                    <div style={styles.metricLabel}><CloudRain size={12} /> Rainfall</div>
                    <div style={styles.metricValue}>{weather.precipitation} mm/hr</div>
                </div>
                <div style={styles.metricCell}>
                    <div style={styles.metricLabel}><Gauge size={12} /> Pressure</div>
                    <div style={styles.metricValue}>{Math.round(weather.surface_pressure)} hPa</div>
                </div>
                <div style={{ ...styles.metricCell, gridColumn: "span 1" }}>
                    <div style={styles.metricLabel}>Condition</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                        {getWeatherIcon(code, 24)}
                    </div>
                </div>
                <div style={styles.metricCell}>
                    <div style={styles.metricLabel}>Outlook</div>
                    <div style={{ ...styles.metricValue, fontSize: 12 }}>{getWeatherDesc(code)}</div>
                </div>
            </div>

            <div style={{
                ...styles.sevBanner,
                background: severity.bg,
                border: `1px solid ${severity.border}`,
                color: severity.text,
            }}>
                <AlertTriangle size={14} style={{ color: severity.color, flexShrink: 0 }} />
                <span>
                    <strong>AI Severity: {severity.label}</strong>
                    {" · "}{severity.signal}
                    {" · "}Wind {weather.wind_speed_10m} km/h
                </span>
            </div>

            <div style={styles.fetchedAt}>Fetched at {formatTime(fetchedAt)}</div>
        </div>
    )
}

export default function AdminWeather() {
    const [entries, setEntries] = useState([])
    const [lastUpdated, setLastUpdated] = useState(null)
    const [refreshing, setRefreshing] = useState(false)
    const [barangaysLoading, setBarangaysLoading] = useState(true)
    const [barangaysError, setBarangaysError] = useState(null)

    const loadAllWeather = useCallback(async (barangays, isManual = false) => {
        if (!barangays?.length) return
        if (isManual) setRefreshing(true)

        const initial = barangays.map((b) => ({
            barangay: b,
            status: "loading",
            weather: null,
            severity: null,
            fetchedAt: null,
            error: null,
        }))
        setEntries(initial)

        const results = await Promise.all(
            barangays.map(async (b) => {
                try {
                    const data = await fetchBarangayWeather(b)
                    return { barangay: b, ...data }
                } catch {
                    return {
                        barangay: b,
                        status: "error",
                        weather: null,
                        severity: null,
                        severityKey: null,
                        fetchedAt: new Date(),
                        error: "Weather API unavailable",
                    }
                }
            })
        )

        setEntries(results)
        setLastUpdated(new Date())
        setRefreshing(false)
    }, [])

    const fetchBarangays = useCallback(async (isManual = false) => {
        setBarangaysError(null)
        if (!isManual) setBarangaysLoading(true)
        try {
            const res = await axios.get(`${API_BASE}/barangays`)
            const list = res.data || []
            if (list.length === 0) {
                setEntries([])
                setBarangaysLoading(false)
                return
            }
            await loadAllWeather(list, isManual)
        } catch {
            setBarangaysError("Failed to load barangays. Please check your connection.")
        }
        setBarangaysLoading(false)
    }, [loadAllWeather])

    useEffect(() => {
        fetchBarangays()
        const timer = setInterval(() => fetchBarangays(false), REFRESH_MS)
        return () => clearInterval(timer)
    }, [fetchBarangays])

    const handleRefresh = () => fetchBarangays(true)

    const monitoringCount = entries.length
    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        })
        : null

    const showSkeletons = barangaysLoading && entries.length === 0
    const isEmpty = !barangaysLoading && !barangaysError && entries.length === 0

    return (
        <AdminLayout>
            <div style={styles.hero}>
                <div style={styles.heroInner}>
                    <div>
                        <h1 style={styles.heroTitle}>🌦️ Live Weather Monitor</h1>
                        <p style={styles.heroSub}>
                            Real-time weather monitoring for all barangays in Surigao City
                        </p>
                        <div style={styles.heroMeta}>
                            <span style={styles.heroPill}>
                                Monitoring {monitoringCount} barangay{monitoringCount !== 1 ? "s" : ""}
                            </span>
                            {lastUpdatedStr && (
                                <span style={styles.heroPill}>
                                    Last updated: {lastUpdatedStr}
                                </span>
                            )}
                        </div>
                    </div>
                    <div
                        onClick={refreshing || barangaysLoading ? undefined : handleRefresh}
                        style={{
                            ...styles.refreshBtn,
                            opacity: refreshing || barangaysLoading ? 0.7 : 1,
                            cursor: refreshing || barangaysLoading ? "not-allowed" : "pointer",
                        }}
                    >
                        <RefreshCw
                            size={16}
                            style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }}
                        />
                        {refreshing ? "Refreshing..." : "Refresh Now"}
                    </div>
                </div>
            </div>

            <div style={styles.content}>
                {barangaysError && <div style={styles.errorBox}>{barangaysError}</div>}

                {showSkeletons && (
                    <div style={styles.grid}>
                        {[1, 2, 3, 4, 5, 6].map((i) => <SkeletonCard key={i} />)}
                    </div>
                )}

                {isEmpty && (
                    <div style={styles.empty}>
                        <Inbox size={40} color="#ccc" />
                        <p style={{ color: "#888", marginTop: 12 }}>No barangays found to monitor.</p>
                    </div>
                )}

                {!showSkeletons && !isEmpty && entries.length > 0 && (
                    <div style={styles.grid}>
                        {entries.map((entry) => (
                            <WeatherCard key={entry.barangay.id} entry={entry} />
                        ))}
                    </div>
                )}

                <div style={styles.footerNote}>
                    Auto-refreshes every 10 minutes · Data via Open-Meteo · PAGASA wind thresholds for AI severity
                </div>
            </div>
        </AdminLayout>
    )
}

const styles = {
    hero: {
        margin: "-28px -32px 24px",
        background: "linear-gradient(135deg, #1a237e 0%, #283593 50%, #3949ab 100%)",
        padding: "28px 32px",
        boxShadow: "0 4px 16px rgba(26,35,126,0.25)",
    },
    heroInner: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 20,
        flexWrap: "wrap",
    },
    heroTitle: {
        margin: 0,
        fontSize: 24,
        fontWeight: 700,
        color: "#fff",
    },
    heroSub: {
        margin: "8px 0 0",
        fontSize: 14,
        color: "rgba(255,255,255,0.85)",
        maxWidth: 480,
    },
    heroMeta: {
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginTop: 14,
    },
    heroPill: {
        fontSize: 12,
        color: "#fff",
        background: "rgba(255,255,255,0.15)",
        padding: "5px 12px",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.2)",
    },
    refreshBtn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        color: "#1a237e",
        padding: "10px 18px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        flexShrink: 0,
    },
    content: { marginTop: 0 },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 16,
    },
    card: {
        background: "#fff",
        borderRadius: 16,
        padding: "18px 20px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        border: "1px solid #e8ecf0",
        borderLeftWidth: 4,
    },
    cardHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 14,
        gap: 10,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: 700,
        color: "#1a237e",
    },
    cardCity: {
        fontSize: 11,
        color: "#888",
        marginTop: 3,
    },
    riskBadge: {
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        padding: "4px 10px",
        borderRadius: 20,
        flexShrink: 0,
    },
    metricGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "repeat(3, auto)",
        gap: 10,
    },
    metricCell: {
        background: "#f8f9fc",
        borderRadius: 10,
        padding: "10px 12px",
        border: "1px solid #eef1f5",
    },
    metricLabel: {
        fontSize: 10,
        fontWeight: 600,
        color: "#888",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginBottom: 4,
    },
    metricValue: {
        fontSize: 15,
        fontWeight: 700,
        color: "#1a1a2e",
    },
    sevBanner: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 14,
        padding: "10px 12px",
        borderRadius: 8,
        fontSize: 11,
        lineHeight: 1.4,
    },
    fetchedAt: {
        fontSize: 10,
        color: "#aaa",
        marginTop: 10,
        textAlign: "right",
    },
    errorBody: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "20px 0",
        color: "#a32d2d",
        fontSize: 13,
    },
    skel: {
        background: "linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.2s ease-in-out infinite",
        borderRadius: 6,
    },
    skeletonHeader: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 14,
    },
    empty: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: 60,
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #e8ecf0",
    },
    errorBox: {
        background: "#fcebeb",
        color: "#a32d2d",
        padding: "12px 16px",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 13,
    },
    footerNote: {
        textAlign: "center",
        fontSize: 11,
        color: "#aaa",
        marginTop: 24,
    },
}
