import { useState, useEffect, useRef, useCallback } from "react"

const API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000/api").replace(/\/+$/, "")
const OSRM_URL_FOOT = (import.meta.env.VITE_OSRM_URL_FOOT || import.meta.env.VITE_OSRM_URL || "https://routing.openstreetmap.de/routed-foot").replace(/\/+$/, "")
const OSRM_URL_CAR = (import.meta.env.VITE_OSRM_URL_CAR || "https://routing.openstreetmap.de/routed-car").replace(/\/+$/, "")
const OSRM_PROFILE_FOOT = import.meta.env.VITE_OSRM_PROFILE_FOOT || import.meta.env.VITE_OSRM_PROFILE || "foot"
const OSRM_PROFILE_CAR = import.meta.env.VITE_OSRM_PROFILE_CAR || "car"

/** Named constants for safer center suggestion limits */
export const SAFER_CENTER_MAX_EXTRA_MIN = 10
export const SAFER_CENTER_MAX_EXTRA_KM = 3

/** Hierarchy of hazard classes for ranking (clear < low < moderate < high < very_high) */
export const CLASS_RANK = {
    clear: 0,
    low: 1,
    moderate: 2,
    high: 3,
    very_high: 4,
}

export const MAPPED_CLASSES = ["low", "moderate", "high", "very_high"]

/**
 * Per-layer status for each candidate:
 *  - mapped class (low/moderate/high/very_high) -> that class
 *  - no_data AND mapped_nearby === false -> "clear" (lowest)
 *  - no_data AND (mapped_nearby true OR null) -> "unknown"
 * A candidate with null mapped_nearby (e.g. manual rows never sampled) counts as unknown and is skipped.
 */
export function getCandidateLayerStatus(susceptibility, mappedNearby) {
    if (MAPPED_CLASSES.includes(susceptibility)) {
        return susceptibility
    }
    // susceptibility is null, undefined, "no_data", or empty
    if (mappedNearby === false) {
        return "clear"
    }
    return "unknown"
}

/**
 * Target worst class = the highest MAPPED class across flood and landslide
 * (ignore unknown layers).
 * Returns the class name (string) or null if no mapped layers exist.
 */
export function getTargetWorstClass(target) {
    if (!target) return null
    const ranks = []
    if (MAPPED_CLASSES.includes(target.flood_susceptibility)) {
        ranks.push(CLASS_RANK[target.flood_susceptibility])
    }
    if (MAPPED_CLASSES.includes(target.landslide_susceptibility)) {
        ranks.push(CLASS_RANK[target.landslide_susceptibility])
    }
    if (ranks.length === 0) return null
    const maxRank = Math.max(...ranks)
    return Object.keys(CLASS_RANK).find((k) => CLASS_RANK[k] === maxRank)
}

/**
 * Haversine distance in meters (fallback when OSRM table is unreachable).
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

/**
 * Request road durations and distances from origin (user) to all candidate centers using OSRM Table service.
 * Makes ONE table request: user -> all candidates.
 *
 * Durations returned are mode-consistent:
 *   Car  → OSRM table duration (server uses road-speed data).
 *   Foot → derived from OSRM road distance at 4.5 km/h, matching MapView loadRoute exactly:
 *            mins = distance_km / 4.5  →  seconds = (distM / 1000 / 4.5) * 3600
 *
 * @param {{ lat: number, lng: number }} userPos
 * @param {Array<{ latitude: number, longitude: number }>} candidates
 * @param {"foot" | "car"} [mode="foot"]
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<{ durations: (number|null)[], distances: (number|null)[] }>}
 */
