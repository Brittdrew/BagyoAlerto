import { useState, useEffect, useCallback } from "react"
import axios from "axios"
import { AlertTriangle, CheckCircle, Clock, Radio, RefreshCw, ShieldAlert, X } from "lucide-react"
import { useAdminAuth } from "../context/AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE

const SIGNAL_META = {
    0: { label: "No signal", floor: "None", color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1" },
    1: { label: "Signal 1", floor: "High", color: "#d97706", bg: "#fef3c7", border: "#fde68a" },
    2: { label: "Signal 2", floor: "High", color: "#d97706", bg: "#fef3c7", border: "#fde68a" },
    3: { label: "Signal 3", floor: "Critical", color: "#dc2626", bg: "#fee2e2", border: "#fca5a5" },
    4: { label: "Signal 4", floor: "Catastrophic", color: "#7f1d1d", bg: "#fee2e2", border: "#f87171" },
    5: { label: "Signal 5", floor: "Catastrophic", color: "#7f1d1d", bg: "#fee2e2", border: "#f87171" },
}

function formatSetAt(dateString) {
    if (!dateString) {
        return { formatted: "Never set", relative: "Default: no signal", isStale: false, diffHours: 0 }
    }
    const date = new Date(dateString)
    if (isNaN(date.getTime())) {
        return { formatted: "Unknown", relative: "", isStale: false, diffHours: 0 }
    }

    const formatted = date.toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    })

    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

    let relative = ""
    if (diffMins < 1) relative = "Just now"
    else if (diffMins < 60) relative = `${diffMins} min${diffMins > 1 ? "s" : ""} ago`
    else if (diffHours < 24) relative = `${diffHours} hr${diffHours > 1 ? "s" : ""} ago`
    else {
        const days = Math.floor(diffHours / 24)
        relative = `${days} day${days > 1 ? "s" : ""} ago`
    }

    const isStale = diffHours >= 6

    return { formatted, relative, isStale, diffHours }
}

