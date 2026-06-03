import { useEffect, useState, useCallback, useRef } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { AlertTriangle, Wind, Cloud, Thermometer } from "lucide-react"
import axios from "axios"

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
})

const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY || ""
const RISK_COLORS = { low: "#1D9E75", moderate: "#EF9F27", high: "#D85A30", critical: "#E24B4A" }

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

// Create marker icons
const createMarkerIcon = (isSelected) => {
    const color = isSelected ? "#185FA5" : "#888"
    return L.divIcon({
        html: `<div style="
            background: ${color};
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 14px;
            font-weight: bold;
        ">📍</div>`,
        className: "",
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
    })
}

// Map controller to handle flyTo
function MapController({ selectedBarangay, isMapActive }) {
    const map = useMap()

    useEffect(() => {
        if (!selectedBarangay || !isMapActive) return

        const lat = Number(selectedBarangay.latitude)
        const lng = Number(selectedBarangay.longitude)

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            map.flyTo([lat, lng], 13, { animate: true, duration: 1 })
        }
    }, [selectedBarangay, isMapActive, map])

    return null
}

// Weather popup component
function WeatherPopup({ barangay, weather, loading }) {
    if (loading) {
        return (
            <div style={{ fontSize: 12, color: "#666", padding: "8px" }}>
                Loading weather...
            </div>
        )
    }

    if (!weather) {
        return (
            <div style={{ fontSize: 12, color: "#666", padding: "8px" }}>
                Unable to load weather
            </div>
        )
    }

    const riskLevel = barangay?.riskLevel || "low"

    return (
        <div style={styles.popup}>
            <div style={styles.popupHeader}>
                <div style={styles.popupTitle}>{barangay.name}</div>
                <div style={{
                    fontSize: 10, fontWeight: 600, padding: "2px 8px",
                    borderRadius: 4, background: RISK_COLORS[riskLevel] || "#888",
                    color: "white", display: "inline-block"
                }}>
                    {riskLevel.toUpperCase()}
                </div>
            </div>

            <div style={styles.popupRow}>
                <span style={styles.popupLabel}>{WX_ICON(weather.weathercode)} {WX_DESC(weather.weathercode)}</span>
            </div>

            <div style={styles.popupMetaGrid}>
                <div>
                    <div style={styles.popupMetaLabel}>Temperature</div>
                    <div style={styles.popupMetaValue}>{Math.round(weather.temperature_2m)}°C</div>
                </div>
                <div>
                    <div style={styles.popupMetaLabel}>Humidity</div>
                    <div style={styles.popupMetaValue}>{weather.relative_humidity_2m}%</div>
                </div>
            </div>

            <div style={styles.popupMetaGrid}>
                <div>
                    <div style={styles.popupMetaLabel}>Wind</div>
                    <div style={styles.popupMetaValue}>{Math.round(weather.wind_speed_10m)} km/h</div>
                </div>
                <div>
                    <div style={styles.popupMetaLabel}>Pressure</div>
                    <div style={styles.popupMetaValue}>{Math.round(weather.surface_pressure)} hPa</div>
                </div>
            </div>

            {weather.precipitation !== undefined && (
                <div style={styles.popupRow}>
                    <span style={styles.popupMetaLabel}>💧 Precipitation: {weather.precipitation} mm</span>
                </div>
            )}
        </div>
    )
}