async function fetchOsrmTableMetrics(userPos, candidates, mode = "foot", { signal, timeoutMs = 8000 } = {}) {
    if (!candidates || candidates.length === 0) return { durations: [], distances: [] }

    const coords = [`${userPos.lng},${userPos.lat}`, ...candidates.map((c) => `${c.longitude},${c.latitude}`)].join(";")
    const destIndices = candidates.map((_, i) => i + 1).join(";")

    const isCar = mode === "car"
    const primaryUrl = isCar ? OSRM_URL_CAR : OSRM_URL_FOOT
    const primaryProfile = isCar ? OSRM_PROFILE_CAR : OSRM_PROFILE_FOOT

    const primaryServer = `${primaryUrl}/table/v1/${primaryProfile}`
    const backupServer = "https://router.project-osrm.org/table/v1/driving"
    const servers = primaryServer === backupServer ? [primaryServer] : [primaryServer, backupServer]

    const WALK_KMH = 4.5
    const CAR_KMH = 30

    for (const server of servers) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort)

        try {
            const url = `${server}/${coords}?sources=0&destinations=${destIndices}&annotations=duration,distance`
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) continue
            const data = await res.json()
            if (data.code !== "Ok") continue

            const osrmDurations = data.durations?.[0]
            const osrmDistances = data.distances?.[0]

            if (!Array.isArray(osrmDurations)) continue

            const durations = osrmDurations.map((osrmSec, i) => {
                const distM = Array.isArray(osrmDistances) ? osrmDistances[i] : null
                if (isCar) {
                    if (osrmSec !== null && Number.isFinite(osrmSec)) return osrmSec
                    if (distM !== null && Number.isFinite(distM)) return (distM / 1000 / CAR_KMH) * 3600
                    return null
                }
                // Foot pace: 4.5 km/h
                if (distM !== null && Number.isFinite(distM) && distM > 0) {
                    return (distM / 1000 / WALK_KMH) * 3600
                }
                if (osrmSec !== null && Number.isFinite(osrmSec)) {
                    return osrmSec * (CAR_KMH / WALK_KMH)
                }
                return null
            })

            const distances = (Array.isArray(osrmDistances) ? osrmDistances : []).map((distM, i) => {
                if (distM !== null && Number.isFinite(distM)) return distM
                const s = osrmDurations[i]
                if (s !== null && Number.isFinite(s)) {
                    return (s / 3600) * (isCar ? CAR_KMH : WALK_KMH) * 1000
                }
                return null
            })

            return { durations, distances }
        } catch {
            // try next server
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }

    // Fallback: Haversine distance
    const distances = candidates.map((c) =>
        haversineMeters(userPos.lat, userPos.lng, Number(c.latitude), Number(c.longitude))
    )
    const durations = distances.map((distM) => (distM / 1000 / (isCar ? CAR_KMH : WALK_KMH)) * 3600)

    return { durations, distances }
}

/**
 * Compute safer center suggestion:
 * - Target worst class must be "high" or "very_high".
 * - Candidate qualifies only if:
 *     - neither layer is unknown
 *     - is_active !== false (and is_active !== 0)
 *     - free capacity (capacity - current_occupancy > 0)
 *     - candidate worst class is strictly lower than target's
 *     - BOTH extra travel time <= SAFER_CENTER_MAX_EXTRA_MIN (10 min)
 *       AND extra distance <= SAFER_CENTER_MAX_EXTRA_KM (3 km)
 * - Ranked by lowest worst class first (clear < low < moderate < high),
 *   then shortest travel time in current mode, then shortest distance.
 *
 * @param {object} target
 * @param {Array<object>} candidatesWithMetrics
 * @returns {object|null}
 */
export function computeSaferCenterSuggestion(target, candidatesWithMetrics) {
    if (!target || !Array.isArray(candidatesWithMetrics) || candidatesWithMetrics.length === 0) {
        return null
    }

    const targetWorstClass = getTargetWorstClass(target)
    // Trigger the suggestion only when target worst class is high or very_high
    if (targetWorstClass !== "high" && targetWorstClass !== "very_high") {
        return null
    }
    const targetWorstRank = CLASS_RANK[targetWorstClass]

    // Find target in candidate list to get accurate duration and distance from user
    const targetInList = candidatesWithMetrics.find((c) => c.id === target.id)
    const targetDuration = targetInList?.duration ?? target.duration ?? 0
    const targetDistance = targetInList?.distance ?? target.distance ?? 0

    const qualifying = []

    for (const cand of candidatesWithMetrics) {
        if (cand.id === target.id) continue
        if (cand.is_active === false || cand.is_active === 0) continue

        const occupancy = cand.current_occupancy ?? cand.occupancy ?? 0
        const freeSpace = (cand.capacity ?? 0) - occupancy
        if (freeSpace <= 0) continue

        const floodStatus = getCandidateLayerStatus(cand.flood_susceptibility, cand.flood_mapped_nearby)
        const landslideStatus = getCandidateLayerStatus(cand.landslide_susceptibility, cand.landslide_mapped_nearby)

        // Neither layer may be unknown
        if (floodStatus === "unknown" || landslideStatus === "unknown") continue

        const candWorstRank = Math.max(CLASS_RANK[floodStatus], CLASS_RANK[landslideStatus])
        // Must be strictly lower than target's worst class
        if (candWorstRank >= targetWorstRank) continue

        const candDuration = cand.duration ?? Infinity
        const candDistance = cand.distance ?? Infinity
        if (!Number.isFinite(candDuration) || !Number.isFinite(candDistance)) continue

        const extraMin = (candDuration - targetDuration) / 60
        const extraKm = (candDistance - targetDistance) / 1000

        // Require BOTH <= +10 min and <= +3 km versus current target
        if (extraMin > SAFER_CENTER_MAX_EXTRA_MIN || extraKm > SAFER_CENTER_MAX_EXTRA_KM) {
            continue
        }

        const worstClass = Object.keys(CLASS_RANK).find((k) => CLASS_RANK[k] === candWorstRank)

        qualifying.push({
            ...cand,
            floodStatus,
            landslideStatus,
            worstClass,
            worstRank: candWorstRank,
            extraMin,
            extraKm,
        })
    }

    if (qualifying.length === 0) return null

    // Rank: lowest worst class first (clear < low < moderate < high),
    // then shortest travel time in current mode, then shortest distance.
    qualifying.sort((a, b) => {
        if (a.worstRank !== b.worstRank) return a.worstRank - b.worstRank
        if (a.duration !== b.duration) return a.duration - b.duration
        return (a.distance ?? 0) - (b.distance ?? 0)
    })

    return qualifying[0]
}

