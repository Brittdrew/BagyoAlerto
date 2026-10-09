import { useState, useEffect } from "react"
import { AlertTriangle, MapPin, Route, Navigation } from "lucide-react"
import { useSavedBarangay } from "../hooks/useSavedBarangay"
import { useLiveLocation } from "../hooks/useLiveLocation"

const API_BASE = import.meta.env.VITE_API_BASE

/**
 * THRESHOLD CONFIGURATION:
 * Change this array to adjust which rule-based severity levels trigger the evacuation alert banner.
 * Supported values: "low", "moderate", "high", "critical", "catastrophic"
 */
export const EVACUATION_ALERT_THRESHOLDS = ["high", "critical", "catastrophic"]

// Color escalation schemes by severity level
const SEVERITY_STYLES = {
    high: {
        bg: "#EA580C", // Orange
        border: "#C2410C",
        text: "#FFFFFF",
        badgeBg: "rgba(0, 0, 0, 0.22)",
        btnBg: "#FFFFFF",
        btnText: "#C2410C",
        btnHover: "#FFF7ED",
        shadow: "0 4px 14px rgba(234, 88, 12, 0.35)",
        pulseColor: "rgba(255, 255, 255, 0.6)",
    },
    critical: {
        bg: "#DC2626", // Red
        border: "#991B1B",
        text: "#FFFFFF",
        badgeBg: "rgba(0, 0, 0, 0.22)",
        btnBg: "#FFFFFF",
        btnText: "#991B1B",
        btnHover: "#FEF2F2",
        shadow: "0 4px 14px rgba(220, 38, 38, 0.4)",
        pulseColor: "rgba(255, 255, 255, 0.7)",
    },
    catastrophic: {
        bg: "#7F1D1D", // Dark Red
        border: "#450A0A",
        text: "#FFFFFF",
        badgeBg: "rgba(0, 0, 0, 0.35)",
        btnBg: "#FFFFFF",
        btnText: "#7F1D1D",
        btnHover: "#FEF2F2",
        shadow: "0 4px 16px rgba(127, 29, 29, 0.55)",
        pulseColor: "rgba(255, 255, 255, 0.8)",
    },
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
        return null
    }
    const R = 6371 // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180)
    const dLon = (lon2 - lon1) * (Math.PI / 180)
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const d = R * c
    return d > 0 ? d.toFixed(1) : "0.1"
}

/**
 * EvacuationAlertBanner
 *
 * @param {object} props
 * @param {string|number|null} [props.barangayId] - Saved barangay ID (falls back to useSavedBarangay)
 * @param {object|null} [props.selectedBarangay] - Full barangay object ({ id, name, city, latitude, longitude })
 * @param {string|null} [props.severity] - Rule-based severity level ('low'|'moderate'|'high'|'critical'|'catastrophic')
 * @param {function} [props.onShowRoute] - Callback when clicking "Show route"
 */
