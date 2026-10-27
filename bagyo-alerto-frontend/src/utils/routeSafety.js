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
    return `${floodHigh} m through high/very high flood-prone area, ${landslideHigh} m landslide-prone`
}

/**
 * Return total meters of high/very-high hazard on this route
 */
export function getHighHazardMeters(meters_by_class) {
    if (!meters_by_class?.worst) return 0
    return Math.round((meters_by_class.worst.high || 0) + (meters_by_class.worst.very_high || 0))
}

/**
 * Evaluate candidates and scored data to select fastest vs safest:
 * - fastest = lowest duration
 * - safest = lowest exposure_index among candidates with duration <= min(fastest*1.5, fastest+900s); tie -> shorter duration
 * - Offer "Safest" only if it differs from fastest AND exposure_index is >= 10% lower.
 *   Otherwise single route labeled "Fastest and safest available".
 *
 * @param {Array<object>} candidates - [{ id, route, coords, distanceKm, durationMins, durationSec }]
 * @param {object|null} scoredMap - { [id]: { length_m, exposure_index, meters_by_class, segments } }
 * @returns {object} { hasSafestOption, fastest, safest, singleRoute, singleRouteLabel, isHazardUnavailable }
 */
export function evaluateRouteCandidates(candidates, scoredMap) {
    if (!candidates || candidates.length === 0) {
        return {
            hasSafestOption: false,
            fastest: null,
            safest: null,
            singleRoute: null,
            singleRouteLabel: "No route available",
            isHazardUnavailable: false,
        }
    }

    const isHazardUnavailable = !scoredMap || Object.keys(scoredMap).length === 0

    // Enrich candidates with scoring info
    const enriched = candidates.map((c) => {
        const s = scoredMap?.[c.id]
        return {
            ...c,
            exposure_index: s?.exposure_index ?? 0,
            meters_by_class: s?.meters_by_class ?? null,
            segments: s?.segments ?? [[0, c.coords.length - 1, 0]],
        }
    })

    // 1. Fastest = lowest duration
    const sortedByDuration = [...enriched].sort((a, b) => a.durationSec - b.durationSec)
    const fastest = sortedByDuration[0]

    if (isHazardUnavailable || candidates.length === 1) {
        return {
            hasSafestOption: false,
            fastest,
            safest: fastest,
            singleRoute: fastest,
            singleRouteLabel: isHazardUnavailable ? "Fastest route" : "Fastest and safest available",
            isHazardUnavailable,
        }
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
        return {
            hasSafestOption: true,
            fastest,
            safest: safestCandidate,
            singleRoute: null,
            singleRouteLabel: null,
            isHazardUnavailable: false,
        }
    }

    return {
        hasSafestOption: false,
        fastest,
        safest: fastest,
        singleRoute: fastest,
        singleRouteLabel: "Fastest and safest available",
        isHazardUnavailable: false,
    }
}
