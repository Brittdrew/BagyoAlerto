import { useEffect, useMemo, useState } from "react"
import { Wind, CloudRain, Thermometer, Cloud, Waves, AlertTriangle } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"

const CENTER = {
    lat: 9.7843,
    lon: 125.4887,
}

const LAYERS = [
    { id: "wind", label: "Wind", icon: Wind },
    { id: "rain", label: "Rain", icon: CloudRain },
    { id: "temp", label: "Temperature", icon: Thermometer },
    { id: "clouds", label: "Clouds", icon: Cloud },
    { id: "waves", label: "Waves", icon: Waves },
]

export default function AdminWeatherMap() {
    const [activeLayer, setActiveLayer] = useState("wind")
    const [iframeSrc, setIframeSrc] = useState("")
    const [isLoading, setIsLoading] = useState(true)

    const embedSrc = useMemo(() => {
        const params = new URLSearchParams({
            lat: String(CENTER.lat),
            lon: String(CENTER.lon),
            detailLat: String(CENTER.lat),
            detailLon: String(CENTER.lon),
            width: "100%",
            height: "500",
            zoom: "9",
            level: "surface",
            overlay: activeLayer,
            product: "ecmwf",
            menu: "",
            message: "true",
            marker: "true",
            forecast: "12",
            hourslider: "",
            calendar: "now",
            type: "map",
            location: "coordinates",
        })
        return `https://embed.windy.com/embed2.html?${params.toString()}`
    }, [activeLayer])

    useEffect(() => {
        setIsLoading(true)
        setIframeSrc(embedSrc)
    }, [embedSrc])

    return (
        <AdminLayout>
            <div style={styles.pageShell}>
                <section style={styles.hero}>
                    <div style={styles.heroTitle}>🗺️ Live Weather Map</div>
                    <div style={styles.heroSubtitle}>Real-time typhoon and weather tracking — Surigao City, Surigao del Norte</div>
                    <div style={styles.liveBadge}>● LIVE</div>
                </section>

                <div style={styles.layerRow}>
                    {LAYERS.map(({ id, label, icon: Icon }) => {
                        const active = activeLayer === id
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setActiveLayer(id)}
                                style={{
                                    ...styles.layerButton,
                                    background: active ? "#1a237e" : "#fff",
                                    color: active ? "#fff" : "#1a237e",
                                    border: active ? "1px solid #1a237e" : "1px solid #d7dced",
                                }}
                            >
                                <Icon size={14} />
                                <span>{label}</span>
                            </button>
                        )
                    })}
                </div>

                <section style={styles.mapCard}>
                    {isLoading && <div style={styles.loadingState}>⏳ Loading live weather map...</div>}
                    <iframe
                        key={activeLayer}
                        title="Live Weather Map - Windy"
                        src={iframeSrc}
                        style={styles.iframe}
                        onLoad={() => setIsLoading(false)}
                    />
                </section>

                <section style={styles.infoCard}>
                    <div style={styles.infoItem}>📍 Location: Surigao City, Surigao del Norte (9.7843°N, 125.4887°E)</div>
                    <div style={styles.infoItem}>🌊 Coverage: Philippine Sea and Mindanao region</div>
                    <div style={styles.infoItem}>⚡ Data source: ECMWF via Windy.com — updates every 6 hours</div>
                </section>

                <section style={styles.noteCard}>
                    <div style={styles.noteHeader}>
                        <AlertTriangle size={16} />
                        <span style={styles.noteTitle}>Typhoon advisory</span>
                    </div>
                    <div style={styles.noteText}>
                        This map shows live atmospheric data from ECMWF model. For official typhoon warnings, always refer to PAGASA advisories. Use this map as a supplementary reference for monitoring weather patterns affecting Surigao City.
                    </div>
                </section>
            </div>
        </AdminLayout>
    )
}

const styles = {
    pageShell: {
        display: "grid",
        gap: 16,
    },
    hero: {
        borderRadius: 16,
        background: "linear-gradient(135deg, #1a237e, #1565c0)",
        color: "#fff",
        padding: "24px 22px",
        boxShadow: "0 8px 20px rgba(26,35,126,0.2)",
    },
    heroTitle: {
        fontSize: 26,
        fontWeight: 700,
    },
    heroSubtitle: {
        marginTop: 8,
        fontSize: 14,
        color: "rgba(255,255,255,0.9)",
    },
    liveBadge: {
        marginTop: 12,
        display: "inline-flex",
        alignItems: "center",
        fontSize: 12,
        fontWeight: 700,
        color: "#00e676",
        background: "rgba(0,230,118,0.14)",
        border: "1px solid rgba(0,230,118,0.35)",
        borderRadius: 999,
        padding: "6px 10px",
    },
    layerRow: {
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
    },
    layerButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
    },
    mapCard: {
        position: "relative",
        background: "#fff",
        borderRadius: 16,
        boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
        border: "1px solid #e4e8f2",
        overflow: "hidden",
        minHeight: 520,
    },
    loadingState: {
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        fontSize: 14,
        color: "#667085",
        background: "#fff",
        zIndex: 1,
    },
    iframe: {
        width: "100%",
        height: 520,
        border: "none",
        display: "block",
    },
    infoCard: {
        background: "#fff",
        borderRadius: 14,
        border: "1px solid #e4e8f2",
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 10,
        padding: 14,
    },
    infoItem: {
        fontSize: 12,
        color: "#1f2937",
        lineHeight: 1.5,
    },
    noteCard: {
        background: "#fff8e6",
        border: "1px solid #f4d88b",
        borderRadius: 14,
        padding: "14px 16px",
    },
    noteHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#8a5b00",
    },
    noteTitle: {
        fontSize: 14,
        fontWeight: 700,
    },
    noteText: {
        marginTop: 8,
        fontSize: 12,
        color: "#7a5600",
        lineHeight: 1.6,
    },
}
