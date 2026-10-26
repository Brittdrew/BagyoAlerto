import { useState, useEffect, useRef, useCallback } from "react"

const API_BASE = import.meta.env.VITE_API_BASE
const OSRM_URL_FOOT = (import.meta.env.VITE_OSRM_URL_FOOT || import.meta.env.VITE_OSRM_URL || "https://routing.openstreetmap.de/routed-foot").replace(/\/+$/, "")
const OSRM_URL_CAR = (import.meta.env.VITE_OSRM_URL_CAR || "https://routing.openstreetmap.de/routed-car").replace(/\/+$/, "")
const OSRM_PROFILE_FOOT = import.meta.env.VITE_OSRM_PROFILE_FOOT || import.meta.env.VITE_OSRM_PROFILE || "foot"
const OSRM_PROFILE_CAR = import.meta.env.VITE_OSRM_PROFILE_CAR || "car"

/** Susceptibility rank (null → treated as unknown, not lower than anything) */
const HAZARD_RANK = { low: 1, moderate: 2, high: 3, very_high: 4 }

/**
 * Request road durations from origin (user) to all candidate centers using OSRM Table service.
 * Makes ONE table request: user -> all candidates.
 *
 * Durations returned are mode-consistent:
 *   Car  → OSRM table duration (server uses road-speed data).
 *   Foot → derived from OSRM road distance at 4.5 km/h, matching MapView loadRoute exactly:
 *            mins = distance_km / 4.5  →  seconds = (distM / 1000 / 4.5) * 3600
 *          Falls back to scaling OSRM seconds by (30 / 4.5) when distance annotation is absent.
 *
 * This guarantees the 10-min suggestion threshold and the +N label are correct for the active
 * travel mode regardless of which backup OSRM server (foot vs driving) actually responds.
 *
 * @param {{ lat: number, lng: number }} userPos
 * @param {Array<{ latitude: number, longitude: number }>} candidates
 * @param {"foot" | "car"} [mode="foot"]
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<(number|null)[]>} Mode-consistent durations in seconds per candidate
 */
async function fetchOsrmTableDurations(userPos, candidates, mode = "foot", { signal, timeoutMs = 8000 } = {}) {
    if (!candidates || candidates.length === 0) return []

    // Coordinates: userLng,userLat;cand0Lng,cand0Lat;cand1Lng,cand1Lat...
    const coords = [`${userPos.lng},${userPos.lat}`, ...candidates.map((c) => `${c.longitude},${c.latitude}`)].join(";")
    const destIndices = candidates.map((_, i) => i + 1).join(";")

    const isCar = mode === "car"
    const primaryUrl = isCar ? OSRM_URL_CAR : OSRM_URL_FOOT
    const primaryProfile = isCar ? OSRM_PROFILE_CAR : OSRM_PROFILE_FOOT

    const primaryServer = `${primaryUrl}/table/v1/${primaryProfile}`
    const backupServer = "https://router.project-osrm.org/table/v1/driving"
    const servers = primaryServer === backupServer ? [primaryServer] : [primaryServer, backupServer]

    // Speed constants — mirror MapView loadRoute:
    //   foot: (route.distance / 1000 / 4.5) * 60 minutes
    //   car:  route.duration from OSRM (seconds)
    const WALK_KMH = 4.5
    const CAR_KMH  = 30   // only used as fallback scale when distance annotation is missing

    for (const server of servers) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort)

        try {
            // Request distance annotation alongside duration so we can derive foot seconds
            // from road distance independently of the server's speed model.
            const url = `${server}/${coords}?sources=0&destinations=${destIndices}&annotations=duration,distance`
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) continue
            const data = await res.json()
            if (data.code !== "Ok") continue

            const osrmDurations = data.durations?.[0]  // seconds (server speed model)
            const osrmDistances = data.distances?.[0]  // metres along road network

            if (!Array.isArray(osrmDurations)) continue

            const seconds = osrmDurations.map((osrmSec, i) => {
                if (isCar) {
                    // Car: OSRM duration is correct for road speeds.
                    return (osrmSec !== null && Number.isFinite(osrmSec)) ? osrmSec : null
                }

                // Foot: compute from road distance at 4.5 km/h — same as MapView loadRoute.
                const distM = Array.isArray(osrmDistances) ? osrmDistances[i] : null
                if (distM !== null && distM !== undefined && Number.isFinite(distM) && distM > 0) {
                    return (distM / 1000 / WALK_KMH) * 3600  // seconds at walking pace
                }

                // Distance annotation absent (older server) — scale driving seconds to foot pace.
                if (osrmSec !== null && Number.isFinite(osrmSec)) {
                    return osrmSec * (CAR_KMH / WALK_KMH)
                }

                return null
            })

            return seconds
        } catch {
            // try next server
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }

    throw new Error("OSRM table service unavailable")
}