/**
 * useNearestCenter
 *
 * Hook to find the optimal evacuation center and evaluate safer-center suggestions:
 * 1. Fetches evacuation centers from GET /api/evacuation-centers.
 * 2. Makes ONE OSRM table request (user -> all centers) to get road durations & distances.
 * 3. Chooses the lowest-duration non-full candidate (with 20% anti-flicker stability).
 * 4. Computes safer-center suggestions against the active target center (works for both
 *    "Nearest center" and "My barangay's center" modes).
 * 5. Provides preferredCenterId override mechanisms.
 *
 * @param {{ lat: number, lng: number } | null} location - User's live coordinates.
 * @param {"foot" | "car" | { enabled?: boolean, mode?: "foot" | "car", targetCenter?: object }} [modeOrOptions="foot"]
 * @param {{ enabled?: boolean, mode?: "foot" | "car", targetCenter?: object }} [extraOptions]
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

    const { enabled = true, targetCenter = null } = options

    const [nearestCenter, setNearestCenter] = useState(null)
    const [candidates, setCandidates] = useState([])
    const [allCentersWithMetrics, setAllCentersWithMetrics] = useState([])
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
    const candidatesWithMetricsRef = useRef([])

    /** Set a preferred center override */
    const setPreferredCenter = useCallback((id) => {
        setPreferredCenterId(id ?? null)
    }, [])

    /** Clear the preferred center override */
    const clearPreferredCenter = useCallback(() => {
        setPreferredCenterId(null)
    }, [])

    const evaluate = useCallback(
        async (isForced = false) => {
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
            if (!isForced && !modeChanged && lastEvaluationTimeRef.current > 0 && now - lastEvaluationTimeRef.current < 45000) {
                return
            }

            abortRef.current?.abort()
            const controller = new AbortController()
            abortRef.current = controller
            const currentEvalId = ++evalIdRef.current

            setLoading(true)
            setError(null)

            try {
                // Fetch all evacuation centers to cover the full city network
                let rawCenters = []
                try {
                    const res = await fetch(`${API_BASE}/evacuation-centers`, {
                        signal: controller.signal,
                    })
                    const contentType = res.headers.get("content-type") || ""
                    if (res.ok && contentType.includes("application/json")) {
                        rawCenters = await res.json()
                    }
                } catch {
                    // Try fallback endpoint
                }

                if (!Array.isArray(rawCenters) || rawCenters.length === 0) {
                    const fallbackRes = await fetch(`${API_BASE}/evacuation-centers/nearest?lat=${lat}&lng=${lng}&limit=5`, {
                        signal: controller.signal,
                    })
                    const contentType = fallbackRes.headers.get("content-type") || ""
                    if (fallbackRes.ok && contentType.includes("application/json")) {
                        rawCenters = await fallbackRes.json()
                    }
                }

                if (currentEvalId !== evalIdRef.current) return

                if (!Array.isArray(rawCenters) || rawCenters.length === 0) {
                    setIsFallback(true)
                    setFallbackNotice("No nearby centers found. Using barangay center.")
                    setNearestCenter(null)
                    setLowerHazardSuggestion(null)
                    currentTargetRef.current = null
                    currentDurationRef.current = null
                    lastEvaluatedModeRef.current = mode
                    return
                }

                setCandidates(rawCenters)

                // Request road duration & distance for all centers in active mode
                const { durations, distances } = await fetchOsrmTableMetrics({ lat, lng }, rawCenters, mode, {
                    signal: controller.signal,
                    timeoutMs: 8000,
                })

                if (currentEvalId !== evalIdRef.current) return

                const centersWithMetrics = rawCenters.map((c, idx) => {
                    const d = durations[idx]
                    const dist = distances[idx]
                    const freeSpace = (c.capacity ?? 0) - (c.current_occupancy ?? c.occupancy ?? 0)
                    return {
                        ...c,
                        duration: d !== null && d !== undefined && Number.isFinite(d) ? d : Infinity,
                        distance: dist !== null && dist !== undefined && Number.isFinite(dist) ? dist : Infinity,
                        distance_km: dist !== null && Number.isFinite(dist) ? Number((dist / 1000).toFixed(2)) : null,
                        free_space: freeSpace,
                        is_full: freeSpace <= 0,
                    }
                })

                candidatesWithMetricsRef.current = centersWithMetrics
                setAllCentersWithMetrics(centersWithMetrics)

                // Selection: Choose lowest-duration active candidate that is not is_full
                const nonFull = centersWithMetrics.filter((c) => !c.is_full && c.is_active !== false && Number.isFinite(c.duration))
                let chosen = null
                let allFull = false

                if (nonFull.length > 0) {
                    nonFull.sort((a, b) => a.duration - b.duration)
                    chosen = nonFull[0]
                    allFull = false
                } else {
                    const sortedByDur = [...centersWithMetrics]
                        .filter((c) => c.is_active !== false && Number.isFinite(c.duration))
                        .sort((a, b) => a.duration - b.duration)
                    chosen = sortedByDur[0] || centersWithMetrics[0]
                    allFull = true
                }

                if (!chosen) {
                    setIsFallback(true)
                    setFallbackNotice("No qualifying centers available. Using barangay center.")
                    return
                }

                // Anti-flicker: Only switch target if new center is at least 20% faster
                const prevTarget = currentTargetRef.current
                const prevDuration = currentDurationRef.current
                let finalTarget = chosen

                if (!modeChanged && prevTarget && prevTarget.id !== chosen.id) {
                    const prevWasFull = Boolean(prevTarget.is_full)
                    const newIsFull = Boolean(chosen.is_full)

                    if (prevWasFull && !newIsFull) {
                        finalTarget = chosen
                    } else if (Number.isFinite(prevDuration) && Number.isFinite(chosen.duration)) {
                        const is20PctFaster = chosen.duration <= prevDuration * 0.8
                        if (is20PctFaster) {
                            finalTarget = chosen
                        } else {
                            const matchedPrev = centersWithMetrics.find((c) => c.id === prevTarget.id)
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

                // Compute safer center suggestion against targetCenter (or finalTarget if none provided)
                const evalTarget = targetCenter || finalTarget
                const suggestion = computeSaferCenterSuggestion(evalTarget, centersWithMetrics)
                setLowerHazardSuggestion(suggestion)
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
        },
        [enabled, hasGps, lat, lng, mode, targetCenter]
    )

    // Re-evaluate whenever targetCenter changes (e.g. user toggles route mode or selects new barangay)
    useEffect(() => {
        if (candidatesWithMetricsRef.current.length > 0) {
            const evalTarget = targetCenter || nearestCenter
            const suggestion = computeSaferCenterSuggestion(evalTarget, candidatesWithMetricsRef.current)
            setLowerHazardSuggestion(suggestion)
        }
    }, [targetCenter, nearestCenter])

    // Trigger on location/enabled/mode update
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

    const effectiveCenter = (() => {
        if (preferredCenterId != null) {
            const preferred = candidatesWithMetricsRef.current.find((c) => c.id === preferredCenterId)
            if (preferred) return preferred
        }
        return nearestCenter
    })()

    return {
        nearestCenter: effectiveCenter,
        candidates,
        allCentersWithMetrics,
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

