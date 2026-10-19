import { useState, useEffect, useRef, useCallback } from "react"

const API_BASE = import.meta.env.VITE_API_BASE
const OSRM_URL_FOOT = (import.meta.env.VITE_OSRM_URL_FOOT || import.meta.env.VITE_OSRM_URL || "https://routing.openstreetmap.de/routed-foot").replace(/\/+$/, "")
const OSRM_URL_CAR = (import.meta.env.VITE_OSRM_URL_CAR || "https://routing.openstreetmap.de/routed-car").replace(/\/+$/, "")
const OSRM_PROFILE_FOOT = import.meta.env.VITE_OSRM_PROFILE_FOOT || import.meta.env.VITE_OSRM_PROFILE || "foot"
const OSRM_PROFILE_CAR = import.meta.env.VITE_OSRM_PROFILE_CAR || "car"

/**
 * Request road durations from origin (user) to all candidate centers using OSRM Table service.
 * Makes ONE table request: user -> all candidates.
 *
 * @param {{ lat: number, lng: number }} userPos
 * @param {Array<{ latitude: number, longitude: number }>} candidates
 * @param {"foot" | "car"} [mode="foot"]
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<number[]>} Durations in seconds corresponding to the candidates array
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

    for (const server of servers) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort)

        try {
            const url = `${server}/${coords}?sources=0&destinations=${destIndices}`
            const res = await fetch(url, { signal: controller.signal })
            if (!res.ok) continue
            const data = await res.json()
            if (data.code === "Ok" && Array.isArray(data.durations?.[0])) {
                return data.durations[0]
            }
        } catch {
            // try backup server
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }

    throw new Error("OSRM table service unavailable")
}

/**
 * useNearestCenter
 *
 * Hook to find the optimal nearest evacuation center based on live GPS:
 * 1. Fetches candidate centers via GET /api/evacuation-centers/nearest?lat=..&lng=..&limit=3.
 * 2. Makes ONE OSRM table request (user -> all candidates) to get road durations for mode ("foot" | "car").
 * 3. Chooses the lowest-duration candidate that is not is_full (or lowest-duration with isFull=true if all full).
 * 4. Anti-flicker: Re-runs selection at most every 45 s, and only switches target if the new center
 *    is at least 20% faster than the current one. Mode change recalculates immediately without flip-flopping.
 * 5. Fallback: If GPS is unavailable/denied or nearest/OSRM fails, flags fallback.
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

    const evaluate = useCallback(async (isForced = false) => {
        if (!enabled) return

        if (!hasGps) {
            setIsFallback(true)
            setFallbackNotice("Location unavailable. Routing to your barangay center.")
            setNearestCenter(null)
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
            // 1. Call GET /api/evacuation-centers/nearest?lat=..&lng=..&limit=3
            const res = await fetch(`${API_BASE}/evacuation-centers/nearest?lat=${lat}&lng=${lng}&limit=3`, {
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

    return {
        nearestCenter,
        candidates,
        loading,
        error,
        isFull,
        isFallback,
        fallbackNotice,
        refetch: () => evaluate(true),
    }
}

export default useNearestCenter
