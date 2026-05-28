import { useState, useEffect, useCallback } from "react"
import axios from "axios"
import {
    RefreshCw,
    Wind,
    CloudRain,
    Gauge,
    Thermometer,
    Droplets,
    Zap,
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

// ─── UNCHANGED: All data/logic constants ───────────────────────────────────────

const API_BASE = "http://127.0.0.1:8000/api"
const REFRESH_MS = 10 * 60 * 1000
const CURRENT_FIELDS = "wind_speed_10m,precipitation,surface_pressure,temperature_2m,relativehumidity_2m,weathercode,windgusts_10m"

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
    critical: { label: "CRITICAL", signal: "Signal #4-5", color: "#E24B4A", bg: "#FCEBEB", border: "#E24B4A", text: "#501313" },
}

// ─── UNCHANGED: All helper functions ──────────────────────────────────────────

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

function readNumeric(current, keys) {
    for (const key of keys) {
        const value = current?.[key]
        if (value !== null && value !== undefined && value !== "" && !Number.isNaN(Number(value))) {
            return Number(value)
        }
    }
    return null
}

function toFixedOrNA(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A"
    return Number(value).toFixed(digits)
}

function clampPct(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return 0
    return Math.min(100, Math.max(0, Math.round(Number(value))))
}

function getHumidityStyle(humidity) {
    if (humidity === null || humidity === undefined || Number.isNaN(Number(humidity))) {
        return { color: "#888", bar: "#d0d7de" }
    }
    if (humidity < 60) return { color: "#1D9E75", bar: "#1D9E75" }
    if (humidity <= 80) return { color: "#BA7517", bar: "#EF9F27" }
    return { color: "#D85A30", bar: "#D85A30" }
}

function getTemperatureStyle(temp) {
    if (temp === null || temp === undefined || Number.isNaN(Number(temp))) {
        return { color: "#888", bar: "#d0d7de" }
    }
    if (temp < 25) return { color: "#1565c0", bar: "#378ADD" }
    if (temp <= 32) return { color: "#1D9E75", bar: "#1D9E75" }
    return { color: "#D85A30", bar: "#D85A30" }
}

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
        `&current=${CURRENT_FIELDS}` +
        `&timezone=Asia%2FManila`
    const res = await axios.get(url)
    const current = res.data.current
    const wind = readNumeric(current, ["wind_speed_10m"]) ?? 0
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
    if (!d) return "-"
    return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

// ─── UNCHANGED: MetricItem component ─────────────────────────────────────────

function MetricItem({ icon, label, value, unit, color = "#1a1a2e", barPct = 0, barColor = "#378ADD", span = 1 }) {
    return (
        <div style={{ ...styles.metricCell, gridColumn: `span ${span}` }}>
            <div style={styles.metricLabel}>
                {icon}
                {label}
            </div>
            <div style={{ ...styles.metricValue, color }}>
                {value} {value === "N/A" ? "" : unit}
            </div>
            <div style={styles.metricBarTrack}>
                <div style={{ ...styles.metricBarFill, width: `${barPct}%`, background: barColor }} />
            </div>
        </div>
    )
}

// ─── NEW: Skeleton for station list item ──────────────────────────────────────

function SkeletonListItem() {
    return (
        <div style={styles.stationItem}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ ...styles.skel, width: "55%", height: 13, borderRadius: 4 }} />
                <div style={{ ...styles.skel, width: 8, height: 8, borderRadius: "50%" }} />
            </div>
            <div style={{ ...styles.skel, width: "70%", height: 10, borderRadius: 4, marginTop: 5 }} />
        </div>
    )
}

// ─── NEW: Station list item (left panel) ──────────────────────────────────────

function StationListItem({ entry, isActive, onClick }) {
    const { barangay, status, weather, severity } = entry
    const wind = status === "success" ? readNumeric(weather, ["wind_speed_10m"]) : null
    const temp = status === "success" ? readNumeric(weather, ["temperature_2m"]) : null
    const sevKey = entry.severityKey || "low"

    const dotColor = {
        low: "#1D9E75",
        moderate: "#BA7517",
        high: "#D85A30",
        critical: "#E24B4A",
    }[sevKey] || "#ccc"

    return (
        <div
            style={{
                ...styles.stationItem,
                ...(isActive ? styles.stationItemActive : {}),
            }}
            onClick={onClick}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={styles.stationName}>{barangay.name}</span>
                <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: status === "loading" ? "#ccc" : status === "error" ? "#E24B4A" : dotColor,
                    flexShrink: 0,
                }} />
            </div>
            <div style={styles.stationMeta}>
                {status === "loading" && "Fetching..."}
                {status === "error" && "Unavailable"}
                {status === "success" && `${toFixedOrNA(temp, 1)}°C · ${toFixedOrNA(wind, 1)} km/h`}
            </div>
        </div>
    )
}

