/**
 * HazardCenterPanel.jsx
 *
 * Shows hazard badges (Flood + Landslide) for a routed evacuation center,
 * a data-source note, an amber/red warning when the center is in a high/very_high
 * susceptibility area, and a lower-hazard suggestion card when one qualifies.
 *
 * Props:
 *  - center: the routed evacuation center object (with flood_susceptibility,
 *            landslide_susceptibility, hazard_level, name, etc.)
 *  - lowerHazardSuggestion: candidate object from useNearestCenter (or null)
 *  - isOverrideActive: boolean — true when user has overridden the nearest center
 *  - onRouteHere: (id) => void — called when "Route here instead" is clicked
 *  - onBackToNearest: () => void — called when "Back to nearest center" is clicked
 *  - travelMode: "foot" | "car"
 */
import React from "react"
import { HazardBadge } from "./HazardBadge"
import { AlertTriangle, ArrowLeft, Navigation } from "lucide-react"

const HAZARD_RANK = { low: 1, moderate: 2, high: 3, very_high: 4 }

/**
 * Which hazards are at or above "high" for the given center.
 * Returns an array like ["flood"], ["landslide"], or ["flood", "landslide"].
 */
function highHazards(center) {
    const result = []
    if (HAZARD_RANK[center?.flood_susceptibility] >= HAZARD_RANK["high"]) result.push("flood")
    if (HAZARD_RANK[center?.landslide_susceptibility] >= HAZARD_RANK["high"]) result.push("landslide")
    return result
}

function hazardLabel(list) {
    if (list.length === 0) return ""
    if (list.length === 2) return "flood and landslide"
    return list[0]
}

function levelWord(level) {
    return level === "very_high" ? "very high" : level
}

function suggestLevelWord(level) {
    if (!level) return "lower"
    const labels = { low: "Low", moderate: "Moderate", high: "High", very_high: "Very high" }
    return labels[level] ?? level
}

function deltaMinutes(suggestion) {
    if (!suggestion || !Number.isFinite(suggestion.duration)) return null
    // duration is in seconds; we don't know routed center's duration here
    // The hook already checked the 10-min constraint. Just show +N min if available.
    return null // We'll compute in panel
}

export default function HazardCenterPanel({
    center,
    lowerHazardSuggestion,
    isOverrideActive,
    onRouteHere,
    onBackToNearest,
    travelMode = "foot",
}) {
    if (!center) return null

    const highs = highHazards(center)
    const hasWarning = highs.length > 0
    const isCritical = highs.some(
        (h) => HAZARD_RANK[center[h === "flood" ? "flood_susceptibility" : "landslide_susceptibility"]] === HAZARD_RANK["very_high"]
    )
    const worstLevel = highs.length > 0
        ? (highs.reduce((acc, h) => {
            const lvl = center[h === "flood" ? "flood_susceptibility" : "landslide_susceptibility"]
            return (HAZARD_RANK[lvl] ?? 0) > (HAZARD_RANK[acc] ?? 0) ? lvl : acc
        }, "high"))
        : null

    // Suggestion extra minutes — both center and suggestion have .duration (seconds)
    const suggestionExtraMin = lowerHazardSuggestion && Number.isFinite(lowerHazardSuggestion.duration) && Number.isFinite(center.duration)
        ? Math.round((lowerHazardSuggestion.duration - center.duration) / 60)
        : null

    return (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Flood + Landslide badges row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <HazardBadge type="flood" level={center.flood_susceptibility} />
                <HazardBadge type="landslide" level={center.landslide_susceptibility} />
            </div>

            {/* Data-source note */}
            <div style={{
                fontSize: 10,
                color: "#78716c",
                fontStyle: "italic",
                lineHeight: 1.4,
            }}>
                Based on MGB susceptibility maps, not live flooding.
            </div>

            {/* Warning notice for high / very_high */}
            {hasWarning && (
                <div
                    role="alert"
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        background: isCritical ? "#fef2f2" : "#fffbeb",
                        border: `1px solid ${isCritical ? "#fca5a5" : "#fde68a"}`,
                        borderRadius: 8,
                        padding: "8px 10px",
                        fontSize: 11,
                        color: isCritical ? "#7f1d1d" : "#78350f",
                        lineHeight: 1.45,
                    }}
                >
                    <AlertTriangle
                        size={13}
                        style={{ color: isCritical ? "#dc2626" : "#d97706", flexShrink: 0, marginTop: 1 }}
                    />
                    <span>
                        <strong>
                            This center is in a mapped {levelWord(worstLevel)}{" "}
                            {hazardLabel(highs)} susceptibility area.
                        </strong>{" "}
                        Follow barangay and DRRMO instructions and avoid flooded or blocked roads.
                    </span>
                </div>
            )}

            {/* Lower-hazard suggestion */}
            {hasWarning && lowerHazardSuggestion && !isOverrideActive && (
                <div style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 8,
                    padding: "8px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                }}>
                    <div style={{ fontSize: 11, color: "#14532d", lineHeight: 1.4 }}>
                        <strong>Lower-hazard option:</strong>{" "}
                        {lowerHazardSuggestion.name}{" "}
                        <span style={{
                            display: "inline-block",
                            background: "#dcfce7",
                            border: "1px solid #86efac",
                            borderRadius: 10,
                            padding: "1px 6px",
                            fontSize: 10,
                            fontWeight: 600,
                            color: "#166534",
                        }}>
                            {suggestLevelWord(lowerHazardSuggestion.hazard_level)} hazard
                        </span>
                        {suggestionExtraMin != null && suggestionExtraMin > 0 && (
                            <span style={{ color: "#15803d", fontWeight: 600 }}>
                                {" "}about +{suggestionExtraMin} min
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        id="hazard-route-here-btn"
                        onClick={() => onRouteHere?.(lowerHazardSuggestion.id)}
                        style={{
                            alignSelf: "flex-start",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            background: "#16a34a",
                            color: "#fff",
                            border: "none",
                            borderRadius: 6,
                            padding: "5px 11px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                        }}
                    >
                        <Navigation size={11} />
                        Route here instead
                    </button>
                </div>
            )}

            {/* Back to nearest center button (shown when override is active) */}
            {isOverrideActive && (
                <button
                    type="button"
                    id="hazard-back-to-nearest-btn"
                    onClick={() => onBackToNearest?.()}
                    style={{
                        alignSelf: "flex-start",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "#f1f5f9",
                        color: "#334155",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: "5px 11px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                    }}
                >
                    <ArrowLeft size={11} />
                    Back to nearest center
                </button>
            )}
        </div>
    )
}
