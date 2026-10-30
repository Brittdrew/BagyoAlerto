import React, { Component, useState, useEffect, useRef, useCallback } from "react"
import axios from "axios"
import Select from "react-select"
import { useNavigate } from "react-router-dom"
import MapView, { formatWalkTime } from "../components/MapView"

import Sidebar from "../components/Sidebar"
import EvacuationAlertBanner from "../components/EvacuationAlertBanner"
import SelfArrivalController from "../components/SelfArrivalController"
import LatestPagasaPostCard from "../components/LatestPagasaPostCard"
import { useSavedBarangay } from "../hooks/useSavedBarangay"

import {
    Tornado, Clock, AlertTriangle, Info, Wind,
    CloudRain, Gauge, Edit3, Search, Route, Satellite,
    Loader, MapPin, Thermometer, Droplets, Shield
} from "lucide-react"
import { getSavedRoutePref, saveRoutePref, formatExposureSummary, getHighHazardMeters } from "../utils/routeSafety"

// --- Constants ---------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_BASE
const WEATHER_TIMEOUT = 15000
const ASSESS_TIMEOUT = 8000
import { RefreshCw } from "lucide-react"
const ERROR_MARKERS = new Set(["__assess_error__", "__weather_error__"])

function fmtKm(v, digits = 1) {
    if (v === null || v === undefined) return "--"
    const num = Number(v)
    if (!Number.isFinite(num)) return "--"
    return num.toFixed(digits)
}

function fmtMins(v) {
    if (v === null || v === undefined) return "--"
    const num = Number(v)
    if (!Number.isFinite(num)) return "--"
    return String(Math.max(1, Math.round(num)))
}

function formatTrendTime(value, isLatest) {
    if (isLatest) return "Now"
    const time = String(value || "").split("T")[1] || ""
    const hour = Number(time.split(":")[0])
    if (!Number.isFinite(hour)) return time || "-"
    return `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`
}

function fmtMeters(v) {
    if (v === null || v === undefined) return "--"
    const num = Number(v)
    if (!Number.isFinite(num)) return "--"
    return num.toLocaleString()
}

function metricDisplay(value) {
    return value === null || value === undefined || value === "" ? "N/A" : value
}

// --- Severity config (maps your backend severity_level to UI) ----------------
export function calculateSeverityScore(wind, rain, pressure, temp, humidity) {
    const clamp = (val) => Math.min(Math.max(val, 0), 100);
    const windPct = clamp((wind - 30) / 320 * 100);
    const pressurePct = clamp((1013 - pressure) / 93 * 100);
    const rainPct = clamp(rain / 60 * 100);
    const humidityPct = clamp((humidity - 85) / 15 * 100);
    const tempPct = clamp((30 - temp) / 10 * 100);
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
    let rank;
    if (s <= 10) rank = 0;
    else if (s <= 22) rank = 1;
    else if (s <= 35) rank = 2;
    else if (s <= 50) rank = 3;
    else if (s <= 65) rank = 4;
    else if (s <= 78) rank = 5;
    else if (s <= 90) rank = 6;
    else rank = 7;

    // Hard overrides — only upgrade, never downgrade
    if (wind >= 185) {
        rank = Math.max(rank, 7); // Signal 5
    } else if (wind >= 118) {
        rank = Math.max(rank, 6); // Signal 4
    } else if (wind >= 89) {
        rank = Math.max(rank, 5); // Signal 3
    } else if (wind >= 62) {
        rank = Math.max(rank, 4); // Signal 2
    } else if (wind >= 39) {
        rank = Math.max(rank, 3); // Signal 1
    }

    if (rain >= 30) {
        rank = Math.max(rank, 3);
    } else if (rain >= 7.5) {
        rank = Math.max(rank, 2);
    }

    if (pressure <= 960) {
        rank = Math.max(rank, 5);
    } else if (pressure <= 975) {
        rank = Math.max(rank, 4);
    } else if (pressure <= 990) {
        rank = Math.max(rank, 3);
    } else if (pressure <= 1005) {
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
            label: "Signal 1 equivalent",
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
            label: "Signal 2 equivalent",
            signal: "Signal 2",
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
            label: "Signal 3 equivalent",
            signal: "Signal 3",
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
            label: "Signal 4 equivalent",
            signal: "Signal 4",
            color: "#A32D2D",
            gaugeColor: "#A32D2D",
            alertBg: "#FCEBEB",
            alertBorder: "#E24B4A",
            alertText: "#501313",
            dot: "#A32D2D",
            bg: "#FCEBEB",
            border: "#E24B4A",
            text: "#501313"
        },
        {
            label: "Signal 5 equivalent",
            signal: "Signal 5",
            color: "#7F1D1D",
            gaugeColor: "#7F1D1D",
            alertBg: "#FCEBEB",
            alertBorder: "#A32D2D",
            alertText: "#501313",
            dot: "#7F1D1D",
            bg: "#FCEBEB",
            border: "#A32D2D",
            text: "#501313"
        }
    ];

    return { ...configs[rank], rank };
}

const RISK_COLORS = {
    low: "#1D9E75", moderate: "#BA7517", high: "#D85A30", critical: "#A32D2D", catastrophic: "#7F1D1D",
}

const FACTOR_WEIGHTS = { wind: 0.35, pressure: 0.30, rain: 0.20, humidity: 0.10, temp: 0.05 }

function formatReading(value, maximumFractionDigits = 1) {
    const number = Number(value)
    if (!Number.isFinite(number)) return "-"
    return number.toLocaleString("en-PH", { maximumFractionDigits })
}

function windSignalFor(wind) {
    const value = Number(wind) || 0
    if (value >= 185) return "Signal 5"
    if (value >= 118) return "Signal 4"
    if (value >= 89) return "Signal 3"
    if (value >= 62) return "Signal 2"
    if (value >= 39) return "Signal 1"
    return "No signal"
}

function factorResult(name, value) {
    const number = Number(value) || 0

    if (name === "wind") return windSignalFor(number)
    if (name === "rain") {
        if (number >= 30) return "Extreme rain"
        if (number >= 15) return "Intense rain"
        if (number >= 7.5) return "Heavy rain"
        if (number > 0) return "Light to moderate rain"
        return "No rain"
    }
    if (name === "pressure") {
        if (number <= 960) return "Typhoon-core pressure"
        if (number <= 975) return "Very low pressure"
        if (number <= 990) return "Low pressure"
        if (number <= 1005) return "Falling pressure"
        return "Typical pressure"
    }
    if (name === "temp") {
        if (number < 24) return "Strong cold inflow"
        if (number < 30) return "Below the 30 °C baseline"
        return "At or above the baseline"
    }
    if (number >= 95) return "Near saturation"
    if (number >= 85) return "Very humid"
    return "Below the risk baseline"
}

function factorRowsFor(weather, factors = {}) {
    const definitions = [
        { key: "wind", label: "Wind", unit: "km/h", value: weather.wind },
        { key: "rain", label: "Rain", unit: "mm/hr", value: weather.rain },
        { key: "pressure", label: "Pressure", unit: "hPa", value: weather.pressure },
        { key: "temp", label: "Temperature", unit: "°C", value: weather.temp },
        { key: "humidity", label: "Humidity", unit: "%", value: weather.humidity },
    ]

    return definitions.map(definition => ({
        ...definition,
        result: factorResult(definition.key, definition.value),
        weighted: ((Number(factors[definition.key]) || 0) * FACTOR_WEIGHTS[definition.key]).toFixed(1),
    }))
}

function topRiskDrivers(weather, factors = {}) {
    return factorRowsFor(weather, factors)
        .sort((left, right) => Number(right.weighted) - Number(left.weighted))
        .slice(0, 2)
        .map(row => row.key === "wind"
            ? `Wind ${formatReading(row.value)} ${row.unit} (${row.result})`
            : `${row.result} ${formatReading(row.value)} ${row.unit}`)
}

function raisedRiskReasons(weather, result) {
    if (!result) return []

    const reasons = []
    const rain = Number(weather.rain) || 0
    const pressure = Number(weather.pressure) || 0

    if (rain >= 30) reasons.push(`Extreme rain (${formatReading(rain)} mm/hr)`)
    else if (rain >= 7.5) reasons.push(`${factorResult("rain", rain)} (${formatReading(rain)} mm/hr)`)

    if (pressure <= 1005) {
        reasons.push(`${factorResult("pressure", pressure)} (${formatReading(pressure)} hPa)`)
    }

    if (result?.floor_applied) reasons.push(`PAGASA Signal ${result.pagasa_signal} floor`)
    return reasons
}

function joinReadable(items) {
    if (items.length < 2) return items[0] || ""
    if (items.length === 2) return `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`
}

function patternMonth(date) {
    if (!date) return "date unavailable"
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return "date unavailable"
    return parsed.toLocaleDateString("en-PH", { month: "short", year: "numeric", timeZone: "UTC" })
}

