import { useEffect, useMemo, useState } from "react"
import axios from "axios"
import { useNavigate } from "react-router-dom"
import { Cloud, CloudRain, ExternalLink, Layers, MapPin, Thermometer, Wind } from "lucide-react"
import Sidebar from "../components/Sidebar"
import { useSavedBarangay } from "../hooks/useSavedBarangay"

const API_BASE = import.meta.env.VITE_API_BASE

const LAYERS = [
    { id: "wind", label: "Wind", icon: Wind },
    { id: "rain", label: "Rain", icon: CloudRain },
    { id: "temp", label: "Temperature", icon: Thermometer },
    { id: "clouds", label: "Clouds", icon: Cloud },
]

export default function MapPage() {
    const navigate = useNavigate()
    const { barangayId } = useSavedBarangay()
    const [activeBarangay, setActiveBarangay] = useState(null)
    const [activeLayer, setActiveLayer] = useState("wind")
    const [loadedSrc, setLoadedSrc] = useState(null)
    const [loadingBarangay, setLoadingBarangay] = useState(true)

    useEffect(() => {
        let cancelled = false

        axios.get(`${API_BASE}/barangays`)
            .then((response) => {
                if (cancelled) return

                const selected = response.data.find(
                    (barangay) => String(barangay.id) === String(barangayId)
                )
                setActiveBarangay(selected || null)
            })
            .catch((error) => {
                if (!cancelled) console.error("Failed to load the active barangay for Windy:", error)
            })
            .finally(() => {
                if (!cancelled) setLoadingBarangay(false)
            })

        return () => { cancelled = true }
    }, [barangayId])

    const coordinates = useMemo(() => {
        const lat = Number(activeBarangay?.latitude)
        const lon = Number(activeBarangay?.longitude)

        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
    }, [activeBarangay])

    const embedSrc = useMemo(() => {
        if (!coordinates) return null

        const params = new URLSearchParams({
            lat: String(coordinates.lat),
            lon: String(coordinates.lon),
            detailLat: String(coordinates.lat),
            detailLon: String(coordinates.lon),
            width: "100%",
            height: "700",
            zoom: "9",
            level: "surface",
            overlay: activeLayer,
            product: "ecmwf",
            menu: "",
            message: "true",
            marker: "true",
            forecast: "12",
            calendar: "now",
            type: "map",
            location: "coordinates",
        })

        return `https://embed.windy.com/embed2.html?${params.toString()}`
    }, [activeLayer, coordinates])

    const windyUrl = coordinates
        ? `https://www.windy.com/?${activeLayer},${coordinates.lat},${coordinates.lon},9`
        : "https://www.windy.com/"
    const mapLoading = Boolean(embedSrc) && loadedSrc !== embedSrc
    const locationName = activeBarangay
        ? `${activeBarangay.name}, ${activeBarangay.city}`
        : "No active barangay"

    return (
        <div style={styles.page}>
            <div className="bakwit-layout" style={styles.layout}>
                <Sidebar activePage="map">
                    <div style={styles.navSection}>Active barangay</div>
                    <div style={styles.sidebarLocation}>{locationName}</div>
                </Sidebar>

                <main className="bakwit-main" style={styles.main}>
                    <div className="bakwit-page-topbar" style={styles.topbar}>
                        <span style={styles.topbarTitle}>Weather Map</span>
                        <span style={styles.topbarLocation}>
                            <MapPin size={12} /> {locationName}
                        </span>
                    </div>

                    <div className="bakwit-content" style={styles.content}>
                        <section style={styles.mapCard}>
                            <div style={styles.cardHeader}>
                                <div>
                                    <h1 style={styles.title}><Layers size={19} /> Weather Map</h1>
                                    <p style={styles.subtitle}>Forecast layers centered on the active barangay</p>
                                </div>
                                <a
                                    href={windyUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={styles.openLink}
                                >
                                    Open full map <ExternalLink size={14} />
                                </a>
                            </div>

                            <div style={styles.layerRow} aria-label="Weather map layers">
                                {LAYERS.map(({ id, label, icon: Icon }) => {
                                    const active = activeLayer === id
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() => setActiveLayer(id)}
                                            style={{
                                                ...styles.layerButton,
                                                ...(active ? styles.layerButtonActive : styles.layerButtonInactive),
                                            }}
                                        >
                                            <Icon size={14} /> {label}
                                        </button>
                                    )
                                })}
                            </div>

                            <div style={styles.mapWrap}>
                                {loadingBarangay && (
                                    <div style={styles.mapState}>Loading active barangay…</div>
                                )}

                                {!loadingBarangay && !embedSrc && (
                                    <div style={styles.mapState}>
                                        <strong>Select an active barangay on the Dashboard to center the map.</strong>
                                        <button type="button" onClick={() => navigate("/")} style={styles.dashboardButton}>
                                            Go to Dashboard
                                        </button>
                                    </div>
                                )}

                                {mapLoading && <div style={styles.mapState}>Loading Windy weather map…</div>}

                                {embedSrc && (
                                    <iframe
                                        key={embedSrc}
                                        src={embedSrc}
                                        title={`Windy weather map for ${locationName}`}
                                        loading="lazy"
                                        allowFullScreen
                                        onLoad={() => setLoadedSrc(embedSrc)}
                                        style={styles.iframe}
                                    />
                                )}
                            </div>

                            <p style={styles.disclaimer}>
                                Windy model data is supplementary. Follow official PAGASA bulletins and local evacuation instructions.
                            </p>
                        </section>
                    </div>
                </main>
            </div>
        </div>
    )
}

