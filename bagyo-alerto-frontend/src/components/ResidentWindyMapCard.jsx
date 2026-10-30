import { useMemo, useState } from "react"
import { Cloud, CloudRain, ExternalLink, Thermometer, Wind } from "lucide-react"

const SURIGAO_CITY = { lat: 9.7843, lon: 125.4887 }

const LAYERS = [
    { id: "wind", label: "Wind", icon: Wind },
    { id: "rain", label: "Rain", icon: CloudRain },
    { id: "temp", label: "Temperature", icon: Thermometer },
    { id: "clouds", label: "Clouds", icon: Cloud },
]

export default function ResidentWindyMapCard({ barangay }) {
    const [activeLayer, setActiveLayer] = useState("wind")
    const [loadedSrc, setLoadedSrc] = useState(null)

    const lat = Number(barangay?.latitude) || SURIGAO_CITY.lat
    const lon = Number(barangay?.longitude) || SURIGAO_CITY.lon
    const locationName = barangay?.name ? `${barangay.name}, ${barangay.city}` : "Surigao City"

    const embedSrc = useMemo(() => {
        const params = new URLSearchParams({
            lat: String(lat),
            lon: String(lon),
            detailLat: String(lat),
            detailLon: String(lon),
            width: "650",
            height: "450",
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
    }, [activeLayer, lat, lon])

    const windyUrl = `https://www.windy.com/?${activeLayer},${lat},${lon},9`
    const loading = loadedSrc !== embedSrc

    return (
        <section style={styles.card} aria-labelledby="resident-windy-map-title">
            <div style={styles.header}>
                <div>
                    <h2 id="resident-windy-map-title" style={styles.title}>Windy Weather Map</h2>
                    <p style={styles.subtitle}>Live forecast layers centered on {locationName}</p>
                </div>
                <a href={windyUrl} target="_blank" rel="noopener noreferrer" style={styles.openLink}>
                    Open full map <ExternalLink size={13} />
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
                {loading && <div style={styles.loadingState}>Loading Windy weather map…</div>}
                <iframe
                    key={embedSrc}
                    src={embedSrc}
                    title={`Windy weather map for ${locationName}`}
                    loading="lazy"
                    allowFullScreen
                    onLoad={() => setLoadedSrc(embedSrc)}
                    style={styles.iframe}
                />
            </div>

            <p style={styles.note}>
                Windy model data is supplementary. Follow official PAGASA bulletins and local evacuation instructions.
            </p>
        </section>
    )
}

const styles = {
    card: {
        background: "#ffffff",
        border: "1px solid #dbeafe",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 12,
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
        fontFamily: "system-ui, sans-serif",
    },
    header: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 12,
    },
    title: { margin: 0, color: "#0f172a", fontSize: 16, lineHeight: 1.3 },
    subtitle: { margin: "3px 0 0", color: "#64748b", fontSize: 12 },
    openLink: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: "#1d4ed8",
        fontSize: 12,
        fontWeight: 700,
        textDecoration: "none",
    },
    layerRow: { display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 },
    layerButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 10px",
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
    },
    layerButtonActive: { color: "#ffffff", background: "#1d4ed8", border: "1px solid #1d4ed8" },
    layerButtonInactive: { color: "#334155", background: "#ffffff", border: "1px solid #cbd5e1" },
    mapWrap: {
        position: "relative",
        width: "100%",
        height: "clamp(360px, 50vw, 500px)",
        overflow: "hidden",
        border: "1px solid #dbeafe",
        borderRadius: 9,
        background: "#e2e8f0",
    },
    loadingState: {
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        zIndex: 1,
        color: "#475569",
        background: "#f8fafc",
        fontSize: 12,
    },
    iframe: { display: "block", width: "100%", height: "100%", border: 0 },
    note: { margin: "9px 0 0", color: "#64748b", fontSize: 11, lineHeight: 1.45 },
}
