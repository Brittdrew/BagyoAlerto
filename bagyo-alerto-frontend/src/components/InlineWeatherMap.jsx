import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { Maximize2 } from "lucide-react"

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY || ""
const OPENWEATHER_URLS = {
    wind: `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
    rain: `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`,
    temp: `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OPENWEATHER_API_KEY}`
}

export default function InlineWeatherMap({ selectedBarangay, onOpenFullMap }) {
    const mapRef = useRef(null)
    const mapInstanceRef = useRef(null)
    const markerRef = useRef(null)
    const layerRef = useRef(null)
    const [activeLayer, setActiveLayer] = useState("wind")

    // Initialize map
    useEffect(() => {
        if (!mapRef.current || !selectedBarangay) return

        // Create map only once
        if (!mapInstanceRef.current) {
            mapInstanceRef.current = L.map(mapRef.current, {
                center: [Number(selectedBarangay.latitude), Number(selectedBarangay.longitude)],
                zoom: 14,
                scrollWheelZoom: false,
                zoomControl: false,
                attributionControl: false,
            })

            // Add OSM base layer
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                opacity: 0.7
            }).addTo(mapInstanceRef.current)

            // Add weather overlay layer
            layerRef.current = L.tileLayer(OPENWEATHER_URLS.wind).addTo(mapInstanceRef.current)
        }

        const map = mapInstanceRef.current

        // Update marker position
        const lat = Number(selectedBarangay.latitude)
        const lng = Number(selectedBarangay.longitude)

        if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng])
        } else {
            markerRef.current = L.circleMarker([lat, lng], {
                radius: 6,
                fillColor: "#185FA5",
                color: "white",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8,
            })
                .bindTooltip(selectedBarangay.name, { permanent: false, offset: [0, -8] })
                .addTo(map)
        }

        // Fly to new location
        map.flyTo([lat, lng], 14, { duration: 1 })
    }, [selectedBarangay])

    // Handle layer changes
    useEffect(() => {
        if (!mapInstanceRef.current || !layerRef.current) return

        const map = mapInstanceRef.current
        map.removeLayer(layerRef.current)

        layerRef.current = L.tileLayer(OPENWEATHER_URLS[activeLayer], {
            opacity: 0.6
        }).addTo(map)
    }, [activeLayer])

    const toggleButtons = [
        { key: "wind", emoji: "💨", label: "Wind" },
        { key: "rain", emoji: "🌧", label: "Rain" },
        { key: "temp", emoji: "🌡", label: "Temp" },
    ]

    return (
        <div style={{ position: "relative", height: "100%", borderRadius: 12, overflow: "hidden", background: "#f5f5f5" }}>
            <div
                ref={mapRef}
                style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 12,
                }}
            />

            {/* Layer Toggle Pills - Top Right */}
            <div style={{
                position: "absolute",
                top: 12,
                right: 12,
                display: "flex",
                gap: 6,
                zIndex: 400,
            }}>
                {toggleButtons.map(btn => (
                    <button
                        key={btn.key}
                        onClick={() => setActiveLayer(btn.key)}
                        style={{
                            padding: "6px 12px",
                            borderRadius: 20,
                            border: "0.5px solid white",
                            background: activeLayer === btn.key ? "#185FA5" : "rgba(255, 255, 255, 0.9)",
                            color: activeLayer === btn.key ? "white" : "#333",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            transition: "all 0.2s",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                        }}
                    >
                        <span>{btn.emoji}</span> {btn.label}
                    </button>
                ))}
            </div>

            {/* Open Full Map Button - Bottom Right */}
            <button
                onClick={onOpenFullMap}
                style={{
                    position: "absolute",
                    bottom: 12,
                    right: 12,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "0.5px solid white",
                    background: "rgba(24, 95, 165, 0.95)",
                    color: "white",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    transition: "all 0.2s",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    zIndex: 400,
                }}
            >
                <Maximize2 size={12} /> Open Full Map
            </button>
        </div>
    )
}
