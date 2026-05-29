import { useState, useEffect, useRef } from "react"
import axios from "axios"
import Select from "react-select"
import { useNavigate } from "react-router-dom"
import MapView from "../components/MapView"

import Sidebar from "../components/Sidebar"

import {
    Tornado, BarChart2, Clock, AlertTriangle, Info, Wind,
    CloudRain, Gauge, Map, Edit3, Search, Route, Satellite,
    Loader, MapPin, Thermometer, Droplets, X
} from "lucide-react"

// --- Constants ---------------------------------------------------------------
const API_BASE = "http://127.0.0.1:8000/api"
const WEATHER_REFRESH = 10 * 60 * 1000 // 10 minutes
import { RefreshCw } from "lucide-react"
const OPEN_METEO_CURRENT_FIELDS = "wind_speed_10m,precipitation,surface_pressure,temperature_2m,relativehumidity_2m,weathercode,windgusts_10m"

function pickCurrentMetric(current, keys) {
    for (const key of keys) {
        const value = current?.[key]
        if (value !== null && value !== undefined && value !== "" && !Number.isNaN(Number(value))) {
            return Number(value)
        }
    }
    return null
}

function toFixedOrEmpty(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return ""
    return Number(value).toFixed(digits)
}

function metricDisplay(value) {
    return value === null || value === undefined || value === "" ? "N/A" : value
}

// --- Severity config (maps your backend severity_level to UI) ----------------
export function calculateSeverityScore(wind, rain, pressure, temp, humidity) {
    const clamp = (val) => Math.min(Math.max(val, 0), 100);
    const windPct = clamp((wind - 30) / 190 * 100);
    const pressurePct = clamp((1013 - pressure) / 43 * 100);
    const rainPct = clamp(rain / 60 * 100);
    const humidityPct = clamp((humidity - 85) / 15 * 100);
    const tempPct = clamp((30 - temp) / 6 * 100);
    return Math.round(
        (windPct * 0.35) +
        (pressurePct * 0.30) +
        (rainPct * 0.20) +
        (humidityPct * 0.10) +
        (tempPct * 0.05)
    );
}

export function getSeverityConfig(score, wind = 0, rain = 0, pressure = 1013) {
    const s = score !== null && score !== undefined ? score : 0;
    let rank = 0;
    if (s <= 24) rank = 0;
    else if (s <= 39) rank = 1;
    else if (s <= 54) rank = 2;
    else if (s <= 70) rank = 3;
    else if (s <= 85) rank = 4;
    else rank = 5;

    // Hard overrides — only upgrade, never downgrade
    if (wind >= 220) {
        rank = Math.max(rank, 5);
    } else if (wind >= 120) {
        rank = Math.max(rank, 4);
    } else if (wind >= 60) {
        rank = Math.max(rank, 3);
    } else if (wind >= 45) {
        rank = Math.max(rank, 2);
    }

    if (rain >= 30) {
        rank = Math.max(rank, 3);
    } else if (rain >= 7.5) {
        rank = Math.max(rank, 2);
    }

    if (pressure <= 970) {
        rank = Math.max(rank, 3);
    } else if (pressure <= 990) {
        rank = Math.max(rank, 1);
    }

    const configs = [
        {
            label: "Normal / Clear",
            signal: "No signal",
            color: "#1D9E75",
            gaugeColor: "#1D9E75",
            alertBg: "#E1F5EE",
            alertBorder: "#5DCAA5",
            alertText: "#085041",
            dot: "#5DCAA5",
            bg: "#E1F5EE",
            border: "#9FE1CB",
            text: "#085041"
        },
        {
            label: "Watch / LPA",
            signal: "Low Pressure Area",
            color: "#BA7517",
            gaugeColor: "#EF9F27",
            alertBg: "#FAEEDA",
            alertBorder: "#EF9F27",
            alertText: "#633806",
            dot: "#EF9F27",
            bg: "#FAEEDA",
            border: "#FAC775",
            text: "#633806"
        },
        {
            label: "Elevated Alert",
            signal: "Pre-Signal 1",
            color: "#BA7517",
            gaugeColor: "#EF9F27",
            alertBg: "#FAEEDA",
            alertBorder: "#EF9F27",
            alertText: "#633806",
            dot: "#EF9F27",
            bg: "#FAEEDA",
            border: "#FAC775",
            text: "#633806"
        },
        {
            label: "PAGASA Signal 1",
            signal: "Signal 1",
            color: "#D85A30",
            gaugeColor: "#D85A30",
            alertBg: "#FAECE7",
            alertBorder: "#F0997B",
            alertText: "#4A1B0C",
            dot: "#D85A30",
            bg: "#FAECE7",
            border: "#F0997B",
            text: "#4A1B0C"
        },
        {
            label: "PAGASA Signal 2–3",
            signal: "Signal 2–3",
            color: "#A32D2D",
            gaugeColor: "#E24B4A",
            alertBg: "#FCEBEB",
            alertBorder: "#F09595",
            alertText: "#501313",
            dot: "#E24B4A",
            bg: "#FCEBEB",
            border: "#F09595",
            text: "#501313"
        },
        {
            label: "PAGASA Signal 4–5",
            signal: "Signal 4–5",
            color: "#A32D2D",
            gaugeColor: "#E24B4A",
            alertBg: "#FCEBEB",
            alertBorder: "#F09595",
            alertText: "#501313",
            dot: "#E24B4A",
            bg: "#FCEBEB",
            border: "#F09595",
            text: "#501313"
        }
    ];

    return configs[rank];
}

const RISK_COLORS = {
    low: "#1D9E75", moderate: "#BA7517", high: "#D85A30", critical: "#A32D2D",
}



// --- Sub-components ----------------------------------------------------------

function LiveDot() {
    return (
        <span style={{
            display: "inline-block", width: 7, height: 7,
            borderRadius: "50%", background: "#00e676",
            animation: "bagyoPulse 1.5s ease-in-out infinite",
        }} />
    )
}

function getOverrideInputBorderColor(name, value) {
    if (value === "" || isNaN(parseFloat(value))) return "#e0e0e0";
    const val = parseFloat(value);
    if (name === "wind_speed" && val >= 60) return "#E24B4A";
    if (name === "rainfall" && val >= 30) return "#E24B4A";
    if (name === "pressure" && val <= 989) return "#E24B4A";
    if (name === "humidity" && val >= 95) return "#E24B4A";
    return "#e0e0e0";
}