export default function EvacuationAlertBanner({
    barangayId: propBarangayId,
    selectedBarangay,
    severity,
    onShowRoute,
}) {
    const { barangayId: storedBarangayId } = useSavedBarangay()
    const activeBarangayId = propBarangayId ?? storedBarangayId ?? selectedBarangay?.value ?? selectedBarangay?.id ?? null

    const { position } = useLiveLocation(Boolean(activeBarangayId))
    const [targetCenter, setTargetCenter] = useState(null)
    const [btnHovered, setBtnHovered] = useState(false)

    // Requirement: Fetch designated evacuation center via GET /api/barangays/{id}/evacuation-target
    useEffect(() => {
        if (!activeBarangayId) {
            setTargetCenter(null)
            return
        }

        let isMounted = true
        fetch(`${API_BASE}/barangays/${activeBarangayId}/evacuation-target`)
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                if (isMounted) {
                    setTargetCenter(data)
                }
            })
            .catch((err) => {
                console.warn("[EvacuationAlertBanner] Could not fetch evacuation target:", err.message)
            })

        return () => {
            isMounted = false
        }
    }, [activeBarangayId])

    // Requirement 5: If no barangay is saved yet, show "Select your barangay" prompt instead of failing
    if (!activeBarangayId) {
        return (
            <div
                className="bakwit-evacuation-alert-banner"
                role="status"
                style={{
                    background: "#FFF8E1",
                    border: "1.5px solid #FFE082",
                    borderRadius: 10,
                    padding: "14px 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 16,
                    boxShadow: "0 2px 8px rgba(245, 127, 23, 0.08)",
                    boxSizing: "border-box",
                    width: "100%",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <MapPin size={22} style={{ color: "#F57F17", flexShrink: 0 }} />
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#E65100" }}>
                            Select your barangay
                        </div>
                        <div style={{ fontSize: 12, color: "#8D6E63", marginTop: 2 }}>
                            Please select your barangay to check typhoon severity and active evacuation alerts.
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    const normalizedSeverity = (severity || "").toLowerCase().trim()
    const isOverThreshold = EVACUATION_ALERT_THRESHOLDS.includes(normalizedSeverity)

    // Requirement 1: Shown only when severity is high, critical, or catastrophic
    if (!isOverThreshold) {
        return null
    }

    const styleCfg = SEVERITY_STYLES[normalizedSeverity] || SEVERITY_STYLES.critical
    const barangayName = selectedBarangay?.name || (targetCenter?.barangay_id ? `Barangay #${activeBarangayId}` : "your barangay")
    const centerName = targetCenter?.name || "the nearest evacuation center"

    // Requirement 2: Use live location for distance if available, otherwise omit the distance
    const hasLiveGps = position && Number.isFinite(position.lat) && Number.isFinite(position.lng)
    const distanceKm = hasLiveGps && targetCenter?.latitude && targetCenter?.longitude
        ? calculateDistanceKm(position.lat, position.lng, Number(targetCenter.latitude), Number(targetCenter.longitude))
        : null

    // Requirement 3: "Show route" button opens existing GPS routing to that center
    const handleShowRouteClick = () => {
        if (typeof onShowRoute === "function") {
            onShowRoute(targetCenter)
            return
        }

        // Smooth scroll to the existing MapView on the resident page
        const mapSection =
            document.getElementById("evacuation-map-section-mobile") ||
            document.getElementById("evacuation-map-section") ||
            document.querySelector(".bakwit-map-wrap")

        if (mapSection) {
            mapSection.scrollIntoView({ behavior: "smooth", block: "start" })
            mapSection.style.transition = "box-shadow 0.3s ease"
            mapSection.style.boxShadow = `0 0 0 4px ${styleCfg.bg}`
            setTimeout(() => {
                mapSection.style.boxShadow = ""
            }, 2500)
        }
    }

    return (
        <aside
            className="bakwit-evacuation-alert-banner"
            role="alert"
            aria-live="assertive"
            style={{
                background: styleCfg.bg,
                border: `2px solid ${styleCfg.border}`,
                borderRadius: 10,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 14,
                marginBottom: 16,
                boxShadow: styleCfg.shadow,
                boxSizing: "border-box",
                width: "100%",
                color: styleCfg.text,
            }}
        >
            <style>{`
                @keyframes evacAlertPulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.12); opacity: 0.85; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `}</style>

            <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "1 1 320px" }}>
                {/* Pulsing emergency icon */}
                <div
                    style={{
                        background: styleCfg.badgeBg,
                        borderRadius: "50%",
                        width: 42,
                        height: 42,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    <AlertTriangle
                        size={22}
                        style={{
                            color: "#FFFFFF",
                            animation: "evacAlertPulse 1.8s ease-in-out infinite",
                        }}
                    />
                </div>

                {/* Banner Text (Requirement 2) */}
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span
                            style={{
                                fontSize: 10,
                                fontWeight: 800,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                background: styleCfg.badgeBg,
                                padding: "2px 8px",
                                borderRadius: 12,
                                border: "1px solid rgba(255,255,255,0.3)",
                            }}
                        >
                            EVACUATION ALERT · {normalizedSeverity.toUpperCase()}
                        </span>
                    </div>

                    <div
                        style={{
                            fontSize: 14,
                            fontWeight: 700,
                            lineHeight: 1.4,
                            marginTop: 4,
                            color: "#FFFFFF",
                        }}
                    >
                        Severity is {normalizedSeverity.toUpperCase()} in {barangayName}. Evacuate now to {centerName}
                        {distanceKm ? `, ${distanceKm} km away.` : "."}
                    </div>
                </div>
            </div>

            {/* Requirement 3: "Show route" button */}
            <div style={{ flexShrink: 0 }}>
                <button
                    type="button"
                    onClick={handleShowRouteClick}
                    onMouseEnter={() => setBtnHovered(true)}
                    onMouseLeave={() => setBtnHovered(false)}
                    style={{
                        background: btnHovered ? styleCfg.btnHover : styleCfg.btnBg,
                        color: styleCfg.btnText,
                        border: "none",
                        borderRadius: 8,
                        padding: "10px 18px",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                        transition: "all 0.15s ease",
                        transform: btnHovered ? "translateY(-1px)" : "none",
                    }}
                >
                    <Route size={16} />
                    Show route
                </button>
            </div>
            {/* Note: Banner is not dismissible while severity is at or above threshold */}
        </aside>
    )
}
