/**
 * HazardBadge.jsx
 *
 * Displays a flood or landslide susceptibility level badge.
 *
 * Rules:
 *  - NEVER uses "safe" or "no risk" wording.
 *  - Null flood  → gray badge "No flood zone mapped"
 *  - Null landslide → gray badge "No landslide zone mapped"
 *  - low        → muted green
 *  - moderate   → yellow-amber
 *  - high       → orange
 *  - very_high  → red
 *
 * Props:
 *  - type: "flood" | "landslide"
 *  - level: "low"|"moderate"|"high"|"very_high"|null
 *  - size: "sm"|"md" (default "sm")
 */
import React from "react"

const LEVEL_CONFIG = {
    low: {
        label: "Low hazard",
        bg: "#dcfce7",
        border: "#86efac",
        color: "#166534",
        dot: "#16a34a",
    },
    moderate: {
        label: "Moderate hazard",
        bg: "#fef9c3",
        border: "#fde047",
        color: "#854d0e",
        dot: "#ca8a04",
    },
    high: {
        label: "High hazard",
        bg: "#ffedd5",
        border: "#fdba74",
        color: "#9a3412",
        dot: "#ea580c",
    },
    very_high: {
        label: "Very high hazard",
        bg: "#fee2e2",
        border: "#fca5a5",
        color: "#991b1b",
        dot: "#dc2626",
    },
}

const NULL_CONFIG_FLOOD = {
    label: "No flood zone mapped",
    bg: "#f3f4f6",
    border: "#d1d5db",
    color: "#6b7280",
    dot: "#9ca3af",
}

const NULL_CONFIG_LANDSLIDE = {
    label: "No landslide zone mapped",
    bg: "#f3f4f6",
    border: "#d1d5db",
    color: "#6b7280",
    dot: "#9ca3af",
}

const TYPE_LABEL = {
    flood: "Flood",
    landslide: "Landslide",
}

export function HazardBadge({ type = "flood", level = null, size = "sm" }) {
    const cfg = level
        ? (LEVEL_CONFIG[level] ?? NULL_CONFIG_FLOOD)
        : (type === "landslide" ? NULL_CONFIG_LANDSLIDE : NULL_CONFIG_FLOOD)

    const isSmall = size === "sm"
    const fontSize = isSmall ? 10 : 12
    const padding  = isSmall ? "2px 7px" : "3px 10px"
    const dotSize  = isSmall ? 6 : 8

    return (
        <span
            title={`${TYPE_LABEL[type] ?? type}: ${cfg.label}`}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: isSmall ? 4 : 5,
                background: cfg.bg,
                border: `1px solid ${cfg.border}`,
                borderRadius: 20,
                padding,
                fontSize,
                fontWeight: 600,
                color: cfg.color,
                whiteSpace: "nowrap",
                lineHeight: 1.4,
            }}
        >
            <span
                style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: "50%",
                    background: cfg.dot,
                    flexShrink: 0,
                }}
            />
            <span style={{ fontWeight: 500, color: cfg.color, fontSize: isSmall ? 9 : 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {TYPE_LABEL[type] ?? type}
            </span>
            <span style={{ fontWeight: 700 }}>{cfg.label}</span>
        </span>
    )
}

export default HazardBadge
