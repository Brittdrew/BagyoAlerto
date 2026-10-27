import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

// MGB swatch colors (match the WMS overlay palette)
const FLOOD_ROWS = [
    {
        color: "#0b1f6b",
        label: "Very high",
        desc: "Areas likely to experience flood heights of greater than 2 meters and/or flood duration of more than 3 days. Immediately flooded during heavy rains of several hours; include topographic lows such as active and abandoned river channels and areas along river banks; also prone to flashfloods.",
    },
    {
        color: "#5b00ff",
        label: "High",
        desc: "Areas likely to experience flood heights of greater than 1 up to 2 meters and/or flood duration of more than 3 days. Immediately flooded during heavy rains of several hours; include topographic lows such as river channels and river banks; also prone to flashfloods.",
    },
    {
        color: "#b04bff",
        label: "Moderate",
        desc: "Areas likely to experience flood heights of greater than 0.5 m up to 1 meter and/or flood duration of 1 to 3 days. Subject to widespread inundation during prolonged and extensive heavy rainfall or extreme weather. Fluvial terraces, alluvial fans, and infilled valleys are moderately subjected to flooding.",
    },
    {
        color: "#e3d4ff",
        label: "Low",
        desc: "Areas likely to experience flood heights of 0.5 meter or less and/or flood duration of less than 1 day. Include low hills and gentle slopes; sparse to moderate drainage density.",
    },
]

const LANDSLIDE_ROWS = [
    {
        color: "#8b2a0f",
        label: "Very high",
        desc: "Areas usually with steep to very steep slopes and underlain by weak materials. Recent landslides, escarpments and tension cracks are present. Human-initiated effects could be an aggravating factor.",
    },
    {
        color: "#ff0000",
        label: "High",
        desc: "Areas usually with steep to very steep slopes and underlain by weak materials. Areas with numerous old/inactive landslides.",
    },
    {
        color: "#1e8c1e",
        label: "Moderate",
        desc: "Areas with moderately steep slopes. Soil creep and other indications of possible landslide occurrence are present.",
    },
    {
        color: "#ffff00",
        label: "Low",
        desc: "Gently sloping areas with no identified landslide.",
    },
    {
        hatched: true,
        label: "Debris flow / possible accumulation zone",
        desc: "Areas that could be affected by landslide debris.",
    },
]

function Swatch({ color, hatched }) {
    const base = {
        width: 24,
        height: 24,
        borderRadius: 4,
        flexShrink: 0,
        border: "1.5px solid rgba(0,0,0,0.18)",
        boxSizing: "border-box",
    }
    if (hatched) {
        return (
            <div style={{
                ...base,
                background: "repeating-linear-gradient(45deg, #000 0px, #000 2px, #fff 2px, #fff 8px)",
            }} />
        )
    }
    return <div style={{ ...base, background: color }} />
}

function LegendRows({ rows }) {
    return (
        <div style={{ display: "grid", gap: 10 }}>
            {rows.map((row) => (
                <div key={row.label} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <Swatch color={row.color} hatched={row.hatched} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={LS.rowLabel}>{row.label}</div>
                        <div style={LS.rowDesc}>{row.desc}</div>
                    </div>
                </div>
            ))}
        </div>
    )
}

function LegendCard({ title, rows }) {
    const [open, setOpen] = useState(true)
    return (
        <div style={LS.card}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                style={LS.cardHeader}
                aria-expanded={open}
            >
                <span style={LS.cardTitle}>{title}</span>
                {open
                    ? <ChevronUp size={16} style={{ flexShrink: 0, color: "#64748b" }} />
                    : <ChevronDown size={16} style={{ flexShrink: 0, color: "#64748b" }} />
                }
            </button>
            {open && (
                <div style={LS.cardBody}>
                    <LegendRows rows={rows} />
                </div>
            )}
        </div>
    )
}

export default function HazardLegendDetailed() {
    return (
        <section style={LS.wrap}>
            <div style={LS.cards}>
                <LegendCard title="Flood Susceptibility" rows={FLOOD_ROWS} />
                <LegendCard title="Landslide Susceptibility" rows={LANDSLIDE_ROWS} />
            </div>
            <div style={LS.footer}>
                Source: MGB via GeoRisk. Class colors match the map overlay.
            </div>
        </section>
    )
}

const LS = {
    wrap: {
        display: "grid",
        gap: 10,
    },
    cards: {
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "flex-start",
    },
    card: {
        flex: "1 1 380px",
        background: "#fff",
        borderRadius: 14,
        border: "1px solid #e4e8f2",
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        overflow: "hidden",
    },
    cardHeader: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        background: "#f8fafc",
        border: "none",
        borderBottom: "1px solid #e4e8f2",
        cursor: "pointer",
        gap: 8,
        textAlign: "left",
    },
    cardTitle: {
        fontWeight: 700,
        fontSize: 13,
        color: "#1a237e",
        letterSpacing: "0.01em",
        textTransform: "uppercase",
    },
    cardBody: {
        padding: "14px 16px",
    },
    rowLabel: {
        fontWeight: 700,
        fontSize: 12,
        color: "#1e293b",
        marginBottom: 2,
    },
    rowDesc: {
        fontSize: 12,
        color: "#475569",
        lineHeight: 1.55,
    },
    footer: {
        fontSize: 11,
        color: "#94a3b8",
        fontStyle: "italic",
        textAlign: "center",
        paddingBottom: 4,
    },
}