/**
 * Compute lower-hazard suggestion among a set of candidates with durations.
 *
 * A candidate qualifies if it:
 *  - Is NOT the current routed center
 *  - Is active (is_active !== false)
 *  - Has free_space > 0  (capacity - occupancy)
 *  - Has a strictly lower hazard_level rank (null = unknown, never counts as "lower")
 *  - Travel duration is at most 600 s (10 min) longer than the routed center's
 *
 * Returns the closest qualifying candidate (shortest travel time), or null.
 */
function computeLowerHazardSuggestion(routedCenter, candidatesWithDurations) {
    if (!routedCenter) return null

    const routedRank = HAZARD_RANK[routedCenter.hazard_level] ?? 0
    // Only suggest if routed center is high or very_high
    if (routedRank < HAZARD_RANK["high"]) return null

    const routedDuration = routedCenter.duration ?? Infinity

    const qualifying = candidatesWithDurations
        .filter((c) => {
            if (c.id === routedCenter.id) return false
            if (c.is_active === false) return false
            const freeSpace = (c.free_space ?? (c.capacity - (c.occupancy ?? c.current_occupancy ?? 0)))
            if (freeSpace <= 0) return false
            const cRank = HAZARD_RANK[c.hazard_level] ?? 0
            if (cRank === 0 || cRank >= routedRank) return false  // null or not lower
            const duration = c.duration ?? Infinity
            if (!Number.isFinite(duration)) return false
            if (duration - routedDuration > 600) return false // more than 10 min longer
            return true
        })
        .sort((a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity))

    return qualifying[0] ?? null
}

/**
 * useNearestCenter
 *
 * Hook to find the optimal nearest evacuation center based on live GPS:
 * 1. Fetches candidate centers via GET /api/evacuation-centers/nearest?lat=..&lng=..&limit=5.
 * 2. Makes ONE OSRM table request (user -> all candidates) to get road durations for mode ("foot" | "car").
 * 3. Chooses the lowest-duration candidate that is not is_full (or lowest-duration with isFull=true if all full).
 * 4. Anti-flicker: Re-runs selection at most every 45 s, and only switches target if the new center
 *    is at least 20% faster than the current one. Mode change recalculates immediately without flip-flopping.
 * 5. Fallback: If GPS is unavailable/denied or nearest/OSRM fails, flags fallback.
 * 6. preferredCenterId override: when set, the preferred center is used as the result instead of
 *    the auto-selected nearest. Expose setPreferredCenterId and clearPreferredCenterId.
 * 7. lowerHazardSuggestion: When routed center is high or very_high, computes a lower-hazard candidate
 *    within 10 min extra travel time. Null if none qualifies.
 *
 * @param {{ lat: number, lng: number } | null} location - User's live coordinates.
 * @param {"foot" | "car" | { enabled?: boolean, mode?: "foot" | "car" }} [modeOrOptions="foot"]
 * @param {{ enabled?: boolean, mode?: "foot" | "car" }} [extraOptions]
 */
