import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { AlertTriangle, Wind, CloudRain, Thermometer, RefreshCw, ChevronDown, ChevronUp, X } from "lucide-react"
import axios from "axios"

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
})

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY || ""

// ─── Placement Anchors to Prevent Pill Overlap at Default Zoom ─────────────────
export const LABEL_ANCHORS = {
    Washington: "left",
    Taft: "right",
    Lipata: "right",
    Mabua: "left",
    Bonifacio: "below",
    Rizal: "left",
    Sabang: "above",
    "Day-asan": "right",
    Cagniog: "below",
    Togbongon: "above",
    Ipil: "below",
}

// ─── Severity Threshold Constants ─────────────────────────────────────────────
// Aligned to PAGASA's Tropical Cyclone Wind Signal (TCWS) brackets:
// < 39: No Signal, 39–61: Signal 1, 62–88: Signal 2, 89–117: Signal 3, 118–184: Signal 4, ≥ 185: Signal 5
export const WIND_THRESHOLDS = [
    { max: 39, label: "< 39", color: "#1D9E75", bg: "#E1F5EE", text: "#085041", level: "No Signal" },
    { max: 62, label: "39–61", color: "#EF9F27", bg: "#FAEEDA", text: "#633806", level: "Signal 1" },
    { max: 89, label: "62–88", color: "#D85A30", bg: "#FAECE7", text: "#4A1B0C", level: "Signal 2" },
    { max: 118, label: "89–117", color: "#E24B4A", bg: "#FCEBEB", text: "#501313", level: "Signal 3" },
    { max: 185, label: "118–184", color: "#A32D2D", bg: "#F8D7DA", text: "#501313", level: "Signal 4" },
    { max: Infinity, label: "≥ 185", color: "#6B1D2F", bg: "#F2D2D8", text: "#3B0813", level: "Signal 5" },
]

// Derived from PAGASA Heavy Rainfall Warning System & repo scoring
export const RAIN_THRESHOLDS = [
    { max: 7.5, label: "< 7.5", color: "#1D9E75", bg: "#E1F5EE", text: "#085041", level: "Light" },
    { max: 15, label: "7.5–15", color: "#EF9F27", bg: "#FAEEDA", text: "#633806", level: "Moderate" },
    { max: 30, label: "15–30", color: "#D85A30", bg: "#FAECE7", text: "#4A1B0C", level: "Heavy" },
    { max: Infinity, label: "≥ 30", color: "#E24B4A", bg: "#FCEBEB", text: "#501313", level: "Torrential" },
]

// Air temperature thresholds (general categories, not official heat index)
export const TEMP_THRESHOLDS = [
    { max: 32, label: "< 32", color: "#1D9E75", bg: "#E1F5EE", text: "#085041", level: "Mild / Normal" },
    { max: 36, label: "32–35", color: "#EF9F27", bg: "#FAEEDA", text: "#633806", level: "Warm" },
    { max: 41, label: "36–40", color: "#D85A30", bg: "#FAECE7", text: "#4A1B0C", level: "Hot" },
    { max: Infinity, label: "≥ 41", color: "#E24B4A", bg: "#FCEBEB", text: "#501313", level: "Very Hot" },
]

const RISK_COLORS = { low: "#1D9E75", moderate: "#EF9F27", high: "#D85A30", critical: "#E24B4A" }

export function getLayerThresholdConfig(layer, value) {
    if (value === null || value === undefined || isNaN(value)) {
        return {
            color: "#64748b",
            bg: "#f8fafc",
            border: "#cbd5e1",
            text: "#334155",
            level: "Loading",
        }
    }
    const thresholds = layer === "rain"
        ? RAIN_THRESHOLDS
        : layer === "temp"
            ? TEMP_THRESHOLDS
            : WIND_THRESHOLDS

    for (const t of thresholds) {
        if (value < t.max) return t
    }
    return thresholds[thresholds.length - 1]
}

