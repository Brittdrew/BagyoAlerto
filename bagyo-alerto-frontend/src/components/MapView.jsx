import { useEffect, useMemo, useState } from "react"
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { Navigation } from "lucide-react"

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
})

const barangayIcon = L.divIcon({
    html: `<div style="
        background: #1565c0;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 16px;
    ">&#128205;</div>`,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
})

const evacuationIcon = L.divIcon({
    html: `<div style="
        background: #dc3545;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 16px;
    ">&#127979;</div>`,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
})

function MapUpdater({ center }) {
    const map = useMap()

    useEffect(() => {
        map.setView(center, 15)
    }, [center, map])

    return null
}

async function getRoute(startLat, startLng, endLat, endLng) {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`
    const response = await fetch(url)
    const data = await response.json()
    if (data.routes && data.routes[0]) {
        const coordinates = data.routes[0].geometry.coordinates.map((coord) => [coord[1], coord[0]])
        const distance = (data.routes[0].distance / 1000).toFixed(2)
        const duration = Math.round(data.routes[0].duration / 60)
        return { coordinates, distance, duration }
    }
    return null
}

const API_BASE = import.meta.env.VITE_API_BASE
const API_ORIGIN = API_BASE.replace(/\/api\/?$/, "")

export default function MapView({ evacuationCenter, barangay }) {
    const [mapType, setMapType] = useState("street")
    const [mapReady, setMapReady] = useState(false)
    const [routeLoading, setRouteLoading] = useState(true)
    const [routeCoords, setRouteCoords] = useState([])
    const [routeDistance, setRouteDistance] = useState(null)
    const [driveMinutes, setDriveMinutes] = useState(null)
    const [photoUrl, setPhotoUrl] = useState(null)
    const [photoLoading, setPhotoLoading] = useState(true)

    const startLat = Number(barangay?.latitude)
    const startLng = Number(barangay?.longitude)
    const endLat = Number(evacuationCenter?.latitude)
    const endLng = Number(evacuationCenter?.longitude)

    const center = useMemo(() => [
        (startLat + endLat) / 2,
        (startLng + endLng) / 2,
    ], [startLat, startLng, endLat, endLng])

    useEffect(() => {
        let active = true
        const loadRoute = async () => {
            setRouteLoading(true)
            try {
                const route = await getRoute(startLat, startLng, endLat, endLng)
                if (!active) return
                if (route && route.coordinates.length > 1) {
                    setRouteCoords(route.coordinates)
                    setRouteDistance(route.distance)
                    setDriveMinutes(route.duration)
                } else {
                    setRouteCoords([[startLat, startLng], [endLat, endLng]])
                    const fallbackDistance = Number(evacuationCenter?.distance)
                    setRouteDistance(Number.isFinite(fallbackDistance) ? fallbackDistance.toFixed(2) : null)
                    setDriveMinutes(null)
                }
            } catch {
                if (!active) return
                setRouteCoords([[startLat, startLng], [endLat, endLng]])
                const fallbackDistance = Number(evacuationCenter?.distance)
                setRouteDistance(Number.isFinite(fallbackDistance) ? fallbackDistance.toFixed(2) : null)
                setDriveMinutes(null)
            } finally {
                if (active) setRouteLoading(false)
            }
        }

        if ([startLat, startLng, endLat, endLng].every((v) => Number.isFinite(v))) {
            loadRoute()
        } else {
            setRouteCoords([])
            setRouteLoading(false)
        }

        return () => {
            active = false
        }
    }, [startLat, startLng, endLat, endLng, evacuationCenter?.distance])

    useEffect(() => {
        let active = true
        const fetchPhoto = async () => {
            if (!barangay?.name) {
                setPhotoLoading(false)
                return
            }
            setPhotoLoading(true)
            try {
                const response = await fetch(`${API_BASE}/evacuation-centers/photo/${encodeURIComponent(barangay.name)}`)
                if (!active) return
                if (response.ok) {
                    const data = await response.json()
                    if (data && data.image_path) {
                        const path = data.image_path
                        const fullUrl = path.startsWith("http") ? path : `${API_ORIGIN}${path}`
                        setPhotoUrl(fullUrl)
                    } else {
                        setPhotoUrl(null)
                    }
                } else {
                    setPhotoUrl(null)
                }
            } catch (err) {
                if (active) {
                    setPhotoUrl(null)
                }
            } finally {
                if (active) {
                    setPhotoLoading(false)
                }
            }
        }
        fetchPhoto()
        return () => {
            active = false
        }
    }, [barangay?.name])

    const navUrl = `https://www.google.com/maps/search/?api=1&query=${evacuationCenter.latitude},${evacuationCenter.longitude}`

    const walkMinutes = driveMinutes ? Math.round(driveMinutes * 4) : null

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <div style={styles.title}>Evacuation Routing Map</div>
                <div style={styles.subtitle}>{evacuationCenter.address}</div>
            </div>

            <div style={styles.toggleRow}>
                <button
                    type="button"
                    onClick={() => setMapType("street")}
                    style={{ ...styles.toggleBtn, ...(mapType === "street" ? styles.toggleBtnActive : styles.toggleBtnInactive) }}
                >
                    Street View
                </button>
                <button
                    type="button"
                    onClick={() => setMapType("satellite")}
                    style={{ ...styles.toggleBtn, ...(mapType === "satellite" ? styles.toggleBtnActive : styles.toggleBtnInactive) }}
                >
                    Satellite View
                </button>
            </div>

            <div style={styles.mapWrap}>
                {!mapReady && <div style={styles.loadingOverlay}>⏳ Loading map...</div>}
                {routeLoading && <div style={{ ...styles.loadingOverlay, top: mapReady ? 52 : 0 }}>🧭 Fetching route...</div>}
                <MapContainer
                    center={center}
                    zoom={15}
                    style={styles.map}
                    scrollWheelZoom={window.innerWidth > 768}
                    whenReady={() => setMapReady(true)}
                >
                    <MapUpdater center={center} />
                    <TileLayer
                        url={mapType === "satellite"
                            ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
                        attribution={mapType === "satellite"
                            ? "Tiles © Esri"
                            : "© OpenStreetMap contributors"}
                    />
                    <Marker position={[startLat, startLng]} icon={barangayIcon}>
                        <Popup>
                            📍 <strong>Your Location</strong><br />
                            Barangay {barangay.name}, Surigao City
                        </Popup>
                    </Marker>
                    <Marker position={[endLat, endLng]} icon={evacuationIcon}>
                        <Popup>
                            🏫 <strong>{evacuationCenter.name}</strong><br />
                            📍 {evacuationCenter.address}<br />
                            👥 Capacity: {evacuationCenter.capacity} persons<br />
                            🟢 Active Evacuation Center
                        </Popup>
                    </Marker>
                    {routeCoords.length > 1 && (
                        <Polyline
                            positions={routeCoords}
                            pathOptions={{ color: "#1565c0", weight: 4, opacity: 0.8 }}
                        />
                    )}
                </MapContainer>
            </div>

            <div style={styles.infoStrip}>
                <div style={styles.infoItem}>📏 Distance: <strong>{routeDistance ? `${routeDistance} km` : "—"}</strong></div>
                <div style={styles.infoItem}>🚗 Drive: <strong>{driveMinutes ? `${driveMinutes} mins` : "—"}</strong></div>
                <div style={styles.infoItem}>🚶 Walk: <strong>{walkMinutes ? `${walkMinutes} mins` : "—"}</strong></div>
            </div>

            <div style={styles.streetCard}>
                <div style={styles.streetTitle}>📷 Evacuation Center Photo</div>
                <div style={styles.streetSub}>Representative photo of your evacuation destination</div>
                {photoLoading ? (
                    <div style={styles.streetFallback}>Loading photo...</div>
                ) : photoUrl ? (
                    <img
                        src={photoUrl}
                        alt="Evacuation center"
                        style={styles.streetImage}
                        onError={() => setPhotoUrl(null)}
                    />
                ) : (
                    <div style={styles.streetFallback}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Photo coming soon</div>
                        <div style={styles.streetFallbackSub}>An image of this evacuation center will be uploaded by the admin soon.</div>
                    </div>
                )}
                <div style={styles.streetCaption}>ℹ️ {evacuationCenter.name} — {evacuationCenter.address}</div>
            </div>

            <button
                type="button"
                style={styles.navBtn}
                onClick={() => window.open(navUrl, "_blank", "noopener,noreferrer")}
            >
                <Navigation size={16} />
                {"\uD83E\uDDED"} Open in Google Maps
            </button>
        </div>
    )
}