function beyondHistoryText(analysis, weather, finalSeverity) {
    const definitions = {
        wind: { label: "Wind", unit: "km/h", decimals: 0 },
        rain: { label: "Rain", unit: "mm/hr", decimals: 0 },
        pressure: { label: "Pressure", unit: "hPa", decimals: 1 },
        temp: { label: "Temperature", unit: "°C", decimals: 1 },
        humidity: { label: "Humidity", unit: "%", decimals: 0 },
    }
    const names = analysis?.out_of_range || []
    const actual = names.map((name, index) => {
        const definition = definitions[name]
        const label = index === 0 ? definition.label : definition.label.toLowerCase()
        return `${label} ${formatReading(weather[name], definition.decimals)} ${definition.unit}`
    })
    const maxima = names.map(name => {
        const definition = definitions[name]
        return `${formatReading(analysis?.ranges?.[name]?.max, definition.decimals)} ${definition.unit}`
    })
    const allAbove = names.every(name => Number(weather[name]) > Number(analysis?.ranges?.[name]?.max))
    const subject = names.length === 1 ? "is" : "are"
    const rangeDescription = allAbove
        ? `${subject} above anything in the recorded storms (max ${joinReadable(maxima)})`
        : `${subject} outside the recorded storm ranges`

    return `${joinReadable(actual)} ${rangeDescription}. Follow the overall risk: ${finalSeverity}.`
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
    if (name === "wind_speed" && val >= 60) return "#d79627";
    if (name === "rainfall" && val >= 30) return "#d79627";
    if (name === "pressure" && val <= 989) return "#d79627";
    if (name === "humidity" && val >= 95) return "#d79627";
    return "var(--input)";
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
        if (num < 39) return { badge: null, border: null, barColor: "#378ADD" };
        if (num <= 61) return { badge: "Signal 1", border: "#EF9F27", barColor: "#EF9F27" };
        if (num <= 88) return { badge: "Signal 2", border: "#D85A30", barColor: "#D85A30" };
        if (num <= 117) return { badge: "Signal 3", border: "#E24B4A", barColor: "#E24B4A" };
        if (num <= 184) return { badge: "Signal 4", border: "#A32D2D", barColor: "#A32D2D" };
        return { badge: "Signal 5", border: "#6B1D2F", barColor: "#6B1D2F" };
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

function MetricCard({ icon, color, bg, label, value, unit, trend, trendLabel, barPct, barColor, badge, borderColor, hideThreshold = false }) {
    const noData = value === "N/A" || value === "—" || value === "-"
    const safePct = Math.max(0, Math.min(100, Number(barPct) || 0))
    const meterColor = safePct >= 80 ? "var(--destructive)" : safePct >= 60 ? "var(--warning)" : (barColor || "var(--chart-1)")
    const displayBorder = badge || borderColor ? "1px solid var(--warning)" : "1px solid var(--border)"
    return (
        <div style={{ ...styles.metricCard, border: displayBorder }}>
            <div style={styles.metricIconRow}>
                <div style={styles.metricLabelGroup}>
                    <div style={{ ...styles.metricIconBox, color }}>
                        {icon}
                    </div>
                    <span style={styles.metricLabel}>{label}</span>
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
            {!hideThreshold && (
                <>
                    <div role="meter" aria-label={`${label} level`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(safePct)} style={styles.metricBarTrack}>
                        <div style={{ ...styles.metricBarFill, width: `${safePct}%`, background: meterColor }} />
                    </div>
                    <div style={{ ...styles.metricStatus, color: badge ? "#92400e" : "var(--muted-foreground)" }}>
                        {badge || (noData ? "Awaiting data" : `${Math.round(safePct)}% of threshold`)}
                    </div>
                </>
            )}
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
                        backgroundColor: "#5267d9",
                        borderRadius: 6,
                        borderSkipped: false,
                        yAxisID: "yWind",
                    },
                    {
                        type: "line",
                        label: "Temperature",
                        data: data.map(d => d.temp),
                        borderColor: "#d79627",
                        borderWidth: 2,
                        tension: 0.3,
                        fill: false,
                        pointBackgroundColor: "#d79627",
                        pointRadius: 3,
                        yAxisID: "yTemp",
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
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
                    x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10, family: "Geist Mono, monospace" }, color: "#8a90a0" } },
                    yWind: {
                        type: "linear",
                        position: "left",
                        grid: { color: "rgba(80,90,120,0.09)" },
                        border: { display: false },
                        ticks: { font: { size: 10, family: "Geist Mono, monospace" }, color: "#8a90a0", callback: v => v + " km/h" },
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

    return <div style={{ position: "relative", width: "100%", height: 220 }}>
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
                {cfg.signal.startsWith("Signal") ? "Wind equiv. " : ""}{cfg.signal} · 5-factor weighted score
            </div>
        </div>
    )
}

function FactorBar({ label, pct, color }) {
    const safePct = Math.max(0, Math.min(100, Number(pct) || 0))
    const meterColor = safePct >= 80 ? "var(--destructive)" : safePct >= 60 ? "var(--warning)" : color
    return (
        <div style={styles.factorRow}>
            <div style={styles.factorLabelRow}>
                <span>{label}</span>
                <span style={styles.factorValue}>{safePct}%</span>
            </div>
            <div role="meter" aria-label={`${label} contribution`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(safePct)} style={styles.factorTrack}>
                <div style={{ width: `${safePct}%`, height: "100%", background: meterColor, borderRadius: 999, transition: "width 0.5s" }} />
            </div>
        </div>
    )
}

class RouteErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        console.error("[RouteErrorBoundary] Caught error:", error, errorInfo)
    }

    componentDidUpdate(prevProps) {
        if (this.state.hasError && (prevProps.travelMode !== this.props.travelMode || prevProps.selectedBarangay !== this.props.selectedBarangay)) {
            this.setState({ hasError: false, error: null })
        }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    ...styles.evacCard,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#991b1b",
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                }}>
                    <AlertTriangle size={15} style={{ color: "#dc2626", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>Route details unavailable</span>
                </div>
            )
        }
        return this.props.children
    }
}