function getCardBadgeAndBorder(name, value) {
    if (value === null || value === undefined || value === "" || value === "N/A" || value === "—" || value === "-") {
        return { badge: null, border: null, barColor: null };
    }
    const num = parseFloat(value);
    if (isNaN(num)) {
        return { badge: null, border: null, barColor: null };
    }

    if (name === "wind_speed") {
        if (num < 45) return { badge: null, border: null, barColor: "#378ADD" };
        if (num <= 59) return { badge: "Watch", border: "#EF9F27", barColor: "#EF9F27" };
        if (num <= 119) return { badge: "Signal 1", border: "#E24B4A", barColor: "#E24B4A" };
        if (num <= 169) return { badge: "Signal 2", border: "#E24B4A", barColor: "#E24B4A" };
        if (num <= 219) return { badge: "Signal 3", border: "#E24B4A", barColor: "#E24B4A" };
        if (num <= 299) return { badge: "Signal 4", border: "#A32D2D", barColor: "#A32D2D" };
        return { badge: "Signal 5", border: "#A32D2D", barColor: "#A32D2D" };
    }
    if (name === "rainfall") {
        if (num < 7.5) return { badge: null, border: null, barColor: "#639922" };
        if (num <= 14.9) return { badge: "Heavy Rain", border: "#EF9F27", barColor: "#EF9F27" };
        if (num <= 29.9) return { badge: "Intense Rain", border: "#D85A30", barColor: "#D85A30" };
        return { badge: "Extreme Rain", border: "#E24B4A", barColor: "#E24B4A" };
    }
    if (name === "pressure") {
        if (num > 1000) return { badge: null, border: null, barColor: "#D85A30" };
        if (num >= 990 && num <= 999) return { badge: "Low Pressure", border: "#EF9F27", barColor: "#EF9F27" };
        if (num >= 970 && num <= 989) return { badge: "Very Low Pressure", border: "#E24B4A", barColor: "#E24B4A" };
        if (num < 970) return { badge: "Danger - Typhoon Core", border: "#A32D2D", barColor: "#A32D2D" };
    }
    if (name === "humidity") {
        if (num < 85) return { badge: null, border: null, barColor: "#378ADD" };
        if (num <= 94) return { badge: "Very Humid", border: "#EF9F27", barColor: "#EF9F27" };
        return { badge: "Saturated Air", border: "#E24B4A", barColor: "#E24B4A" };
    }
    if (name === "temperature") {
        if (num >= 24) return { badge: null, border: null, barColor: "#D85A30" };
        return { badge: "Cold Inflow", border: "#EF9F27", barColor: "#EF9F27" };
    }

    return { badge: null, border: null, barColor: null };
}

function MetricCard({ icon, color, bg, label, value, unit, trend, trendLabel, barPct, barColor, badge, borderColor }) {
    const noData = value === "N/A" || value === "—" || value === "-"
    const displayBorder = borderColor ? `1.5px solid ${borderColor}` : "0.5px solid #e8ecf0"
    return (
        <div style={{ ...styles.metricCard, border: displayBorder }}>
            <div style={styles.metricIconRow}>
                <div style={{ ...styles.metricIconBox, background: bg }}>
                    <span style={{ fontSize: 15, color }}>{icon}</span>
                </div>
                {badge ? (
                    <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: borderColor ? `${borderColor}12` : "#f0f0f0",
                        color: borderColor || "#555",
                        border: `1px solid ${borderColor || "#ddd"}`,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2
                    }}>
                        {badge}
                    </span>
                ) : trend && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: trend === "up" ? "#A32D2D" : "#0F6E56", display: "flex", alignItems: "center", gap: 2 }}>
                        {trend === "up" ? "▲" : "▼"} {trendLabel}
                    </span>
                )}
            </div>
            <div>
                <span style={styles.metricVal}>{value ?? "-"}</span>
                {!noData && <span style={styles.metricUnit}> {unit}</span>}
            </div>
            <div style={styles.metricLabel}>{label}</div>
            <div style={styles.metricBarTrack}>
                <div style={{ ...styles.metricBarFill, width: `${barPct}%`, background: barColor }} />
            </div>
        </div>
    )
}

function TrendChart({ data }) {
    const chartRef = useRef(null)
    const instanceRef = useRef(null)

    useEffect(() => {
        if (!data || data.length === 0) return
        if (instanceRef.current) instanceRef.current.destroy()

        const ctx = chartRef.current.getContext("2d")

        instanceRef.current = new window.Chart(ctx, {
            type: "bar",
            data: {
                labels: data.map(d => d.time),
                datasets: [
                    {
                        type: "bar",
                        label: "Wind Speed",
                        data: data.map(d => d.wind),
                        backgroundColor: data.map(d =>
                            d.wind >= 118 ? "#E24B4A" :
                                d.wind >= 88 ? "#EF9F27" :
                                    "#378ADD"
                        ),
                        borderRadius: 4,
                        borderSkipped: false,
                        yAxisID: "yWind",
                    },
                    {
                        type: "line",
                        label: "Temperature",
                        data: data.map(d => d.temp),
                        borderColor: "#EF9F27",
                        borderWidth: 2,
                        tension: 0.3,
                        fill: false,
                        pointBackgroundColor: "#EF9F27",
                        pointRadius: 3,
                        yAxisID: "yTemp",
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: "top",
                        labels: {
                            boxWidth: 10,
                            font: { size: 10 },
                            color: "#666"
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: context => {
                                const label = context.dataset.label || "";
                                const val = context.parsed.y;
                                return ` ${label}: ${val} ${context.dataset.yAxisID === "yWind" ? "km/h" : "°C"}`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: "#aaa" } },
                    yWind: {
                        type: "linear",
                        position: "left",
                        grid: { color: "rgba(0,0,0,0.05)" },
                        ticks: { font: { size: 11 }, color: "#aaa", callback: v => v + " km/h" },
                        min: 0,
                    },
                    yTemp: {
                        type: "linear",
                        position: "right",
                        grid: { display: false },
                        ticks: { font: { size: 11 }, color: "#aaa", callback: v => v + " °C" }
                    }
                }
            }
        })

        return () => { if (instanceRef.current) instanceRef.current.destroy() }
    }, [data])

    if (!data || data.length === 0) return (
        <div style={{ height: 72, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 12 }}>
            No trend data yet
        </div>
    )

    return <div style={{ position: "relative", width: "100%", height: 140 }}>
        <canvas ref={chartRef} role="img" aria-label="6-hour wind speed & temperature chart" />
    </div>
}

function SeverityGauge({ score, wind = 0, rain = 0, pressure = 1013 }) {
    const displayScore = score ?? 0
    const cfg = getSeverityConfig(displayScore, wind, rain, pressure)
    // Gauge arc: total arc length ~141, offset controls fill
    const filled = Math.round((displayScore / 100) * 141)
    const offset = 141 - filled

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 110, height: 68, overflow: "hidden", margin: "0 auto 4px" }}>
                <svg viewBox="0 0 110 70" width={110} height={80} xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 65 A45 45 0 0 1 100 65" fill="none" stroke="#f0f0f0" strokeWidth={9} strokeLinecap="round" />
                    <path d="M10 65 A45 45 0 0 1 100 65" fill="none" stroke={cfg.gaugeColor} strokeWidth={9} strokeLinecap="round"
                        strokeDasharray="141" strokeDashoffset={offset} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
                    <text x="55" y="55" textAnchor="middle" fontSize={18} fontWeight={600} fill={cfg.color}>{displayScore}</text>
                </svg>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: cfg.color, textAlign: "center", lineHeight: 1.3 }}>
                {cfg.label}
            </div>
            <div style={{ fontSize: 11, color: "#888", textAlign: "center", margin: "3px 0 6px" }}>
                {cfg.signal.startsWith("Signal") ? "PAGASA " : ""}{cfg.signal} · 5-factor weighted score
            </div>
        </div>
    )
}