// ─── NEW: Detail panel (right panel) ──────────────────────────────────────────

function DetailPanel({ entry }) {
    if (!entry) {
        return (
            <div style={styles.detailEmpty}>
                <MapPin size={32} color="#ccc" />
                <p style={{ color: "#aaa", marginTop: 10, fontSize: 13 }}>Select a barangay to view details</p>
            </div>
        )
    }

    const { barangay, status, weather, severity, fetchedAt, error } = entry
    const risk = RISK_COLORS[barangay.risk_level] || RISK_COLORS.low

    if (status === "loading") {
        return (
            <div style={styles.detailPanel}>
                <div style={{ ...styles.skel, width: "40%", height: 22, borderRadius: 6, marginBottom: 8 }} />
                <div style={{ ...styles.skel, width: "25%", height: 14, borderRadius: 4, marginBottom: 16 }} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} style={styles.metricCell}>
                            <div style={{ ...styles.skel, width: "50%", height: 10, marginBottom: 6, borderRadius: 4 }} />
                            <div style={{ ...styles.skel, width: "70%", height: 16, borderRadius: 4 }} />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (status === "error") {
        return (
            <div style={styles.detailPanel}>
                <div style={styles.detailHeader}>
                    <div>
                        <div style={styles.detailTitle}>{barangay.name}</div>
                        <div style={styles.detailCity}>
                            <MapPin size={11} style={{ marginRight: 3 }} />{barangay.city}
                        </div>
                    </div>
                    <span style={{ ...styles.riskBadge, background: risk.bg, color: risk.color, border: `1px solid ${risk.border}` }}>
                        {barangay.risk_level}
                    </span>
                </div>
                <div style={styles.errorBody}>
                    <AlertTriangle size={18} color="#E24B4A" />
                    <span>{error || "Failed to fetch weather"}</span>
                </div>
                <div style={styles.fetchedAt}>Last attempt: {formatTime(fetchedAt)}</div>
            </div>
        )
    }

    const code = weather?.weathercode
    const wind = readNumeric(weather, ["wind_speed_10m"])
    const rain = readNumeric(weather, ["precipitation", "rain"])
    const pressure = readNumeric(weather, ["surface_pressure"])
    const temperature = readNumeric(weather, ["temperature_2m"])
    const humidity = readNumeric(weather, ["relativehumidity_2m", "relative_humidity_2m"])
    const gust = readNumeric(weather, ["windgusts_10m"])
    const tempStyle = getTemperatureStyle(temperature)
    const humidStyle = getHumidityStyle(humidity)

    return (
        <div style={styles.detailPanel}>
            {/* Header */}
            <div style={styles.detailHeader}>
                <div>
                    <div style={styles.detailTitle}>{barangay.name}</div>
                    <div style={styles.detailCity}>
                        <MapPin size={11} style={{ marginRight: 3 }} />{barangay.city}
                    </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <span style={{ ...styles.riskBadge, background: risk.bg, color: risk.color, border: `1px solid ${risk.border}` }}>
                        {barangay.risk_level}
                    </span>
                    <span style={{
                        fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                        background: severity.bg, color: severity.text, border: `1px solid ${severity.border}`,
                        textTransform: "uppercase",
                    }}>
                        {severity.label}
                    </span>
                </div>
            </div>

            {/* Condition chip */}
            <div style={styles.conditionChip}>
                {getWeatherIcon(code, 16)}
                <span style={{ fontSize: 12, color: "#5b6470", fontWeight: 600, marginLeft: 6 }}>
                    {getWeatherDesc(code)} · {severity.signal}
                </span>
            </div>

            {/* Metrics */}
            <div style={styles.detailMetricGrid}>
                <MetricItem
                    icon={<Thermometer size={12} />}
                    label="Temperature"
                    value={toFixedOrNA(temperature, 1)}
                    unit="°C"
                    color={tempStyle.color}
                    barPct={clampPct(Math.min(100, Math.max(0, (((temperature ?? 0) - 20) / (45 - 20)) * 100)))}
                    barColor={tempStyle.bar}
                />
                <MetricItem
                    icon={<Droplets size={12} />}
                    label="Humidity"
                    value={toFixedOrNA(humidity, 0)}
                    unit="%"
                    color={humidStyle.color}
                    barPct={clampPct(humidity ?? 0)}
                    barColor={humidStyle.bar}
                />
                <MetricItem
                    icon={<Gauge size={12} />}
                    label="Pressure"
                    value={toFixedOrNA(pressure, 0)}
                    unit="hPa"
                    barPct={pressure ? clampPct(((1020 - pressure) / 120) * 100) : 0}
                    barColor={pressure && pressure < 990 ? "#EF9F27" : "#D85A30"}
                />
                <MetricItem
                    icon={<Wind size={12} />}
                    label="Wind Speed"
                    value={toFixedOrNA(wind, 1)}
                    unit="km/h"
                    barPct={clampPct((wind ?? 0) / 2)}
                    barColor={wind >= 88 ? "#EF9F27" : "#378ADD"}
                />
                <MetricItem
                    icon={<Zap size={12} />}
                    label="Wind Gusts"
                    value={toFixedOrNA(gust, 1)}
                    unit="km/h"
                    barPct={clampPct((gust ?? 0) / 2)}
                    barColor={gust >= 88 ? "#EF9F27" : "#378ADD"}
                />
                <MetricItem
                    icon={<CloudRain size={12} />}
                    label="Rainfall"
                    value={toFixedOrNA(rain, 1)}
                    unit="mm/hr"
                    barPct={clampPct((rain ?? 0) * 2)}
                    barColor={rain >= 30 ? "#E24B4A" : rain >= 15 ? "#EF9F27" : "#639922"}
                />
            </div>

            {/* Severity banner */}
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
                    {" · "}Wind {toFixedOrNA(wind, 1)} km/h
                </span>
            </div>

            <div style={styles.fetchedAt}>Fetched at {formatTime(fetchedAt)}</div>
        </div>
    )
}

// ─── MAIN PAGE COMPONENT ──────────────────────────────────────────────────────

export default function AdminWeather() {
    const [entries, setEntries] = useState([])
    const [lastUpdated, setLastUpdated] = useState(null)
    const [refreshing, setRefreshing] = useState(false)
    const [barangaysLoading, setBarangaysLoading] = useState(true)
    const [barangaysError, setBarangaysError] = useState(null)
    const [selectedId, setSelectedId] = useState(null)

    // ─── UNCHANGED: All data fetching logic ───────────────────────────────────

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
        if (!selectedId && barangays.length > 0) setSelectedId(barangays[0].id)

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
    }, [selectedId])

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

    // ─── Derived state ─────────────────────────────────────────────────────────

    const monitoringCount = entries.length
    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleString("en-PH", {
            month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
        })
        : null

    const showSkeletons = barangaysLoading && entries.length === 0
    const isEmpty = !barangaysLoading && !barangaysError && entries.length === 0
    const selectedEntry = entries.find(e => e.barangay.id === selectedId) || entries[0] || null

    // Summary stats
    const successEntries = entries.filter(e => e.status === "success")
    const alertCount = entries.filter(e => e.severityKey === "high" || e.severityKey === "critical").length
    const avgTemp = successEntries.length
        ? (successEntries.reduce((s, e) => s + (readNumeric(e.weather, ["temperature_2m"]) ?? 0), 0) / successEntries.length).toFixed(1)
        : null
    const avgWind = successEntries.length
        ? (successEntries.reduce((s, e) => s + (readNumeric(e.weather, ["wind_speed_10m"]) ?? 0), 0) / successEntries.length).toFixed(1)
        : null

    return (
        <AdminLayout>
            {/* ── Hero header (same style, trimmed padding) ── */}
            <div style={styles.hero}>
                <div style={styles.heroInner}>
                    <div>
                        <h1 style={styles.heroTitle}>Live Weather Monitor</h1>
                        <p style={styles.heroSub}>
                            Real-time weather monitoring for all barangays in Surigao City
                        </p>
                        <div style={styles.heroMeta}>
                            <span style={styles.heroPill}>
                                Monitoring {monitoringCount} barangay{monitoringCount !== 1 ? "s" : ""}
                            </span>
                            {lastUpdatedStr && (
                                <span style={styles.heroPill}>Last updated: {lastUpdatedStr}</span>
                            )}
                            <span style={{ ...styles.heroPill, background: "rgba(29,158,117,0.25)", border: "1px solid rgba(29,158,117,0.4)" }}>
                                ● Live
                            </span>
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
                        <RefreshCw size={16} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} />
                        {refreshing ? "Refreshing..." : "Refresh Now"}
                    </div>
                </div>
            </div>

            <div style={styles.content}>
                {barangaysError && <div style={styles.errorBox}>{barangaysError}</div>}

                {/* ── Summary stat row ── */}
                {!isEmpty && (
                    <div style={styles.summaryRow}>
                        <div style={styles.statCard}>
                            <div style={styles.statLabel}><MapPin size={11} /> Barangays</div>
                            <div style={styles.statValue}>{monitoringCount}</div>
                            <div style={styles.statSub}>All monitored</div>
                        </div>
                        <div style={styles.statCard}>
                            <div style={styles.statLabel}><Thermometer size={11} /> Avg temp</div>
                            <div style={{ ...styles.statValue, color: "#1D9E75" }}>{avgTemp ? `${avgTemp}°C` : "—"}</div>
                            <div style={styles.statSub}>Across stations</div>
                        </div>
                        <div style={styles.statCard}>
                            <div style={styles.statLabel}><Wind size={11} /> Avg wind</div>
                            <div style={styles.statValue}>{avgWind ? `${avgWind} km/h` : "—"}</div>
                            <div style={styles.statSub}>Surface level</div>
                        </div>
                        <div style={styles.statCard}>
                            <div style={styles.statLabel}><AlertTriangle size={11} /> Active alerts</div>
                            <div style={{ ...styles.statValue, color: alertCount > 0 ? "#D85A30" : "#1D9E75" }}>
                                {alertCount > 0 ? alertCount : "None"}
                            </div>
                            <div style={styles.statSub}>{alertCount > 0 ? "Needs attention" : "All clear"}</div>
                        </div>
                    </div>
                )}

                {/* ── Empty state ── */}
                {isEmpty && (
                    <div style={styles.empty}>
                        <Inbox size={40} color="#ccc" />
                        <p style={{ color: "#888", marginTop: 12 }}>No barangays found to monitor.</p>
                    </div>
                )}

                {/* ── Main split panel ── */}
                {!isEmpty && (
                    <div style={styles.splitPanel}>
                        {/* Left: station list */}
                        <div style={styles.stationList}>
                            <div style={styles.stationListHeader}>
                                Stations ({monitoringCount})
                            </div>
                            <div style={styles.stationScroll}>
                                {showSkeletons
                                    ? [1, 2, 3, 4, 5].map(i => <SkeletonListItem key={i} />)
                                    : entries.map(entry => (
                                        <StationListItem
                                            key={entry.barangay.id}
                                            entry={entry}
                                            isActive={selectedId === entry.barangay.id}
                                            onClick={() => setSelectedId(entry.barangay.id)}
                                        />
                                    ))
                                }
                            </div>
                        </div>

                        {/* Right: detail panel */}
                        <div style={styles.detailWrapper}>
                            <DetailPanel entry={selectedEntry} />
                        </div>
                    </div>
                )}

                <div style={styles.footerNote}>
                    Auto-refreshes every 10 minutes · Data via Open-Meteo · 5 core metrics + gusts and feels-like
                </div>
            </div>
        </AdminLayout>
    )
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = {
    // ── Hero (unchanged from original) ──
    hero: {
        margin: "-28px -32px 24px",
        background: "linear-gradient(135deg, #1a237e 0%, #283593 50%, #3949ab 100%)",
        padding: "28px 32px",
        boxShadow: "0 4px 16px rgba(26,35,126,0.25)",
    },
    heroInner: {
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 20, flexWrap: "wrap",
    },
    heroTitle: { margin: 0, fontSize: 24, fontWeight: 700, color: "#fff" },
    heroSub: { margin: "8px 0 0", fontSize: 14, color: "rgba(255,255,255,0.85)", maxWidth: 480 },
    heroMeta: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 },
    heroPill: {
        fontSize: 12, color: "#fff",
        background: "rgba(255,255,255,0.15)",
        padding: "5px 12px", borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.2)",
        display: "flex", alignItems: "center", gap: 5,
    },
    refreshBtn: {
        display: "inline-flex", alignItems: "center", gap: 8,
        background: "#fff", color: "#1a237e",
        padding: "10px 18px", borderRadius: 8,
        fontSize: 13, fontWeight: 600, flexShrink: 0,
    },

    // ── Page content ──
    content: { marginTop: 0 },

    // ── Summary stat row ──
    summaryRow: {
        display: "grid", gridTemplateColumns: "repeat(4,1fr)",
        gap: 12, marginBottom: 16,
    },
    statCard: {
        background: "#fff", border: "1px solid #e8ecf0",
        borderRadius: 12, padding: "12px 16px",
    },
    statLabel: {
        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: 0.5, color: "#888",
        display: "flex", alignItems: "center", gap: 4, marginBottom: 4,
    },
    statValue: { fontSize: 20, fontWeight: 700, color: "#1a1a2e" },
    statSub: { fontSize: 10, color: "#aaa", marginTop: 2 },

    // ── Split panel layout ──
    splitPanel: {
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gap: 0,
        background: "#fff",
        border: "1px solid #e8ecf0",
        borderRadius: 16,
        overflow: "hidden",
        minHeight: 500,
    },

    // ── Station list (left) ──
    stationList: {
        borderRight: "1px solid #e8ecf0",
        display: "flex", flexDirection: "column",
    },
    stationListHeader: {
        padding: "10px 16px",
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: 0.6, color: "#aaa",
        borderBottom: "1px solid #e8ecf0",
        background: "#fafbfc",
    },
    stationScroll: { flex: 1, overflowY: "auto" },
    stationItem: {
        padding: "10px 16px",
        borderBottom: "1px solid #f0f2f5",
        borderLeft: "3px solid transparent",
        cursor: "pointer",
        transition: "background 0.1s",
    },
    stationItemActive: {
        background: "#f0f4ff",
        borderLeft: "3px solid #1a237e",
    },
    stationName: { fontSize: 13, fontWeight: 600, color: "#1a1a2e" },
    stationMeta: { fontSize: 11, color: "#888", marginTop: 3 },

    // ── Detail panel (right) ──
    detailWrapper: { flex: 1 },
    detailPanel: { padding: "20px 24px" },
    detailEmpty: {
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        height: "100%", padding: 40,
    },
    detailHeader: {
        display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", marginBottom: 12,
    },
    detailTitle: { fontSize: 20, fontWeight: 700, color: "#1a237e" },
    detailCity: {
        fontSize: 11, color: "#888", marginTop: 4,
        display: "flex", alignItems: "center",
    },
    conditionChip: {
        display: "inline-flex", alignItems: "center",
        background: "#f8f9fc", border: "1px solid #e8ecf0",
        borderRadius: 20, padding: "5px 12px",
        marginBottom: 16,
    },
    detailMetricGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0,1fr))",
        gap: 10, marginBottom: 14,
    },

    // ── Metric cells (unchanged from original) ──
    metricCell: {
        background: "#f8f9fc", borderRadius: 10,
        padding: "10px 12px", border: "1px solid #eef1f5",
    },
    metricLabel: {
        fontSize: 10, fontWeight: 600, color: "#888",
        textTransform: "uppercase", letterSpacing: 0.4,
        display: "flex", alignItems: "center", gap: 4, marginBottom: 4,
    },
    metricValue: { fontSize: 15, fontWeight: 700, color: "#1a1a2e" },
    metricBarTrack: {
        height: 3, borderRadius: 999, marginTop: 7,
        background: "#e6ebf1", overflow: "hidden",
    },
    metricBarFill: {
        height: "100%", borderRadius: 999,
        transition: "width 0.3s ease",
    },

    // ── Severity banner (unchanged from original) ──
    sevBanner: {
        display: "flex", alignItems: "center", gap: 8,
        marginTop: 14, padding: "10px 12px",
        borderRadius: 8, fontSize: 11, lineHeight: 1.4,
    },

    // ── Misc (unchanged from original) ──
    fetchedAt: { fontSize: 10, color: "#aaa", marginTop: 10, textAlign: "right" },
    errorBody: {
        display: "flex", alignItems: "center", gap: 10,
        padding: "20px 0", color: "#a32d2d", fontSize: 13,
    },
    riskBadge: {
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        padding: "4px 10px", borderRadius: 20, flexShrink: 0,
    },
    skel: {
        background: "linear-gradient(90deg, #eee 25%, #f5f5f5 50%, #eee 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.2s ease-in-out infinite",
        borderRadius: 6,
        display: "block",
    },
    empty: {
        display: "flex", flexDirection: "column",
        alignItems: "center", padding: 60,
        background: "#fff", borderRadius: 12, border: "1px solid #e8ecf0",
    },
    errorBox: {
        background: "#fcebeb", color: "#a32d2d",
        padding: "12px 16px", borderRadius: 8,
        marginBottom: 16, fontSize: 13,
    },
    footerNote: {
        textAlign: "center", fontSize: 11, color: "#aaa", marginTop: 24,
    },
}