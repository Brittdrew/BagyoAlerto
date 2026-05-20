import { useState } from "react"
import { Map, MapPin, School, Users, ChevronUp, ChevronDown } from "lucide-react"

export default function MapView({ evacuationCenter }) {
    const [isExpanded, setIsExpanded] = useState(false)

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_KEY

    const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${evacuationCenter.latitude},${evacuationCenter.longitude}&zoom=16`

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h3 style={{ ...styles.title, display: "flex", alignItems: "center", gap: 6 }}>
                    <Map size={18} /> Evacuation Center Location
                </h3>
                <p style={{ ...styles.sub, display: "flex", alignItems: "center", gap: 4 }}>
                    <MapPin size={13} style={{ color: "#888" }} /> {evacuationCenter.address}
                </p>
            </div>

            <iframe
                title="Evacuation Center Map"
                src={embedUrl}
                style={{
                    ...styles.map,
                    height: isExpanded ? "600px" : "400px"
                }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
            />

            <div style={styles.details}>
                <div style={styles.detailItem}>
                    <School size={15} style={{ color: "#666" }} />
                    <span>{evacuationCenter.name}</span>
                </div>
                <div style={styles.detailItem}>
                    <MapPin size={15} style={{ color: "#666" }} />
                    <span>{evacuationCenter.address}</span>
                </div>
                {evacuationCenter.distance !== undefined && evacuationCenter.distance !== null && (
                    <div style={styles.detailItem}>
                        <span style={{ fontSize: 15 }}>📍</span>
                        <span>Distance: {parseFloat(evacuationCenter.distance).toFixed(1)} km away</span>
                    </div>
                )}
                <div style={styles.detailItem}>
                    <Users size={15} style={{ color: "#666" }} />
                    <span>Capacity: {evacuationCenter.capacity} persons</span>
                </div>
            </div>

            <button
                style={{ ...styles.expandButton, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {isExpanded ? (
                    <>
                        <ChevronUp size={14} /> Collapse Map
                    </>
                ) : (
                    <>
                        <ChevronDown size={14} /> Expand Map
                    </>
                )}
            </button>
        </div>
    )
}

const styles = {
    container: {
        background: "white",
        borderRadius: "16px",
        padding: "20px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        marginTop: "16px",
    },
    header: {
        marginBottom: "16px",
    },
    title: {
        fontSize: "1.1rem",
        fontWeight: "bold",
        color: "#1a237e",
        marginBottom: "4px",
    },
    sub: {
        fontSize: "0.9rem",
        color: "#555",
        marginBottom: "12px",
    },
    map: {
        width: "100%",
        borderRadius: "12px",
        border: "none",
        transition: "height 0.3s ease",
    },
    details: {
        marginTop: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        color: "#555",
        fontSize: "0.95rem",
        padding: "12px",
        background: "#f8f9fa",
        borderRadius: "10px",
    },
    detailItem: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    expandButton: {
        marginTop: "12px",
        padding: "8px 16px",
        background: "#f0f4f8",
        border: "1px solid #ddd",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "0.85rem",
        color: "#555",
        width: "100%",
    }
}