export default function WeatherMap({ barangays, selectedBarangay, isMapActive }) {
    const [layer, setLayer] = useState("wind")
    const [markerWeather, setMarkerWeather] = useState({}) // { barangayId: weather }
    const [loading, setLoading] = useState({}) // { barangayId: true/false }
    const mapRef = useRef(null)
    const markersRef = useRef({})

    // Fetch weather for a specific barangay
    const fetchWeatherForBarangay = useCallback(async (barangay) => {
        if (!barangay) return

        const key = `${barangay.id}`
        setLoading(prev => ({ ...prev, [key]: true }))

        try {
            const res = await axios.get(
                `https://api.open-meteo.com/v1/forecast` +
                `?latitude=${barangay.latitude}&longitude=${barangay.longitude}` +
                `&current=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,` +
                `relative_humidity_2m,weathercode,surface_pressure` +
                `&wind_speed_unit=kmh&timezone=Asia/Manila`
            )

            const current = res.data?.current || {}
            setMarkerWeather(prev => ({
                ...prev,
                [key]: current
            }))
        } catch (err) {
            console.error("Failed to fetch weather for barangay:", err)
        } finally {
            setLoading(prev => ({ ...prev, [key]: false }))
        }
    }, [])

    // Handle marker click
    const handleMarkerClick = useCallback((barangay) => {
        const key = `${barangay.id}`
        if (!markerWeather[key] && !loading[key]) {
            fetchWeatherForBarangay(barangay)
        }
        // Popup will open automatically
    }, [markerWeather, loading, fetchWeatherForBarangay])

    // Get weather layer URL
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

    const center = selectedBarangay
        ? [Number(selectedBarangay.latitude), Number(selectedBarangay.longitude)]
        : [9.7833, 125.4833] // Surigao default

    return (
        <div style={styles.container}>
            <MapContainer
                center={center}
                zoom={13}
                style={styles.map}
                ref={mapRef}
            >
                {/* OSM Base Layer */}
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                    zIndex={1}
                />

                {/* Weather Overlay Layer */}
                <TileLayer
                    url={getLayerUrl()}
                    attribution="OpenWeatherMap"
                    zIndex={2}
                    opacity={0.5}
                />

                {/* Map Controller */}
                <MapController selectedBarangay={selectedBarangay} isMapActive={isMapActive} />

                {/* Barangay Markers */}
                {barangays.map(barangay => {
                    const lat = Number(barangay.latitude)
                    const lng = Number(barangay.longitude)
                    const isSelected = selectedBarangay?.id === barangay.id

                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

                    return (
                        <Marker
                            key={barangay.id}
                            position={[lat, lng]}
                            icon={createMarkerIcon(isSelected)}
                            eventHandlers={{
                                click: () => handleMarkerClick(barangay),
                            }}
                        >
                            <Popup maxWidth={280}>
                                <WeatherPopup
                                    barangay={barangay}
                                    weather={markerWeather[`${barangay.id}`]}
                                    loading={loading[`${barangay.id}`]}
                                />
                            </Popup>
                        </Marker>
                    )
                })}
            </MapContainer>

            {/* Layer Toggle Buttons */}
            <div style={styles.layerToggle}>
                {[
                    { id: "wind", label: "Wind", icon: "🌬️" },
                    { id: "rain", label: "Rain", icon: "🌧️" },
                    { id: "temp", label: "Temperature", icon: "🌡️" },
                ].map(btn => (
                    <button
                        key={btn.id}
                        style={{
                            ...styles.layerButton,
                            ...(layer === btn.id ? styles.layerButtonActive : {}),
                        }}
                        onClick={() => setLayer(btn.id)}
                    >
                        <span>{btn.icon}</span>
                        <span>{btn.label}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}

const styles = {
    container: {
        position: "relative",
        width: "100%",
        height: "100%",
    },
    map: {
        width: "100%",
        height: "100%",
    },
    layerToggle: {
        position: "absolute",
        top: 12,
        right: 12,
        display: "flex",
        gap: 8,
        zIndex: 400,
        flexWrap: "wrap",
        maxWidth: "90%",
    },
    layerButton: {
        height: 34,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        borderRadius: 8,
        border: "0.5px solid rgba(12, 30, 48, 0.18)",
        background: "rgba(255, 255, 255, 0.92)",
        color: "#203040",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.12)",
        transition: "all 0.2s",
    },
    layerButtonActive: {
        background: "#185FA5",
        color: "white",
        borderColor: "#185FA5",
    },
    popup: {
        fontSize: 12,
        color: "#333",
        minWidth: 240,
    },
    popupHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
        paddingBottom: 8,
        borderBottom: "1px solid #e8ecf0",
    },
    popupTitle: {
        fontSize: 13,
        fontWeight: 700,
        color: "#1a237e",
    },
    popupRow: {
        marginBottom: 6,
    },
    popupLabel: {
        fontSize: 11,
        color: "#555",
    },
    popupMetaGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        marginBottom: 8,
    },
    popupMetaLabel: {
        fontSize: 10,
        color: "#aaa",
        textTransform: "uppercase",
        fontWeight: 600,
    },
    popupMetaValue: {
        fontSize: 13,
        fontWeight: 600,
        color: "#1a237e",
        marginTop: 2,
    },
}
