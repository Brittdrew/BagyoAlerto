import { useState, useEffect, useRef, useCallback } from "react"
import { useLiveLocation } from "./useLiveLocation"
import { useSavedBarangay } from "./useSavedBarangay"

const API_BASE = import.meta.env.VITE_API_BASE

/** Arrival triggers when the device is within this many metres of the center */
const PROXIMITY_METERS = 50

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function getDeviceId() {
    try {
        const key = "bagyo_device_id"
        let id = localStorage.getItem(key)
        if (!id) {
            id = (typeof crypto !== "undefined" && crypto.randomUUID)
                ? crypto.randomUUID()
                : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`
            localStorage.setItem(key, id)
        }
        return id
    } catch {
        return `mem-${Math.random().toString(36).slice(2)}`
    }
}

/** Persistent (across reloads) — written only on success or 409. */
function reportedLsKey(centerId) {
    return `bagyo_reported_center_${centerId}`
}

function hasAlreadyReportedPersistently(centerId) {
    try { return Boolean(localStorage.getItem(reportedLsKey(centerId))) }
    catch { return false }
}

function markPersistentlyReported(centerId) {
    try { localStorage.setItem(reportedLsKey(centerId), "1") }
    catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------------------
// Haversine distance in metres
// ---------------------------------------------------------------------------

function haversineMeters(lat1, lon1, lat2, lon2) {
    if (
        !Number.isFinite(lat1) || !Number.isFinite(lon1) ||
        !Number.isFinite(lat2) || !Number.isFinite(lon2)
    ) return null
    const R = 6371000
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180
    const a =
        Math.sin(Δφ / 2) ** 2 +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * useSelfArrival
 *
 * Monitors the user's live GPS position and, when they come within
 * PROXIMITY_METERS of their barangay's designated evacuation center
 * AND a route is active, triggers a self-arrival prompt.
 *
 * @param {{ barangayId: string|number|null, enabled: boolean }} options
 * @returns {{
 *   showPrompt: boolean,
 *   centerName: string,
 *   onConfirm: (headcount: number) => Promise<void>,
 *   onSkip: () => void,
 *   successMsg: string|null,
 *   clearSuccess: () => void,
 * }}
 */
export function useSelfArrival({ barangayId, enabled, targetCenter = null }) {
    const { barangayId: savedBarangayId } = useSavedBarangay()
    const activeBId = barangayId ?? savedBarangayId

    // Always watch GPS if we have a barangay — the same hook MapView uses
    const { position } = useLiveLocation(Boolean(activeBId))

    const [center, setCenter] = useState(targetCenter || null)
    const [showPrompt, setShowPrompt] = useState(false)
    const [successMsg, setSuccessMsg] = useState(null)

    // Session-only skip flag — cleared on page reload, does NOT write to localStorage
    const skippedThisSessionRef = useRef(false)

    // Prevents re-opening the prompt mid-session even if GPS drifts
    const promptFiredRef = useRef(false)

    // When the actual routed center changes, update the center to watch
    useEffect(() => {
        if (targetCenter?.id) {
            setCenter(targetCenter)
        }
    }, [targetCenter])

    // Fetch the designated evacuation center for this barangay only if no targetCenter provided
    useEffect(() => {
        if (targetCenter?.id) return
        if (!activeBId) {
            setCenter(null)
            return
        }
        let mounted = true
        fetch(`${API_BASE}/barangays/${activeBId}/evacuation-target`)
            .then((r) => r.ok ? r.json() : null)
            .then((data) => { if (mounted && data) setCenter(data) })
            .catch(() => { /* silently ignore */ })
        return () => { mounted = false }
    }, [activeBId, targetCenter?.id])

    // Proximity check — runs on every GPS update
    useEffect(() => {
        if (!enabled) return
        if (!center?.id || !center?.latitude || !center?.longitude) return
        if (promptFiredRef.current) return
        if (skippedThisSessionRef.current) return
        if (hasAlreadyReportedPersistently(center.id)) return

        const hasGps = position && Number.isFinite(position.lat) && Number.isFinite(position.lng)
        if (!hasGps) return

        const dm = haversineMeters(
            position.lat, position.lng,
            Number(center.latitude), Number(center.longitude)
        )
        if (dm !== null && dm <= PROXIMITY_METERS) {
            promptFiredRef.current = true
            setShowPrompt(true)
        }
    }, [position, center, enabled])

    // Reset prompt-fired guard when the center changes (different barangay)
    useEffect(() => {
        promptFiredRef.current = false
        skippedThisSessionRef.current = false
        setShowPrompt(false)
    }, [center?.id])

    const onConfirm = useCallback(async (headcount) => {
        setShowPrompt(false)
        if (!center?.id || !position) return

        const deviceId = getDeviceId()
        const payload = {
            device_id: deviceId,
            latitude: position.lat,
            longitude: position.lng,
            headcount,
        }

        // Include origin_barangay_id if we know the resident's saved barangay
        const numBId = activeBId ? Number(activeBId) : null
        if (numBId && !Number.isNaN(numBId)) {
            payload.origin_barangay_id = numBId
        }

        try {
            const res = await fetch(
                `${API_BASE}/evacuation-centers/${center.id}/self-arrival`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            )

            if (res.status === 201) {
                markPersistentlyReported(center.id)
                setSuccessMsg(center.name || "the evacuation center")
                setTimeout(() => setSuccessMsg(null), 10000)
                return
            }

            // 409 = server-side cooldown hit → mark locally, no error
            if (res.status === 409) {
                markPersistentlyReported(center.id)
                return
            }

            // 422 = bad GPS coords or validation → do NOT mark as reported.
            // The next GPS tick that comes in within range will re-evaluate
            // and, because promptFiredRef is already true, it won't re-prompt.
            // The user would need to reload the page. This is the safest UX
            // for a bad-GPS scenario: silent fail, no spam.
        } catch {
            // Network error — do NOT mark as reported so it can retry next session
        }
    }, [center, position, activeBId])

    const onSkip = useCallback(() => {
        // Session-only skip: localStorage NOT written, so prompt can return after reload
        skippedThisSessionRef.current = true
        setShowPrompt(false)
    }, [])

    return {
        showPrompt,
        centerName: center?.name || "the evacuation center",
        onConfirm,
        onSkip,
        successMsg,
        clearSuccess: () => setSuccessMsg(null),
    }
}