export default function PagasaSignalCard({ onSignalChange }) {
    const { authHeaders } = useAdminAuth()
    const [currentSignal, setCurrentSignal] = useState(0)
    const [setAt, setSetAt] = useState(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [successMsg, setSuccessMsg] = useState(null)

    // Confirm step state: null or { signal: number }
    const [confirmTarget, setConfirmTarget] = useState(null)

    const fetchCurrentSignal = useCallback(async () => {
        try {
            setLoading(true)
            const res = await axios.get(`${API_BASE}/pagasa-signal`)
            setCurrentSignal(Number(res.data.signal) || 0)
            setSetAt(res.data.set_at || null)
            setError(null)
        } catch (err) {
            console.error("Failed to fetch PAGASA signal:", err)
            setError("Could not load current PAGASA signal.")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchCurrentSignal()
    }, [fetchCurrentSignal])

    const handleSelectSignal = (sig) => {
        setError(null)
        setSuccessMsg(null)
        setConfirmTarget(sig)
    }

    const handleConfirm = async () => {
        if (confirmTarget === null) return
        setSaving(true)
        setError(null)
        setSuccessMsg(null)

        try {
            const res = await axios.post(
                `${API_BASE}/admin/pagasa-signal`,
                { signal: confirmTarget },
                { headers: authHeaders() }
            )
            const newSig = Number(res.data.signal)
            setCurrentSignal(newSig)
            setSetAt(res.data.set_at)
            setConfirmTarget(null)
            const msg = newSig === 0
                ? "PAGASA signal cleared. Severity floor removed."
                : `PAGASA Signal ${newSig} set for Surigao City (Floor: ${SIGNAL_META[newSig]?.floor}).`
            setSuccessMsg(msg)
            if (onSignalChange) onSignalChange(newSig)
        } catch (err) {
            console.error("Failed to update PAGASA signal:", err)
            const msg = err.response?.data?.message || "Failed to update PAGASA signal. Please check your connection."
            setError(msg)
        } finally {
            setSaving(false)
        }
    }

    const handleCancel = () => {
        setConfirmTarget(null)
    }

    const currentMeta = SIGNAL_META[currentSignal] || SIGNAL_META[0]
    const { formatted: setAtFormatted, relative: setAtRelative, isStale, diffHours } = formatSetAt(setAt)

    return (
        <div style={styles.card}>
            {/* Header */}
            <div style={styles.cardHeader}>
                <div style={styles.headerLeft}>
                    <div style={styles.headerIcon}>
                        <Radio size={20} color="#1a237e" />
                    </div>
                    <div>
                        <div style={styles.cardTitle}>PAGASA Signal (City-wide Severity Floor)</div>
                        <div style={styles.cardSubtitle}>
                            Sets a minimum severity floor for all resident typhoon assessments across Surigao City.
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={fetchCurrentSignal}
                    disabled={loading || saving}
                    title="Refresh current signal"
                    style={styles.refreshBtn}
                >
                    <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
                </button>
            </div>

            {/* Error Message */}
            {error && (
                <div style={styles.errorBox}>
                    <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ flex: 1 }}>{error}</span>
                    <button type="button" onClick={() => setError(null)} style={styles.closeBtn}>
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Success Message */}
            {successMsg && (
                <div style={styles.successBox}>
                    <CheckCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ flex: 1 }}>{successMsg}</span>
                    <button type="button" onClick={() => setSuccessMsg(null)} style={styles.closeBtn}>
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Status Display Area */}
            <div style={styles.statusSection}>
                <div style={styles.statusBlock}>
                    <div style={styles.statusLabel}>Current Signal</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                        <span
                            style={{
                                ...styles.signalBadge,
                                background: currentMeta.bg,
                                color: currentMeta.color,
                                border: `1px solid ${currentMeta.border}`,
                            }}
                        >
                            <ShieldAlert size={14} />
                            {currentSignal === 0 ? "No Signal Active" : `Signal ${currentSignal}`}
                        </span>
                        <span style={styles.floorBadge}>
                            Floor: <strong>{currentMeta.floor}</strong>
                        </span>
                    </div>
                </div>

                {/* Set At Timestamp Prominently Displayed */}
                <div style={styles.statusBlock}>
                    <div style={styles.statusLabel}>Last Set Time</div>
                    <div style={styles.timeRow}>
                        <Clock size={15} color="#475569" />
                        <div>
                            <span style={styles.timeMain}>{setAtFormatted}</span>
                            {setAtRelative && (
                                <span style={styles.timeRelative}> ({setAtRelative})</span>
                            )}
                        </div>
                    </div>
                    {isStale && currentSignal > 0 && (
                        <div style={styles.staleNotice}>
                            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                            <span>Signal may be stale ({diffHours}h old). Please check official PAGASA bulletins.</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Confirmation Box (when a button is clicked) */}
            {confirmTarget !== null && (
                <div style={styles.confirmBox}>
                    <div style={styles.confirmHeader}>
                        <AlertTriangle size={18} color="#b45309" />
                        <strong>
                            {confirmTarget === 0
                                ? "Clear PAGASA Signal for all of Surigao City?"
                                : `Set PAGASA Signal ${confirmTarget} for all of Surigao City?`}
                        </strong>
                    </div>
                    <div style={styles.confirmText}>
                        {confirmTarget === 0 ? (
                            "This will clear the floor. Resident assessments will calculate severity purely from local weather readings."
                        ) : (
                            <>
                                Minimum severity floor will be set to <strong>{SIGNAL_META[confirmTarget]?.floor}</strong>. Any assessment with a lower computed score will be automatically raised to this floor.
                            </>
                        )}
                    </div>
                    <div style={styles.confirmActions}>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={saving}
                            style={{
                                ...styles.confirmBtn,
                                background: confirmTarget === 0 ? "#64748b" : "#1a237e",
                            }}
                        >
                            {saving ? (
                                <>
                                    <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
                                    Applying...
                                </>
                            ) : (
                                confirmTarget === 0 ? "Yes, Clear Signal" : `Confirm Signal ${confirmTarget}`
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={handleCancel}
                            disabled={saving}
                            style={styles.cancelBtn}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Signal Buttons Bar */}
            <div style={styles.buttonSection}>
                <div style={styles.buttonLabel}>Select Signal Level:</div>
                <div style={styles.buttonRow}>
                    {[0, 1, 2, 3, 4, 5].map((sig) => {
                        const isCurrent = currentSignal === sig
                        const meta = SIGNAL_META[sig]
                        return (
                            <button
                                key={sig}
                                type="button"
                                onClick={() => handleSelectSignal(sig)}
                                disabled={saving}
                                style={{
                                    ...styles.signalBtn,
                                    background: isCurrent ? meta.bg : "#fff",
                                    color: isCurrent ? meta.color : "#334155",
                                    borderColor: isCurrent ? meta.color : "#cbd5e1",
                                    fontWeight: isCurrent ? 700 : 500,
                                }}
                            >
                                <span style={styles.btnMainText}>
                                    {sig === 0 ? "No Signal" : `Signal ${sig}`}
                                </span>
                                <span style={styles.btnSubText}>
                                    {sig === 0 ? "None" : `Floor: ${meta.floor}`}
                                </span>
                            </button>
                        )
                    })}
                </div>

                {/* Visible Clear Action */}
                <div style={styles.clearRow}>
                    <button
                        type="button"
                        onClick={() => handleSelectSignal(0)}
                        disabled={saving || currentSignal === 0}
                        style={{
                            ...styles.clearBtn,
                            opacity: currentSignal === 0 ? 0.5 : 1,
                            cursor: currentSignal === 0 ? "not-allowed" : "pointer",
                        }}
                    >
                        <X size={14} />
                        Clear signal (set 0)
                    </button>
                    <span style={styles.clearHint}>
                        Setting 0 clears the floor and allows normal weather-based scoring.
                    </span>
                </div>
            </div>
        </div>
    )
}

const styles = {
    card: {
        background: "#ffffff",
        borderRadius: 12,
        padding: "20px 22px",
        border: "1px solid #e2e8f0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        marginBottom: 20,
        fontFamily: "system-ui, sans-serif",
    },
    cardHeader: {
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 16,
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: 12,
    },
    headerIcon: {
        width: 38,
        height: 38,
        borderRadius: 10,
        background: "#e8eaf6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: 700,
        color: "#0f172a",
        letterSpacing: "-0.01em",
    },
    cardSubtitle: {
        fontSize: 12,
        color: "#64748b",
        marginTop: 2,
    },
    refreshBtn: {
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "6px 8px",
        cursor: "pointer",
        color: "#475569",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    errorBox: {
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 8,
        padding: "10px 14px",
        color: "#991b1b",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
    },
    successBox: {
        background: "#f0fdf4",
        border: "1px solid #bbf7d0",
        borderRadius: 8,
        padding: "10px 14px",
        color: "#166534",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
    },
    closeBtn: {
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "inherit",
        opacity: 0.7,
        padding: 2,
    },
    statusSection: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 14,
        background: "#f8fafc",
        borderRadius: 10,
        padding: "14px 16px",
        border: "1px solid #e2e8f0",
        marginBottom: 16,
    },
    statusBlock: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    statusLabel: {
        fontSize: 11,
        fontWeight: 700,
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
    },
    signalBadge: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 20,
        fontSize: 13,
        fontWeight: 700,
    },
    floorBadge: {
        fontSize: 12,
        color: "#475569",
    },
    timeRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginTop: 4,
    },
    timeMain: {
        fontSize: 13,
        fontWeight: 600,
        color: "#1e293b",
    },
    timeRelative: {
        fontSize: 12,
        color: "#64748b",
    },
    staleNotice: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "#fffbeb",
        border: "1px solid #fef3c7",
        color: "#b45309",
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 11,
        fontWeight: 600,
        marginTop: 4,
    },
    confirmBox: {
        background: "#fffbeb",
        border: "1.5px solid #f59e0b",
        borderRadius: 10,
        padding: "14px 18px",
        marginBottom: 16,
        boxShadow: "0 2px 6px rgba(245, 158, 11, 0.15)",
    },
    confirmHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 14,
        color: "#92400e",
        marginBottom: 6,
    },
    confirmText: {
        fontSize: 12,
        color: "#78350f",
        lineHeight: 1.5,
        marginBottom: 12,
    },
    confirmActions: {
        display: "flex",
        alignItems: "center",
        gap: 10,
    },
    confirmBtn: {
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    cancelBtn: {
        background: "#fff",
        border: "1px solid #cbd5e1",
        color: "#475569",
        borderRadius: 8,
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
    },
    buttonSection: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    buttonLabel: {
        fontSize: 12,
        fontWeight: 600,
        color: "#475569",
    },
    buttonRow: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
        gap: 10,
    },
    signalBtn: {
        borderWidth: 1.5,
        borderStyle: "solid",
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 0.15s ease",
    },
    btnMainText: {
        fontSize: 13,
        fontWeight: 700,
    },
    btnSubText: {
        fontSize: 11,
        opacity: 0.8,
        marginTop: 2,
    },
    clearRow: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 6,
        flexWrap: "wrap",
    },
    clearBtn: {
        background: "#fee2e2",
        border: "1px solid #fca5a5",
        color: "#991b1b",
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
    },
    clearHint: {
        fontSize: 11,
        color: "#64748b",
    },
}