function EvacRoutes({
    evacuationCenter,
    severity,
    selectedBarangay,
    routedCenter,
    originalCenter,
    routeDistance,
    routeMinutes,
    hasLiveGps,
    barangays = [],
    travelMode = "foot",
    onTravelModeChange,
    // Hazard panel props
    lowerHazardSuggestion,
    isOverrideActive,
    onRouteHere,
    onBackToNearest,
    routeSafetyInfo,
    routePref = "safest",
    onRoutePrefChange,
}) {
    const needsEvac = ["high", "critical", "catastrophic"].includes(severity)
    const isActive = ["moderate", "high", "critical", "catastrophic"].includes(severity)

    if (!selectedBarangay) {
        return (
            <div style={{ ...styles.evacCard, background: "#f8f9fa", border: "0.5px solid #e0e0e0" }}>
                <div style={styles.evacHeader}>
                    <Route size={15} style={{ color: "#aaa" }} />
                    <span style={styles.evacTitle}>Evacuation routes</span>
                </div>
                <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
                    Select your barangay to see recommended evacuation routes.
                </p>
            </div>
        )
    }

    const isLiveActive = Boolean(hasLiveGps && routedCenter)
    const displayCenter = isLiveActive ? routedCenter : evacuationCenter

    if (!displayCenter) {
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

    const targetBarangay = barangays.find(b => (b.id ?? b.value) === displayCenter.barangay_id)
    const centerBarangayName = displayCenter.barangay_name
        || displayCenter.barangay?.name
        || targetBarangay?.name
        || (typeof displayCenter.barangay === "string" ? displayCenter.barangay : null)
        || selectedBarangay?.name
        || ""
    const barangayText = centerBarangayName
        ? (centerBarangayName.toLowerCase().startsWith("brgy") ? centerBarangayName : `Brgy. ${centerBarangayName}`)
        : (displayCenter.address || "")

    // Distance display logic:
    // When live GPS routing is active, show the same road distance shown on the route card, formatted the same way (e.g. 5.25 km away)
    // When no live location (GPS denied or unavailable), keep using assess() center, but change label to "{N} km from barangay center" (e.g. 0.1 km from barangay center)
    let distanceText = null
    if (isLiveActive) {
        const roadDist = routeDistance ?? (displayCenter.distance_km !== undefined ? displayCenter.distance_km : (displayCenter.distance !== undefined ? fmtKm(displayCenter.distance, 1) : null))
        if (roadDist !== null && roadDist !== undefined) {
            distanceText = `${typeof roadDist === "number" ? fmtKm(roadDist, 1) : roadDist} km away`
        }
    } else if (displayCenter.distance !== undefined && displayCenter.distance !== null) {
        distanceText = `${fmtKm(displayCenter.distance, 1)} km from barangay center`
    }

    // ETA display logic for selected mode:
    const modeLabel = travelMode === "car" ? "drive" : "walk"
    let etaMins = (routeMinutes !== null && routeMinutes !== undefined && Number.isFinite(routeMinutes))
        ? routeMinutes
        : null

    if (etaMins === null) {
        const distNum = isLiveActive
            ? (routeDistance ? parseFloat(routeDistance) : (displayCenter?.distance_km ? parseFloat(displayCenter.distance_km) : null))
            : (displayCenter?.distance ? parseFloat(displayCenter.distance) : null)
        if (distNum !== null && Number.isFinite(distNum)) {
            const speed = travelMode === "car" ? 30 : 4.5
            etaMins = Math.max(1, Math.round((distNum / speed) * 60))
        }
    }

    const etaText = etaMins ? `~${formatWalkTime(etaMins)} ${modeLabel}` : null

    return (
        <div style={{
            ...styles.evacCard,
            borderColor: needsEvac ? "color-mix(in oklch, var(--destructive) 32%, var(--border))" : "var(--border)",
        }}>
            <div style={styles.evacHeader}>
                <Route size={15} style={{ color: needsEvac ? "#501313" : "#333" }} />
                <span style={{ ...styles.evacTitle, color: needsEvac ? "#501313" : "#333" }}>Evacuation routes</span>

                {isActive && (
                    <span style={{ fontSize: 10, background: "#E24B4A", color: "#fff", padding: "2px 8px", borderRadius: 20, marginLeft: "auto" }}>
                        ACTIVE
                    </span>
                )}
            </div>

            <div style={styles.routeControls} aria-label="Route preferences">
                <div style={styles.segmentedControl} aria-label="Route origin">
                    <span style={{ ...styles.segment, ...(isLiveActive ? styles.segmentActive : null) }}>Closest to me</span>
                    <span style={{ ...styles.segment, ...(!isLiveActive ? styles.segmentActive : null) }}>Barangay center</span>
                </div>
                <div style={styles.segmentedControl} aria-label="Travel mode">
                    <button
                        type="button"
                        onClick={() => onTravelModeChange?.("foot")}
                        aria-pressed={travelMode === "foot"}
                        style={{ ...styles.segmentButton, ...(travelMode === "foot" ? styles.segmentActive : null) }}
                    >Walk</button>
                    <button
                        type="button"
                        onClick={() => onTravelModeChange?.("car")}
                        aria-pressed={travelMode === "car"}
                        style={{ ...styles.segmentButton, ...(travelMode === "car" ? styles.segmentActive : null) }}
                    >Drive</button>
                </div>
            </div>

            <div style={{ ...styles.routeItem, borderBottom: `0.5px solid ${needsEvac ? "#F7C1C1" : "#eee"}` }}>
                <div style={{ ...styles.routeNum, background: needsEvac ? "#E24B4A" : "#888" }}>1</div>
                <div style={styles.routeInfo}>
                    <div style={{ ...styles.routeName, color: needsEvac ? "#501313" : "#333" }}>{displayCenter.name}</div>
                    <div style={{ ...styles.routeDesc, color: needsEvac ? "#793333" : "#888" }}>{barangayText}</div>
                    {(distanceText || etaText) && (
                        <div style={{ fontSize: 11, fontWeight: 600, color: needsEvac ? "#A32D2D" : "#1565c0", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {distanceText && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                    <MapPin size={11} style={{ color: "inherit" }} /> {distanceText}
                                </span>
                            )}
                            {etaText && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                    <Clock size={11} style={{ color: "inherit" }} /> {etaText}
                                </span>
                            )}
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
                        Capacity: {displayCenter.capacity != null ? fmtMeters(displayCenter.capacity) : "--"} persons
                    </div>
                    <div style={{ ...styles.routeDesc, color: needsEvac ? "#793333" : "#888" }}>
                        {needsEvac ? "Mandatory evacuation recommended" : "Standby - monitor conditions"}
                    </div>
                </div>
            </div>
        </div>
    )
}

function RecentHistory({ logs, onViewAll }) {
    const recent = (logs || []).slice(0, 4)

    return (
        <div style={styles.historyCard}>
            <div style={styles.cardHeader}>
                <div style={styles.cardTitle}>Recent assessments</div>
                <button type="button" onClick={onViewAll} style={styles.cardLink}>See all</button>
            </div>
            {recent.length === 0 && (
                <p style={{ fontSize: 12, color: "#aaa", padding: "8px 0" }}>No assessments yet.</p>
            )}
            {recent.map((log, i) => {
                const tLog = log.typhoon_log
                const score = tLog ? (tLog.score ?? calculateSeverityScore(
                    parseFloat(tLog.wind_speed) || 0,
                    parseFloat(tLog.rainfall) || 0,
                    parseFloat(tLog.pressure) || 0,
                    parseFloat(tLog.temperature) || 0,
                    parseFloat(tLog.humidity) || 0
                )) : 0
                const cfg = getSeverityConfig(score)
                const date = new Date(log.recommended_at)
                const dateStr = date.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                return (
                    <div key={log.id} style={{ ...styles.histRow, borderBottom: i < recent.length - 1 ? "0.5px solid #f0f0f0" : "none" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <strong style={{ display: "block", color: "var(--foreground)", fontSize: 12, fontWeight: 650 }}>{log.barangay?.name || "-"}</strong>
                            <span style={styles.historyDate}>{dateStr}</span>
                        </span>
                        <span style={{
                            fontSize: 10, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                            background: cfg.bg, color: cfg.text, whiteSpace: "nowrap"
                        }}>
                            {String(cfg.label || "Normal").split("/")[0].trim()}
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
    const { barangayId, setBarangayId } = useSavedBarangay()

    const [barangays, setBarangays] = useState([])
    const [selectedBarangay, setSelectedBarangay] = useState(null)
    const [formData, setFormData] = useState({ wind_speed: "", rainfall: "", pressure: "", temperature: "", humidity: "", barangay_id: null })
    const [liveWeather, setLiveWeather] = useState(null)
    const [isManualOverride, setIsManualOverride] = useState(false)
    const [extraWeather, setExtraWeather] = useState({ wind_gusts: "N/A" })
    const [weatherLoading, setWeatherLoading] = useState(false)
    const [weatherFetched, setWeatherFetched] = useState(false)
    const [weatherError, setWeatherError] = useState(false)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [weatherRevision, setWeatherRevision] = useState(0)
    const [trendData, setTrendData] = useState([])
    const [result, setResult] = useState(null)
    const [assessedAt, setAssessedAt] = useState(null)
    const [assessedWeatherRevision, setAssessedWeatherRevision] = useState(null)
    const [assessing, setAssessing] = useState(false)
    const [assessError, setAssessError] = useState(null)
    const [recentLogs, setRecentLogs] = useState([])
    const [isMobileScreen, setIsMobileScreen] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 768 : false))
    // True while MapView has a drawn GPS route to the evacuation center
    const [routingActive, setRoutingActive] = useState(false)
    const [routedCenter, setRoutedCenter] = useState(null)
    const [routeDistance, setRouteDistance] = useState(null)
    const [routeMinutes, setRouteMinutes] = useState(null)
    const [hasLiveGps, setHasLiveGps] = useState(false)
    const [travelMode, setTravelMode] = useState(() => {
        try {
            const saved = localStorage.getItem("bakwit_travel_mode")
            if (saved === "car" || saved === "foot") return saved
        } catch (_e) {
            // ignore
        }
        return "foot"
    })

    // Hazard suggestion + preferred-center override state
    const [preferredCenterId, setPreferredCenterId] = useState(null)
    const [lowerHazardSuggestion, setLowerHazardSuggestion] = useState(null)
    const [baseTarget, setBaseTarget] = useState(null)
    // Ref that MapView fills with { setPreferredCenter, clearPreferredCenter }
    const nearestOverrideRef = useRef(null)

    // Hazard-aware routing state
    const [routeSafetyInfo, setRouteSafetyInfo] = useState(null)
    const [routePref, setRoutePref] = useState(() => getSavedRoutePref())

    const handleRoutePrefChange = useCallback((newPref) => {
        setRoutePref(newPref)
        saveRoutePref(newPref)
    }, [])

    const handleTravelModeChange = useCallback((newMode) => {
        setTravelMode(newMode)
        setPreferredCenterId(null)
        setLowerHazardSuggestion(null)
        // Reset stale route safety info on mode change so walk data is never rendered with vehicle UI
        setRouteSafetyInfo(null)
        try {
            localStorage.setItem("bakwit_travel_mode", newMode)
        } catch (_e) {
            // ignore
        }
    }, [])

    useEffect(() => {
        const handleResize = () => setIsMobileScreen(window.innerWidth <= 768)
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
    }, [])

    const isManualOverrideRef = useRef(false)
    const activeBarangayIdRef = useRef(null)
    const weatherRevisionRef = useRef(0)
    const assessmentGenerationRef = useRef(0)
    const bootstrapStartedRef = useRef(false)

    useEffect(() => {
        isManualOverrideRef.current = isManualOverride
    }, [isManualOverride])

    // -- Fetch barangays on mount ------------------------------------------------
    useEffect(() => {
        if (bootstrapStartedRef.current) return
        bootstrapStartedRef.current = true

        axios.get(`${API_BASE}/barangays`)
            .then(res => {
                const opts = res.data.map(b => ({
                    value: b.id, label: `${b.name}, ${b.city}`,
                    riskLevel: b.risk_level, latitude: b.latitude, longitude: b.longitude,
                    name: b.name, city: b.city,
                }))
                setBarangays(opts)
                if (opts.length > 0) {
                    const saved = (barangayId !== null && barangayId !== undefined)
                        ? opts.find(b => String(b.value) === String(barangayId))
                        : null
                    if (saved) {
                        // Seed the stale-response guard ref before the first fetch
                        activeBarangayIdRef.current = saved.value
                        setSelectedBarangay(saved)
                        setFormData(f => ({ ...f, barangay_id: saved.value }))
                        fetchWeather(saved)
                    } else {
                        activeBarangayIdRef.current = null
                        setSelectedBarangay(null)
                        setFormData(f => ({ ...f, barangay_id: null }))
                    }
                }
            })
            .catch((err) => {
                console.error("Failed to load barangays:", err.response?.status, err.message)
            })

        fetchRecentLogs()

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // -- Fetch live weather ------------------------------------------------------
    async function fetchWeather(option) {
        if (!option?.value) return
        const requestedBarangayId = option.value
        if (activeBarangayIdRef.current !== null &&
            String(activeBarangayIdRef.current) !== String(requestedBarangayId)) {
            return
        }
        setWeatherLoading(true)
        try {
            const response = await axios.get(`${API_BASE}/barangays/${requestedBarangayId}/weather`, {
                timeout: WEATHER_TIMEOUT,
            })

            if (activeBarangayIdRef.current !== null &&
                String(activeBarangayIdRef.current) !== String(requestedBarangayId)) {
                console.info("[weather] Stale response discarded — barangay changed during request")
                return
            }

            const current = response.data?.current || {}
            const metric = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : ""
            const liveMetrics = {
                wind_speed: metric(current.wind_speed),
                rainfall: metric(current.rainfall),
                pressure: metric(current.pressure),
                temperature: metric(current.temperature),
                humidity: metric(current.humidity),
            }
            setLiveWeather(liveMetrics)
            if (!isManualOverrideRef.current) {
                setFormData(f => ({
                    ...f,
                    ...liveMetrics,
                    barangay_id: option.value,
                }))
            }
            setExtraWeather({ wind_gusts: metricDisplay(metric(current.wind_gusts)) })
            setLastUpdated(response.data?.updated_at ? new Date(response.data.updated_at) : new Date())
            setWeatherFetched(true)
            setWeatherError(false)
            setTrendData((response.data?.trend || []).map((point, index, all) => ({
                time: formatTrendTime(point.time, index === all.length - 1),
                wind: Number(point.wind) || 0,
                temp: Number(point.temp) || 0,
            })))
            weatherRevisionRef.current += 1
            setWeatherRevision(weatherRevisionRef.current)
        } catch (error) {
            console.error("Weather fetch failed:", error.response?.status, error.message)
            if (activeBarangayIdRef.current === null ||
                String(activeBarangayIdRef.current) === String(requestedBarangayId)) {
                setWeatherError(true)
            }
        } finally {
            if (activeBarangayIdRef.current === null ||
                String(activeBarangayIdRef.current) === String(requestedBarangayId)) {
                setWeatherLoading(false)
            }
        }
    }

    // -- Fetch recent history ----------------------------------------------------
    async function fetchRecentLogs() {
        try {
            const res = await axios.get(`${API_BASE}/recommendations`)
            setRecentLogs(res.data.slice(0, 4))
        } catch (err) {
            console.error("History fetch failed:", err.response?.status, err.message)
        }
    }

    // -- Barangay change ---------------------------------------------------------
    const handleBarangayChange = (option) => {
        // Update stale-response guard ref immediately so in-flight requests are discarded
        activeBarangayIdRef.current = option?.value ?? null
        assessmentGenerationRef.current += 1
        setSelectedBarangay(option)
        setBarangayId(option?.value ?? null)
        setFormData({ wind_speed: "", rainfall: "", pressure: "", temperature: "", humidity: "", barangay_id: option?.value ?? null })
        setLiveWeather(null)
        setExtraWeather({ wind_gusts: "N/A" })
        setTrendData([])
        setResult(null)
        setAssessedAt(null)
        setAssessedWeatherRevision(null)
        setAssessError(null)
        setWeatherError(false)
        setWeatherFetched(false)
        setRoutedCenter(null)
        setRouteDistance(null)
        setPreferredCenterId(null)
        setLowerHazardSuggestion(null)
        setIsManualOverride(false)
        isManualOverrideRef.current = false
        if (option) fetchWeather(option)
    }

    // -- Manual input change -----------------------------------------------------
    const handleChange = (e) => {
        setIsManualOverride(true)
        isManualOverrideRef.current = true
        setFormData(f => ({ ...f, [e.target.name]: e.target.value }))
    }

    const handleResetToLiveData = () => {
        assessmentGenerationRef.current += 1
        setIsManualOverride(false)
        isManualOverrideRef.current = false
        setResult(null)
        setAssessedAt(null)
        setAssessedWeatherRevision(null)
        setAssessError(null)
        if (liveWeather) {
            setFormData(f => ({
                ...f,
                ...liveWeather,
                barangay_id: formData.barangay_id,
            }))
        }
        if (selectedBarangay) fetchWeather(selectedBarangay)
    }

    // -- Assess (manual) ------------------------------------------------------------------
    const handleAssess = async () => {
        const requestedBarangayId = formData.barangay_id
        const requestedGeneration = assessmentGenerationRef.current
        const assessmentWeatherVersion = weatherRevisionRef.current
        setAssessing(true)
        setAssessError(null)
        try {
            const readings = isManualOverride ? formData : {
                ...liveWeather,
                barangay_id: requestedBarangayId,
            }
            const payload = {
                ...readings,
                manual_override: isManualOverride,
                source: "manual",
            }
            const res = await axios.post(`${API_BASE}/typhoon/assess`, payload, { timeout: ASSESS_TIMEOUT })
            // Stale-response guard for manual assess too
            if (activeBarangayIdRef.current !== null &&
                (String(activeBarangayIdRef.current) !== String(requestedBarangayId) ||
                    assessmentGenerationRef.current !== requestedGeneration)) {
                return
            }
            setResult(res.data)
            setAssessedAt(new Date())
            setAssessedWeatherRevision(assessmentWeatherVersion)
            setAssessError(null)
            fetchRecentLogs()
        } catch (err) {
            const status = err.response?.status
            if (status === 422) {
                // Surface validation field errors
                const errors = err.response.data?.errors || {}
                const messages = Object.values(errors).flat()
                setAssessError(messages.length ? messages : ["Invalid input. Please check your values."])
            } else if (status === 429) {
                setAssessError(["Too many requests. Please wait a moment, then press Assess risk again."])
            } else {
                setAssessError(["Risk assessment is temporarily unavailable. Please press Assess risk to try again."])
            }
        } finally {
            setAssessing(false)
        }
    }

    const handleAssessClick = () => {
        if (isBtnDisabled) return
        handleAssess()
    }

    // -- Derived UI values --------------------------------------------------------
    const wind = parseFloat(formData.wind_speed) || 0
    const rain = parseFloat(formData.rainfall) || 0
    const pressure = parseFloat(formData.pressure) || 0
    const temperature = parseFloat(formData.temperature) || 0
    const humidity = parseFloat(formData.humidity) || 0

    const hasAssessmentReadings = ["wind_speed", "rainfall", "pressure", "temperature", "humidity"]
        .every(name => formData[name] !== "" && Number.isFinite(Number(formData[name])))
    const isBtnDisabled = assessing || !formData.barangay_id || !hasAssessmentReadings || (!isManualOverride && !weatherFetched)

    // Factor bar percentages from assess API response (empty / 0 before assessment runs)
    const windPct = result?.factors?.wind ?? 0
    const rainPct = result?.factors?.rain ?? 0
    const pressurePct = result?.factors?.pressure ?? 0
    const tempPct = result?.factors?.temp ?? 0
    const humidityPct = result?.factors?.humidity ?? 0
    const temperaturePct = tempPct

    const compositeScore = result?.score ?? null

    const severity = result?.severity || null
    const activeSeverity = result?.severity || null

    // Classify assessError into display type
    const isWeatherError = weatherError
    const isAssessError = Array.isArray(assessError) && assessError.includes("__assess_error__")
    const isConditionsError = isWeatherError || isAssessError
    const userFacingErrors = Array.isArray(assessError)
        ? assessError.filter(msg => !ERROR_MARKERS.has(msg))
        : []
    const hasUserFacingErrors = !isConditionsError && userFacingErrors.length > 0
    const conditionsNoticeText = isWeatherError
        ? "Can't load live weather right now."
        : "Can't assess risk right now."
    const sevCfg = compositeScore !== null ? getSeverityConfig(compositeScore, wind, rain, pressure) : null
    const ruleBasedLabel = result?.classification || sevCfg?.label
    const assessmentWeather = {
        wind: result?.weather?.wind ?? wind,
        rain: result?.weather?.rain ?? rain,
        pressure: result?.weather?.pressure ?? pressure,
        temp: result?.weather?.temp ?? temperature,
        humidity: result?.weather?.humidity ?? humidity,
    }
    const historicalPatternAnalysis = result?.ml_pattern
    const historicalPattern = historicalPatternAnalysis?.pattern
    const outsideHistory = historicalPatternAnalysis?.out_of_range || []

    const lastUpdatedStr = lastUpdated
        ? lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
        : null
    const assessedAtStr = assessedAt
        ? assessedAt.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
        : null
    const weatherChangedSinceAssessment = Boolean(
        result && !isManualOverride && assessedWeatherRevision !== null && weatherRevision > assessedWeatherRevision
    )

    // Alert banner config based on result
    const alertBanner = () => {
        if (!result) return null
        const isFloor = Boolean(result.floor_applied)

        const SEVERITY_CARD_STYLES = {
            low: { alertBg: "#E1F5EE", alertBorder: "#5DCAA5", alertText: "#085041", color: "#1D9E75" },
            moderate: { alertBg: "#FAEEDA", alertBorder: "#EF9F27", alertText: "#633806", color: "#BA7517" },
            high: { alertBg: "#FAECE7", alertBorder: "#F0997B", alertText: "#4A1B0C", color: "#D85A30" },
            critical: { alertBg: "#FCEBEB", alertBorder: "#F09595", alertText: "#501313", color: "#A32D2D" },
            catastrophic: { alertBg: "#FCEBEB", alertBorder: "#F09595", alertText: "#501313", color: "#7F1D1D" },
        }

        const sevKey = (result.severity || "low").toLowerCase()
        const resultStyle = SEVERITY_CARD_STYLES[sevKey] || SEVERITY_CARD_STYLES.critical
        const cfg = {
            ...sevCfg,
            ...resultStyle,
        }

        const bannerTitle = isFloor
            ? `PAGASA Signal ${result.pagasa_signal} in effect`
            : `Rule-based assessment: ${ruleBasedLabel}`

        return (
            <div className="bakwit-alert-banner" style={{
                background: cfg.alertBg, border: `0.5px solid ${cfg.alertBorder}`,
                borderRadius: 8, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10,
                width: "100%", boxSizing: "border-box",
            }}>
                <span style={{ fontSize: 18, display: "flex", alignItems: "center" }}>
                    {isFloor || compositeScore > 24 ? <AlertTriangle size={18} style={{ color: cfg.alertText }} /> : <Info size={18} style={{ color: cfg.alertText }} />}
                </span>
                <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: cfg.alertText }}>
                        {bannerTitle}
                    </div>
                    <div style={{ fontSize: 11, color: cfg.alertText, opacity: 0.85, marginTop: 2 }}>
                        {result.message}
                    </div>
                    {!isFloor && result.classification?.startsWith("Signal") && (
                        <div style={{ fontSize: 10, color: cfg.alertText, opacity: 0.65, marginTop: 3 }}>
                            Computed equivalent only — follow official PAGASA bulletins.
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const windCardStyle = getCardBadgeAndBorder("wind_speed", formData.wind_speed)
    const rainCardStyle = getCardBadgeAndBorder("rainfall", formData.rainfall)
    const pressureCardStyle = getCardBadgeAndBorder("pressure", formData.pressure)
    const tempCardStyle = getCardBadgeAndBorder("temperature", formData.temperature)
    const humidityCardStyle = getCardBadgeAndBorder("humidity", formData.humidity)
    const baselineKeyRaw = String(selectedBarangay?.riskLevel || "low").toLowerCase().replaceAll(" ", "_")
    const baselineKey = baselineKeyRaw === "normal" ? "low" : baselineKeyRaw
    const baselineLabel = baselineKey.charAt(0).toUpperCase() + baselineKey.slice(1).replaceAll("_", " ")
    const riskKey = (result?.severity || baselineKey || "low").toLowerCase()
    const riskLabel = riskKey.charAt(0).toUpperCase() + riskKey.slice(1)
    const riskColor = RISK_COLORS[riskKey] || RISK_COLORS.low
    const ruleWindSignal = result?.wind_signal || windSignalFor(assessmentWeather.wind)
    const riskFactorRows = factorRowsFor(assessmentWeather, result?.factors)
    const riskDrivers = topRiskDrivers(assessmentWeather, result?.factors)
    const raiseReasons = raisedRiskReasons(assessmentWeather, result)
    const mlTileTitle = outsideHistory.length > 0
        ? "Beyond recorded history"
        : historicalPattern
            ? `Resembles ${historicalPattern.storm} (${patternMonth(historicalPattern.date)}), ${historicalPattern.label}`
            : "Pattern unavailable"
    const mlTileDetail = outsideHistory.length > 0
        ? beyondHistoryText(historicalPatternAnalysis, assessmentWeather, riskLabel)
        : historicalPattern
            ? `${historicalPattern.agreeing} of 3 closest recorded hours agree. Compared against ${historicalPattern.compared.toLocaleString("en-PH")} storm hours.`
            : "No historical comparison is available. Follow the overall risk."
    const riskAdvice = {
        low: "Conditions are normal. No evacuation is advised at this time.",
        moderate: "Stay alert and prepare essential supplies in case conditions worsen.",
        high: "Prepare to evacuate and follow instructions from barangay officials.",
        critical: "Evacuate when instructed and avoid exposed or flood-prone routes.",
        catastrophic: "Seek designated shelter immediately and follow emergency instructions.",
    }[riskKey] || "Continue monitoring official updates and local instructions."
    const heroTitle = result ? riskLabel : "Not assessed yet"
    const heroAdvice = result ? riskAdvice : "Press Assess risk to check your barangay."
    const sidebarBadgeLabel = isManualOverride
        ? `Test: ${riskLabel}`
        : result
            ? `Risk: ${riskLabel}`
            : `Baseline: ${baselineLabel}`

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
        .bagyo-sidebar-item:hover { background: var(--accent) !important; color: var(--accent-foreground) !important; }
        .bagyo-assess:hover:not(:disabled) { opacity: 0.88 !important; transform: translateY(-1px); }
        .bagyo-assess:active:not(:disabled) { transform: scale(0.98); }
        @media (max-width: 1199px) {
            .bakwit-risk-overview { grid-template-columns: minmax(0, 1fr) !important; }
            .bakwit-metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 1023px) {
            .bakwit-charts-grid, .bakwit-row3 { grid-template-columns: minmax(0, 1fr) !important; }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
            .bakwit-metrics-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
        /* Mobile: last lone metric card spans full width */
        @media (max-width: 768px) {
            .bakwit-metrics-grid > *:last-child:nth-child(odd) {
                grid-column: 1 / -1;
            }
            .bakwit-risk-overview > article { padding: 20px !important; }
            .bakwit-risk-hero-main { flex-direction: column !important; align-items: stretch !important; }
            .bakwit-risk-tiles { min-width: 0 !important; grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>



            {/* -- Main Layout -------------------------------------------------- */}
            <div className="bakwit-layout" style={styles.layout}>

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
                        {/* Sidebar badge — static area risk from database (selectedBarangay.riskLevel) */}
                        {selectedBarangay && (
                            <div style={{
                                marginTop: 10, fontSize: 11, fontWeight: 650, padding: "3px 9px",
                                borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 5,
                                color: riskColor, background: `${riskColor}18`, border: `1px solid ${riskColor}55`,
                            }}>
                                <Shield size={12} aria-hidden="true" /> {sidebarBadgeLabel}
                            </div>
                        )}
                    </div>

                    {/* Weather status in sidebar */}
                    <div style={{ padding: "0 12px", marginTop: "auto", paddingBottom: 16 }}>
                        <div style={{
                            borderTop: "1px solid var(--border)", padding: "12px 4px 0", fontSize: 11,
                            color: weatherFetched ? "var(--foreground)" : "var(--muted-foreground)",
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
                                    <LiveDot />
                                    <span>Live · Updated {lastUpdatedStr}</span>
                                </>
                            ) : (
                                "Select a barangay"
                            )}
                        </div>
                    </div>
                </Sidebar>

                {/* -- Main Content ----------------------------------------------- */}
                <main className="bakwit-main" style={styles.main}>

                    {/* Topbar */}
                    <div className="bakwit-page-topbar" style={styles.topbar}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 650, color: "var(--foreground)" }}>Dashboard</span>
                            <span style={isManualOverride ? styles.testBadge : styles.liveBadge}>
                                {isManualOverride ? (
                                    <><span style={styles.testDot} /> Test</>
                                ) : (
                                    <><LiveDot /> Live</>
                                )}
                            </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground)" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <MapPin size={12} aria-hidden="true" /> {selectedBarangay ? `${selectedBarangay.name}, ${selectedBarangay.city}` : "No barangay selected"}
                            </span>
                            {lastUpdatedStr && <span style={{ color: "var(--border)" }}>|</span>}
                            {lastUpdatedStr && (
                                <span style={styles.updatedBadge}>
                                    <RefreshCw size={11} style={{ animation: weatherLoading ? "spin 1.5s linear infinite" : "none" }} /> Updated {lastUpdatedStr}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Content area */}
                    <div className="bakwit-content" style={styles.content}>

                        <section className="bakwit-risk-overview" style={styles.riskOverview} aria-labelledby="risk-overview-title">
                            <article style={styles.riskHero}>
                                <div className="bakwit-risk-hero-main" style={styles.riskHeroMain}>
                                    <div style={styles.riskHeroCopy}>
                                        <div id="risk-overview-title" style={styles.riskEyebrow}>
                                            Current risk · {selectedBarangay ? `Brgy. ${selectedBarangay.name}` : "Select a barangay"}
                                        </div>
                                        <div style={styles.riskLevelRow}>
                                            <Shield size={38} strokeWidth={1.8} aria-hidden="true" />
                                            <span style={styles.riskLevel}>{heroTitle}</span>
                                        </div>
                                        <p style={styles.riskAdvice}>{heroAdvice}</p>
                                        {result && (
                                            <p style={styles.riskWhy}>
                                                <strong>Why:</strong> {joinReadable(riskDrivers)}
                                            </p>
                                        )}
                                        <div style={styles.assessmentActions}>
                                            <button
                                                type="button"
                                                className="bagyo-assess"
                                                onClick={handleAssessClick}
                                                disabled={isBtnDisabled}
                                                style={{
                                                    ...styles.heroAssessButton,
                                                    opacity: isBtnDisabled ? 0.55 : 1,
                                                    cursor: isBtnDisabled ? "not-allowed" : "pointer",
                                                }}
                                            >
                                                {assessing ? <><Loader size={14} /> Assessing...</> : <><Search size={14} /> Assess risk</>}
                                            </button>
                                            {result && assessedAtStr && (
                                                <span style={styles.assessedMeta}>Assessed {assessedAtStr}</span>
                                            )}
                                        </div>
                                        {weatherChangedSinceAssessment && (
                                            <p style={styles.assessmentHint}>Weather changed since last assessment. Assess again?</p>
                                        )}
                                    </div>

                                    {result && <div className="bakwit-risk-tiles" style={styles.riskTiles}>
                                        <div style={styles.riskTile}>
                                            <span style={styles.riskTileLabel}>Rule-based</span>
                                            <strong style={styles.riskTileValue}>{ruleWindSignal}</strong>
                                            <span style={styles.riskTileDetail}>Score {compositeScore ?? 0}/100</span>
                                            {raiseReasons.length > 0 && (
                                                <span style={styles.riskTileDetail}>
                                                    Raised to {riskLabel} by: {joinReadable(raiseReasons)}.
                                                </span>
                                            )}
                                            <details style={styles.ruleDetails}>
                                                <summary style={styles.ruleSummary}>How this is worked out</summary>
                                                <div style={styles.ruleBreakdown}>
                                                    {riskFactorRows.map(row => (
                                                        <div key={row.key} style={styles.ruleFactorRow}>
                                                            <span>{row.label} {formatReading(row.value)} {row.unit}: {row.result}</span>
                                                            <span style={styles.ruleFactorPoints}>{row.weighted} pts</span>
                                                        </div>
                                                    ))}
                                                    <div style={styles.ruleTotal}>Weighted score: {compositeScore ?? 0}/100</div>
                                                </div>
                                            </details>
                                        </div>
                                        <div style={styles.riskTile}>
                                            <span style={styles.riskTileLabel}>ML pattern</span>
                                            <strong style={{ ...styles.riskTileValue, fontSize: 14 }}>{mlTileTitle}</strong>
                                            <span style={styles.riskTileDetail}>{mlTileDetail}</span>
                                        </div>
                                    </div>}
                                </div>
                            </article>

                            <div style={styles.pagasaOverviewCard}>
                                <LatestPagasaPostCard />
                            </div>
                        </section>

                        {/* Self-arrival GPS controller — runs independently of severity */}
                        {/* Conditions unavailable notice (weather or assess error) */}
                        {isConditionsError && (
                            <div style={{
                                display: "flex", alignItems: "flex-start", gap: 10,
                                background: "#FFF7ED", border: "1px solid #FED7AA",
                                borderRadius: 8, padding: "10px 14px", marginBottom: 8,
                                fontSize: 12, color: "#92400E",
                            }}>
                                <AlertTriangle size={15} style={{ color: "#F59E0B", flexShrink: 0, marginTop: 1 }} />
                                <div>
                                    <strong>{conditionsNoticeText}</strong>
                                    {" Follow PAGASA and your barangay officials."}
                                </div>
                            </div>
                        )}

                        {/* Field-level validation errors from manual assess */}
                        {hasUserFacingErrors && (
                            <div style={{
                                background: "#FEF2F2", border: "1px solid #FECACA",
                                borderRadius: 8, padding: "10px 14px", marginBottom: 8,
                                fontSize: 12, color: "#991B1B",
                            }}>
                                {userFacingErrors.map((msg, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <AlertTriangle size={13} style={{ color: "#EF4444", flexShrink: 0 }} />
                                        {msg}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Mobile Barangay Selector directly at the top of page content under 768px */}
                        <div className="bakwit-mobile-barangay-bar">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                    Active Barangay
                                </span>
                                {/* Mobile badge — static area risk from database */}
                                {selectedBarangay && (
                                    <span style={{
                                        fontSize: 10, fontWeight: 700, padding: "2px 8px",
                                        borderRadius: 12, display: "inline-flex", alignItems: "center", gap: 4, color: "white",
                                        background: riskColor,
                                    }}>
                                        <AlertTriangle size={11} /> {sidebarBadgeLabel}
                                    </span>
                                )}
                            </div>
                            <Select
                                options={barangays}
                                value={selectedBarangay}
                                onChange={handleBarangayChange}
                                placeholder="Select your barangay..."
                                isSearchable
                                menuPortalTarget={document.body}
                                styles={{
                                    ...selectStyles,
                                    control: (b) => ({ ...b, borderRadius: 8, border: "1px solid #cbd5e1", minHeight: 44, height: 44 }),
                                }}
                            />
                        </div>

                        {/* Mobile-only: live evacuation route directly after barangay selector (before weather cards) */}
                        {false && isMobileScreen && selectedBarangay && (
                            <div className="bakwit-mobile-evac-early" id="evacuation-map-section-mobile">
                                <RouteErrorBoundary travelMode={travelMode} selectedBarangay={selectedBarangay}>
                                    <EvacRoutes
                                        evacuationCenter={result?.evacuation_center}
                                        severity={activeSeverity}
                                        selectedBarangay={selectedBarangay}
                                        routedCenter={hasLiveGps ? routedCenter : null}
                                        routeDistance={hasLiveGps ? routeDistance : null}
                                        routeMinutes={hasLiveGps ? routeMinutes : null}
                                        hasLiveGps={hasLiveGps}
                                        barangays={barangays}
                                        travelMode={travelMode}
                                        onTravelModeChange={handleTravelModeChange}
                                        lowerHazardSuggestion={lowerHazardSuggestion}
                                        isOverrideActive={preferredCenterId != null}
                                        onRouteHere={(id) => setPreferredCenterId(id)}
                                        onBackToNearest={() => setPreferredCenterId(null)}
                                        routeSafetyInfo={routeSafetyInfo}
                                        routePref={routePref}
                                        onRoutePrefChange={handleRoutePrefChange}
                                    />
                                </RouteErrorBoundary>
                                <MapView
                                    evacuationCenter={result?.evacuation_center}
                                    barangay={selectedBarangay}
                                    travelMode={travelMode}
                                    onTravelModeChange={handleTravelModeChange}
                                    onRoutingChange={setRoutingActive}
                                    onRoutedCenterChange={setRoutedCenter}
                                    onRouteDistanceChange={setRouteDistance}
                                    onRouteMinutesChange={setRouteMinutes}
                                    onLiveGpsChange={setHasLiveGps}
                                    preferredCenterId={preferredCenterId}
                                    onPreferredCenterChange={setPreferredCenterId}
                                    onHazardSuggestionChange={setLowerHazardSuggestion}
                                    onNearestCenterOverrideRef={nearestOverrideRef}
                                    onBaseTargetChange={setBaseTarget}
                                    onClearOverride={() => setPreferredCenterId(null)}
                                    onRouteSafetyChange={setRouteSafetyInfo}
                                    routePref={routePref}
                                    onRoutePrefChange={handleRoutePrefChange}
                                />
                            </div>
                        )}

                        {/* Main weather section (only when a barangay is selected) */}
                        {selectedBarangay && (
                            <>
                                {isManualOverride && (
                                    <div style={{
                                        background: "#FFF8E1",
                                        border: "1.5px solid #FFC107",
                                        borderRadius: 8,
                                        padding: "10px 14px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        marginBottom: 12,
                                        boxShadow: "0 2px 6px rgba(255, 193, 7, 0.15)",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{
                                                background: "#FF9800",
                                                color: "white",
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: "2px 8px",
                                                borderRadius: 4,
                                                textTransform: "uppercase",
                                                letterSpacing: "0.04em"
                                            }}>
                                                TEST MODE
                                            </span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: "#B78103" }}>
                                                Manual test values, not live data
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleResetToLiveData}
                                            style={{
                                                background: "#fff",
                                                border: "1px solid #FFC107",
                                                color: "#B78103",
                                                borderRadius: 6,
                                                padding: "5px 12px",
                                                fontSize: 11,
                                                fontWeight: 600,
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 5,
                                            }}
                                        >
                                            <RefreshCw size={12} /> Reset to live data
                                        </button>
                                    </div>
                                )}
                                {false && (result ? (
                                    alertBanner()
                                ) : (
                                    <div style={{ background: "#EBF3FB", border: "0.5px solid #B5D4F4", borderRadius: 8, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                                        <Info size={16} style={{ color: "#0C447C" }} />
                                        <div style={{ fontSize: 12, color: "#0C447C" }}>
                                            {weatherFetched
                                                ? `Live weather loaded for ${selectedBarangay?.name}.`
                                                : "Weather data loading..."}
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}

                        <section aria-labelledby="current-conditions-title">
                            <div style={styles.sectionHeadingRow}>
                                <div>
                                    <h2 id="current-conditions-title" style={styles.sectionTitle}>Current conditions</h2>
                                </div>
                                <div style={styles.weatherStatusRow}>
                                    <span style={{
                                        ...styles.sectionStatus,
                                        color: isConditionsError ? "#92400e" : "var(--muted-foreground)",
                                        background: isConditionsError ? "var(--warning-soft)" : "transparent",
                                    }}>
                                        {isConditionsError
                                            ? conditionsNoticeText
                                            : isManualOverride
                                                ? "Manual values active"
                                                : weatherFetched
                                                    ? "Live weather"
                                                    : "Loading live weather…"}
                                    </span>
                                    {lastUpdatedStr && <span style={styles.weatherUpdated}>Weather updated {lastUpdatedStr}</span>}
                                    <button
                                        type="button"
                                        aria-label="Refresh live weather"
                                        title="Refresh live weather"
                                        onClick={() => selectedBarangay && fetchWeather(selectedBarangay)}
                                        disabled={!selectedBarangay || weatherLoading}
                                        style={styles.weatherRefreshButton}
                                    >
                                        <RefreshCw size={13} style={{ animation: weatherLoading ? "spin 1.5s linear infinite" : "none" }} />
                                    </button>
                                </div>
                            </div>

                            <div className="bakwit-metrics-grid" style={styles.metricsRow}>
                            <MetricCard
                                icon={<Wind size={15} />} color="#185FA5" bg="#E6F1FB"
                                label="Wind speed" value={metricDisplay(formData.wind_speed)} unit="km/h"
                                trend={wind > 88 ? "up" : null} trendLabel={wind > 118 ? "Danger" : "Warning"}
                                barPct={windPct} barColor={windCardStyle.barColor || "#ddd"}
                                badge={windCardStyle.badge} borderColor={windCardStyle.border}
                            />
                            <MetricCard
                                icon={<CloudRain size={15} />} color="#3B6D11" bg="#EAF3DE"
                                label="Rainfall" value={metricDisplay(formData.rainfall)} unit="mm/hr"
                                trend={rain > 15 ? "up" : null} trendLabel={rain > 30 ? "Heavy" : "Moderate"}
                                barPct={rainPct} barColor={rainCardStyle.barColor || "#ddd"}
                                badge={rainCardStyle.badge} borderColor={rainCardStyle.border}
                            />
                            <MetricCard
                                icon={<Gauge size={15} />} color="#993C1D" bg="#FAECE7"
                                label="Pressure" value={metricDisplay(formData.pressure)} unit="hPa"
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
                            <MetricCard
                                icon={<Wind size={15} />} color="#185FA5" bg="#E6F1FB"
                                label="Wind gusts"
                                value={isManualOverride ? "n/a (test mode)" : extraWeather.wind_gusts}
                                unit={isManualOverride ? "" : "km/h"}
                                barPct={Number.isFinite(Number(extraWeather.wind_gusts))
                                    ? Math.min(100, (Number(extraWeather.wind_gusts) / 200) * 100)
                                    : 0}
                                barColor="#378ADD"
                                hideThreshold={isManualOverride}
                            />
                            </div>
                        </section>

                        <section className="bakwit-charts-grid" style={styles.chartsGrid} aria-label="Weather analysis charts">
                            <div style={{
                                ...styles.card,
                                ...(isManualOverride ? { opacity: 0.55, pointerEvents: "none" } : {})
                            }}>
                                <div style={styles.cardHeader}>
                                    <div>
                                        <div style={styles.cardTitle}>6-hour trend</div>
                                        <div style={styles.cardSubtitle}>Wind speed and temperature</div>
                                    </div>
                                    <div style={styles.chartHeaderMeta}>
                                        <span style={styles.legendItem}><i style={{ ...styles.legendMark, background: "var(--chart-1)" }} /> Wind</span>
                                        <span style={styles.legendItem}><i style={{ ...styles.legendLine, background: "var(--chart-2)" }} /> Temperature</span>
                                        <button type="button" onClick={() => navigate("/history")} style={styles.cardLink}>View history →</button>
                                    </div>
                                </div>
                                <TrendChart data={trendData} />
                            </div>

                            <div style={styles.card}>
                                <div style={styles.cardHeader}>
                                    <div>
                                        <div style={styles.cardTitle}>What drives the score</div>
                                        <div style={styles.cardSubtitle}>Contribution of each factor to risk</div>
                                    </div>
                                </div>
                                <div style={styles.factorList}>
                                    <FactorBar label="Wind" pct={windPct} color="#378ADD" />
                                    <FactorBar label="Rainfall" pct={rainPct} color="#639922" />
                                    <FactorBar label="Pressure" pct={pressurePct} color="#D85A30" />
                                    <FactorBar label="Temp" pct={tempPct} color="#EF9F27" />
                                    <FactorBar label="Humidity" pct={humidityPct} color="#185FA5" />
                                </div>
                            </div>
                        </section>

                        {/* Manual input row - collapsed until a resident needs it */}
                        <details style={{ ...styles.card, padding: 0 }} open={isManualOverride || hasUserFacingErrors ? true : undefined}>
                            <summary style={styles.overrideSummary}>
                                <span style={styles.overrideSummaryIcon}><Edit3 size={14} aria-hidden="true" /></span>
                                <span>
                                    <strong style={styles.cardTitle}>Run a manual assessment</strong>
                                    <span style={styles.overrideSummaryHelp}>Override live readings to test a scenario</span>
                                </span>
                                {isManualOverride && <span style={styles.manualActiveBadge}>Custom values active</span>}
                            </summary>
                            <div style={styles.overrideBody}>
                                {isManualOverride && (
                                    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                                        <button type="button" onClick={handleResetToLiveData} style={styles.resetLiveButton}>
                                            <RefreshCw size={11} /> Reset to live data
                                        </button>
                                    </div>
                                )}
                                <div className="bakwit-override-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr) auto", gap: 10, alignItems: "flex-end" }}>
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
                                    className="bagyo-assess bakwit-override-btn"
                                    onClick={handleAssessClick}
                                    disabled={isBtnDisabled}
                                    style={{
                                        ...styles.assessBtn,
                                        minHeight: 44,
                                        background: isBtnDisabled ? "var(--muted)" : "var(--primary)",
                                        color: isBtnDisabled ? "var(--muted-foreground)" : "var(--primary-foreground)",
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
                                        <><Search size={13} /> Run assessment</>
                                    )}
                                </button>
                                </div>

                                {hasUserFacingErrors && (
                                    <div style={{ marginTop: 10, fontSize: 12, color: "#dc3545", background: "#fff0f0", padding: "8px 12px", borderRadius: 8 }}>
                                        {Array.isArray(assessError) ? (
                                            <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                                                {userFacingErrors.map((msg, i) => (
                                                    <li key={i} style={{ marginBottom: 2 }}>{msg}</li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                <AlertTriangle size={14} /> {assessError}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </details>

                        {/* Evacuation routes + Recent history */}
                        <EvacuationAlertBanner
                            barangayId={formData.barangay_id}
                            selectedBarangay={selectedBarangay}
                            severity={activeSeverity}
                            routedCenter={hasLiveGps ? routedCenter : null}
                            routeDistance={hasLiveGps ? routeDistance : null}
                            routeMinutes={hasLiveGps ? routeMinutes : null}
                            evacuationCenter={result?.evacuation_center}
                            hasLiveGps={hasLiveGps}
                            travelMode={travelMode}
                            routeSafetyInfo={routeSafetyInfo}
                            routePref={routePref}
                            onRoutePrefChange={handleRoutePrefChange}
                        />

                        <SelfArrivalController
                            barangayId={formData.barangay_id}
                            routingActive={routingActive}
                            targetCenter={routedCenter}
                        />

                        <div className="bakwit-row3" style={styles.row3}>
                            <div id="evacuation-map-section" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                                    {selectedBarangay && (
                                    <MapView
                                        evacuationCenter={result?.evacuation_center}
                                        barangay={selectedBarangay}
                                        travelMode={travelMode}
                                        onTravelModeChange={handleTravelModeChange}
                                        onRoutingChange={setRoutingActive}
                                        onRoutedCenterChange={setRoutedCenter}
                                        onRouteDistanceChange={setRouteDistance}
                                        onRouteMinutesChange={setRouteMinutes}
                                        onLiveGpsChange={setHasLiveGps}
                                        preferredCenterId={preferredCenterId}
                                        onPreferredCenterChange={setPreferredCenterId}
                                        onHazardSuggestionChange={setLowerHazardSuggestion}
                                        onNearestCenterOverrideRef={nearestOverrideRef}
                                        onBaseTargetChange={setBaseTarget}
                                        onClearOverride={() => setPreferredCenterId(null)}
                                        onRouteSafetyChange={setRouteSafetyInfo}
                                        routePref={routePref}
                                        onRoutePrefChange={handleRoutePrefChange}
                                    />
                                    )}
                            </div>
                            <RecentHistory logs={recentLogs} onViewAll={() => navigate("/history")} />
                        </div>

                    </div>
                </main>
            </div>

        </div>
    )
}

// --- Styles ------------------------------------------------------------------
const styles = {
    page: { minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", display: "flex", flexDirection: "column", fontFamily: "var(--sans)" },

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
    layout: { display: "flex", flex: 1, minHeight: "100vh" },


    navSection: { fontSize: 10, color: "var(--muted-foreground)", padding: "18px 20px 6px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" },
    sidebarItem: { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", fontSize: 13, transition: "background 0.15s, color 0.15s" },
    barangayLabel: { fontSize: 10, color: "var(--muted-foreground)", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" },

    // Main
    main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
    topbar: { position: "sticky", top: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 24px", background: "color-mix(in oklch, var(--card) 92%, transparent)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border)", flexShrink: 0 },
    liveBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--success)", background: "var(--success-soft)", padding: "3px 9px", borderRadius: 999, fontWeight: 650, border: "1px solid color-mix(in oklch, var(--success) 25%, transparent)" },
    testBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#9A3412", background: "#FFEDD5", padding: "3px 9px", borderRadius: 999, fontWeight: 700, border: "1px solid #FDBA74" },
    testDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#F97316" },
    updatedBadge: { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--mono)", fontSize: 10, fontVariantNumeric: "tabular-nums" },
    aiChip: { display: "flex", alignItems: "center", gap: 5, fontSize: 11, background: "rgba(255, 255, 255, 0.15)", color: "#90caf9", padding: "3px 9px", borderRadius: 20, fontWeight: 600, border: "0.5px solid rgba(255, 255, 255, 0.25)" },

    content: { width: "100%", maxWidth: 1400, margin: "0 auto", padding: "24px 32px 40px", display: "flex", flexDirection: "column", gap: 24, flex: 1 },

    riskOverview: { display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(340px, 2fr)", gap: 16, alignItems: "stretch" },
    riskHero: { display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0, padding: 24, borderRadius: 16, background: "var(--primary)", color: "var(--primary-foreground)" },
    riskHeroMain: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 },
    riskHeroCopy: { minWidth: 0, flex: "1 1 300px" },
    riskEyebrow: { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.75 },
    riskLevelRow: { display: "flex", alignItems: "center", gap: 12, marginTop: 10 },
    riskLevel: { fontSize: 40, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.04em" },
    riskAdvice: { maxWidth: 580, margin: "12px 0 0", fontSize: 14, lineHeight: 1.55, opacity: 0.9 },
    riskWhy: { maxWidth: 580, margin: "9px 0 0", fontSize: 11, lineHeight: 1.5, opacity: 0.82 },
    assessmentActions: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 16 },
    heroAssessButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 36, padding: "8px 14px", border: "1px solid color-mix(in oklch, var(--primary-foreground) 40%, transparent)", borderRadius: 9, background: "var(--primary-foreground)", color: "var(--primary)", fontFamily: "inherit", fontSize: 12, fontWeight: 750 },
    assessedMeta: { fontFamily: "var(--mono)", fontSize: 10, fontVariantNumeric: "tabular-nums", opacity: 0.75 },
    assessmentHint: { margin: "8px 0 0", color: "#FDE68A", fontSize: 10, lineHeight: 1.4 },
    riskTiles: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, flex: "1 1 500px", minWidth: 440 },
    riskTile: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0, padding: "13px 14px", borderRadius: 12, background: "color-mix(in oklch, var(--primary-foreground) 11%, transparent)" },
    riskTileLabel: { fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.72 },
    riskTileValue: { fontFamily: "var(--mono)", fontSize: 16, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" },
    riskTileDetail: { fontSize: 10, lineHeight: 1.45, opacity: 0.82 },
    ruleDetails: { marginTop: 3, paddingTop: 7, borderTop: "1px solid color-mix(in oklch, var(--primary-foreground) 16%, transparent)" },
    ruleSummary: { cursor: "pointer", fontSize: 10, fontWeight: 650, lineHeight: 1.4 },
    ruleBreakdown: { display: "flex", flexDirection: "column", gap: 6, marginTop: 8 },
    ruleFactorRow: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 9, lineHeight: 1.35, opacity: 0.82 },
    ruleFactorPoints: { flexShrink: 0, fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" },
    ruleTotal: { paddingTop: 6, borderTop: "1px solid color-mix(in oklch, var(--primary-foreground) 16%, transparent)", fontSize: 10, fontWeight: 700 },
    pagasaOverviewCard: { minWidth: 0, maxHeight: 460, overflowY: "auto", overflowX: "hidden" },

    sectionHeadingRow: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 12 },
    sectionEyebrow: { color: "var(--muted-foreground)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" },
    sectionTitle: { margin: "2px 0 0", color: "var(--foreground)", fontSize: 14, fontWeight: 650 },
    sectionStatus: { maxWidth: 420, padding: "4px 8px", borderRadius: 999, fontSize: 11, textAlign: "right" },
    weatherStatusRow: { display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 6 },
    weatherUpdated: { color: "var(--muted-foreground)", fontFamily: "var(--mono)", fontSize: 10, fontVariantNumeric: "tabular-nums" },
    weatherRefreshButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--foreground)", cursor: "pointer" },



    // Metrics
    metricsRow: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12 },
    metricCard: { minWidth: 0, background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: 16 },
    metricIconRow: { display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 22, marginBottom: 10 },
    metricLabelGroup: { display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
    metricIconBox: { width: 17, height: 17, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
    metricVal: { fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums", fontSize: 26, fontWeight: 650, color: "var(--foreground)", letterSpacing: "-0.04em" },
    metricUnit: { fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted-foreground)" },
    metricLabel: { fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 },
    metricBarTrack: { height: 4, borderRadius: 999, marginTop: 12, background: "var(--muted)", overflow: "hidden" },
    metricBarFill: { height: "100%", borderRadius: 2, transition: "width 0.5s, background 0.3s" },
    metricStatus: { marginTop: 7, fontSize: 10, lineHeight: 1.3 },

    // Cards
    row3: { display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(280px, 1fr)", gap: 16, alignItems: "start" },
    chartsGrid: { display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)", gap: 16, alignItems: "stretch" },
    card: { minWidth: 0, background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: 20 },
    cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 },
    cardTitle: { fontSize: 13, fontWeight: 650, color: "var(--foreground)" },
    cardSubtitle: { marginTop: 2, color: "var(--muted-foreground)", fontSize: 10, lineHeight: 1.4 },
    cardAction: { fontSize: 11, color: "var(--primary)", cursor: "pointer" },
    cardLink: { border: 0, padding: 0, color: "var(--primary)", background: "transparent", fontSize: 11, fontWeight: 650, cursor: "pointer" },
    chartHeaderMeta: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 },
    legendItem: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted-foreground)", fontSize: 10 },
    legendMark: { display: "inline-block", width: 9, height: 9, borderRadius: 3 },
    legendLine: { display: "inline-block", width: 12, height: 2, borderRadius: 999 },
    monoMeta: { color: "var(--muted-foreground)", fontFamily: "var(--mono)", fontSize: 11, fontVariantNumeric: "tabular-nums" },
    factorList: { display: "flex", flexDirection: "column", gap: 18, paddingTop: 6 },
    factorRow: { display: "flex", flexDirection: "column", gap: 7, color: "var(--muted-foreground)", fontSize: 11 },
    factorLabelRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    factorValue: { color: "var(--foreground)", fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums", fontWeight: 650 },
    factorTrack: { width: "100%", height: 5, overflow: "hidden", borderRadius: 999, background: "var(--muted)" },
    mlCompareGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 },
    mlCompareBox: { background: "#f8f9fc", border: "1px solid #eef1f5", borderRadius: 8, padding: "9px 10px", minHeight: 92 },
    mlCompareLabel: { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 },
    mlCompareScore: { fontSize: 14, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.25 },
    mlCompareResult: { fontSize: 12, fontWeight: 700, color: "#185FA5", marginTop: 4, lineHeight: 1.3 },
    mlExplanation: { fontSize: 11, color: "#666", marginTop: 5, lineHeight: 1.35 },

    // Evacuation
    evacCard: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 },
    evacHeader: { display: "flex", alignItems: "center", gap: 7, marginBottom: 12 },
    evacTitle: { fontSize: 13, fontWeight: 650, color: "var(--foreground)" },
    routeControls: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 },
    segmentedControl: { display: "inline-flex", alignItems: "center", gap: 2, padding: 3, borderRadius: 9, background: "var(--secondary)" },
    segment: { padding: "5px 8px", borderRadius: 7, color: "var(--muted-foreground)", fontSize: 10, whiteSpace: "nowrap" },
    segmentButton: { padding: "5px 8px", border: 0, borderRadius: 7, color: "var(--muted-foreground)", background: "transparent", fontFamily: "inherit", fontSize: 10, cursor: "pointer" },
    segmentActive: { color: "var(--foreground)", background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--border)", fontWeight: 650 },
    routeItem: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0" },
    routeNum: { width: 18, height: 18, borderRadius: "50%", background: "#E24B4A", color: "white", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 600 },
    routeInfo: { flex: 1, minWidth: 0 },
    routeName: { fontSize: 13, fontWeight: 650, color: "var(--foreground)" },
    routeDesc: { fontSize: 11, color: "var(--muted-foreground)" },
    routeStatus: { fontSize: 10, fontWeight: 650, padding: "2px 8px", borderRadius: 999 },

    // History
    historyCard: { minWidth: 0, background: "var(--card)", borderRadius: 12, border: "1px solid var(--border)", padding: 20 },
    histRow: { display: "flex", alignItems: "center", gap: 10, padding: "11px 0" },
    historyDate: { minWidth: 52, color: "var(--muted-foreground)", fontFamily: "var(--mono)", fontSize: 10, fontVariantNumeric: "tabular-nums" },

    // Input / Assess
    input: {
        width: "100%", padding: "8px 10px", borderRadius: 8,
        border: "1px solid var(--input)", fontSize: 13, outline: "none",
        background: "var(--card)", color: "var(--foreground)", fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums",
    },
    assessBtn: {
        padding: "8px 18px", color: "var(--primary-foreground)", border: "none",
        borderRadius: 8, fontSize: 13, fontWeight: 700,
        transition: "opacity 0.2s, transform 0.15s", whiteSpace: "nowrap",
    },
    overrideSummary: { display: "flex", alignItems: "center", gap: 10, minHeight: 66, padding: "14px 20px", cursor: "pointer", listStylePosition: "inside", color: "var(--foreground)" },
    overrideSummaryIcon: { display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" },
    overrideSummaryHelp: { display: "block", marginTop: 2, color: "var(--muted-foreground)", fontSize: 10 },
    manualActiveBadge: { marginLeft: "auto", padding: "3px 8px", borderRadius: 999, background: "var(--warning-soft)", color: "#92400e", fontSize: 10, fontWeight: 650 },
    overrideBody: { padding: "0 20px 20px", borderTop: "1px solid var(--border)" },
    resetLiveButton: { display: "inline-flex", alignItems: "center", gap: 4, marginTop: 12, padding: "5px 9px", borderRadius: 7, border: "1px solid color-mix(in oklch, var(--warning) 55%, var(--border))", background: "var(--warning-soft)", color: "#92400e", fontFamily: "inherit", fontSize: 10, fontWeight: 650, cursor: "pointer" },
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
    control: b => ({ ...b, borderRadius: 8, border: "1px solid var(--input)", background: "var(--card)", boxShadow: "none", fontSize: 12, minHeight: 36 }),
    option: (b, s) => ({ ...b, backgroundColor: s.isFocused ? "var(--accent)" : "var(--card)", color: "var(--foreground)", fontSize: 12 }),
    singleValue: b => ({ ...b, color: "var(--foreground)", fontWeight: 600, fontSize: 12 }),
    placeholder: b => ({ ...b, color: "var(--muted-foreground)" }),
    menu: b => ({ ...b, zIndex: 9999 }),
}




