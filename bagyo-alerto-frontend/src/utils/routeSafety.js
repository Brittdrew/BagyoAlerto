/**
 * Route Safety & Hazard Scoring Utilities for Bakwit Resident Routing
 */

export const SAFE_MAX_RATIO = 1.5
export const SAFE_MAX_EXTRA_SECONDS = 900 // 15 minutes in seconds
export const MIN_IMPROVEMENT = 0.10 // 10% lower exposure required to offer "Safest"

export const HAZARD_SEGMENT_COLORS = {
    0: "#2563eb", // blue (safe / none)
    1: "#2563eb", // blue (low)
    2: "#f59e0b", // amber (moderate)
    3: "#ea580c", // orange-red (high)
    4: "#991b1b", // dark red (very high)
}

export function getSegmentColor(worstClass) {
    return HAZARD_SEGMENT_COLORS[worstClass] ?? "#2563eb"
}

export function getSavedRoutePref() {
    try {
        const pref = localStorage.getItem("bakwit_route_pref")
        if (pref === "fastest" || pref === "safest") return pref
    } catch (_e) {}
    return "safest"
}

export function saveRoutePref(pref) {
    try {
        localStorage.setItem("bakwit_route_pref", pref)
    } catch (_e) {}
}

/**
 * Format meters_by_class into a readable summary string:
 * e.g. "320 m through high/very high flood-prone area, 0 m landslide-prone"
 */
export function formatExposureSummary(meters_by_class) {
    if (!meters_by_class) return ""
    const floodHigh = Math.round((meters_by_class.flood?.high || 0) + (meters_by_class.flood?.very_high || 0))
    const landslideHigh = Math.round((meters_by_class.landslide?.high || 0) + (meters_by_class.landslide?.very_high || 0))
    return `${floodHigh.toLocaleString()} m through high/very high flood-prone area, ${landslideHigh.toLocaleString()} m landslide-prone`
}

/**
 * Return total meters of high/very-high hazard on this route
 */
export function getHighHazardMeters(meters_by_class) {
    if (!meters_by_class?.worst) return 0
    return Math.round((meters_by_class.worst.high || 0) + (meters_by_class.worst.very_high || 0))
}

/**
 * Reject candidates that duplicate an existing one (>90% shared vertices).
 */
export function isDuplicateRoute(coordsA, coordsB, threshold = 0.90) {
    if (!coordsA || !coordsB || coordsA.length === 0 || coordsB.length === 0) return false
    let sharedCount = 0
    for (const ptB of coordsB) {
        for (const ptA of coordsA) {
            const dLat = ptB[0] - ptA[0]
            const dLng = ptB[1] - ptA[1]
            if (dLat * dLat + dLng * dLng < 0.00000005) {
                sharedCount++
                break
            }
        }
    }
    return (sharedCount / coordsB.length) > threshold
}

/**
 * Reject candidates that double back on themselves.
 */
export function isDoublingBack(coords) {
    if (!coords || coords.length < 6) return false
    const n = coords.length
    for (let i = 0; i < n - 6; i++) {
        const [latA, lngA] = coords[i]
        for (let j = i + 6; j < n; j++) {
            const [latB, lngB] = coords[j]
            const dLat = latB - latA
            const dLng = lngB - lngA
            if (dLat * dLat + dLng * dLng < 0.00000005) {
                return true
            }
        }
    }
    return false
}

/**
 * Sum high and very_high meters for flood and landslide (matches formatExposureSummary)
 */
export function getHighHazardTotalMeters(meters_by_class) {
    if (!meters_by_class) return 0
    const floodHigh = Number(meters_by_class.flood?.high || 0) + Number(meters_by_class.flood?.very_high || 0)
    const landslideHigh = Number(meters_by_class.landslide?.high || 0) + Number(meters_by_class.landslide?.very_high || 0)
    return Math.max(0, Math.round(floodHigh + landslideHigh))
}

const isDev = Boolean(import.meta.env?.DEV ?? (typeof process !== "undefined" && process.env?.NODE_ENV !== "production"))