const styles = {
    page: {
        minHeight: "100vh",
        background: "#f0f4f8",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflowX: "hidden",
    },
    layout: { display: "flex", minHeight: "100vh", width: "100%" },
    navSection: {
        fontSize: 10,
        color: "#bbb",
        padding: "12px 14px 4px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
    },
    sidebarLocation: { padding: "4px 14px 14px", color: "#1a237e", fontSize: 11, fontWeight: 600 },
    main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%" },
    topbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
        padding: "12px 18px",
        background: "linear-gradient(135deg, #1a237e, #1565c0)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    },
    topbarTitle: { color: "#ffffff", fontSize: 14, fontWeight: 600 },
    topbarLocation: {
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: "rgba(255,255,255,0.85)",
        fontSize: 12,
    },
    content: { flex: 1, minWidth: 0, width: "100%", padding: "14px 18px", overflowX: "hidden" },
    mapCard: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
        padding: "14px 16px",
        border: "0.5px solid #e8ecf0",
        borderRadius: 12,
        background: "#ffffff",
        boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
    },
    cardHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 10,
    },
    title: { display: "flex", alignItems: "center", gap: 7, margin: 0, color: "#1a237e", fontSize: 18 },
    subtitle: { margin: "4px 0 0", color: "#64748b", fontSize: 12 },
    openLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: "#1565c0",
        fontSize: 12,
        fontWeight: 700,
        textDecoration: "none",
    },
    layerRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    layerButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 11px",
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
    },
    layerButtonActive: { color: "#ffffff", background: "#1a237e", border: "1px solid #1a237e" },
    layerButtonInactive: { color: "#334155", background: "#ffffff", border: "1px solid #cbd5e1" },
    mapWrap: {
        position: "relative",
        width: "100%",
        height: "calc(100vh - 230px)",
        minHeight: 500,
        overflow: "hidden",
        border: "1px solid #dbeafe",
        borderRadius: 9,
        background: "#e2e8f0",
    },
    mapState: {
        position: "absolute",
        inset: 0,
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 20,
        textAlign: "center",
        color: "#475569",
        background: "#f8fafc",
        fontSize: 13,
    },
    dashboardButton: {
        padding: "8px 13px",
        border: 0,
        borderRadius: 7,
        color: "#ffffff",
        background: "#1d4ed8",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
    },
    iframe: { display: "block", width: "100%", height: "100%", border: 0 },
    disclaimer: { margin: "9px 0 0", color: "#64748b", fontSize: 11, lineHeight: 1.45 },
}