function FactorBar({ label, pct, color }) {
    return (
        <div style={{ display: "flex", alignItems: "center", fontSize: 11, gap: 0 }}>
            <span style={{ color: "#999", minWidth: 52 }}>{label}</span>
            <div style={{ flex: 1, height: 4, background: "#f0f0f0", borderRadius: 2, margin: "0 8px" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.5s" }} />
            </div>
            <span style={{ fontWeight: 600, color: "#333", minWidth: 28, textAlign: "right" }}>{pct}%</span>
        </div>
    )
}

function EvacRoutes({ evacuationCenter, severity }) {
    const needsEvac = ["high", "critical"].includes(severity)
    const isActive = ["moderate", "high", "critical"].includes(severity)

    if (!evacuationCenter) {
        return (
            <div style={{ ...styles.evacCard, background: "#f8f9fa", border: "0.5px solid #e0e0e0" }}>
                <div style={styles.evacHeader}>
                    <Route size={15} style={{ color: "#aaa" }} />
                    <span style={styles.evacTitle}>Evacuation routes</span>
                </div>
                <p style={{ fontSize: 12, color: "#aaa", marginTop: 8 }}>
                    Run an assessment to see recommended evacuation routes.
                </p>
            </div>
        )
    }

    return (
        <div style={{
            ...styles.evacCard,
            background: needsEvac ? "#FCEBEB" : "#f8f9fa",
            border: `0.5px solid ${needsEvac ? "#F09595" : "#e0e0e0"}`,
        }}>
            <div style={styles.evacHeader}>
                <Route size={15} style={{ color: needsEvac ? "#501313" : "#333" }} />
                <span style={{ ...styles.evacTitle, color: needsEvac ? "#501313" : "#333" }}>Evacuation routes</span>
                {isActive && (
                    <span style={{ marginLeft: "auto", fontSize: 10, background: "#E24B4A", color: "#fff", padding: "2px 8px", borderRadius: 20 }}>
                        ACTIVE
                    </span>
                )}
            </div>
            <div style={{ ...styles.routeItem, borderBottom: `0.5px solid ${needsEvac ? "#F7C1C1" : "#eee"}` }}>
                <div style={{ ...styles.routeNum, background: needsEvac ? "#E24B4A" : "#888" }}>1</div>
                <div style={styles.routeInfo}>
                    <div style={{ ...styles.routeName, color: needsEvac ? "#501313" : "#333" }}>{evacuationCenter.name}</div>
                    <div style={{ ...styles.routeDesc, color: needsEvac ? "#793333" : "#888" }}>{evacuationCenter.address}</div>
                    {evacuationCenter.distance !== undefined && evacuationCenter.distance !== null && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: needsEvac ? "#A32D2D" : "#1565c0", marginTop: 4, display: "flex", alignItems: "center", gap: 3 }}>
                            <span>📍</span> {parseFloat(evacuationCenter.distance).toFixed(1)} km away
                        </div>
                    )}
                </div>
                <span style={{ ...styles.routeStatus, background: "#EAF3DE", color: "#3B6D11" }}>Open</span>
            </div>
            <div style={{ ...styles.routeItem, border: "none" }}>
                <div style={{ ...styles.routeNum, background: needsEvac ? "#E24B4A" : "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Info size={10} style={{ color: "white" }} />
                </div>
                <div style={styles.routeInfo}>
                    <div style={{ ...styles.routeName, color: needsEvac ? "#501313" : "#333" }}>
                        Capacity: {evacuationCenter.capacity?.toLocaleString()} persons
                    </div>
                    <div style={{ ...styles.routeDesc, color: needsEvac ? "#793333" : "#888" }}>
                        {needsEvac ? "Mandatory evacuation recommended" : "Standby - monitor conditions"}
                    </div>
                </div>
            </div>
        </div>
    )
}

function RecentHistory({ logs }) {
    const recent = (logs || []).slice(0, 4)

    return (
        <div style={styles.historyCard}>
            <div style={styles.cardHeader}>
                <div style={{ ...styles.cardTitle, display: "flex", alignItems: "center", gap: 5 }}>
                    <Clock size={14} style={{ color: "#555" }} /> Recent assessments
                </div>
            </div>
            {recent.length === 0 && (
                <p style={{ fontSize: 12, color: "#aaa", padding: "8px 0" }}>No assessments yet.</p>
            )}
            {recent.map((log, i) => {
                const tLog = log.typhoon_log
                const score = tLog ? calculateSeverityScore(
                    parseFloat(tLog.wind_speed) || 0,
                    parseFloat(tLog.rainfall) || 0,
                    parseFloat(tLog.pressure) || 0,
                    parseFloat(tLog.temperature) || 0,
                    parseFloat(tLog.humidity) || 0
                ) : 0
                const cfg = getSeverityConfig(score)
                const date = new Date(log.recommended_at)
                const dateStr = date.toLocaleDateString("en-PH", { month: "short", year: "numeric" })
                return (
                    <div key={log.id} style={{ ...styles.histRow, borderBottom: i < recent.length - 1 ? "0.5px solid #f0f0f0" : "none" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.dot || "#ccc", flexShrink: 0 }} />
                        <span style={{ color: "#aaa", minWidth: 70, fontSize: 11 }}>{dateStr}</span>
                        <span style={{ flex: 1, fontWeight: 500, fontSize: 11, color: "#333" }}>
                            {log.barangay?.name || "-"}
                        </span>
                        <span style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                            background: cfg.bg, color: cfg.text
                        }}>
                            {cfg.label}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}

// --- Main Dashboard ----------------------------------------------------------
export default function Dashboard() {
    const navigate = useNavigate()

    const [barangays, setBarangays] = useState([])
    const [selectedBarangay, setSelectedBarangay] = useState(null)
    const [formData, setFormData] = useState({ wind_speed: "", rainfall: "", pressure: "", temperature: "", humidity: "", barangay_id: null })
    const [extraWeather, setExtraWeather] = useState({ wind_gusts: "N/A" })
    const [weatherLoading, setWeatherLoading] = useState(false)
    const [weatherFetched, setWeatherFetched] = useState(false)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [trendData, setTrendData] = useState([])
    const [result, setResult] = useState(null)
    const [assessing, setAssessing] = useState(false)
    const [assessError, setAssessError] = useState(null)
    const [recentLogs, setRecentLogs] = useState([])
    const [showMap, setShowMap] = useState(false)
    const [confirmModalOpen, setConfirmModalOpen] = useState(false)


    const weatherTimer = useRef(null)

    // -- Fetch barangays on mount ------------------------------------------------
    useEffect(() => {
        axios.get(`${API_BASE}/barangays`)
            .then(res => {
                const opts = res.data.map(b => ({
                    value: b.id, label: `${b.name}, ${b.city}`,
                    riskLevel: b.risk_level, latitude: b.latitude, longitude: b.longitude,
                    name: b.name, city: b.city,
                }))
                setBarangays(opts)
                if (opts.length > 0) {
                    setSelectedBarangay(opts[0])
                    setFormData(f => ({ ...f, barangay_id: opts[0].value }))
                    fetchWeather(opts[0])
                }
            })
            .catch(() => console.error("Failed to load barangays"))

        fetchRecentLogs()

        return () => { if (weatherTimer.current) clearInterval(weatherTimer.current) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // -- Fetch live weather ------------------------------------------------------
    async function fetchWeather(option) {
        if (!option?.latitude || !option?.longitude) return
        setWeatherLoading(true)
        setWeatherFetched(false)
        setFormData(f => ({
            ...f,
            wind_speed: "",
            rainfall: "",
            pressure: "",
            temperature: "",
            humidity: "",
        }))
        setExtraWeather({ wind_gusts: "N/A" })
        try {
            const [currentRes, hourlyRes] = await Promise.all([
                axios.get(
                    `https://api.open-meteo.com/v1/forecast` +
                    `?latitude=${option.latitude}&longitude=${option.longitude}` +
                    `&current=${OPEN_METEO_CURRENT_FIELDS}` +
                    `&timezone=Asia%2FManila`
                ),
                axios.get(
                    `https://api.open-meteo.com/v1/forecast` +
                    `?latitude=${option.latitude}&longitude=${option.longitude}` +
                    `&hourly=wind_speed_10m,temperature_2m&forecast_days=1` +
                    `&timezone=Asia%2FManila`
                ),
            ])

            const cur = currentRes.data.current
            const windVal = pickCurrentMetric(cur, ["wind_speed_10m"])
            const rainVal = pickCurrentMetric(cur, ["precipitation", "rain"])
            const pressureVal = pickCurrentMetric(cur, ["surface_pressure"])
            const temperatureVal = pickCurrentMetric(cur, ["temperature_2m"])
            const humidityVal = pickCurrentMetric(cur, ["relativehumidity_2m", "relative_humidity_2m"])
            const gustVal = pickCurrentMetric(cur, ["windgusts_10m"])

            setFormData(f => ({
                ...f,
                wind_speed: toFixedOrEmpty(windVal, 1),
                rainfall: toFixedOrEmpty(rainVal, 1),
                pressure: toFixedOrEmpty(pressureVal, 1),
                temperature: toFixedOrEmpty(temperatureVal, 1),
                humidity: toFixedOrEmpty(humidityVal, 1),
            }))
            setExtraWeather({
                wind_gusts: metricDisplay(toFixedOrEmpty(gustVal, 1)),
            })
            setLastUpdated(new Date())
            setWeatherFetched(true)

            // Build 6-point trend (last 6 hours)
            const hourly = hourlyRes.data.hourly
            const nowH = new Date().getHours()
            const points = []
            for (let i = 5; i >= 0; i--) {
                const h = ((nowH - i) + 24) % 24
                const label = h === nowH ? "Now" : `${h % 12 || 12}${h < 12 ? "am" : "pm"}`
                points.push({
                    time: label,
                    wind: parseFloat(hourly.wind_speed_10m[h]?.toFixed(1) || 0),
                    temp: parseFloat(hourly.temperature_2m[h]?.toFixed(1) || 0)
                })
            }
            setTrendData(points)

            // Auto-refresh
            if (weatherTimer.current) clearInterval(weatherTimer.current)
            weatherTimer.current = setInterval(() => fetchWeather(option), WEATHER_REFRESH)

        } catch {
            setExtraWeather({ wind_gusts: "N/A" })
            console.error("Weather fetch failed")
        }
        setWeatherLoading(false)
    }

    // -- Fetch recent history ----------------------------------------------------
    async function fetchRecentLogs() {
        try {
            const res = await axios.get(`${API_BASE}/recommendations`)
            setRecentLogs(res.data.slice(0, 4))
        } catch {
            console.error("History fetch failed")
        }
    }

    // -- Barangay change ---------------------------------------------------------
    const handleBarangayChange = (option) => {
        setSelectedBarangay(option)
        setFormData(f => ({ ...f, barangay_id: option?.value ?? null }))
        setResult(null)
        setAssessError(null)
        setWeatherFetched(false)
        fetchWeather(option)
    }

    // -- Manual input change -----------------------------------------------------
    const handleChange = (e) => {
        setFormData(f => ({ ...f, [e.target.name]: e.target.value }))
    }

    // -- Assess ------------------------------------------------------------------
    const handleAssess = async () => {
        setAssessing(true)
        setAssessError(null)
        try {
            const res = await axios.post(`${API_BASE}/typhoon/assess`, formData)
            setResult(res.data)
            fetchRecentLogs()
        } catch {
            setAssessError("Assessment failed. Please check your connection and try again.")
        }
        setAssessing(false)
    }

    const handleAssessClick = () => {
        if (isBtnDisabled) return
        if (maxRank >= 3) {
            setConfirmModalOpen(true)
        } else {
            handleAssess()
        }
    }

    const handleConfirmSubmit = () => {
        setConfirmModalOpen(false)
        handleAssess()
    }

    const handleCancelSubmit = () => {
        setConfirmModalOpen(false)
    }

    // -- Derived UI values --------------------------------------------------------
    const wind = parseFloat(formData.wind_speed) || 0
    const rain = parseFloat(formData.rainfall) || 0
    const pressure = parseFloat(formData.pressure) || 0
    const temperature = parseFloat(formData.temperature) || 0
    const humidity = parseFloat(formData.humidity) || 0

    const hasWind = formData.wind_speed !== "" && !isNaN(parseFloat(formData.wind_speed))
    const hasRain = formData.rainfall !== "" && !isNaN(parseFloat(formData.rainfall))
    const hasPressure = formData.pressure !== "" && !isNaN(parseFloat(formData.pressure))
    const hasHumidity = formData.humidity !== "" && !isNaN(parseFloat(formData.humidity))
    const hasTemp = formData.temperature !== "" && !isNaN(parseFloat(formData.temperature))

    let maxRank = 0
    if (hasWind) {
        const windVal = parseFloat(formData.wind_speed)
        let r = 0
        if (windVal >= 300) r = 5
        else if (windVal >= 220) r = 5
        else if (windVal >= 170) r = 4
        else if (windVal >= 120) r = 4
        else if (windVal >= 60) r = 3
        else if (windVal >= 45) r = 1
        maxRank = Math.max(maxRank, r)
    }
    if (hasRain) {
        const rainVal = parseFloat(formData.rainfall)
        let r = 0
        if (rainVal >= 30) r = 3
        else if (rainVal >= 15) r = 2
        else if (rainVal >= 7.5) r = 1
        maxRank = Math.max(maxRank, r)
    }
    if (hasPressure) {
        const pressureVal = parseFloat(formData.pressure)
        let r = 0
        if (pressureVal < 970) r = 5
        else if (pressureVal <= 989) r = 3
        else if (pressureVal <= 999) r = 1
        maxRank = Math.max(maxRank, r)
    }
    if (hasHumidity) {
        const humidityVal = parseFloat(formData.humidity)
        let r = 0
        if (humidityVal >= 95) r = 3
        else if (humidityVal >= 85) r = 1
        maxRank = Math.max(maxRank, r)
    }
    if (hasTemp) {
        const tempVal = parseFloat(formData.temperature)
        let r = 0
        if (tempVal < 24) r = 1
        maxRank = Math.max(maxRank, r)
    }

    const isBtnDisabled = assessing || !formData.barangay_id

    let conditionLabel = ""
    if (maxRank === 3) conditionLabel = "Signal 1"
    else if (maxRank === 4) conditionLabel = "Signal 2–3"
    else if (maxRank === 5) conditionLabel = "Signal 4–5"

    // Progress-bar percentages — corrected PH-baseline formulas (match backend)
    const clamp = (val) => Math.min(Math.max(val, 0), 100)
    const windPct = Math.round(clamp((wind - 30) / 190 * 100))
    const pressurePct = Math.round(clamp((1013 - pressure) / 43 * 100))
    const rainPct = Math.round(clamp(rain / 60 * 100))
    const humidityPct = Math.round(clamp((humidity - 85) / 15 * 100))
    const tempPct = Math.round(clamp((30 - temperature) / 6 * 100))
    const temperaturePct = tempPct

    // -- 5-factor weighted composite score (0–100) — matches backend weights -----
    const finalScore = Math.round(
        (windPct * 0.35) +
        (pressurePct * 0.30) +
        (rainPct * 0.20) +
        (humidityPct * 0.10) +
        (tempPct * 0.05)
    )
    const compositeScore = result ? (result.score ?? finalScore) : null

    const severity = result?.severity || null
    const sevCfg = compositeScore !== null ? getSeverityConfig(compositeScore, wind, rain, pressure) : null

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
        : null

    // Alert banner config based on result
    const alertBanner = () => {
        if (!result) return null
        const cfg = sevCfg
        return (
            <div style={{
                background: cfg.alertBg, border: `0.5px solid ${cfg.alertBorder}`,
                borderRadius: 8, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10,
            }}>
                <span style={{ fontSize: 18, display: "flex", alignItems: "center" }}>
                    {compositeScore <= 24 ? <Info size={18} style={{ color: cfg.alertText }} /> : <AlertTriangle size={18} style={{ color: cfg.alertText }} />}
                </span>
                <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: cfg.alertText }}>
                        {cfg.signal.startsWith("Signal") ? "PAGASA " : ""}{cfg.signal} · {cfg.label}
                    </div>
                    <div style={{ fontSize: 11, color: cfg.alertText, opacity: 0.85, marginTop: 2 }}>
                        {result.message}
                    </div>
                </div>
            </div>
        )
    }

    const windCardStyle = getCardBadgeAndBorder("wind_speed", formData.wind_speed)
    const rainCardStyle = getCardBadgeAndBorder("rainfall", formData.rainfall)
    const pressureCardStyle = getCardBadgeAndBorder("pressure", formData.pressure)
    const tempCardStyle = getCardBadgeAndBorder("temperature", formData.temperature)
    const humidityCardStyle = getCardBadgeAndBorder("humidity", formData.humidity)

    return (
        <div style={styles.page}>
            <style>{`
        @keyframes bagyoPulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes ticker { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes pulseBtn {
            0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(163, 45, 45, 0.7); }
            70% { transform: scale(1.03); box-shadow: 0 0 0 8px rgba(163, 45, 45, 0); }
            100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(163, 45, 45, 0); }
        }
        .bagyo-pulse-btn {
            animation: pulseBtn 1.5s infinite;
        }
        .bagyo-nav:hover { background: rgba(255,255,255,0.08) !important; }
        .bagyo-sidebar-item:hover { background: #f5f7ff !important; color: #185FA5 !important; }
        .bagyo-assess:hover:not(:disabled) { opacity: 0.88 !important; transform: translateY(-1px); }
        .bagyo-assess:active:not(:disabled) { transform: scale(0.98); }
      `}</style>



            {/* -- Main Layout -------------------------------------------------- */}
            <div style={styles.layout}>

                {/* -- Sidebar ---------------------------------------------------- */}
                <Sidebar activePage="dashboard">
                    <div style={styles.navSection}>Barangay</div>

                    <div style={{ padding: "0 12px 12px" }}>
                        <div style={styles.barangayLabel}>Active barangay</div>
                        <Select
                            options={barangays}
                            value={selectedBarangay}
                            onChange={handleBarangayChange}
                            placeholder="Select barangay..."
                            isSearchable
                            menuPortalTarget={document.body}
                            styles={selectStyles}
                        />
                        {selectedBarangay?.riskLevel && (
                            <div style={{
                                marginTop: 8, fontSize: 11, fontWeight: 600, padding: "3px 10px",
                                borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 5, color: "white",
                                background: RISK_COLORS[selectedBarangay.riskLevel] || "#888",
                            }}>
                                <AlertTriangle size={12} /> {selectedBarangay.riskLevel.toUpperCase()} RISK
                            </div>
                        )}
                    </div>

                    {/* Weather status in sidebar */}
                    <div style={{ padding: "0 12px", marginTop: "auto", paddingBottom: 16 }}>
                        <div style={{
                            background: weatherFetched ? "#E1F5EE" : "#f5f5f5",
                            borderRadius: 8, padding: "8px 10px", fontSize: 11,
                            color: weatherFetched ? "#085041" : "#aaa",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}>
                            {weatherLoading ? (
                                <>
                                    <Loader size={12} style={{ animation: "spin 1.5s linear infinite" }} />
                                    <span>Fetching weather...</span>
                                </>
                            ) : weatherFetched ? (
                                <>
                                    <Satellite size={12} style={{ color: "#1D9E75" }} />
                                    <span>Live · Updated {lastUpdatedStr}</span>
                                </>
                            ) : (
                                "Select a barangay"
                            )}
                        </div>
                    </div>
                </Sidebar>

                {/* -- Main Content ----------------------------------------------- */}
                <main style={styles.main}>

                    {/* Topbar */}
                    <div style={styles.topbar}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "white" }}>Dashboard</span>
                            <span style={styles.liveBadge}><LiveDot /> Live</span>
                            <span style={{ ...styles.aiChip, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <Tornado size={12} style={{ animation: "spin 3s linear infinite" }} /> AI-Powered
                            </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255, 255, 255, 0.85)" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <MapPin size={12} style={{ color: "rgba(255, 255, 255, 0.7)" }} /> {selectedBarangay ? `${selectedBarangay.name}, ${selectedBarangay.city}` : "No barangay selected"}
                            </span>
                            {lastUpdatedStr && <span style={{ color: "rgba(255, 255, 255, 0.3)" }}>|</span>}
                            {lastUpdatedStr && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <RefreshCw size={11} style={{ animation: weatherLoading ? "spin 1.5s linear infinite" : "none" }} /> Updated {lastUpdatedStr}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Content area */}
                    <div style={styles.content}>



                        {/* Alert banner - shows after assessment */}
                        {result && alertBanner()}

                        {/* No assessment yet - info bar */}
                        {!result && (
                            <div style={{ background: "#EBF3FB", border: "0.5px solid #B5D4F4", borderRadius: 8, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                                <Info size={16} style={{ color: "#0C447C" }} />
                                <div style={{ fontSize: 12, color: "#0C447C" }}>
                                    {weatherFetched
                                        ? `Live weather loaded for ${selectedBarangay?.name}. Press Assess to evaluate severity.`
                                        : "Select a barangay - weather data loads automatically."}
                                </div>
                            </div>
                        )}

                        {/* Metric cards */}
                        <div style={styles.metricsRow}>
                            <MetricCard
                                icon={<Wind size={15} />} color="#185FA5" bg="#E6F1FB"
                                label="Wind speed" value={metricDisplay(formData.wind_speed)} unit="km/h"
                                trend={wind > 88 ? "up" : null} trendLabel={wind > 118 ? "Danger" : "Warning"}
                                barPct={windPct} barColor={windCardStyle.barColor || "#ddd"}
                                badge={windCardStyle.badge} borderColor={windCardStyle.border}
                            />
                            <MetricCard
                                icon={<CloudRain size={15} />} color="#3B6D11" bg="#EAF3DE"
                                label="Rainfall rate" value={metricDisplay(formData.rainfall)} unit="mm/hr"
                                trend={rain > 15 ? "up" : null} trendLabel={rain > 30 ? "Heavy" : "Moderate"}
                                barPct={rainPct} barColor={rainCardStyle.barColor || "#ddd"}
                                badge={rainCardStyle.badge} borderColor={rainCardStyle.border}
                            />
                            <MetricCard
                                icon={<Gauge size={15} />} color="#993C1D" bg="#FAECE7"
                                label="Atmos. pressure" value={metricDisplay(formData.pressure)} unit="hPa"
                                trend={pressure > 0 && pressure < 990 ? "up" : null} trendLabel="Dropping"
                                barPct={pressurePct} barColor={pressureCardStyle.barColor || "#ddd"}
                                badge={pressureCardStyle.badge} borderColor={pressureCardStyle.border}
                            />
                            <MetricCard
                                icon={<Thermometer size={15} />} color="#D85A30" bg="#FAECE7"
                                label="Temperature" value={metricDisplay(formData.temperature)} unit="°C"
                                barPct={temperaturePct} barColor={tempCardStyle.barColor || "#ddd"}
                                badge={tempCardStyle.badge} borderColor={tempCardStyle.border}
                            />
                            <MetricCard
                                icon={<Droplets size={15} />} color="#185FA5" bg="#E6F1FB"
                                label="Humidity" value={metricDisplay(formData.humidity)} unit="%"
                                barPct={humidityPct} barColor={humidityCardStyle.barColor || "#ddd"}
                                badge={humidityCardStyle.badge} borderColor={humidityCardStyle.border}
                            />
                        </div>

                        <div style={{ ...styles.card, padding: "9px 12px" }}>
                            <div style={{ ...styles.cardHeader, marginBottom: 6 }}>
                                <div style={{ ...styles.cardTitle, display: "flex", alignItems: "center", gap: 5 }}>
                                    <Info size={13} style={{ color: "#555" }} /> Bonus weather details
                                </div>
                                <span style={{ fontSize: 11, color: "#888" }}>Open-Meteo current</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                                <div style={{ background: "#f8f9fc", border: "1px solid #eef1f5", borderRadius: 8, padding: "8px 10px" }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>Wind Gusts</div>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginTop: 2 }}>
                                        {extraWeather.wind_gusts} {extraWeather.wind_gusts === "N/A" ? "" : "km/h"}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Trend chart + Severity gauge */}
                        <div style={styles.row2}>
                            <div style={styles.card}>
                                <div style={styles.cardHeader}>
                                    <div style={{ ...styles.cardTitle, display: "flex", alignItems: "center", gap: 5 }}>
                                        <BarChart2 size={13} style={{ color: "#555" }} /> 6-hour wind trend
                                    </div>
                                    <span onClick={() => navigate("/history")} style={styles.cardAction}>View history &gt;</span>
                                </div>
                                <TrendChart data={trendData} />
                            </div>

                            <div style={styles.card}>
                                <div style={styles.cardHeader}>
                                    <div style={{ ...styles.cardTitle, display: "flex", alignItems: "center", gap: 5 }}>
                                        <Tornado size={13} style={{ animation: result ? "spin 4s linear infinite" : "none", color: "#555" }} /> AI severity score
                                    </div>
                                    {!result && <span style={{ fontSize: 11, color: "#bbb" }}>Run assess first</span>}
                                </div>
                                {result ? (
                                    <>
                                        <SeverityGauge score={compositeScore} wind={wind} rain={rain} pressure={pressure} />
                                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                                            <FactorBar label="Wind" pct={windPct} color="#378ADD" />
                                            <FactorBar label="Rainfall" pct={rainPct} color="#639922" />
                                            <FactorBar label="Pressure" pct={pressurePct} color="#D85A30" />
                                            <FactorBar label="Temp" pct={tempPct} color="#EF9F27" />
                                            <FactorBar label="Humidity" pct={humidityPct} color="#185FA5" />
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", gap: 8 }}>
                                        <Tornado size={36} style={{ color: "#ddd" }} />
                                        <span style={{ fontSize: 12, color: "#bbb" }}>Assessment not yet run</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Manual input row - allows override */}
                        <div style={styles.card}>
                            <div style={styles.cardHeader}>
                                <div style={{ ...styles.cardTitle, display: "flex", alignItems: "center", gap: 5 }}>
                                    <Edit3 size={13} style={{ color: "#555" }} /> Override weather values (optional)
                                </div>
                                <span style={{ fontSize: 11, color: "#aaa" }}>Auto-filled from live API</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto", gap: 10, alignItems: "flex-end" }}>
                                {[
                                    { name: "wind_speed", label: "Wind (km/h)", placeholder: "e.g. 120" },
                                    { name: "rainfall", label: "Rain (mm/hr)", placeholder: "e.g. 25" },
                                    { name: "pressure", label: "Pressure (hPa)", placeholder: "e.g. 985" },
                                    { name: "temperature", label: "Temp (°C)", placeholder: "e.g. 28" },
                                    { name: "humidity", label: "Humidity (%)", placeholder: "e.g. 80" },
                                ].map(({ name, label, placeholder }) => (
                                    <div key={name}>
                                        <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>{label}</label>
                                        <input
                                            type="number" name={name} value={formData[name]}
                                            onChange={handleChange} placeholder={placeholder}
                                            style={{
                                                ...styles.input,
                                                border: `1.5px solid ${getOverrideInputBorderColor(name, formData[name])}`,
                                            }}
                                        />
                                    </div>
                                ))}
                                <button
                                    className={`bagyo-assess ${(!isBtnDisabled && (maxRank === 4 || maxRank === 5)) ? "bagyo-pulse-btn" : ""}`}
                                    onClick={handleAssessClick}
                                    disabled={isBtnDisabled}
                                    style={{
                                        ...styles.assessBtn,
                                        background: isBtnDisabled
                                            ? "#ccc"
                                            : maxRank === 1 || maxRank === 2
                                                ? "#EF9F27"
                                                : maxRank === 3
                                                    ? "#E24B4A"
                                                    : maxRank === 4 || maxRank === 5
                                                        ? "#A32D2D"
                                                        : "linear-gradient(135deg, #1a237e, #1565c0)",
                                        cursor: isBtnDisabled ? "not-allowed" : "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 5,
                                        justifyContent: "center",
                                        border: "none",
                                    }}
                                >
                                    {assessing ? (
                                        <>
                                            <Loader size={13} style={{ animation: "spin 1.5s linear infinite" }} /> Assessing...
                                        </>
                                    ) : (
                                        <>
                                            {maxRank === 0 && <><Search size={13} /> Assess</>}
                                            {maxRank === 1 && "Assess - Watch Level"}
                                            {maxRank === 2 && "Assess - Elevated"}
                                            {maxRank === 3 && "Assess - Signal 1 Detected"}
                                            {maxRank === 4 && "Assess - Signal 2–3"}
                                            {maxRank === 5 && "URGENT - Assess Now"}
                                        </>
                                    )}
                                </button>
                            </div>

                            {assessError && (
                                <div style={{ marginTop: 10, fontSize: 12, color: "#dc3545", background: "#fff0f0", padding: "8px 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6 }}>
                                    <AlertTriangle size={14} /> {assessError}
                                </div>
                            )}
                        </div>

                        {/* Evacuation routes + Recent history */}
                        <div style={styles.row3}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                <EvacRoutes evacuationCenter={result?.evacuation_center} severity={severity} />
                                {result?.evacuation_center && (
                                    <button
                                        onClick={() => setShowMap(!showMap)}
                                        style={{
                                            marginTop: 8, padding: "8px 14px", background: "#1565c0", color: "white",
                                            border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                                            display: "inline-flex", alignItems: "center", gap: 5, justifyContent: "center"
                                        }}
                                    >
                                        <Map size={13} /> {showMap ? "Hide Map" : "View on Map"}
                                    </button>
                                )}
                                {showMap && result?.evacuation_center && (
                                    <div style={{ marginTop: 10 }}>
                                        <MapView evacuationCenter={result.evacuation_center} barangay={selectedBarangay} />
                                    </div>
                                )}
                            </div>
                            <RecentHistory logs={recentLogs} />
                        </div>

                    </div>
                </main>
            </div>

            {confirmModalOpen && (
                <div style={styles.overlay} onClick={handleCancelSubmit}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={{ ...styles.modalTitle, color: "#a32d2d", display: "flex", alignItems: "center", gap: 6 }}>
                                <AlertTriangle size={18} /> Confirm Assessment
                            </h2>
                            <div onClick={handleCancelSubmit} style={styles.closeBtn}><X size={18} /></div>
                        </div>
                        <div style={{ ...styles.modalBody, fontSize: 14, color: "#333", lineHeight: 1.5 }}>
                            <p style={{ margin: "0 0 10px 0" }}>
                                Weather data indicates <strong>{conditionLabel}</strong> conditions.
                            </p>
                            <p style={{ margin: "0 0 10px 0" }}>
                                Submitting this assessment will notify barangay officials.
                            </p>
                            <p style={{ margin: 0, fontWeight: 600 }}>Proceed?</p>
                        </div>
                        <div style={styles.modalFooter}>
                            <button
                                onClick={handleCancelSubmit}
                                style={styles.cancelBtn}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmSubmit}
                                style={styles.saveBtn}
                            >
                                Yes, Submit Assessment
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// --- Styles ------------------------------------------------------------------
const styles = {
    page: { minHeight: "100vh", background: "#f0f4f8", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" },

    // Navbar
    navbar: { background: "linear-gradient(135deg, #1a237e, #1565c0)", display: "flex", flexDirection: "column", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(26,35,126,0.25)" },
    navTop: { padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" },
    navLogo: { display: "flex", alignItems: "center", gap: 8 },
    navLogoText: { color: "white", fontSize: 20, fontWeight: 700, letterSpacing: 0.5 },
    navLinks: { display: "flex", gap: 24 },
    navLink: { color: "white", fontSize: 14, fontWeight: 500, padding: "4px 0", textDecoration: "none", transition: "opacity 0.2s" },

    ticker: { background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", height: 34, borderTop: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" },
    tickerBadge: { flexShrink: 0, padding: "0 14px", color: "#00e676", fontWeight: 800, fontSize: 11, letterSpacing: 1.5, borderRight: "1px solid rgba(255,255,255,0.15)", height: "100%", display: "flex", alignItems: "center" },
    tickerWindow: { flex: 1, overflow: "hidden" },
    tickerTrack: { display: "flex", animation: "ticker 40s linear infinite", whiteSpace: "nowrap" },
    tickerText: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 500, padding: "0 20px", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 },

    // Layout
    layout: { display: "flex", flex: 1 },


    navSection: { fontSize: 10, color: "#bbb", padding: "12px 14px 4px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" },
    sidebarItem: { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", fontSize: 13, transition: "background 0.15s, color 0.15s" },
    barangayLabel: { fontSize: 10, color: "#aaa", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" },

    // Main
    main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
    topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "linear-gradient(135deg, #1a237e, #1565c0)", borderBottom: "0.5px solid #1a237e", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" },
    liveBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#00e676", background: "rgba(0, 230, 118, 0.15)", padding: "3px 9px", borderRadius: 20, fontWeight: 600, border: "0.5px solid rgba(0, 230, 118, 0.3)" },
    aiChip: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, background: "rgba(255, 255, 255, 0.15)", color: "#90caf9", padding: "3px 9px", borderRadius: 20, fontWeight: 600, border: "0.5px solid rgba(255, 255, 255, 0.25)" },

    content: { padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, flex: 1 },



    // Metrics
    metricsRow: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 },
    metricCard: { background: "white", borderRadius: 10, border: "0.5px solid #e8ecf0", padding: "10px 13px" },
    metricIconRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    metricIconBox: { width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" },
    metricVal: { fontSize: 24, fontWeight: 600, color: "#1a1a2e" },
    metricUnit: { fontSize: 11, color: "#aaa" },
    metricLabel: { fontSize: 11, color: "#aaa", marginTop: 2 },
    metricBarTrack: { height: 3, borderRadius: 2, marginTop: 7, background: "#f0f0f0", overflow: "hidden" },
    metricBarFill: { height: "100%", borderRadius: 2, transition: "width 0.5s, background 0.3s" },

    // Cards
    row2: { display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10 },
    row3: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    card: { background: "white", borderRadius: 10, border: "0.5px solid #e8ecf0", padding: "11px 13px" },
    cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    cardTitle: { fontSize: 12, fontWeight: 600, color: "#333" },
    cardAction: { fontSize: 11, color: "#1565c0", cursor: "pointer" },

    // Evacuation
    evacCard: { background: "#FCEBEB", border: "0.5px solid #F09595", borderRadius: 10, padding: "10px 13px" },
    evacHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 },
    evacTitle: { fontSize: 12, fontWeight: 600, color: "#501313" },
    routeItem: { display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0" },
    routeNum: { width: 18, height: 18, borderRadius: "50%", background: "#E24B4A", color: "white", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 600 },
    routeInfo: { flex: 1 },
    routeName: { fontSize: 12, fontWeight: 600, color: "#501313" },
    routeDesc: { fontSize: 10, color: "#793333" },
    routeStatus: { fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 10 },

    // History
    historyCard: { background: "white", borderRadius: 10, border: "0.5px solid #e8ecf0", padding: "11px 13px" },
    histRow: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" },

    // Input / Assess
    input: {
        width: "100%", padding: "8px 10px", borderRadius: 8,
        border: "1px solid #e0e0e0", fontSize: 13, outline: "none",
        background: "#fafafa", color: "#333",
    },
    assessBtn: {
        padding: "8px 18px", color: "white", border: "none",
        borderRadius: 8, fontSize: 13, fontWeight: 700,
        transition: "opacity 0.2s, transform 0.15s", whiteSpace: "nowrap",
    },
    overlay: {
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    },
    modal: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid #eee" },
    modalTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: "#1a237e" },
    closeBtn: { cursor: "pointer", color: "#888", padding: 4, display: "flex", alignItems: "center" },
    modalBody: { padding: "20px" },
    modalFooter: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid #eee" },
    cancelBtn: { padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer", color: "#666", border: "1px solid #ddd", background: "#fff" },
    saveBtn: { padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#a32d2d", color: "#fff", border: "none" },
}

const selectStyles = {
    control: b => ({ ...b, borderRadius: 8, border: "1px solid #e0e0e0", boxShadow: "none", fontSize: 12, minHeight: 34 }),
    option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? "#EBF3FB" : "white", color: "#1a237e", fontSize: 12 }),
    singleValue: b => ({ ...b, color: "#1a237e", fontWeight: 600, fontSize: 12 }),
    menu: b => ({ ...b, zIndex: 9999 }),
}