function logDebugTable(candidates, scoredMap, fastest, safestCandidate, offersSafest, isHazardUnavailable, debugOptions = {}) {
    if (debugOptions.viaPointsCount !== undefined) {
        console.log(`[Route Detour] Backend returned ${debugOptions.viaPointsCount} via points`)
    }

    const allList = debugOptions.allAttempted && debugOptions.allAttempted.length > 0
        ? debugOptions.allAttempted
        : candidates

    const tableRows = allList.map((c) => {
        const s = scoredMap?.[c.id]
        const rawDistKm = Number(c.distanceKm ?? (c.distance != null ? c.distance / 1000 : (c.distanceMeters != null ? c.distanceMeters / 1000 : 0)))
        const distKm = Number.isFinite(rawDistKm) ? Number(rawDistKm.toFixed(2)) : 0
        const durationSec = Number(c.durationSec ?? (c.duration != null ? c.duration : (c.durationMins != null ? c.durationMins * 60 : 0)))
        const durationMins = Number(c.durationMins ?? Math.max(1, Math.round(durationSec / 60)))
        const rawExp = Number(s?.exposure_index ?? c.exposure_index ?? 0)
        const expIndex = Number.isFinite(rawExp) ? rawExp : null

        let verdict = "accepted"
        if (c.dropReason) {
            verdict = c.dropReason
        } else if (isHazardUnavailable) {
            verdict = c.id === fastest?.id ? "accepted" : "under 10% improvement"
        } else if (!fastest) {
            verdict = "accepted"
        } else if (durationSec > fastest.durationSec * SAFE_MAX_RATIO) {
            verdict = "over time ratio"
        } else if (durationSec > fastest.durationSec + SAFE_MAX_EXTRA_SECONDS) {
            verdict = "over extra seconds"
        } else {
            const expDiff = fastest.exposure_index - (expIndex ?? 0)
            const impRatio = fastest.exposure_index > 0 ? expDiff / fastest.exposure_index : 0
            if (c.id === fastest.id) {
                verdict = "accepted"
            } else if (impRatio < MIN_IMPROVEMENT) {
                verdict = "under 10% improvement"
            } else if (safestCandidate && c.id === safestCandidate.id && offersSafest) {
                verdict = "accepted"
            } else {
                verdict = "under 10% improvement"
            }
        }

        let pctVsFastest = "--"
        if (expIndex !== null && fastest && fastest.exposure_index > 0 && !c.dropReason) {
            const pct = (expIndex / fastest.exposure_index) * 100
            pctVsFastest = `${pct.toFixed(1)}%`
        }

        const extraMin = fastest ? Math.round(durationMins - fastest.durationMins) : 0
        const extraMinStr = extraMin > 0 ? `+${extraMin}` : `${extraMin}`

        return {
            source: c.source || (String(c.id).startsWith("via") ? "via-detour" : "osrm-alt"),
            distanceKm: distKm,
            "duration min": durationMins,
            "exposure index": (!c.dropReason && expIndex !== null) ? Math.round(expIndex) : "--",
            "% exposure vs fastest": pctVsFastest,
            "extra min vs fastest": extraMinStr,
            verdict,
        }
    })

    console.table(tableRows)
}

/**
 * Evaluate candidates and scored data to select fastest vs safest:
 * - fastest = lowest duration
 * - safest = lowest exposure_index among candidates with duration <= min(fastest*1.5, fastest+900s); tie -> shorter duration
 * - Offer "Safest" only if it differs from fastest AND exposure_index is >= 10% lower.
 *   Otherwise single route labeled "No safer route found nearby" (or "Fastest route" if hazard check unavailable).
 *
 * @param {Array<object>} candidates - [{ id, route, coords, distanceKm, durationMins, durationSec }]
 * @param {object|null} scoredMap - { [id]: { length_m, exposure_index, meters_by_class, segments } }
 * @param {object} [debugOptions] - { allAttempted: Array<object>, viaPointsCount: number }
 * @returns {object} { hasSafestOption, fastest, safest, singleRoute, singleRouteLabel, isHazardUnavailable, candidatesCount, extraMins, lessExposureMeters, diffSummary }
 */
