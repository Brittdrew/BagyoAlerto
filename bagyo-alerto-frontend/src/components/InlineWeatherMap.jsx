import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { Maximize2, Wind, CloudRain, Thermometer } from "lucide-react"
import axios from "axios"
import {
    createWeatherPillIcon,
    getLayerThresholdConfig,
    formatLayerValue,
} from "./WeatherMap"

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY || ""
const OPENWEATHER_URLS = {
    wind: `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
    rain: `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
    temp: `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
}

export default function InlineWeatherMap({ selectedBarangay, onOpenFullMap }) {
    const containerRef = useRef(null)
    const mapRef = useRef(null)
    const mapInstanceRef = useRef(null)
    const markerRef = useRef(null)
    const layerRef = useRef(null)
    const [activeLayer, setActiveLayer] = useState("wind")
    const [weather, setWeather] = useState(null)

    useEffect(() => {
        if (!selectedBarangay) return
        const lat = Number(selectedBarangay.latitude)
        const lng = Number(selectedBarangay.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
        axios.get(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
            `&current=temperature_2m,precipitation,wind_speed_10m&wind_speed_unit=kmh&timezone=Asia/Manila`
        ).then(res => {
            if (res.data?.current) setWeather(res.data.current)
        }).catch(() => {})
    }, [selectedBarangay])

    useEffect(() => {
        if (!mapRef.current || !selectedBarangay) return
        const lat = Number(selectedBarangay.latitude)
        const lng = Number(selectedBarangay.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

        if (!mapInstanceRef.current) {
            mapInstanceRef.current = L.map(mapRef.current, {
                center: [lat, lng],
                zoom: 14,
                minZoom: 11,
                maxZoom: 18,
                scrollWheelZoom: false,
                zoomControl: false,
                attributionControl: false,
            })
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                opacity: 0.75,
                className: "muted-tile-layer",
            }).addTo(mapInstanceRef.current)
            layerRef.current = L.tileLayer(OPENWEATHER_URLS.wind, { opacity: 0.45 }).addTo(mapInstanceRef.current)
        }

        const map = mapInstanceRef.current
        const cw = containerRef.current?.offsetWidth
        const ch = containerRef.current?.offsetHeight
        if (cw && ch) {
            map.invalidateSize()
            map.flyTo([lat, lng], 14, { duration: 1 })
        }
    }, [selectedBarangay])

    useEffect(() => {
        if (!containerRef.current) return
        const el = containerRef.current
        const onResize = () => {
            if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize()
        }
        const ro = new ResizeObserver(onResize)
        ro.observe(el)
        const t1 = setTimeout(onResize, 100)
        const t2 = setTimeout(onResize, 400)
        return () => { ro.disconnect(); clearTimeout(t1); clearTimeout(t2) }
    }, [])

    useEffect(() => {
        if (!mapInstanceRef.current || !selectedBarangay) return
        const map = mapInstanceRef.current
        const lat = Number(selectedBarangay.latitude)
        const lng = Number(selectedBarangay.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

        const cleanName = (selectedBarangay.name || "").replace(/^Barangay\s+/i, "").trim()
        const { valueText, numValue } = formatLayerValue(activeLayer, weather)
        const step = getLayerThresholdConfig(activeLayer, numValue)
        // Ignore LABEL_ANCHORS and center the pill above the point so it is never clipped
        const icon = createWeatherPillIcon(cleanName, valueText, step, true, "above", false)

        if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng])
            markerRef.current.setIcon(icon)
        } else {
            markerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map)
        }
    }, [selectedBarangay, weather, activeLayer])

    useEffect(() => {
        if (!mapInstanceRef.current || !layerRef.current) return
        const map = mapInstanceRef.current
        map.removeLayer(layerRef.current)
        layerRef.current = L.tileLayer(OPENWEATHER_URLS[activeLayer], { opacity: 0.45 }).addTo(map)
    }, [activeLayer])

    const toggleButtons = [
        { key: "wind", Icon: Wind, label: "Wind" },
        { key: "rain", Icon: CloudRain, label: "Rain" },
        { key: "temp", Icon: Thermometer, label: "Temp" },
    ]

    return (
        <div
            ref={containerRef}
            className="inline-wx-map-container"
            style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#f5f5f5" }}
        >
            <style>{`
                .muted-tile-layer { filter: saturate(0.7) contrast(0.92) !important; }
                .weather-pill-marker-wrap { background: transparent !important; border: none !important; }
            `}</style>
            <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: 12 }} />
            <div style={{
                position: "absolute", top: 10, right: 10,
                display: "inline-flex", alignItems: "center", gap: 2, padding: 2,
                borderRadius: 9, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(6px)",
                border: "0.5px solid #cbd5e1", boxShadow: "0 2px 6px rgba(15,23,42,0.12)", zIndex: 400,
            }}>
                {toggleButtons.map(btn => {
                    const isActive = activeLayer === btn.key
                    return (
                        <button
                            key={btn.key}
                            onClick={() => setActiveLayer(btn.key)}
                            style={{
                                height: 26, display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "0 8px", borderRadius: 6, border: "none",
                                background: isActive ? "#185FA5" : "transparent",
                                color: isActive ? "white" : "#475569",
                                fontSize: 10.5, fontWeight: 600, cursor: "pointer", transition: "all 0.15s ease",
                            }}
                        >
                            <btn.Icon size={11} /> {btn.label}
                        </button>
                    )
                })}
            </div>
            {/* Small attribution text at bottom-left */}
            <div
                style={{
                    position: "absolute",
                    bottom: 8,
                    left: 8,
                    fontSize: 9.5,
                    color: "#475569",
                    background: "rgba(255, 255, 255, 0.85)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    backdropFilter: "blur(4px)",
                    border: "0.5px solid rgba(203, 213, 225, 0.6)",
                    zIndex: 400,
                    pointerEvents: "auto",
                    lineHeight: 1.2,
                }}
            >
                &copy;{" "}
                <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#334155", textDecoration: "none" }}
                >
                    OpenStreetMap
                </a>{" "}
                contributors,{" "}
                <a
                    href="https://openweathermap.org/"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#334155", textDecoration: "none" }}
                >
                    OpenWeatherMap
                </a>
            </div>
            <button
                onClick={onOpenFullMap}
                style={{
                    position: "absolute", bottom: 10, right: 10, padding: "5px 9px",
                    borderRadius: 7, border: "0.5px solid rgba(255,255,255,0.3)",
                    background: "rgba(24,95,165,0.95)", color: "white",
                    fontSize: 10.5, fontWeight: 600, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 4,
                    transition: "all 0.15s ease", boxShadow: "0 2px 6px rgba(0,0,0,0.15)", zIndex: 400,
                }}
            >
                <Maximize2 size={11} /> Open Full Map
            </button>
        </div>
    )
}