const styles = {
    container: {
        background: "#fff",
        borderRadius: 16,
        border: "0.5px solid #e4e8f2",
        padding: 14,
        marginTop: 14,
        boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
        display: "grid",
        gap: 12,
    },
    header: {
        display: "grid",
        gap: 4,
    },
    title: {
        fontSize: 15,
        fontWeight: 700,
        color: "#1a237e",
    },
    subtitle: {
        fontSize: 12,
        color: "#5f6b7a",
    },
    toggleRow: {
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
    },
    toggleBtn: {
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
    },
    toggleBtnActive: {
        background: "#1a237e",
        color: "#fff",
        border: "1px solid #1a237e",
    },
    toggleBtnInactive: {
        background: "#fff",
        color: "#1a237e",
        border: "1px solid #cfd7ea",
    },
    mapWrap: {
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
    },
    map: {
        width: "100%",
        height: 400,
    },
    loadingOverlay: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        zIndex: 500,
        background: "rgba(255,255,255,0.88)",
        color: "#44506a",
        fontSize: 12,
        padding: "8px 10px",
        textAlign: "center",
    },
    infoStrip: {
        background: "#fff",
        border: "0.5px solid #e4e8f2",
        borderRadius: 12,
        padding: "10px 12px",
        display: "flex",
        gap: 12,
        justifyContent: "space-between",
        flexWrap: "wrap",
    },
    infoItem: {
        fontSize: 12,
        color: "#334155",
    },
    streetCard: {
        background: "#fff",
        border: "0.5px solid #e4e8f2",
        borderRadius: 12,
        padding: 10,
        display: "grid",
        gap: 6,
    },
    streetTitle: {
        fontSize: 13,
        fontWeight: 700,
        color: "#1a237e",
    },
    streetSub: {
        fontSize: 11,
        color: "#6b7280",
    },
    streetImage: {
        width: "100%",
        height: 250,
        objectFit: "cover",
        borderRadius: 10,
        border: "0.5px solid #dbe3ef",
    },
    streetFallback: {
        width: "100%",
        height: 250,
        borderRadius: 10,
        border: "0.5px solid #dbe3ef",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        color: "#8b95a7",
        fontSize: 12,
        background: "#f8fafc",
        textAlign: "center",
        padding: 12,
        gap: 6,
    },
    streetFallbackSub: {
        fontSize: 11,
        color: "#6b7280",
    },
    streetCaption: {
        fontSize: 11,
        color: "#4b5563",
    },
    navBtn: {
        width: "100%",
        height: 44,
        borderRadius: 10,
        border: "1px solid #1a237e",
        background: "#1a237e",
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: "pointer",
    },
}