export function useNearestCenter(location, modeOrOptions = "foot", extraOptions = {}) {
    let mode = "foot"
    let options = {}

    if (typeof modeOrOptions === "string") {
        mode = modeOrOptions
        options = extraOptions || {}
    } else if (typeof modeOrOptions === "object" && modeOrOptions !== null) {
        options = modeOrOptions
        if (options.mode) mode = options.mode
    }

    const { enabled = true } = options

    const [nearestCenter, setNearestCenter] = useState(null)
    const [candidates, setCandidates] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [isFull, setIsFull] = useState(false)
    const [isFallback, setIsFallback] = useState(false)
    const [fallbackNotice, setFallbackNotice] = useState(null)
    const [preferredCenterId, setPreferredCenterId] = useState(null)
    const [lowerHazardSuggestion, setLowerHazardSuggestion] = useState(null)

    const lat = location?.lat ?? location?.latitude
    const lng = location?.lng ?? location?.longitude
    const hasGps = Number.isFinite(lat) && Number.isFinite(lng)

    // Anti-flicker refs
    const lastEvaluationTimeRef = useRef(0)
    const currentTargetRef = useRef(null)
    const currentDurationRef = useRef(null)
    const lastEvaluatedModeRef = useRef(mode)
    const abortRef = useRef(null)
    const evalIdRef = useRef(0)
    // Store all candidates with durations for suggestion computation
    const candidatesWithDurationsRef = useRef([])

    /** Set a preferred center override — only accepts an id that exists in candidates */
    const setPreferredCenter = useCallback((id) => {
        setPreferredCenterId(id ?? null)
    }, [])

    /** Clear the preferred center override (reverts to nearest) */
    const clearPreferredCenter = useCallback(() => {
        setPreferredCenterId(null)
    }, [])

    const evaluate = useCallback(async (isForced = false) => {
        if (!enabled) return

        if (!hasGps) {
            setIsFallback(true)
            setFallbackNotice("Location unavailable. Routing to your barangay center.")
            setNearestCenter(null)
            setLowerHazardSuggestion(null)
            currentTargetRef.current = null
            currentDurationRef.current = null
            lastEvaluatedModeRef.current = mode
            return
        }

        const modeChanged = lastEvaluatedModeRef.current !== mode
        const now = Date.now()
        // Anti-flicker: re-run selection at most every 45 s, unless forced or mode changed
        if (!isForced && !modeChanged && lastEvaluationTimeRef.current > 0 && (now - lastEvaluationTimeRef.current) < 45000) {
            return
        }

        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        const currentEvalId = ++evalIdRef.current

        setLoading(true)
        setError(null)

        try {
            // 1. Call GET /api/evacuation-centers/nearest?lat=..&lng=..&limit=5
            const res = await fetch(`${API_BASE}/evacuation-centers/nearest?lat=${lat}&lng=${lng}&limit=5`, {
                signal: controller.signal,
            })

            if (currentEvalId !== evalIdRef.current) return
            if (!res.ok) {
                throw new Error(`Nearest endpoint returned HTTP ${res.status}`)
            }

            const rawCandidates = await res.json()
            if (currentEvalId !== evalIdRef.current) return

            if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
                setIsFallback(true)
                setFallbackNotice("No nearby centers found. Using barangay center.")
                setNearestCenter(null)
                setLowerHazardSuggestion(null)
                currentTargetRef.current = null
                currentDurationRef.current = null
                lastEvaluatedModeRef.current = mode
                return
            }

            setCandidates(rawCandidates)

            // 2. ONE OSRM table request (user -> all candidates) to get road duration for the selected mode
            let durations = []
            try {
                durations = await fetchOsrmTableDurations({ lat, lng }, rawCandidates, mode, {
                    signal: controller.signal,
                    timeoutMs: 8000,
                })
            } catch (osrmErr) {
                if (currentEvalId !== evalIdRef.current) return
                console.warn("[useNearestCenter] OSRM table failed, falling back:", osrmErr.message)
                setIsFallback(true)
                setFallbackNotice("Routing service unavailable. Using barangay center.")
                setError("OSRM table failed")
                return
            }

            if (currentEvalId !== evalIdRef.current) return

            // Attach duration in seconds to each candidate
            const candidatesWithDurations = rawCandidates.map((c, idx) => {
                const d = durations[idx]
                return {
                    ...c,
                    duration: (d !== null && d !== undefined && Number.isFinite(d)) ? d : Infinity,
                }
            })
            candidatesWithDurationsRef.current = candidatesWithDurations

            // 3. Selection: Choose lowest-duration candidate that is not is_full.
            // If all are full, choose nearest by duration and show a "FULL" warning.
            const nonFull = candidatesWithDurations.filter((c) => !c.is_full && Number.isFinite(c.duration))
            let chosen = null
            let allFull = false

            if (nonFull.length > 0) {
                nonFull.sort((a, b) => a.duration - b.duration)
                chosen = nonFull[0]
                allFull = false
            } else {
                const sortedByDur = [...candidatesWithDurations].sort((a, b) => a.duration - b.duration)
                chosen = sortedByDur[0]
                allFull = true
            }

            if (!chosen) {
                setIsFallback(true)
                setFallbackNotice("No qualifying centers available. Using barangay center.")
                return
            }

            // 4. Anti-flicker: Only switch target if the new center is at least 20% faster than the current one (within the same mode).
            // When mode changes, we select the optimal center for that mode without comparing mismatched units.
            const prevTarget = currentTargetRef.current
            const prevDuration = currentDurationRef.current

            let finalTarget = chosen

            if (!modeChanged && prevTarget && prevTarget.id !== chosen.id) {
                const prevWasFull = Boolean(prevTarget.is_full)
                const newIsFull = Boolean(chosen.is_full)

                // If previous was full and new is NOT full, switch immediately
                if (prevWasFull && !newIsFull) {
                    finalTarget = chosen
                } else if (Number.isFinite(prevDuration) && Number.isFinite(chosen.duration)) {
                    // Switch only if at least 20% faster: newDuration <= prevDuration * 0.8
                    const is20PctFaster = chosen.duration <= (prevDuration * 0.8)
                    if (is20PctFaster) {
                        finalTarget = chosen
                    } else {
                        // Keep current target; update its details if present in candidates list
                        const matchedPrev = candidatesWithDurations.find((c) => c.id === prevTarget.id)
                        finalTarget = matchedPrev ? { ...prevTarget, ...matchedPrev } : prevTarget
                        allFull = Boolean(finalTarget.is_full)
                    }
                }
            }

            currentTargetRef.current = finalTarget
            currentDurationRef.current = finalTarget.duration
            lastEvaluatedModeRef.current = mode
            lastEvaluationTimeRef.current = Date.now()

            setNearestCenter(finalTarget)
            setIsFull(allFull || Boolean(finalTarget.is_full))
            setIsFallback(false)
            setFallbackNotice(null)

            // 5. Compute lower-hazard suggestion against the auto-selected nearest
            setLowerHazardSuggestion(computeLowerHazardSuggestion(finalTarget, candidatesWithDurations))
        } catch (err) {
            if (currentEvalId !== evalIdRef.current) return
            if (controller.signal.aborted) return
            console.warn("[useNearestCenter] Error selecting nearest center:", err.message)
            setError(err.message)
            setIsFallback(true)
            setFallbackNotice("Nearest center search failed. Using barangay center.")
        } finally {
            if (currentEvalId === evalIdRef.current) {
                setLoading(false)
            }
        }
    }, [enabled, hasGps, lat, lng, mode])

    // Trigger on location/enabled/mode update (subject to 45s anti-flicker throttle, except when mode changes)
    useEffect(() => {
        if (!enabled) {
            currentTargetRef.current = null
            currentDurationRef.current = null
            lastEvaluationTimeRef.current = 0
            setNearestCenter(null)
            setIsFallback(false)
            setFallbackNotice(null)
            setLowerHazardSuggestion(null)
            return
        }

        if (!hasGps) {
            setIsFallback(true)
            setFallbackNotice("Location unavailable. Routing to your barangay center.")
            setNearestCenter(null)
            return
        }

        const isModeChange = lastEvaluatedModeRef.current !== mode
        evaluate(isModeChange)
    }, [enabled, hasGps, lat, lng, mode, evaluate])

    // Scheduled 45s anti-flicker interval
    useEffect(() => {
        if (!enabled || !hasGps) return

        const timer = setInterval(() => {
            evaluate(true)
        }, 45000)

        return () => clearInterval(timer)
    }, [enabled, hasGps, evaluate])

    useEffect(() => () => {
        abortRef.current?.abort()
    }, [])

    // Derive the effective routed center:
    // If preferredCenterId is set and found in candidates, use that one.
    const effectiveCenter = (() => {
        if (preferredCenterId != null) {
            const preferred = candidatesWithDurationsRef.current.find((c) => c.id === preferredCenterId)
            if (preferred) return preferred
        }
        return nearestCenter
    })()

    return {
        nearestCenter: effectiveCenter,
        candidates,
        loading,
        error,
        isFull,
        isFallback,
        fallbackNotice,
        refetch: () => evaluate(true),
        // Hazard suggestion API
        lowerHazardSuggestion,
        preferredCenterId,
        setPreferredCenter,
        clearPreferredCenter,
        isOverrideActive: preferredCenterId != null,
    }
}

export default useNearestCenter
