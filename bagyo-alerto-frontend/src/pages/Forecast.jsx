import { useState, useEffect, useRef } from "react"
import axios from "axios"
import Select from "react-select"
import Sidebar from "../components/Sidebar"
import { 
    Tornado, MapPin, Wind, CloudRain, Gauge, Droplets, 
    RefreshCw, AlertTriangle, Satellite, Thermometer 
} from "lucide-react"

const API_BASE = import.meta.env.VITE_API_BASE

const WX_ICON = (code) => {
    if (code === 0) return "☀️"
    if (code <= 3) return "⛅"
    if (code <= 48) return "🌫️"
    if (code <= 67) return "🌧️"
    if (code <= 82) return "🌦️"
    if (code <= 99) return "⛈️"
    return "🌡️"
}

const WX_DESC = (code) => {
    if (code === 0) return "Clear Sky"
    if (code <= 3) return "Partly Cloudy"
    if (code <= 48) return "Foggy"
    if (code <= 67) return "Rainy"
    if (code <= 82) return "Showers"
    if (code <= 99) return "Thunderstorms"
    return "Mild"
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const RISK_COLORS = { low: "#1D9E75", moderate: "#EF9F27", high: "#D85A30", critical: "#E24B4A" }

const getBarangayDisplayName = (barangay) => {
    if (!barangay || !barangay.name) return ""
    return barangay.name.replace(/^Barangay\s+/i, "").trim()
}

const selectStyles = {
    control: (provided) => ({
        ...provided,
        fontSize: 12,
        borderRadius: 8,
        border: "0.5px solid #e0e0e0",
        boxShadow: "none",
        minHeight: 32,
        height: 32,
        background: "#fafafa",
        "&:hover": { border: "0.5px solid #ccc" }
    }),
    valueContainer: (provided) => ({ ...provided, padding: "0 8px" }),
    indicatorsContainer: (provided) => ({ ...provided, height: 30 }),
    option: (provided, state) => ({
        ...provided,
        fontSize: 12,
        background: state.isSelected ? "#185FA5" : state.isFocused ? "#EBF3FB" : "white",
        color: state.isSelected ? "white" : "#333",
        padding: "6px 10px",
    }),
    menuPortal: base => ({ ...base, zIndex: 9999 })
}

export default function Forecast() {
    const [barangays, setBarangays] = useState([])
    const [selectedBarangay, setSelectedBarangay] = useState(null)
    const [weather, setWeather] = useState(null)
    const [loading, setLoading] = useState(false)
    const [lastUpdated, setLastUpdated] = useState(null)

    const chartRef = useRef(null)
    const chartInstance = useRef(null)

    // ── Fetch barangays on mount ─────────────────────────────────────────────
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
                }
            })
            .catch(() => console.error("Failed to load barangays"))
    }, [])

    // ── Fetch weather details when active barangay changes ───────────────────
    useEffect(() => {
        if (!selectedBarangay) return
        setLoading(true)

        axios.get(
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${selectedBarangay.latitude}&longitude=${selectedBarangay.longitude}` +
            `&current=temperature_2m,weathercode,windspeed_10m,surface_pressure,relativehumidity_2m,precipitation_probability` +
            `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
            `&hourly=temperature_2m` +
            `&timezone=Asia%2FManila&forecast_days=7`
        ).then(res => {
            const data = res.data
            setWeather({
                current: data.current,
                daily: data.daily.time.map((t, i) => ({
                    date: new Date(t),
                    code: data.daily.weathercode[i],
                    hi: Math.round(data.daily.temperature_2m_max[i]),
                    lo: Math.round(data.daily.temperature_2m_min[i]),
                    rain: data.daily.precipitation_probability_max[i],
                })),
                hourly: data.hourly.time.slice(0, 24).map((t, i) => ({
                    time: new Date(t).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true }),
                    temp: data.hourly.temperature_2m[i],
                }))
            })
            setLastUpdated(new Date())
            setLoading(false)
        }).catch(() => {
            setLoading(false)
        })
    }, [selectedBarangay])

    // ── Render Chart.js Temperature line chart ──────────────────────────────
    useEffect(() => {
        if (!weather || weather.hourly.length === 0 || !chartRef.current) return
        if (chartInstance.current) chartInstance.current.destroy()

        const ctx = chartRef.current.getContext("2d")

        // Create gradient fill under line
        const gradient = ctx.createLinearGradient(0, 0, 0, 180)
        gradient.addColorStop(0, "rgba(24, 95, 165, 0.25)")
        gradient.addColorStop(1, "rgba(24, 95, 165, 0.0)")

        chartInstance.current = new window.Chart(ctx, {
            type: "line",
            data: {
                labels: weather.hourly.filter((_, idx) => idx % 2 === 0).map(h => h.time), // Show every 2 hours
                datasets: [{
                    label: "Temperature (°C)",
                    data: weather.hourly.filter((_, idx) => idx % 2 === 0).map(h => h.temp),
                    borderColor: "#185FA5",
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true,
                    backgroundColor: gradient,
                    pointBackgroundColor: "#185FA5",
                    pointRadius: 3,
                    pointHoverRadius: 5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.parsed.y} °C`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 10 }, color: "#aaa" }
                    },
                    y: {
                        grid: { color: "rgba(0,0,0,0.05)" },
                        ticks: { 
                            font: { size: 10 }, 
                            color: "#aaa",
                            callback: (val) => `${val}°C`
                        }
                    }
                }
            }
        })

        return () => {
            if (chartInstance.current) chartInstance.current.destroy()
        }
    }, [weather])

    const handleBarangayChange = (option) => {
        setSelectedBarangay(option)
    }

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
        : null

    return (
        <div style={styles.page}>
            <style>{`
                .f-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05) !important; }
            `}</style>

            <div style={styles.layout}>
                {/* Sidebar */}
                <Sidebar activePage="forecast">
                    <div style={styles.navSection}>Barangay</div>
                    <div style={{ padding: "0 12px 12px" }}>
                        <div style={styles.barangayLabel}>Query barangay</div>
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
                </Sidebar>

                {/* Main Content */}
                <main style={styles.main}>
                    {/* Topbar */}
                    <div style={styles.topbar}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={styles.tbTitle}>Forecast Center</span>
                            <span style={styles.tbCount}>7-Day Meteorological View</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "rgba(255, 255, 255, 0.85)" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <MapPin size={12} style={{ color: "rgba(255, 255, 255, 0.7)" }} /> {selectedBarangay ? `${selectedBarangay.name}, ${selectedBarangay.city}` : "No barangay selected"}
                            </span>
                            {lastUpdatedStr && <span style={{ color: "rgba(255, 255, 255, 0.3)" }}>|</span>}
                            {lastUpdatedStr && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <RefreshCw size={11} style={{ animation: loading ? "spin 1.5s linear infinite" : "none" }} /> Updated {lastUpdatedStr}
                                </span>
                            )}
                        </div>
                    </div>

                    <div style={styles.content}>
                        <h2 style={selectedBarangay ? styles.dynamicHeading : styles.placeholderHeading}>
                            {selectedBarangay
                                ? `Current Weather in ${getBarangayDisplayName(selectedBarangay)}`
                                : "Select a Barangay to view forecast"}
                        </h2>

                        {loading && (
                            <div style={styles.loadingBox}>
                                <RefreshCw size={24} style={{ animation: "spin 1.5s linear infinite", color: "#185FA5", marginBottom: 8 }} />
                                <div style={{ fontSize: 13, color: "#666" }}>Retrieving live meteorological forecast...</div>
                            </div>
                        )}

                        {!loading && weather && (
                            <>
                                {/* Top Row: Current Conditions & Hourly Temperature Trend */}
                                <div style={styles.topGrid}>
                                    {/* Current Weather Card */}
                                    <div style={{ ...styles.card, background: "linear-gradient(135deg, #1a237e, #1565c0)", color: "white", border: "none" }}>
                                        <div style={{ fontSize: 11, opacity: 0.8, textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em" }}>Current Weather</div>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0" }}>
                                            <div>
                                                <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>
                                                    {Math.round(weather.current.temperature_2m)}<span style={{ fontSize: 24, fontWeight: 400 }}>°C</span>
                                                </div>
                                                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                                                    {WX_ICON(weather.current.weathercode)} {WX_DESC(weather.current.weathercode)}
                                                </div>
                                            </div>
                                            <span style={{ fontSize: 56 }}>{WX_ICON(weather.current.weathercode)}</span>
                                        </div>

                                        <div style={styles.metaRow}>
                                            <div style={styles.metaItem}>
                                                <div style={styles.metaLabelWhite}><Droplets size={12} /> Humidity</div>
                                                <div style={styles.metaValWhite}>{weather.current.relativehumidity_2m}%</div>
                                            </div>
                                            <div style={styles.metaItem}>
                                                <div style={styles.metaLabelWhite}><Wind size={12} /> Wind</div>
                                                <div style={styles.metaValWhite}>{Math.round(weather.current.windspeed_10m)} km/h</div>
                                            </div>
                                            <div style={styles.metaItem}>
                                                <div style={styles.metaLabelWhite}><Gauge size={12} /> Pressure</div>
                                                <div style={styles.metaValWhite}>{Math.round(weather.current.surface_pressure)} hPa</div>
                                            </div>
                                            <div style={styles.metaItem}>
                                                <div style={styles.metaLabelWhite}><CloudRain size={12} /> Precip.</div>
                                                <div style={styles.metaValWhite}>{weather.current.precipitation_probability ?? 0}%</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Hourly Trend Line Chart */}
                                    <div style={styles.card}>
                                        <div style={styles.cardHeader}>
                                            <span style={styles.cardTitle}><Thermometer size={14} style={{ color: "#185FA5" }} /> 24-Hour Temperature Trend</span>
                                        </div>
                                        <div style={{ height: 160, position: "relative" }}>
                                            <canvas ref={chartRef} />
                                        </div>
                                    </div>
                                </div>

                                {/* Section Label */}
                                <div style={styles.sectionHeader}>
                                    <span>7-Day Weather Outlook</span>
                                </div>

                                {/* 7-Day Grid */}
                                <div style={styles.forecastGrid}>
                                    {weather.daily.map((day, idx) => {
                                        const isToday = idx === 0
                                        const dayName = isToday ? "Today" : DAYS[day.date.getDay()]
                                        const dateStr = day.date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })
                                        const rainBg = day.rain > 60 ? "#FCEBEB" : day.rain > 30 ? "#EBF3FB" : "#EAF3DE"
                                        const rainColor = day.rain > 60 ? "#E24B4A" : day.rain > 30 ? "#185FA5" : "#639922"

                                        return (
                                            <div key={idx} className="f-card" style={{
                                                ...styles.card,
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                textAlign: "center",
                                                padding: "16px 10px",
                                                background: isToday ? "#f4f8fd" : "white",
                                                border: isToday ? "1px solid #b5d4f4" : "0.5px solid #e8ecf0",
                                                transition: "transform 0.2s, box-shadow 0.2s"
                                            }}>
                                                <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? "#185FA5" : "#333" }}>{dayName}</div>
                                                <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{dateStr}</div>
                                                
                                                <div style={{ fontSize: 32, margin: "14px 0" }}>{WX_ICON(day.code)}</div>
                                                <div style={{ fontSize: 11, fontWeight: 600, color: "#555", marginBottom: 12 }}>{WX_DESC(day.code)}</div>

                                                <div style={{ display: "flex", gap: 8, fontSize: 13, fontWeight: 600, margin: "auto 0 10px" }}>
                                                    <span style={{ color: "#333" }}>{day.hi}°</span>
                                                    <span style={{ color: "#aaa" }}>{day.lo}°</span>
                                                </div>

                                                <div style={{
                                                    fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                                                    background: rainBg, color: rainColor, display: "flex", alignItems: "center", gap: 3
                                                }}>
                                                    💧 {day.rain}%
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                </main>
            </div>
        </div>
    )
}

const styles = {
    page: { minHeight: "100vh", background: "#f0f4f8", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, sans-serif" },
    layout: { display: "flex", flex: 1 },
    
    // Sidebar items mapping
    navSection: { fontSize: 10, color: "#bbb", padding: "12px 14px 4px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" },
    barangayLabel: { fontSize: 10, color: "#aaa", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" },

    main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
    topbar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "linear-gradient(135deg, #1a237e, #1565c0)", borderBottom: "0.5px solid #1a237e", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" },
    tbTitle: { fontSize: 14, fontWeight: 600, color: "white" },
    tbCount: { fontSize: 11, color: "#90caf9", background: "rgba(255, 255, 255, 0.15)", padding: "2px 10px", borderRadius: 20, border: "0.5px solid rgba(255, 255, 255, 0.2)" },

    content: { padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, flex: 1 },
    
    loadingBox: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, background: "white", borderRadius: 12, border: "0.5px solid #e8ecf0" },
    
    topGrid: { display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 12 },
    card: { background: "white", borderRadius: 12, border: "0.5px solid #e8ecf0", padding: "14px 18px", boxShadow: "0 2px 6px rgba(0,0,0,0.02)" },
    cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    cardTitle: { fontSize: 12, fontWeight: 600, color: "#333", display: "flex", alignItems: "center", gap: 6 },
    
    metaRow: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 12, borderTop: "0.5px solid rgba(255,255,255,0.2)", paddingTop: 12 },
    metaItem: { display: "flex", flexDirection: "column", gap: 2 },
    metaLabelWhite: { fontSize: 11, color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", gap: 4 },
    metaValWhite: { fontSize: 13, fontWeight: 600 },

    sectionHeader: { fontSize: 12, fontWeight: 700, color: "#1a237e", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 8 },
    forecastGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 },
    dynamicHeading: {
        fontSize: "18px",
        fontWeight: "700",
        color: "#1a237e",
        margin: "0 0 4px 0",
        letterSpacing: "-0.01em",
    },
    placeholderHeading: {
        fontSize: "18px",
        fontWeight: "600",
        color: "#6b7280",
        margin: "0 0 4px 0",
        fontStyle: "italic",
        letterSpacing: "-0.01em",
    },
}