export function formatLayerValue(layer, weather) {
    if (!weather) return { valueText: "...", numValue: null }
    if (layer === "rain") {
        const val = weather.precipitation ?? 0
        return { valueText: `${parseFloat(val).toFixed(1)} mm/h`, numValue: parseFloat(val) }
    }
    if (layer === "temp") {
        const val = weather.temperature_2m
        return { valueText: val != null ? `${Math.round(val)}°C` : "...", numValue: val }
    }
    // wind default
    const val = weather.wind_speed_10m
    return { valueText: val != null ? `${Math.round(val)} km/h` : "...", numValue: val }
}

// ─── DivIcon Dot Marker (Compact mode non-selected: 18px circle) ──────────────
export const createWeatherDotIcon = (step) => {
    return L.divIcon({
        className: "weather-dot-marker-wrap",
        html: `
            <div class="weather-dot-bubble" style="
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: ${step.color};
                border: 2px solid #ffffff;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
                box-sizing: border-box;
                cursor: pointer;
            "></div>
        `,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
    })
}

// ─── DivIcon Pill Marker Generator ───────────────────────────────────────────
export const createWeatherPillIcon = (barangayName, valText, step, isSelected, placement = "right", isCompact = false) => {
    const cleanName = (barangayName || "").replace(/^Barangay\s+/i, "").trim()

    // Non-selected pills get 1.5px border in severity color; selected gets 3px dark border and larger shadow
    const borderWidth = isSelected ? "3px" : "1.5px"
    const borderColor = isSelected ? "#0f172a" : step.color
    const shadow = isSelected
        ? "0 4px 14px rgba(15, 23, 42, 0.45)"
        : "0 2px 6px rgba(0, 0, 0, 0.12)"
    const selectedDot = isSelected
        ? `<span style="width: 5px; height: 5px; border-radius: 50%; background: #0f172a; display: inline-block; flex-shrink: 0;"></span>`
        : ""

    // Calculate placement offset
    let transformCss = "translate(-50%, -50%)"
    if (placement === "left") {
        transformCss = "translate(calc(-100% - 6px), -50%)"
    } else if (placement === "right") {
        transformCss = "translate(6px, -50%)"
    } else if (placement === "above") {
        transformCss = "translate(-50%, calc(-100% - 6px))"
    } else if (placement === "below") {
        transformCss = "translate(-50%, 6px)"
    }

    const contentHtml = isCompact
        ? `<span style="font-variant-numeric: tabular-nums; font-weight: 700; color: ${step.text};">${valText}</span>
           <span class="pill-hover-tip">${cleanName}</span>`
        : `${selectedDot}
           <span style="font-weight: 700; color: ${step.text};">${cleanName}</span>
           <span style="opacity: 0.45; font-weight: 400;">·</span>
           <span style="font-variant-numeric: tabular-nums; font-weight: 600; color: ${step.text};">${valText}</span>`

    return L.divIcon({
        className: "weather-pill-marker-wrap",
        html: `
            <div style="position: relative;">
                <span class="anchor-pin-dot" style="
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: ${step.color};
                    border: 1.5px solid white;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.35);
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                "></span>
                <div class="weather-pill-bubble ${isSelected ? "is-selected" : ""}"
                     title="${cleanName}"
                     tabindex="0"
                     style="
                        background: ${step.bg};
                        color: ${step.text};
                        border: ${borderWidth} solid ${borderColor};
                        box-shadow: ${shadow};
                        border-radius: 20px;
                        padding: ${isCompact ? "3px 8px" : "4px 9px"};
                        font-size: 11px;
                        font-weight: 600;
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                        white-space: nowrap;
                        transform: ${transformCss};
                        cursor: pointer;
                        user-select: none;
                        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                     ">
                    ${contentHtml}
                </div>
            </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        popupAnchor: [0, -14],
    })
}

// ─── Map Bounds, Pan & Zoom Controller ───────────────────────────────────────
function MapController({ barangays, selectedBarangay, isMapActive, onZoomChange, containerRef, onMapReady }) {
    const map = useMap()
    const initializedRef = useRef(false)
    const prevSelectedRef = useRef(selectedBarangay?.id)

    useEffect(() => {
        if (map && onMapReady) onMapReady(map)
    }, [map, onMapReady])

    // Track zoom changes
    useEffect(() => {
        if (!map) return
        const updateZoom = () => onZoomChange(map.getZoom())
        updateZoom()
        map.on("zoomend", updateZoom)
        return () => map.off("zoomend", updateZoom)
    }, [map, onZoomChange])

    // Helper: fitBounds only when container has real dimensions and bounds are valid
    const safeFitBounds = useCallback(() => {
        if (!map || !barangays || barangays.length === 0) return
        const container = containerRef?.current
        if (container) {
            const w = container.offsetWidth
            const h = container.offsetHeight
            if (!w || !h) return // container still has zero size — skip
        }

        const validCoords = barangays
            .map(b => [Number(b.latitude), Number(b.longitude)])
            .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))

        if (validCoords.length === 0) return
        const bounds = L.latLngBounds(validCoords)
        if (!bounds.isValid()) return

        // Edge clipping: on fitBounds, use at least 60px padding on phones so no marker is cut off
        const isPhone = (container?.offsetWidth || window.innerWidth) < 768
        const pad = isPhone ? 60 : 40
        map.fitBounds(bounds, { padding: [pad, pad] })
        initializedRef.current = true
    }, [map, barangays, containerRef])

    // Attach ResizeObserver to call invalidateSize + fitBounds whenever container resizes
    useEffect(() => {
        if (!map || !containerRef?.current) return
        const el = containerRef.current

        const onResize = () => {
            map.invalidateSize()
            if (!initializedRef.current) {
                safeFitBounds()
            }
        }

        const ro = new ResizeObserver(onResize)
        ro.observe(el)

        // Also fire once shortly after mount to handle post-paint layout shifts
        const t1 = setTimeout(() => { map.invalidateSize(); safeFitBounds() }, 100)
        const t2 = setTimeout(() => { map.invalidateSize(); if (!initializedRef.current) safeFitBounds() }, 400)

        return () => {
            ro.disconnect()
            clearTimeout(t1)
            clearTimeout(t2)
        }
    }, [map, containerRef, safeFitBounds])

    // Pan smoothly to selected barangay when selection changes
    useEffect(() => {
        if (!map || !selectedBarangay || !initializedRef.current) return
        if (prevSelectedRef.current !== selectedBarangay.id) {
            prevSelectedRef.current = selectedBarangay.id
            const lat = Number(selectedBarangay.latitude)
            const lng = Number(selectedBarangay.longitude)
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                map.flyTo([lat, lng], Math.max(map.getZoom(), 13), { animate: true, duration: 1 })
            }
        }
    }, [map, selectedBarangay])

    // Extra invalidateSize when the map tab becomes active
    useEffect(() => {
        if (!map || !isMapActive) return
        const t = setTimeout(() => {
            map.invalidateSize()
            if (!initializedRef.current) safeFitBounds()
        }, 250)
        return () => clearTimeout(t)
    }, [map, isMapActive, safeFitBounds])

    return null
}

// ─── Weather Detail Card (Bottom Sheet on Mobile, Floating Card on Desktop) ───
function WeatherDetailCard({ barangay, weather, onClose, isMobile }) {
    if (!barangay) return null

    const cleanName = (barangay.name || "").replace(/^Barangay\s+/i, "").trim()
    const riskLevel = barangay.riskLevel || "low"

    // Readings with "n/a" for anything missing
    const wind = weather?.wind_speed_10m != null
        ? `${Math.round(weather.wind_speed_10m)} km/h`
        : "n/a"

    const gustsRaw = weather?.wind_gusts_10m ?? weather?.windgusts_10m
    const gusts = gustsRaw != null
        ? `${Math.round(gustsRaw)} km/h`
        : "n/a"

    const rain = weather?.precipitation != null
        ? `${parseFloat(weather.precipitation).toFixed(1)} mm/h`
        : "n/a"

    const temp = weather?.temperature_2m != null
        ? `${Math.round(weather.temperature_2m)}°C`
        : "n/a"

    const pressure = weather?.surface_pressure != null
        ? `${Math.round(weather.surface_pressure)} hPa`
        : "n/a"

    const metrics = [
        { label: "Wind", value: wind },
        { label: "Gusts", value: gusts },
        { label: "Rain", value: rain },
        { label: "Temperature", value: temp },
        { label: "Pressure", value: pressure },
    ]

    return (
        <div className={isMobile ? "wx-bottom-sheet" : "wx-desktop-detail-card"}>
            {isMobile && <div className="wx-sheet-handle" />}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                        {cleanName}
                    </span>
                    <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background: RISK_COLORS[riskLevel] || "#1D9E75",
                        color: "#ffffff",
                        letterSpacing: "0.03em",
                        textTransform: "uppercase",
                    }}>
                        {riskLevel.toUpperCase()} RISK
                    </span>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close"
                    style={{
                        background: "#f1f5f9",
                        border: "none",
                        borderRadius: "50%",
                        width: 28,
                        height: 28,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        color: "#64748b",
                        padding: 0,
                    }}
                >
                    <X size={16} />
                </button>
            </div>

            <div className="wx-detail-metrics-grid" style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                gap: 8,
            }}>
                {metrics.map((m) => (
                    <div
                        key={m.label}
                        style={{
                            background: "#f8fafc",
                            border: "0.5px solid #e2e8f0",
                            borderRadius: 8,
                            padding: "8px 6px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                            alignItems: "center",
                            textAlign: "center",
                        }}
                    >
                        <span style={{ fontSize: 9.5, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            {m.label}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            {m.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// ─── Main WeatherMap Component ────────────────────────────────────────────────
export default function WeatherMap({ barangays = [], selectedBarangay, onSelectBarangay, isMapActive }) {
    const [layer, setLayer] = useState("wind") // "wind" | "rain" | "temp"
    const [markerWeather, setMarkerWeather] = useState({}) // { [barangayId]: currentWeatherData }
    const [loadingWeather, setLoadingWeather] = useState(false)
    const [weatherError, setWeatherError] = useState(null)
    const [lastUpdatedTime, setLastUpdatedTime] = useState(null)
    const [currentZoom, setCurrentZoom] = useState(13)
    const [legendExpanded, setLegendExpanded] = useState(false)
    const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false)
    const [internalSelected, setInternalSelected] = useState(null)
    const [detailBarangay, setDetailBarangay] = useState(null)
    const [leafletMap, setLeafletMap] = useState(null)

    const mapRef = useRef(null)
    const containerRef = useRef(null)

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
    }, [])

    // Sync external selectedBarangay if provided
    useEffect(() => {
        if (selectedBarangay) {
            setInternalSelected(selectedBarangay)
        }
    }, [selectedBarangay])

    const currentSelected = internalSelected || selectedBarangay

    const handleSelectBarangay = useCallback((b) => {
        if (!b) return
        setInternalSelected(b)
        setDetailBarangay(b)
        if (onSelectBarangay) onSelectBarangay(b)

        const lat = Number(b.latitude)
        const lng = Number(b.longitude)
        if (leafletMap && Number.isFinite(lat) && Number.isFinite(lng)) {
            leafletMap.flyTo([lat, lng], Math.max(leafletMap.getZoom(), 14), {
                animate: true,
                duration: 0.8,
            })
        }
    }, [leafletMap, onSelectBarangay])

    // Fetch batch weather for all barangays
    const fetchAllWeather = useCallback(async () => {
        if (!barangays || barangays.length === 0) return

        const validBarangays = barangays.filter(b => {
            const lat = Number(b.latitude)
            const lng = Number(b.longitude)
            return Number.isFinite(lat) && Number.isFinite(lng)
        })

        if (validBarangays.length === 0) return

        setLoadingWeather(true)
        setWeatherError(null)

        try {
            const lats = validBarangays.map(b => b.latitude).join(",")
            const lngs = validBarangays.map(b => b.longitude).join(",")

            const res = await axios.get(
                `https://api.open-meteo.com/v1/forecast` +
                `?latitude=${lats}&longitude=${lngs}` +
                `&current=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,` +
                `relative_humidity_2m,weathercode,surface_pressure` +
                `&wind_speed_unit=kmh&timezone=Asia/Manila`
            )

            const dataArr = Array.isArray(res.data) ? res.data : [res.data]
            const newWeatherMap = {}

            validBarangays.forEach((b, idx) => {
                const item = dataArr[idx]
                if (item && item.current) {
                    newWeatherMap[`${b.id ?? b.value ?? b.name}`] = item.current
                }
            })

            setMarkerWeather(prev => ({ ...prev, ...newWeatherMap }))

            const now = new Date()
            const timeStr = now.toLocaleTimeString("en-PH", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            })
            setLastUpdatedTime(timeStr)
        } catch (err) {
            console.error("Failed to batch fetch weather for barangays:", err)
            setWeatherError("Weather update failed.")
        } finally {
            setLoadingWeather(false)
        }
    }, [barangays])

    useEffect(() => {
        fetchAllWeather()
    }, [fetchAllWeather])

    // Get weather tile overlay URL
    const getLayerUrl = () => {
        switch (layer) {
            case "wind":
                return `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`
            case "rain":
                return `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`
            case "temp":
                return `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`
            default:
                return `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`
        }
    }

    const defaultCenter = currentSelected
        ? [Number(currentSelected.latitude), Number(currentSelected.longitude)]
        : [9.7833, 125.4833] // Surigao City

    const activeSteps = useMemo(() => {
        if (layer === "rain") return RAIN_THRESHOLDS
        if (layer === "temp") return TEMP_THRESHOLDS
        return WIND_THRESHOLDS
    }, [layer])

    const layerUnitTitle = useMemo(() => {
        if (layer === "rain") return "Precipitation (mm/h)"
        if (layer === "temp") return "Air temperature (°C)"
        return "Wind Speed (km/h)"
    }, [layer])

    // Compact mode: zoom below 13, or any zoom under 768px
    const isCompact = currentZoom < 13 || isMobile

    // Sorted barangays for the under 768px "All barangays" list (highest value first)
    const sortedBarangays = useMemo(() => {
        return [...barangays].sort((a, b) => {
            const wa = markerWeather[`${a.id ?? a.value ?? a.name}`]
            const wb = markerWeather[`${b.id ?? b.value ?? b.name}`]
            const valA = formatLayerValue(layer, wa).numValue
            const valB = formatLayerValue(layer, wb).numValue
            const numA = (valA == null || isNaN(valA)) ? -Infinity : valA
            const numB = (valB == null || isNaN(valB)) ? -Infinity : valB
            return numB - numA
        })
    }, [barangays, markerWeather, layer])

    return (
        <div className="wx-map-page-wrapper" style={{ width: "100%", position: "relative" }}>
            <div ref={containerRef} className="wx-map-container" style={styles.container}>
                <style>{`
                    .muted-tile-layer {
                        filter: saturate(0.7) contrast(0.92) !important;
                    }
                    .weather-pill-marker-wrap,
                    .weather-dot-marker-wrap {
                        background: transparent !important;
                        border: none !important;
                        transition: z-index 0.1s ease;
                    }
                    .weather-pill-marker-wrap:hover,
                    .weather-dot-marker-wrap:hover {
                        z-index: 9999 !important;
                    }
                    .weather-pill-bubble {
                        transition: scale 0.15s ease, box-shadow 0.15s ease;
                    }
                    .weather-pill-bubble:hover {
                        scale: 1.06;
                        z-index: 9999 !important;
                    }
                    .weather-pill-bubble.is-selected {
                        scale: 1.04;
                    }
                    .weather-dot-bubble {
                        transition: transform 0.15s ease, box-shadow 0.15s ease;
                    }
                    .weather-dot-bubble:hover {
                        transform: scale(1.25);
                        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
                    }
                    .pill-hover-tip {
                        display: none;
                        position: absolute;
                        bottom: calc(100% + 5px);
                        left: 50%;
                        transform: translateX(-50%);
                        background: #0f172a;
                        color: #ffffff;
                        padding: 3px 7px;
                        border-radius: 5px;
                        font-size: 10px;
                        font-weight: 600;
                        white-space: nowrap;
                        pointer-events: none;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                        z-index: 10000;
                    }
                    .weather-pill-bubble:hover .pill-hover-tip,
                    .weather-pill-bubble:focus .pill-hover-tip,
                    .weather-pill-bubble:active .pill-hover-tip {
                        display: block;
                    }
                `}</style>

                <MapContainer
                    center={defaultCenter}
                    zoom={13}
                    minZoom={11}
                    maxZoom={18}
                    style={styles.map}
                    ref={mapRef}
                >
                    {/* Muted OSM Base Layer */}
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        className="muted-tile-layer"
                        zIndex={1}
                    />

                    {/* Weather Overlay Layer */}
                    <TileLayer
                        key={layer}
                        url={getLayerUrl()}
                        attribution='&copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>'
                        zIndex={2}
                        opacity={0.45}
                    />

                    {/* Map Bounds, Pan & Zoom Controller */}
                    <MapController
                        barangays={barangays}
                        selectedBarangay={currentSelected}
                        isMapActive={isMapActive}
                        onZoomChange={setCurrentZoom}
                        containerRef={containerRef}
                        onMapReady={setLeafletMap}
                    />

                    {/* Barangay Markers: 18px Dot in Compact Mode, Full Pill when selected or non-compact */}
                    {barangays.map(barangay => {
                        const lat = Number(barangay.latitude)
                        const lng = Number(barangay.longitude)
                        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

                        const cleanName = (barangay.name || "").replace(/^Barangay\s+/i, "").trim()
                        const key = `${barangay.id ?? barangay.value ?? barangay.name}`
                        const isSelected = !!currentSelected && (
                            currentSelected.id === barangay.id ||
                            currentSelected.value === barangay.value ||
                            currentSelected.name === barangay.name
                        )

                        const placement = LABEL_ANCHORS[cleanName] || LABEL_ANCHORS[barangay.name] || "right"
                        const w = markerWeather[key]
                        const { valueText, numValue } = formatLayerValue(layer, w)
                        const step = getLayerThresholdConfig(layer, numValue)

                        // Requirement 2:
                        // In compact mode: non-selected is an 18px circular dot. Only selected shows full pill.
                        // When not in compact mode: non-selected gets 1.5px border in severity color.
                        // Non-selected markers NEVER get the 3px dark border.
                        const isDot = isCompact && !isSelected
                        const icon = isDot
                            ? createWeatherDotIcon(step)
                            : createWeatherPillIcon(barangay.name, valueText, step, isSelected, placement, false)

                        return (
                            <Marker
                                key={key}
                                position={[lat, lng]}
                                icon={icon}
                                zIndexOffset={isSelected ? 1000 : 1}
                                eventHandlers={{
                                    click: () => handleSelectBarangay(barangay),
                                }}
                            >
                                {isDot && (
                                    <Tooltip direction="top" offset={[0, -10]}>
                                        {cleanName}
                                    </Tooltip>
                                )}
                            </Marker>
                        )
                    })}
                </MapContainer>

                {/* Top-Right Segmented Control */}
                <div style={styles.segmentedControl}>
                    {[
                        { id: "wind", label: "Wind", Icon: Wind },
                        { id: "rain", label: "Rain", Icon: CloudRain },
                        { id: "temp", label: "Temp", Icon: Thermometer },
                    ].map(({ id, label, Icon }) => {
                        const isActive = layer === id
                        return (
                            <button
                                key={id}
                                onClick={() => setLayer(id)}
                                style={{
                                    ...styles.segmentBtn,
                                    ...(isActive ? styles.segmentBtnActive : styles.segmentBtnInactive),
                                }}
                            >
                                <Icon size={13} style={{ flexShrink: 0 }} />
                                <span>{label}</span>
                            </button>
                        )
                    })}
                </div>

                {/* Top-Left Status Toast (Loading / Error) */}
                {loadingWeather && (
                    <div style={styles.statusToast}>
                        <RefreshCw size={12} style={{ animation: "spin 1.5s linear infinite" }} />
                        <span>Loading weather...</span>
                    </div>
                )}
                {weatherError && !loadingWeather && (
                    <div style={styles.errorToast}>
                        <AlertTriangle size={12} color="#dc2626" />
                        <span>{weatherError}</span>
                        <button onClick={fetchAllWeather} style={styles.retryBtn}>
                            Retry
                        </button>
                    </div>
                )}

                {/* Bottom-Left Legend — collapsible on mobile */}
                <div style={styles.legendCard} className="wx-legend">
                    <div
                        style={styles.legendHeader}
                        className="wx-legend-header"
                        onClick={() => setLegendExpanded(v => !v)}
                        role="button"
                        aria-expanded={legendExpanded}
                    >
                        <span style={styles.legendTitle}>{layerUnitTitle}</span>
                        <span className="wx-legend-chevron">
                            {legendExpanded
                                ? <ChevronUp size={13} color="#64748b" />
                                : <ChevronDown size={13} color="#64748b" />}
                        </span>
                    </div>
                    <div style={styles.legendSteps} className={`wx-legend-body${legendExpanded ? " is-expanded" : ""}`}>
                        {activeSteps.map((step, idx) => (
                            <div key={idx} style={styles.legendStepRow}>
                                <span style={{ ...styles.legendColorDot, background: step.color }} />
                                <span style={styles.legendStepLabel}>{step.label}</span>
                                <span style={styles.legendStepLevel}>{step.level}</span>
                            </div>
                        ))}
                    </div>
                    <div style={styles.legendFooter} className={`wx-legend-footer${legendExpanded ? " is-expanded" : ""}`}>
                        <span>Updated {lastUpdatedTime || "--:--"}</span>
                        <span>·</span>
                        <span>Open-Meteo</span>
                    </div>
                </div>

                {/* Desktop Detail Card (Floating in bottom-right corner) */}
                {!isMobile && detailBarangay && (
                    <WeatherDetailCard
                        barangay={detailBarangay}
                        weather={markerWeather[`${detailBarangay.id ?? detailBarangay.value ?? detailBarangay.name}`]}
                        onClose={() => setDetailBarangay(null)}
                        isMobile={false}
                    />
                )}
            </div>

            {/* Mobile Bottom Sheet Detail Card */}
            {isMobile && detailBarangay && (
                <>
                    <div
                        className="wx-sheet-backdrop"
                        onClick={() => setDetailBarangay(null)}
                    />
                    <WeatherDetailCard
                        barangay={detailBarangay}
                        weather={markerWeather[`${detailBarangay.id ?? detailBarangay.value ?? detailBarangay.name}`]}
                        onClose={() => setDetailBarangay(null)}
                        isMobile={true}
                    />
                </>
            )}

            {/* Under 768px: "All barangays" list below the map */}
            <div className="wx-all-barangays-section">
                <div style={styles.listSectionHeader}>
                    <span style={styles.listSectionTitle}>All barangays</span>
                    <span style={styles.listSectionSubtitle}>
                        Active layer: {layerUnitTitle}
                    </span>
                </div>
                <div style={styles.listSectionBody}>
                    {sortedBarangays.map(barangay => {
                        const cleanName = (barangay.name || "").replace(/^Barangay\s+/i, "").trim()
                        const key = `${barangay.id ?? barangay.value ?? barangay.name}`
                        const w = markerWeather[key]
                        const { valueText, numValue } = formatLayerValue(layer, w)
                        const step = getLayerThresholdConfig(layer, numValue)
                        const isRowSelected = !!currentSelected && (
                            currentSelected.id === barangay.id ||
                            currentSelected.value === barangay.value ||
                            currentSelected.name === barangay.name
                        )

                        return (
                            <div
                                key={key}
                                onClick={() => handleSelectBarangay(barangay)}
                                className={`wx-barangay-row ${isRowSelected ? "is-selected" : ""}`}
                                role="button"
                                tabIndex={0}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "10px 14px",
                                    borderRadius: 9,
                                    background: isRowSelected ? "#f0f7ff" : "#ffffff",
                                    border: isRowSelected ? "1.5px solid #185FA5" : "0.5px solid #e2e8f0",
                                    cursor: "pointer",
                                    boxShadow: isRowSelected
                                        ? "0 2px 8px rgba(24, 95, 165, 0.15)"
                                        : "0 1px 3px rgba(0, 0, 0, 0.03)",
                                    transition: "all 0.15s ease",
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                    <span
                                        style={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: 3,
                                            background: step.color,
                                            flexShrink: 0,
                                            display: "inline-block",
                                        }}
                                        title={step.level}
                                    />
                                    <span style={{
                                        fontSize: 13,
                                        fontWeight: isRowSelected ? 700 : 600,
                                        color: isRowSelected ? "#185FA5" : "#1e293b",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}>
                                        {cleanName}
                                    </span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                    <span style={{
                                        fontSize: 12.5,
                                        fontWeight: 700,
                                        color: step.text,
                                        fontVariantNumeric: "tabular-nums",
                                    }}>
                                        {valueText}
                                    </span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

const styles = {
    container: {
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 420,
        borderRadius: 12,
        overflow: "hidden",
    },
    map: {
        width: "100%",
        height: "100%",
    },
    segmentedControl: {
        position: "absolute",
        top: 14,
        right: 14,
        zIndex: 400,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: 3,
        borderRadius: 10,
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(6px)",
        border: "0.5px solid #cbd5e1",
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.12)",
    },
    segmentBtn: {
        height: 30,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 10px",
        borderRadius: 7,
        border: "none",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
    },
    segmentBtnActive: {
        background: "#185FA5",
        color: "white",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
    },
    segmentBtnInactive: {
        background: "transparent",
        color: "#475569",
    },
    statusToast: {
        position: "absolute",
        top: 14,
        left: 14,
        zIndex: 400,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.94)",
        backdropFilter: "blur(6px)",
        border: "0.5px solid #cbd5e1",
        color: "#1e293b",
        fontSize: 11,
        fontWeight: 600,
        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
    },
    errorToast: {
        position: "absolute",
        top: 14,
        left: 14,
        zIndex: 400,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 8,
        background: "rgba(254, 242, 242, 0.96)",
        backdropFilter: "blur(6px)",
        border: "0.5px solid #fca5a5",
        color: "#991b1b",
        fontSize: 11,
        fontWeight: 600,
        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
    },
    retryBtn: {
        marginLeft: 4,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 700,
        color: "white",
        background: "#dc2626",
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
    },
    legendCard: {
        position: "absolute",
        bottom: 16,
        left: 16,
        zIndex: 400,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(6px)",
        border: "0.5px solid #cbd5e1",
        boxShadow: "0 4px 12px rgba(15, 23, 42, 0.12)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 160,
    },
    legendHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "0.5px solid #e2e8f0",
        paddingBottom: 4,
    },
    legendTitle: {
        fontSize: 11,
        fontWeight: 700,
        color: "#0f172a",
        letterSpacing: "0.01em",
    },
    legendSteps: {
        display: "flex",
        flexDirection: "column",
        gap: 3,
    },
    legendStepRow: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
    },
    legendColorDot: {
        width: 10,
        height: 10,
        borderRadius: 3,
        flexShrink: 0,
    },
    legendStepLabel: {
        fontWeight: 600,
        color: "#1e293b",
        width: 48,
    },
    legendStepLevel: {
        color: "#64748b",
        fontSize: 9.5,
    },
    legendFooter: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 9.5,
        color: "#64748b",
        borderTop: "0.5px solid #e2e8f0",
        paddingTop: 4,
        marginTop: 2,
    },
    listSectionHeader: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 10,
    },
    listSectionTitle: {
        fontSize: 14,
        fontWeight: 700,
        color: "#0f172a",
    },
    listSectionSubtitle: {
        fontSize: 11,
        color: "#64748b",
    },
    listSectionBody: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
}
