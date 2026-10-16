import { useState } from "react"
import { CheckCircle2, Users } from "lucide-react"
import { useSelfArrival } from "../hooks/useSelfArrival"

// ---------------------------------------------------------------------------
// Headcount stepper prompt (modal overlay)
// ---------------------------------------------------------------------------

function SelfArrivalPrompt({ centerName, onConfirm, onSkip }) {
    const [headcount, setHeadcount] = useState(1)
    const [submitting, setSubmitting] = useState(false)

    const handleConfirm = async () => {
        setSubmitting(true)
        await onConfirm(headcount)
        setSubmitting(false)
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Record your arrival"
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                padding: 16,
            }}
        >
            <div
                style={{
                    background: "#fff",
                    borderRadius: 16,
                    padding: "28px 24px",
                    maxWidth: 340,
                    width: "100%",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                    textAlign: "center",
                }}
            >
                {/* Icon */}
                <div
                    style={{
                        width: 52,
                        height: 52,
                        borderRadius: "50%",
                        background: "#e1f5ee",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 16px",
                    }}
                >
                    <Users size={26} style={{ color: "#10B981" }} />
                </div>

                <div
                    style={{
                        fontSize: 17,
                        fontWeight: 800,
                        color: "#0f172a",
                        marginBottom: 6,
                    }}
                >
                    You've arrived at {centerName}!
                </div>
                <div
                    style={{
                        fontSize: 13,
                        color: "#64748b",
                        marginBottom: 20,
                        lineHeight: 1.5,
                    }}
                >
                    How many people are with you?&nbsp;
                    <span style={{ color: "#94a3b8" }}>(including yourself, max 10)</span>
                </div>

                {/* Stepper */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 16,
                        marginBottom: 24,
                    }}
                >
                    <button
                        id="self-arrival-decrement"
                        type="button"
                        onClick={() => setHeadcount((h) => Math.max(1, h - 1))}
                        disabled={headcount <= 1}
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            border: "1px solid #cbd5e1",
                            background: headcount <= 1 ? "#f1f5f9" : "#fff",
                            fontSize: 20,
                            fontWeight: 700,
                            cursor: headcount <= 1 ? "not-allowed" : "pointer",
                            color: headcount <= 1 ? "#94a3b8" : "#1e293b",
                            lineHeight: 1,
                        }}
                        aria-label="Decrease headcount"
                    >
                        −
                    </button>

                    <span
                        style={{
                            fontSize: 32,
                            fontWeight: 800,
                            color: "#0f172a",
                            minWidth: 40,
                            textAlign: "center",
                        }}
                    >
                        {headcount}
                    </span>

                    <button
                        id="self-arrival-increment"
                        type="button"
                        onClick={() => setHeadcount((h) => Math.min(10, h + 1))}
                        disabled={headcount >= 10}
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            border: "1px solid #cbd5e1",
                            background: headcount >= 10 ? "#f1f5f9" : "#fff",
                            fontSize: 20,
                            fontWeight: 700,
                            cursor: headcount >= 10 ? "not-allowed" : "pointer",
                            color: headcount >= 10 ? "#94a3b8" : "#1e293b",
                            lineHeight: 1,
                        }}
                        aria-label="Increase headcount"
                    >
                        +
                    </button>
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", gap: 10 }}>
                    <button
                        id="self-arrival-skip"
                        type="button"
                        onClick={onSkip}
                        disabled={submitting}
                        style={{
                            flex: 1,
                            padding: "11px 0",
                            borderRadius: 8,
                            border: "1px solid #cbd5e1",
                            background: "#f8fafc",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#64748b",
                            cursor: "pointer",
                        }}
                    >
                        Skip
                    </button>
                    <button
                        id="self-arrival-confirm"
                        type="button"
                        onClick={handleConfirm}
                        disabled={submitting}
                        style={{
                            flex: 2,
                            padding: "11px 0",
                            borderRadius: 8,
                            border: "none",
                            background: submitting ? "#a7f3d0" : "#10B981",
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#fff",
                            cursor: submitting ? "not-allowed" : "pointer",
                            transition: "background 0.15s ease",
                        }}
                    >
                        {submitting ? "Recording…" : "Record arrival"}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Success banner
// ---------------------------------------------------------------------------

function ArrivalSuccessBanner({ centerName, onClose }) {
    return (
        <div
            role="status"
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: "#e1f5ee",
                border: "1.5px solid #6ee7b7",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 12,
                boxShadow: "0 2px 8px rgba(16,185,129,0.12)",
                boxSizing: "border-box",
                width: "100%",
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <CheckCircle2 size={20} style={{ color: "#10B981", flexShrink: 0 }} />
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#065f46" }}>
                        Your arrival at {centerName} was recorded.
                    </div>
                    <div style={{ fontSize: 11, color: "#047857", marginTop: 2 }}>
                        Thank you for helping us track evacuation center occupancy.
                    </div>
                </div>
            </div>
            <button
                type="button"
                onClick={onClose}
                aria-label="Dismiss arrival notification"
                style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#6ee7b7",
                    fontSize: 20,
                    lineHeight: 1,
                    padding: "2px 4px",
                    flexShrink: 0,
                }}
            >
                ×
            </button>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Main exported component — mount once in the Dashboard near the map section
// ---------------------------------------------------------------------------

/**
 * SelfArrivalController
 *
 * Mounts near the MapView in the Dashboard. Runs independently of severity
 * and the EvacuationAlertBanner. Triggers the self-arrival prompt whenever:
 *   - `routingActive` is true (GPS navigation to a center is in progress)
 *   - the device comes within 50 m of the designated evacuation center
 *   - the center has not already been reported this session / persistently
 *
 * @param {{ barangayId: string|number|null, routingActive: boolean }} props
 */
export default function SelfArrivalController({ barangayId, routingActive }) {
    const {
        showPrompt,
        centerName,
        onConfirm,
        onSkip,
        successMsg,
        clearSuccess,
    } = useSelfArrival({ barangayId, enabled: Boolean(routingActive) })

    return (
        <>
            {showPrompt && (
                <SelfArrivalPrompt
                    centerName={centerName}
                    onConfirm={onConfirm}
                    onSkip={onSkip}
                />
            )}
            {successMsg && (
                <ArrivalSuccessBanner
                    centerName={successMsg}
                    onClose={clearSuccess}
                />
            )}
        </>
    )
}