export function evaluateRouteCandidates(candidates, scoredMap, debugOptions = {}) {
    if (!candidates || candidates.length === 0) {
        return {
            hasSafestOption: false,
            fastest: null,
            safest: null,
            singleRoute: null,
            singleRouteLabel: "No route available",
            isHazardUnavailable: false,
            candidatesCount: 0,
            extraMins: 0,
            lessExposureMeters: 0,
            diffSummary: "",
        }
    }

    const isHazardUnavailable = !scoredMap || Object.keys(scoredMap).length === 0

    // Enrich and normalize candidates with scoring info and guaranteed numeric fields
    const enriched = candidates.map((c) => {
        const s = scoredMap?.[c.id]

        const rawDistKm = Number(c.distanceKm ?? (c.distance != null ? c.distance / 1000 : (c.distanceMeters != null ? c.distanceMeters / 1000 : 0)))
        const distKm = Number.isFinite(rawDistKm) ? rawDistKm : 0

        const rawDurationSec = Number(c.durationSec ?? (c.duration != null ? c.duration : (c.durationMins != null ? c.durationMins * 60 : 0)))
        const durationSec = Number.isFinite(rawDurationSec) ? rawDurationSec : 0

        const rawDurationMins = Number(c.durationMins ?? Math.max(1, Math.round(durationSec / 60)))
        const durationMins = Number.isFinite(rawDurationMins) ? rawDurationMins : 1

        const rawExposure = Number(s?.exposure_index ?? c.exposure_index ?? 0)
        const exposureIndex = Number.isFinite(rawExposure) ? rawExposure : 0

        return {
            ...c,
            distanceKm: distKm,
            durationSec,
            durationMins,
            exposure_index: exposureIndex,
            meters_by_class: s?.meters_by_class ?? c.meters_by_class ?? null,
            segments: s?.segments ?? c.segments ?? [[0, (c.coords?.length || 1) - 1, 0]],
        }
    })

    // 1. Fastest = lowest duration
    const sortedByDuration = [...enriched].sort((a, b) => a.durationSec - b.durationSec)
    const fastest = sortedByDuration[0]

    if (isHazardUnavailable || candidates.length === 1) {
        const singleResult = {
            hasSafestOption: false,
            fastest,
            safest: fastest,
            singleRoute: fastest,
            singleRouteLabel: isHazardUnavailable
                ? "Fastest route"
                : "No safer route found nearby",
            isHazardUnavailable,
            candidatesCount: candidates.length,
            extraMins: 0,
            lessExposureMeters: 0,
            diffSummary: "",
        }
        if (isDev) {
            logDebugTable(enriched, scoredMap, fastest, fastest, false, isHazardUnavailable, debugOptions)
        }
        return singleResult
    }

    // 2. Safest candidate criteria: duration <= min(fastest * 1.5, fastest + 900s)
    const maxAllowedDuration = Math.min(
        fastest.durationSec * SAFE_MAX_RATIO,
        fastest.durationSec + SAFE_MAX_EXTRA_SECONDS
    )

    const eligibleForSafe = enriched.filter((c) => c.durationSec <= maxAllowedDuration)

    // Sort by exposure_index ascending; tie breaker: durationSec ascending
    eligibleForSafe.sort((a, b) => {
        if (Math.abs(a.exposure_index - b.exposure_index) > 0.01) {
            return a.exposure_index - b.exposure_index
        }
        return a.durationSec - b.durationSec
    })

    const safestCandidate = eligibleForSafe[0] || fastest

    // 3. Offer "Safest" only if it differs from fastest AND exposure_index is at least 10% lower
    const isDifferent = safestCandidate.id !== fastest.id
    const exposureDiff = fastest.exposure_index - safestCandidate.exposure_index
    const improvementRatio = fastest.exposure_index > 0 ? exposureDiff / fastest.exposure_index : 0
    const offersSafest = isDifferent && improvementRatio >= MIN_IMPROVEMENT

    if (offersSafest) {
        const extraMins = Math.max(0, Math.round(safestCandidate.durationMins - fastest.durationMins))

        // Same metric as formatExposureSummary: sum of high + very_high for flood + landslide
        const fastestHighM = getHighHazardTotalMeters(fastest.meters_by_class)
        const safestHighM = getHighHazardTotalMeters(safestCandidate.meters_by_class)
        const lessHighHazardM = Math.max(0, fastestHighM - safestHighM)

        const diffSummary = lessHighHazardM > 0
            ? `+${extraMins} min, ${lessHighHazardM.toLocaleString()} m less exposure`
            : (extraMins > 0 ? `+${extraMins} min (lower hazard)` : "Lower hazard")

        const result = {
            hasSafestOption: true,
            fastest,
            safest: safestCandidate,
            singleRoute: null,
            singleRouteLabel: null,
            isHazardUnavailable: false,
            candidatesCount: candidates.length,
            extraMins,
            lessExposureMeters: lessHighHazardM,
            diffSummary,
        }

        if (isDev) {
            logDebugTable(enriched, scoredMap, fastest, safestCandidate, true, false, debugOptions)
        }

        return result
    }

    const fallbackResult = {
        hasSafestOption: false,
        fastest,
        safest: fastest,
        singleRoute: fastest,
        singleRouteLabel: "No safer route found nearby",
        isHazardUnavailable: false,
        candidatesCount: candidates.length,
        extraMins: 0,
        lessExposureMeters: 0,
        diffSummary: "",
    }

    if (isDev) {
        logDebugTable(enriched, scoredMap, fastest, safestCandidate, false, false, debugOptions)
    }

    return fallbackResult
}
