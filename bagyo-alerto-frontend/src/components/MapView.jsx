import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { Navigation, AlertTriangle, CheckCircle2, WifiOff, MapPin, Loader, Camera, Info, Shield, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react"
import { useLiveLocation } from "../hooks/useLiveLocation"
import { useNearestCenter } from "../hooks/useNearestCenter"
import { HazardBadge } from "./HazardBadge"
import { HazardControl, HazardOverlayRenderer } from "./HazardOverlay"
import {
    getSegmentColor,
    getSavedRoutePref,
    saveRoutePref,
    formatExposureSummary,
    formatSaferCenterDelta,
    evaluateRouteCandidates,
    isDuplicateRoute,
    isDoublingBack,
    getRouteSafetyBanner,
} from "../utils/routeSafety"

const HAZARD_LS_KEY = "bakwit_hazard_layers"
const HAZARD_DEFAULT_OPACITY = 0.55

function loadHazardState() {
    try {
        const raw = localStorage.getItem(HAZARD_LS_KEY)
        if (!raw) return null
        return JSON.parse(raw)
    } catch (_e) {
        return null
    }
}

function saveHazardState(val) {
    try {
        localStorage.setItem(HAZARD_LS_KEY, JSON.stringify(val))
    } catch (_e) {
        /* ignore */
    }
}

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
})

// Map tile styling constants (OpenStreetMap standard & Satellite)
const STREET_TILES_URL = import.meta.env.VITE_STREET_TILES_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const STREET_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
const SATELLITE_ATTRIBUTION = "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"

// User marker: blue dot with a white border
const userLiveIcon = L.divIcon({
    html: `<div style="
        width: 14px;
        height: 14px;
        background: #2563eb;
        border: 2.5px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
        box-sizing: border-box;
    "></div>`,
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -9],
})

// Center marker: inline SVG pin (no emoji)
const evacuationIcon = L.divIcon({
    html: `<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="#dc2626"/>
        <circle cx="14" cy="13" r="5" fill="#ffffff"/>
    </svg>`,
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -36],
})

// Barangay starting marker: inline SVG pin (no emoji)
const barangayIcon = L.divIcon({
    html: `<svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 18 12 18s12-9 12-18c0-6.627-5.373-12-12-12z" fill="#2563eb"/>
        <circle cx="12" cy="12" r="4" fill="#ffffff"/>
    </svg>`,
    className: "",
    iconSize: [24, 30],
    iconAnchor: [12, 30],
    popupAnchor: [0, -30],
})

// Call fitBounds on the route with 40px padding on route load or change only
function RouteBoundsFitter({ routeCoords }) {
    const map = useMap()
    const lastRouteKeyRef = useRef(null)

    useEffect(() => {
        if (!routeCoords || routeCoords.length < 2) return

        const routeKey = `${routeCoords[0][0]},${routeCoords[0][1]}_${routeCoords[routeCoords.length - 1][0]},${routeCoords[routeCoords.length - 1][1]}_${routeCoords.length}`
        if (lastRouteKeyRef.current === routeKey) {
            return
        }
        lastRouteKeyRef.current = routeKey

        const bounds = L.latLngBounds(routeCoords)
        map.fitBounds(bounds, { padding: [40, 40] })
    }, [routeCoords, map])

    return null
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
        return 0
    }
    const R = 6371000 // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

const API_BASE = import.meta.env.VITE_API_BASE
const API_ORIGIN = API_BASE ? API_BASE.replace(/\/api\/?$/, "") : ""
const OSRM_URL_FOOT = (import.meta.env.VITE_OSRM_URL_FOOT || import.meta.env.VITE_OSRM_URL || "https://routing.openstreetmap.de/routed-foot").replace(/\/+$/, "")
const OSRM_URL_CAR = (import.meta.env.VITE_OSRM_URL_CAR || "https://routing.openstreetmap.de/routed-car").replace(/\/+$/, "")
const OSRM_PROFILE_FOOT = import.meta.env.VITE_OSRM_PROFILE_FOOT || import.meta.env.VITE_OSRM_PROFILE || "foot"
const OSRM_PROFILE_CAR = import.meta.env.VITE_OSRM_PROFILE_CAR || "car"

async function fetchOsrmRoute(startLng, startLat, endLng, endLat, mode = "foot", { signal, timeoutMs = 20000 } = {}) {
    const isCar = mode === "car"
    const coords = `${startLng},${startLat};${endLng},${endLat}`

    const primaryUrl = isCar ? OSRM_URL_CAR : OSRM_URL_FOOT
    const primaryProfile = isCar ? OSRM_PROFILE_CAR : OSRM_PROFILE_FOOT

    const primaryEndpoint = `${primaryUrl}/route/v1/${primaryProfile}/${coords}?overview=full&geometries=geojson&alternatives=true`
    const backupEndpoint = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=true`

    const endpoints = [
        { url: primaryEndpoint, isBackup: false },
        { url: backupEndpoint, isBackup: true },
    ]

    for (const ep of endpoints) {
        const controller = new AbortController()
        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort)
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            console.log(`[Route] requesting (${mode}):`, ep.url)
            const res = await fetch(ep.url, { signal: controller.signal })
            if (!res.ok) continue
            const data = await res.json()
            if (data.code === "Ok" && Array.isArray(data.routes) && data.routes.length > 0) {
                const routes = data.routes.slice(0, 3)
                return { routes, route: routes[0], isBackup: ep.isBackup }
            }
        } catch (_err) {
            // try next endpoint
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }

    // Additional fallback for foot: try backend route proxy if available
    if (!isCar && API_BASE) {
        const qs = new URLSearchParams({
            from_lat: startLat, from_lng: startLng, to_lat: endLat, to_lng: endLng,
        })
        const controller = new AbortController()
        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort)
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const res = await fetch(`${API_BASE}/route?${qs}`, { signal: controller.signal })
            if (res.ok) {
                const data = await res.json()
                if (data.route) return { routes: [data.route], route: data.route, isBackup: false }
            }
        } catch (_err) {
            // ignore
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }

    throw new Error("OSRM route service unavailable")
}

async function fetchOsrmViaRoute(startLng, startLat, viaLng, viaLat, endLng, endLat, mode = "foot", { signal, timeoutMs = 12000 } = {}) {
    const isCar = mode === "car"
    const coords = `${startLng},${startLat};${viaLng},${viaLat};${endLng},${endLat}`

    const primaryUrl = isCar ? OSRM_URL_CAR : OSRM_URL_FOOT
    const primaryProfile = isCar ? OSRM_PROFILE_CAR : OSRM_PROFILE_FOOT

    const primaryEndpoint = `${primaryUrl}/route/v1/${primaryProfile}/${coords}?overview=full&geometries=geojson&alternatives=false`
    const backupEndpoint = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false`

    const endpoints = [
        { url: primaryEndpoint, isBackup: false },
        { url: backupEndpoint, isBackup: true },
    ]

    for (const ep of endpoints) {
        const controller = new AbortController()
        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort)
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const res = await fetch(ep.url, { signal: controller.signal })
            if (!res.ok) continue
            const data = await res.json()
            if (data.code === "Ok" && Array.isArray(data.routes) && data.routes.length > 0) {
                return { route: data.routes[0], isBackup: ep.isBackup }
            }
        } catch (_err) {
            // try next endpoint
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }
    return null
}

export function formatDuration(minutes) {
    if (minutes == null || !Number.isFinite(minutes)) return "—"
    const m = Math.round(minutes)
    if (m < 60) {
        return `${m} min`
    }
    const hrs = Math.floor(m / 60)
    const remMins = m % 60
    return remMins > 0 ? `${hrs} h ${remMins} min` : `${hrs} h`
}

export const formatWalkTime = formatDuration

function getCenterHazardNote(center) {
    if (!center) return "Center hazard info unavailable."
    const HAZARD_RANK = { low: 1, moderate: 2, high: 3, very_high: 4 }
    const floodHigh = (HAZARD_RANK[center.flood_susceptibility] || 0) >= 3
    const landslideHigh = (HAZARD_RANK[center.landslide_susceptibility] || 0) >= 3

    if (floodHigh && landslideHigh) {
        return "Center is located in a flood and landslide-prone area."
    }
    if (floodHigh) {
        return "Center is located in a flood-prone area."
    }
    if (landslideHigh) {
        return "Center is located in a landslide-prone area."
    }
    return "Center is in a low-hazard area."
}

const BANNER_STYLES = {
    clear: {
        bg: "#f0fdf4",
        border: "#bbf7d0",
        color: "#166534",
        icon: CheckCircle2,
        iconColor: "#16a34a",
    },
    caution: {
        bg: "#fffbeb",
        border: "#fde68a",
        color: "#92400e",
        icon: AlertTriangle,
        iconColor: "#d97706",
    },
    high_risk: {
        bg: "#fef2f2",
        border: "#fecaca",
        color: "#991b1b",
        icon: AlertTriangle,
        iconColor: "#dc2626",
    },
    unavailable: {
        bg: "#f8fafc",
        border: "#e2e8f0",
        color: "#475569",
        icon: Info,
        iconColor: "#64748b",
    },
}

export default function MapView({
    evacuationCenter: initialCenter,
    barangay,
    travelMode: propTravelMode,
    onTravelModeChange: propOnTravelModeChange,
    onRoutingChange,
    onRoutedCenterChange,
    onRouteDistanceChange,
    onRouteMinutesChange,
    onLiveGpsChange,
    // Hazard suggestion / preferred-center override
    preferredCenterId: propPreferredCenterId,
    onPreferredCenterChange,
    onHazardSuggestionChange,
    onNearestCenterOverrideRef,   // receives { setPreferredCenter, clearPreferredCenter }
    onBaseTargetChange,
    onClearOverride,
    routePref: propRoutePref,
    onRoutePrefChange: propOnRoutePrefChange,
    onRouteSafetyChange,
}) {
    const [internalRoutePref, setInternalRoutePref] = useState(() => getSavedRoutePref())
    const routePref = propRoutePref || internalRoutePref
    const handleRoutePrefChange = useCallback((newPref) => {
        saveRoutePref(newPref)
        if (propOnRoutePrefChange) {
            propOnRoutePrefChange(newPref)
        } else {
            setInternalRoutePref(newPref)
        }
    }, [propOnRoutePrefChange])

    const [routeSafetyResult, setRouteSafetyResult] = useState(null)
    const [internalOverrideId, setInternalOverrideId] = useState(null)
    const activeOverrideId = propPreferredCenterId != null ? propPreferredCenterId : internalOverrideId

    const [internalTravelMode, setInternalTravelMode] = useState(() => {
        try {
            const s = localStorage.getItem("bakwit_travel_mode")
            if (s === "car" || s === "foot") return s
        } catch (_e) {
            /* ignore */
        }
        return "foot"
    })
    const travelMode = propTravelMode || internalTravelMode
    const handleTravelModeChange = useCallback((newMode) => {
        setRouteSafetyResult(null)
        onRouteSafetyChange?.(null)
        if (propOnTravelModeChange) {
            propOnTravelModeChange(newMode)
        } else {
            setInternalTravelMode(newMode)
        }
        try {
            localStorage.setItem("bakwit_travel_mode", newMode)
        } catch (_e) {
            /* ignore */
        }
    }, [propOnTravelModeChange, onRouteSafetyChange])

    const [mapType, setMapType] = useState("street")
    const [mapReady, setMapReady] = useState(false)
    const [routeMode, setRouteMode] = useState("nearest") // "nearest" | "barangay" (session-only)
    const [hazardDetailsOpen, setHazardDetailsOpen] = useState(false)

    // Hazard overlay state (persisted via localStorage in HazardOverlay too, but we
    // own it here so HazardControl (outside MapContainer) and HazardOverlayRenderer
    // (inside MapContainer) share a single source of truth).
    const [hazardLayers, setHazardLayers] = useState(() => {
        const stored = loadHazardState()
        return stored?.activeLayers ?? { flood: false, landslide: false }
    })
    const [hazardOpacity, setHazardOpacity] = useState(() => {
        const stored = loadHazardState()
        return stored?.opacity ?? HAZARD_DEFAULT_OPACITY
    })

    useEffect(() => {
        saveHazardState({ activeLayers: hazardLayers, opacity: hazardOpacity })
    }, [hazardLayers, hazardOpacity])

    const handleHazardToggle = useCallback((key) => {
        setHazardLayers((prev) => ({ ...prev, [key]: !prev[key] }))
    }, [])
    const [barangayTarget, setBarangayTarget] = useState(initialCenter || null)
    const [barangayTargetLoading, setBarangayTargetLoading] = useState(false)
    const [barangayTargetError, setBarangayTargetError] = useState(null)

    const [routeCoords, setRouteCoords] = useState([])
    const [routeDistance, setRouteDistance] = useState(null)
    const [routeMinutes, setRouteMinutes] = useState(null)
    const [routeLoading, setRouteLoading] = useState(false)
    const [isOfflineRoute, setIsOfflineRoute] = useState(false)

    const [photoUrl, setPhotoUrl] = useState(null)
    const [photoLoading, setPhotoLoading] = useState(true)

    const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false))
    const [lastUpdated, setLastUpdated] = useState(() => Date.now())
    const [secondsAgo, setSecondsAgo] = useState(0)

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handleResize)
        return () => window.removeEventListener("resize", handleResize)
    }, [])

    const barangayId = barangay?.value || barangay?.id

    // Requirement 2: Call useLiveLocation with enabled = true once a barangay is selected
    const { position, accuracy, status: gpsStatus } = useLiveLocation(Boolean(barangayId))
    const hasLiveGps = Boolean(position && Number.isFinite(position.lat) && Number.isFinite(position.lng))

    // Call useNearestCenter with live GPS position and travel mode (enabled for both nearest and barangay modes)
    const {
        nearestCenter,
        allCentersWithMetrics,
        isFull: nearestIsFull,
        isFallback: nearestIsFallback,
        fallbackNotice: nearestFallbackNotice,
        loading: nearestLoading,
        lowerHazardSuggestion,
        setPreferredCenter,
        clearPreferredCenter,
    } = useNearestCenter(position, {
        enabled: Boolean(barangayId),
        mode: travelMode,
        targetCenter: routeMode === "barangay" ? barangayTarget : null,
    })

    const handleRouteToSaferCenter = useCallback((centerId) => {
        setInternalOverrideId(centerId)
        setPreferredCenter(centerId)
        onPreferredCenterChange?.(centerId)
    }, [setPreferredCenter, onPreferredCenterChange])

    const handleBackToOriginalCenter = useCallback(() => {
        setInternalOverrideId(null)
        clearPreferredCenter()
        onPreferredCenterChange?.(null)
        onClearOverride?.()
    }, [clearPreferredCenter, onPreferredCenterChange, onClearOverride])

    // Forward active override ID into hook when parent supplies it or local state changes
    useEffect(() => {
        if (activeOverrideId != null) {
            setPreferredCenter(activeOverrideId)
        } else {
            clearPreferredCenter()
        }
    }, [activeOverrideId, setPreferredCenter, clearPreferredCenter])

    // Reset override when barangay changes
    useEffect(() => {
        setInternalOverrideId(null)
    }, [barangayId])

    // Surface hazard suggestion and override controls to parent
    useEffect(() => {
        onHazardSuggestionChange?.(lowerHazardSuggestion)
    }, [lowerHazardSuggestion, onHazardSuggestionChange])

    useEffect(() => {
        if (onNearestCenterOverrideRef) {
            onNearestCenterOverrideRef.current = { setPreferredCenter, clearPreferredCenter }
        }
    }, [setPreferredCenter, clearPreferredCenter, onNearestCenterOverrideRef])

    // Base target (before any user override)
    const baseTarget = useMemo(() => {
        if (routeMode === "barangay") {
            return barangayTarget
        }
        if (!nearestIsFallback && nearestCenter) {
            return nearestCenter
        }
        return barangayTarget
    }, [routeMode, nearestIsFallback, nearestCenter, barangayTarget])

    useEffect(() => {
        onBaseTargetChange?.(baseTarget)
    }, [baseTarget, onBaseTargetChange])

    // Effective target (with preferredCenter override if active)
    const target = useMemo(() => {
        if (activeOverrideId != null) {
            if (allCentersWithMetrics?.length > 0) {
                const preferred = allCentersWithMetrics.find((c) => c.id === activeOverrideId)
                if (preferred) return preferred
            }
            if (lowerHazardSuggestion?.id === activeOverrideId) {
                return lowerHazardSuggestion
            }
        }
        return baseTarget
    }, [activeOverrideId, allCentersWithMetrics, lowerHazardSuggestion, baseTarget])

    const isFull = useMemo(() => {
        if (routeMode === "nearest" && !nearestIsFallback && nearestCenter) {
            return Boolean(nearestIsFull || nearestCenter.is_full || (nearestCenter.free_space !== undefined && nearestCenter.free_space <= 0))
        }
        if (barangayTarget) {
            return Boolean(barangayTarget.current_occupancy >= barangayTarget.capacity)
        }
        return false
    }, [routeMode, nearestIsFallback, nearestCenter, nearestIsFull, barangayTarget])

    const fallbackNotice = useMemo(() => {
        if (routeMode !== "nearest") return null
        if (nearestIsFallback) {
            return nearestFallbackNotice || "Using your barangay's designated evacuation center."
        }
        return null
    }, [routeMode, nearestIsFallback, nearestFallbackNotice])

    const targetLoading = (routeMode === "nearest" && nearestLoading && !barangayTarget) || (barangayTargetLoading && !target)
    const targetError = routeMode === "barangay" ? barangayTargetError : (target ? null : (barangayTargetError || "No evacuation center available"))

    // Call-rate guard refs:
    const lastScoredPosRef = useRef(null)
    const lastScoredTimeRef = useRef(0)
    const lastScoredTargetIdRef = useRef(null)
    const lastScoredModeRef = useRef(null)

    // Throttle tracking refs: re-fetch only after moving > 30 m AND at least 15 s have passed
    const lastFetchedPosRef = useRef(null)
    const lastFetchedTimeRef = useRef(0)
    const activeTargetIdRef = useRef(null)

    const routeAbortRef = useRef(null)
    const routeReqIdRef = useRef(0)

    const loadRoute = useCallback(async ({ startLat, startLng, destLat, destLng, cacheKey, mode = travelMode, onFail }) => {
        routeAbortRef.current?.abort()
        const controller = new AbortController()
        routeAbortRef.current = controller
        const reqId = ++routeReqIdRef.current
        setRouteLoading(true)

        try {
            const { routes, route, isBackup } = await fetchOsrmRoute(startLng, startLat, destLng, destLat, mode, {
                signal: controller.signal,
            })
            if (reqId !== routeReqIdRef.current) return

            let candidateList = (routes && routes.length > 0 ? routes : [route]).map((r, idx) => {
                const coords = r.geometry.coordinates.map((c) => [c[1], c[0]])
                const distKm = Number((r.distance / 1000).toFixed(2))
                let mins
                if (mode === "car") {
                    mins = Math.max(1, Math.round(r.duration / 60))
                } else {
                    mins = isBackup
                        ? Math.max(1, Math.round((r.distance / 1000 / 4.5) * 60))
                        : Math.max(1, Math.round(r.duration / 60))
                }
                return {
                    id: String(idx),
                    source: "osrm-alt",
                    route: r,
                    coords,
                    distanceKm: distKm,
                    durationMins: mins,
                    durationSec: Number(r.duration),
                }
            })

            const allAttemptedCandidates = [...candidateList]
            let viaPointsCount = 0

            // Call-rate guard: re-score only when:
            // - destination changed (target.id)
            // - travel mode changed
            // - user moved > 150m from last scored origin AND >= 30s have passed
            const now = Date.now()
            const targetChanged = lastScoredTargetIdRef.current !== target?.id
            const modeChanged = lastScoredModeRef.current !== mode
            let movedM = 0
            if (lastScoredPosRef.current) {
                movedM = getDistanceInMeters(startLat, startLng, lastScoredPosRef.current.lat, lastScoredPosRef.current.lng)
            }
            const timeSinceLastScore = now - lastScoredTimeRef.current
            const shouldScore = targetChanged || modeChanged || !lastScoredPosRef.current || (movedM > 150 && timeSinceLastScore >= 30000)

            // When re-scoring is needed, fetch detour candidates (max 3 extra OSRM calls per refresh)
            if (shouldScore && candidateList[0]?.coords) {
                try {
                    const viaController = new AbortController()
                    const viaTimer = setTimeout(() => viaController.abort(), 6000)
                    const viaRes = await fetch(`${API_BASE}/route-via-candidates`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            coordinates: candidateList[0].coords,
                            mode,
                        }),
                        signal: viaController.signal,
                    }).finally(() => clearTimeout(viaTimer))

                    if (viaRes.ok) {
                        const viaData = await viaRes.json()
                        const viaPoints = (viaData.via_points || viaData.points || []).slice(0, 3)
                        viaPointsCount = viaPoints.length
                        if (import.meta.env.DEV) {
                            console.log(`[Route Detour] Backend returned ${viaPointsCount} via points`)
                        }
                        for (let vIdx = 0; vIdx < viaPoints.length; vIdx++) {
                            if (reqId !== routeReqIdRef.current) return
                            const vp = viaPoints[vIdx]
                            const vLat = vp[0] ?? vp.lat
                            const vLng = vp[1] ?? vp.lng
                            try {
                                const viaRouteRes = await fetchOsrmViaRoute(startLng, startLat, vLng, vLat, destLng, destLat, mode, {
                                    signal: controller.signal,
                                })
                                if (viaRouteRes?.route) {
                                    const r = viaRouteRes.route
                                    const rCoords = r.geometry.coordinates.map((c) => [c[1], c[0]])
                                    const isDup = candidateList.some((existing) => isDuplicateRoute(existing.coords, rCoords, 0.90))
                                    const doublesBack = isDoublingBack(rCoords)
                                    const rDistKm = Number((r.distance / 1000).toFixed(2))
                                    const rMins = mode === "car"
                                        ? Math.max(1, Math.round(r.duration / 60))
                                        : (viaRouteRes.isBackup
                                            ? Math.max(1, Math.round((r.distance / 1000 / 4.5) * 60))
                                            : Math.max(1, Math.round(r.duration / 60)))
                                    const viaCand = {
                                        id: `via_${vIdx}`,
                                        source: "via-detour",
                                        route: r,
                                        coords: rCoords,
                                        distanceKm: rDistKm,
                                        durationMins: rMins,
                                        durationSec: Number(r.duration),
                                    }

                                    if (isDup) {
                                        allAttemptedCandidates.push({ ...viaCand, dropReason: "duplicate" })
                                    } else if (doublesBack) {
                                        allAttemptedCandidates.push({ ...viaCand, dropReason: "doubling back" })
                                    } else {
                                        candidateList.push(viaCand)
                                        allAttemptedCandidates.push(viaCand)
                                    }
                                }
                            } catch (_viaErr) {
                                // ignore individual via routing failure
                            }
                        }
                    }
                } catch (_viaApiErr) {
                    // ignore detour api failure
                }
            }

            // Cap to 5 total candidates
            candidateList = candidateList.slice(0, 5)

            let scoredMap = null
            let hazardCheckFailed = false
            const scoreCacheKey = `bakwit_hazard_scored_${barangayId}_${target?.id}_${mode}`

            if (!shouldScore) {
                try {
                    const cachedScored = localStorage.getItem(scoreCacheKey)
                    if (cachedScored) {
                        scoredMap = JSON.parse(cachedScored)
                    }
                } catch (_e) {}
            }

            if (!scoredMap) {
                // Call /api/route-hazard-score with 8 s timeout
                const scoreController = new AbortController()
                const scoreTimer = setTimeout(() => scoreController.abort(), 8000)

                try {
                    const candidatePayload = candidateList.map((c) => ({
                        id: c.id,
                        coordinates: c.coords,
                    }))

                    const scoreRes = await fetch(`${API_BASE}/route-hazard-score`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ routes: candidatePayload }),
                        signal: scoreController.signal,
                    })

                    if (scoreRes.ok) {
                        const scoreData = await scoreRes.json()
                        if (Array.isArray(scoreData.routes)) {
                            scoredMap = {}
                            scoreData.routes.forEach((sr) => {
                                scoredMap[sr.id] = sr
                            })
                            try {
                                localStorage.setItem(scoreCacheKey, JSON.stringify(scoredMap))
                            } catch (_e) {}
                            lastScoredPosRef.current = { lat: startLat, lng: startLng }
                            lastScoredTimeRef.current = now
                            lastScoredModeRef.current = mode
                            lastScoredTargetIdRef.current = target?.id
                        }
                    } else {
                        hazardCheckFailed = true
                    }
                } catch (_err) {
                    hazardCheckFailed = true
                } finally {
                    clearTimeout(scoreTimer)
                }
            }

            if (reqId !== routeReqIdRef.current) return

            // Evaluate candidates according to selection rule
            const evaluation = evaluateRouteCandidates(candidateList, scoredMap, {
                allAttempted: allAttemptedCandidates,
                viaPointsCount,
            })
            if (hazardCheckFailed) {
                evaluation.isHazardUnavailable = true
            }

            setRouteSafetyResult(evaluation)
            onRouteSafetyChange?.(evaluation)

            // Active choice based on routePref
            const activeChoice = (evaluation.hasSafestOption && routePref === "fastest")
                ? evaluation.fastest
                : (evaluation.hasSafestOption ? evaluation.safest : (evaluation.singleRoute || evaluation.fastest))

            if (activeChoice) {
                setRouteCoords(activeChoice.coords)
                setRouteDistance(activeChoice.distanceKm)
                setRouteMinutes(activeChoice.durationMins)
            }
            setIsOfflineRoute(false)

            if (cacheKey) {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({
                        coords: activeChoice.coords,
                        distance: activeChoice.distanceKm,
                        duration: activeChoice.durationMins,
                        evaluation,
                    }))
                } catch (_e) {}
            }
        } catch (err) {
            // Cancelled or superseded: not a real failure, do not show fallback
            if (controller.signal.aborted && reqId !== routeReqIdRef.current) return
            if (reqId !== routeReqIdRef.current) return
            console.error("[Route] failed:", err?.name, err?.message)
            onFail?.()

            try {
                const cached = cacheKey && localStorage.getItem(cacheKey)
                if (cached) {
                    const parsed = JSON.parse(cached)
                    const startPt = parsed.coords?.[0]
                    if (startPt && getDistanceInMeters(startLat, startLng, startPt[0], startPt[1]) <= 150) {
                        setRouteCoords(parsed.coords)
                        setRouteDistance(parsed.distance)
                        setRouteMinutes(parsed.duration)
                        if (parsed.evaluation) {
                            setRouteSafetyResult(parsed.evaluation)
                            onRouteSafetyChange?.(parsed.evaluation)
                        }
                        setIsOfflineRoute(true)
                        return
                    }
                }
            } catch (_e) {}

            const fallbackCoords = [[startLat, startLng], [destLat, destLng]]
            setRouteCoords(fallbackCoords)
            const d = Number((getDistanceInMeters(startLat, startLng, destLat, destLng) / 1000).toFixed(2))
            setRouteDistance(d)
            const fallbackSpeed = mode === "car" ? 30 : 4.5
            const fallbackMins = Math.max(1, Math.round((d / fallbackSpeed) * 60))
            setRouteMinutes(fallbackMins)
            setIsOfflineRoute(true)

            const fallbackEval = {
                hasSafestOption: false,
                fastest: { coords: fallbackCoords, distanceKm: d, durationMins: fallbackMins, durationSec: fallbackMins * 60, segments: [] },
                safest: null,
                singleRoute: { coords: fallbackCoords, distanceKm: d, durationMins: fallbackMins, durationSec: fallbackMins * 60, segments: [] },
                singleRouteLabel: "Direct route (offline)",
                isHazardUnavailable: true,
            }
            setRouteSafetyResult(fallbackEval)
            onRouteSafetyChange?.(fallbackEval)
        } finally {
            if (reqId === routeReqIdRef.current) setRouteLoading(false)
        }
    }, [travelMode, barangayId, target, routePref, onRouteSafetyChange])

    const selectedRoute = useMemo(() => {
        if (!routeSafetyResult) return null
        if (routeSafetyResult.hasSafestOption) {
            return routePref === "fastest" ? routeSafetyResult.fastest : routeSafetyResult.safest
        }
        return routeSafetyResult.singleRoute || routeSafetyResult.fastest || null
    }, [routeSafetyResult, routePref])

    useEffect(() => {
        if (!selectedRoute) return
        if (selectedRoute.coords && selectedRoute.coords.length > 0) {
            setRouteCoords(selectedRoute.coords)
            setRouteDistance(selectedRoute.distanceKm)
            setRouteMinutes(selectedRoute.durationMins)
            onRouteDistanceChange?.(selectedRoute.distanceKm)
            onRouteMinutesChange?.(selectedRoute.durationMins)
        }
    }, [selectedRoute, onRouteDistanceChange, onRouteMinutesChange])

    const activeSegments = useMemo(() => {
        return selectedRoute?.segments || []
    }, [selectedRoute])

    useEffect(() => () => routeAbortRef.current?.abort(), [])

    // Notify parent whenever actual routed target center changes
    useEffect(() => {
        onRoutedCenterChange?.(target)
    }, [target, onRoutedCenterChange])

    // Notify parent of the computed route road distance
    useEffect(() => {
        onRouteDistanceChange?.(routeDistance)
    }, [routeDistance, onRouteDistanceChange])

    // Notify parent of the computed route travel duration in minutes
    useEffect(() => {
        onRouteMinutesChange?.(routeMinutes)
    }, [routeMinutes, onRouteMinutesChange])

    // Notify parent whether live GPS is active
    useEffect(() => {
        onLiveGpsChange?.(hasLiveGps)
    }, [hasLiveGps, onLiveGpsChange])

    useEffect(() => {
        setLastUpdated(Date.now())
        setSecondsAgo(0)
    }, [routeCoords, position, target])

    // Notify parent when a drawn route appears or disappears
    const routeActive = routeCoords.length > 1
    useEffect(() => {
        onRoutingChange?.(routeActive)
    }, [routeActive, onRoutingChange])

    useEffect(() => {
        const timer = setInterval(() => {
            setSecondsAgo(Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000)))
        }, 1000)
        return () => clearInterval(timer)
    }, [lastUpdated])

    // Reset routing cache when switching barangay or mode
    useEffect(() => {
        routeAbortRef.current?.abort()
        routeReqIdRef.current++
        setRouteCoords([])
        setRouteSafetyResult(null)
        onRouteSafetyChange?.(null)
        setIsOfflineRoute(false)
        activeTargetIdRef.current = null
        lastFetchedPosRef.current = null
        lastFetchedTimeRef.current = 0
    }, [barangayId, routeMode, travelMode, onRouteSafetyChange])

    // Fetch barangay's designated target from GET /api/barangays/{barangayId}/evacuation-target
    useEffect(() => {
        if (!barangayId) {
            setBarangayTarget(null)
            return
        }

        setBarangayTarget(null)
        setBarangayTargetLoading(true)

        let active = true

        fetch(`${API_BASE}/barangays/${barangayId}/evacuation-target`)
            .then(async (res) => {
                if (!active) return
                if (res.status === 404) {
                    setBarangayTarget(null)
                    setBarangayTargetError("No evacuation center available")
                    return
                }
                if (!res.ok) {
                    throw new Error(`Server returned status ${res.status}`)
                }
                const data = await res.json()
                if (!active) return
                setBarangayTarget(data)
                setBarangayTargetError(null)
                // Cache target in localStorage (Requirement 8 / 9)
                try {
                    localStorage.setItem(`bakwit_target_${barangayId}`, JSON.stringify(data))
                } catch (err) {
                    console.warn("Failed to cache target:", err)
                }
            })
            .catch(() => {
                if (!active) return
                // Try reading cached target (Requirement 8 / 9)
                try {
                    const cached = localStorage.getItem(`bakwit_target_${barangayId}`)
                    if (cached) {
                        setBarangayTarget(JSON.parse(cached))
                        setBarangayTargetError(null)
                        return
                    }
                } catch (_e) {
                    // ignore
                }

                if (initialCenter) {
                    setBarangayTarget(initialCenter)
                    setBarangayTargetError(null)
                } else {
                    setBarangayTarget(null)
                    setBarangayTargetError("No evacuation center available")
                }
            })
            .finally(() => {
                if (active) setBarangayTargetLoading(false)
            })

        return () => {
            active = false
        }
    }, [barangayId, initialCenter])

    // Requirement 3 & 5 & 8 & 9: Route calculation and throttling
    useEffect(() => {
        if (!target?.latitude || !target?.longitude) return

        const destLat = Number(target.latitude)
        const destLng = Number(target.longitude)
        const hasLivePosition = position && Number.isFinite(position.lat) && Number.isFinite(position.lng)

        // Case A: live GPS
        if (hasLivePosition) {
            const now = Date.now()
            const lastPos = lastFetchedPosRef.current
            const lastTime = lastFetchedTimeRef.current
            const targetChanged = activeTargetIdRef.current !== target.id

            let shouldFetch
            if (targetChanged) {
                shouldFetch = true
            } else if (!lastPos) {
                // previous attempt failed: retry, at most once per 15 s
                shouldFetch = now - lastTime >= 15000
            } else {
                const moved = getDistanceInMeters(lastPos.lat, lastPos.lng, position.lat, position.lng)
                shouldFetch = moved > 30 && now - lastTime >= 15000
            }
            if (!shouldFetch) return

            lastFetchedPosRef.current = { lat: position.lat, lng: position.lng }
            lastFetchedTimeRef.current = now
            activeTargetIdRef.current = target.id

            loadRoute({
                startLat: position.lat,
                startLng: position.lng,
                destLat,
                destLng,
                cacheKey: `bakwit_route_${barangayId}_${target.id}_${travelMode}`,
                mode: travelMode,
                onFail: () => { lastFetchedPosRef.current = null },
            })
            return
        }

        // Case B: no GPS, route from barangay center
        if (barangay?.latitude && barangay?.longitude) {
            loadRoute({
                startLat: Number(barangay.latitude),
                startLng: Number(barangay.longitude),
                destLat,
                destLng,
                cacheKey: `bakwit_route_fallback_${barangayId}_${target.id}_${travelMode}`,
                mode: travelMode,
            })
        }
    }, [target, position, barangayId, barangay?.latitude, barangay?.longitude, travelMode, loadRoute])

    // Photo fetch effect
    useEffect(() => {
        let active = true
        const fetchPhoto = async () => {
            if (!barangay?.name) {
                setPhotoLoading(false)
                return
            }
            try {
                const response = await fetch(`${API_BASE}/evacuation-centers/photo/${encodeURIComponent(barangay.name)}`)
                if (!active) return
                if (response.ok) {
                    const data = await response.json()
                    if (data && data.image_path) {
                        const path = data.image_path
                        const fullUrl = path.startsWith("http") ? path : `${API_ORIGIN}${path}`
                        setPhotoUrl(fullUrl)
                    } else {
                        setPhotoUrl(null)
                    }
                } else {
                    setPhotoUrl(null)
                }
            } catch (_err) {
                if (active) setPhotoUrl(null)
            } finally {
                if (active) setPhotoLoading(false)
            }
        }
        fetchPhoto()
        return () => {
            active = false
        }
    }, [barangay?.name])

    // Calculate user distance to center for arrival check (Requirement 7)
    const distanceToCenterMeters = useMemo(() => {
        if (!position || !target?.latitude || !target?.longitude) return null
        return getDistanceInMeters(position.lat, position.lng, Number(target.latitude), Number(target.longitude))
    }, [position, target?.latitude, target?.longitude])

    const hasArrived = distanceToCenterMeters !== null && distanceToCenterMeters <= 30

    // Coordinates for center & markers
    const startPoint = useMemo(() => {
        if (hasLiveGps) {
            return [position.lat, position.lng]
        }
        if (barangay?.latitude && barangay?.longitude) {
            return [Number(barangay.latitude), Number(barangay.longitude)]
        }
        return null
    }, [hasLiveGps, position, barangay?.latitude, barangay?.longitude])

    const endPoint = useMemo(() => {
        if (target?.latitude && target?.longitude) {
            return [Number(target.latitude), Number(target.longitude)]
        }
        return null
    }, [target])

    const mapCenter = useMemo(() => {
        if (startPoint && endPoint) {
            return [(startPoint[0] + endPoint[0]) / 2, (startPoint[1] + endPoint[1]) / 2]
        }
        return startPoint || endPoint || [9.784, 125.488]
    }, [startPoint, endPoint])

    // Requirement 4: Status messages as a single alert bar with a Lucide icon and plain, short text (no emoji)
    // MUST be declared before any early return so hooks are called in the same order every render
    const activeAlert = useMemo(() => {
        if (hasArrived) {
            return {
                icon: CheckCircle2,
                text: "You have arrived at the evacuation facility.",
                bg: "#f0fdf4",
                border: "#bbf7d0",
                color: "#166534",
                iconColor: "#16a34a",
            }
        }
        if (target?.is_fallback) {
            return {
                icon: AlertTriangle,
                text: "Local center unavailable. Redirected to nearest active facility.",
                bg: "#fffbeb",
                border: "#fde68a",
                color: "#92400e",
                iconColor: "#d97706",
            }
        }
        if (isOfflineRoute) {
            const offline = typeof navigator !== "undefined" && navigator.onLine === false
            return {
                icon: WifiOff,
                text: offline
                    ? "No internet connection. Displaying direct route."
                    : "Routing service unreachable. Displaying direct route.",
                bg: "#fef2f2", border: "#fecaca", color: "#991b1b", iconColor: "#dc2626",
            }
        }
        if (!hasLiveGps && gpsStatus === "denied") {
            return {
                icon: MapPin,
                text: "Location permission denied. Routing from barangay center.",
                bg: "#eff6ff",
                border: "#bfdbfe",
                color: "#1e40af",
                iconColor: "#2563eb",
            }
        }
        if (!hasLiveGps && gpsStatus === "unavailable") {
            return {
                icon: MapPin,
                text: "Location unavailable. Routing from barangay center.",
                bg: "#eff6ff",
                border: "#bfdbfe",
                color: "#1e40af",
                iconColor: "#2563eb",
            }
        }
        return null
    }, [hasArrived, target?.is_fallback, isOfflineRoute, hasLiveGps, gpsStatus])

    const navUrl = target
        ? `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}`
        : "#"

    const capacityNum = target?.capacity ? Number(target.capacity) : 0
    const occupancyNum = target?.occupancy !== undefined
        ? Number(target.occupancy)
        : (target?.current_occupancy !== undefined ? Number(target.current_occupancy) : 0)
    const freeSpaceCount = target?.free_space !== undefined
        ? Number(target.free_space)
        : (capacityNum > 0 ? capacityNum - occupancyNum : null)
    const capacityPercent = capacityNum > 0
        ? Math.min(100, Math.max(0, Math.round((occupancyNum / capacityNum) * 100)))
        : 0

    // Safety Banner computation
    const safetyBanner = useMemo(() => {
        return getRouteSafetyBanner(selectedRoute, routeSafetyResult?.isHazardUnavailable, travelMode)
    }, [selectedRoute, routeSafetyResult?.isHazardUnavailable, travelMode])
    const bannerCfg = BANNER_STYLES[safetyBanner.level] || BANNER_STYLES.unavailable
    const BannerIcon = bannerCfg.icon

    // Route Metrics Subline: "X.X km · N min by vehicle/on foot"
    const distanceDisplay = routeDistance ? `${routeDistance} km` : (target?.distance_km ? `${target.distance_km} km` : "")
    const timeDisplay = routeMinutes != null && Number.isFinite(routeMinutes)
        ? `${routeMinutes} min ${travelMode === "car" ? "by vehicle" : "on foot"}`
        : ""
    const routeMetricsText = [distanceDisplay, timeDisplay].filter(Boolean).join(" · ")

    // Spaces Free Text: "395 of 400 spaces free"
    const freeSpaceText = useMemo(() => {
        if (capacityNum <= 0) return "Capacity unavailable"
        if (freeSpaceCount !== null) {
            return `${freeSpaceCount} of ${capacityNum} spaces free`
        }
        return `Capacity: ${capacityNum} persons`
    }, [freeSpaceCount, capacityNum])

    // ── Early returns (all hooks are above this line) ──────────────────────────
    if (targetLoading && !target) {
        return (
            <div style={styles.container}>
                <div style={{ padding: 24, textAlign: "center", color: "#666", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <Loader size={18} style={{ animation: "spin 1.5s linear infinite" }} />
                    <span>Locating assigned evacuation center...</span>
                </div>
            </div>
        )
    }

    if (targetError && !target) {
        return (
            <div style={styles.container}>
                <div style={styles.errorBanner}>
                    <AlertTriangle size={24} style={{ color: "#dc2626", flexShrink: 0 }} />
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#991b1b" }}>
                            {targetError}
                        </div>
                        <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>
                            There are currently no active evacuation centers with available capacity for Barangay {barangay?.name || ""}.
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // Primary Route Card (Info Panel)
    const infoPanel = (
        <div style={isMobile ? styles.panelMobile : styles.panelDesktop}>
            {/* Toggles: Destination ("Closest to me" vs "My barangay's center") + Travel Mode ("Walk" vs "Vehicle") */}
            <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
            }}>
                <div style={{
                    display: "flex",
                    background: "#f1f5f9",
                    borderRadius: 8,
                    padding: 3,
                    border: "1px solid #e2e8f0",
                    gap: 4,
                    flex: "1 1 200px",
                }}>
                    <button
                        type="button"
                        id="route-mode-nearest"
                        onClick={() => {
                            if (routeMode !== "nearest") {
                                setRouteMode("nearest")
                                handleBackToOriginalCenter()
                            }
                        }}
                        style={{
                            flex: 1,
                            padding: "7px 10px",
                            fontSize: 12,
                            fontWeight: routeMode === "nearest" ? 700 : 500,
                            borderRadius: 6,
                            border: "none",
                            background: routeMode === "nearest" ? "#1a237e" : "transparent",
                            color: routeMode === "nearest" ? "#ffffff" : "#64748b",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            minHeight: 38,
                        }}
                    >
                        Closest to me
                    </button>
                    <button
                        type="button"
                        id="route-mode-barangay"
                        onClick={() => {
                            if (routeMode !== "barangay") {
                                setRouteMode("barangay")
                                handleBackToOriginalCenter()
                            }
                        }}
                        style={{
                            flex: 1,
                            padding: "7px 10px",
                            fontSize: 12,
                            fontWeight: routeMode === "barangay" ? 700 : 500,
                            borderRadius: 6,
                            border: "none",
                            background: routeMode === "barangay" ? "#1a237e" : "transparent",
                            color: routeMode === "barangay" ? "#ffffff" : "#64748b",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            minHeight: 38,
                        }}
                    >
                        My barangay's center
                    </button>
                </div>

                <div style={{
                    display: "flex",
                    background: "#f1f5f9",
                    borderRadius: 8,
                    padding: 3,
                    border: "1px solid #e2e8f0",
                    gap: 4,
                    flex: "0 1 170px",
                }}>
                    <button
                        type="button"
                        id="travel-mode-walk"
                        onClick={() => handleTravelModeChange("foot")}
                        style={{
                            flex: 1,
                            padding: "7px 10px",
                            fontSize: 12,
                            fontWeight: travelMode === "foot" ? 700 : 500,
                            borderRadius: 6,
                            border: "none",
                            background: travelMode === "foot" ? "#1a237e" : "transparent",
                            color: travelMode === "foot" ? "#ffffff" : "#64748b",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                            minHeight: 38,
                        }}
                    >
                        Walk
                    </button>
                    <button
                        type="button"
                        id="travel-mode-vehicle"
                        onClick={() => handleTravelModeChange("car")}
                        style={{
                            flex: 1,
                            padding: "7px 10px",
                            fontSize: 12,
                            fontWeight: travelMode === "car" ? 700 : 500,
                            borderRadius: 6,
                            border: "none",
                            background: travelMode === "car" ? "#1a237e" : "transparent",
                            color: travelMode === "car" ? "#ffffff" : "#64748b",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                            minHeight: 38,
                        }}
                    >
                        Vehicle
                    </button>
                </div>
            </div>

            {/* Fallback notice if any */}
            {fallbackNotice && (
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: 8,
                    padding: "8px 12px",
                    marginBottom: 10,
                    fontSize: 12,
                    color: "#1e40af",
                }}>
                    <MapPin size={15} style={{ color: "#2563eb", flexShrink: 0 }} />
                    <span>{fallbackNotice}</span>
                </div>
            )}

            {/* Offline or Arrived system status */}
            {(hasArrived || isOfflineRoute) && activeAlert && (
                <div
                    style={{
                        ...styles.alertBar,
                        background: activeAlert.bg,
                        borderColor: activeAlert.border,
                        color: activeAlert.color,
                        marginBottom: 10,
                    }}
                >
                    <activeAlert.icon size={16} style={{ color: activeAlert.iconColor, flexShrink: 0 }} />
                    <span style={styles.alertText}>{activeAlert.text}</span>
                </div>
            )}

            {/* 1. Center name (large) + "X.X km · N min by vehicle/on foot" */}
            <div style={styles.titleBlock}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <h3 style={styles.centerTitle}>{target?.name || "Evacuation Center"}</h3>
                    {isFull && (
                        <span style={{
                            background: "#dc2626",
                            color: "#ffffff",
                            fontSize: 11,
                            fontWeight: 800,
                            padding: "2px 7px",
                            borderRadius: 4,
                            letterSpacing: "0.5px",
                        }}>
                            FULL
                        </span>
                    )}
                </div>
                {routeMetricsText && (
                    <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600, marginTop: 2 }}>
                        {routeMetricsText}
                    </div>
                )}
            </div>

            {/* Route selection toggle: Safest vs Fastest (only shown when a safer route exists) */}
            {routeSafetyResult?.hasSafestOption && (
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                    <div style={{
                        display: "flex",
                        gap: 6,
                        background: "#f1f5f9",
                        padding: 3,
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                    }}>
                        <button
                            type="button"
                            id="route-pref-safest"
                            onClick={() => handleRoutePrefChange("safest")}
                            style={{
                                flex: 1,
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: "none",
                                background: routePref === "safest" ? "#1a237e" : "transparent",
                                color: routePref === "safest" ? "#ffffff" : "#475569",
                                fontWeight: routePref === "safest" ? 700 : 500,
                                fontSize: 12,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 5,
                                transition: "all 0.15s ease",
                                minHeight: 38,
                            }}
                        >
                            <Shield size={13} style={{ color: routePref === "safest" ? "#60a5fa" : "#059669" }} />
                            <span>Safest ({routeSafetyResult.safest.distanceKm} km · {formatWalkTime(routeSafetyResult.safest.durationMins)})</span>
                        </button>
                        <button
                            type="button"
                            id="route-pref-fastest"
                            onClick={() => handleRoutePrefChange("fastest")}
                            style={{
                                flex: 1,
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: "none",
                                background: routePref === "fastest" ? "#1a237e" : "transparent",
                                color: routePref === "fastest" ? "#ffffff" : "#475569",
                                fontWeight: routePref === "fastest" ? 700 : 500,
                                fontSize: 12,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 5,
                                transition: "all 0.15s ease",
                                minHeight: 38,
                            }}
                        >
                            <span>Fastest ({routeSafetyResult.fastest.distanceKm} km · {formatWalkTime(routeSafetyResult.fastest.durationMins)})</span>
                        </button>
                    </div>

                    {routeSafetyResult.diffSummary && (
                        <div style={{
                            fontSize: 11,
                            color: "#166534",
                            background: "#f0fdf4",
                            padding: "3px 8px",
                            borderRadius: 6,
                            border: "1px solid #bbf7d0",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontWeight: 700,
                            width: "fit-content",
                        }}>
                            <Shield size={12} style={{ color: "#16a34a" }} />
                            <span>{routeSafetyResult.diffSummary}</span>
                        </div>
                    )}
                </div>
            )}

            {/* 2. ONE safety banner */}
            <div
                role="status"
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: bannerCfg.bg,
                    border: `1px solid ${bannerCfg.border}`,
                    color: bannerCfg.color,
                    borderRadius: 8,
                    padding: "9px 12px",
                    marginTop: 10,
                    marginBottom: 10,
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.4,
                }}
            >
                <BannerIcon size={16} style={{ color: bannerCfg.iconColor, flexShrink: 0 }} />
                <span>{safetyBanner.text}</span>
            </div>

            {/* 3. Spaces free + existing progress bar */}
            <div style={styles.capacitySection}>
                <div style={styles.capacityHeader}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: freeSpaceCount !== null && freeSpaceCount <= 0 ? "#dc2626" : "#334155" }}>
                        {freeSpaceText}
                    </span>
                </div>
                <div style={styles.progressTrack}>
                    <div
                        style={{
                            ...styles.progressFill,
                            width: `${capacityPercent}%`,
                            background: freeSpaceCount !== null && freeSpaceCount <= 0 ? "#dc2626" : (capacityPercent >= 80 ? "#f59e0b" : "#1a237e"),
                        }}
                    />
                </div>
            </div>

            {/* 4. The existing "Open in Google Maps" button, full width */}
            <button
                type="button"
                style={styles.primaryNavBtn}
                onClick={() => window.open(navUrl, "_blank", "noopener,noreferrer")}
            >
                <Navigation size={18} />
                Open in Google Maps
            </button>

            {/* 5. Collapsible "See hazard details", COLLAPSED by default */}
            <div style={{ marginTop: 8 }}>
                <button
                    type="button"
                    onClick={() => setHazardDetailsOpen((prev) => !prev)}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        padding: "8px 12px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#334155",
                        cursor: "pointer",
                        minHeight: 40,
                    }}
                >
                    <span>See hazard details</span>
                    {hazardDetailsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {hazardDetailsOpen && (
                    <div style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        marginTop: 8,
                        padding: "10px 12px",
                        background: "#f8fafc",
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                    }}>
                        {/* Flood / Landslide badges */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            <HazardBadge type="flood" level={target?.flood_susceptibility ?? target?.flood_hazard ?? null} />
                            <HazardBadge type="landslide" level={target?.landslide_susceptibility ?? target?.landslide_hazard ?? null} />
                        </div>

                        {/* Center-in-hazard-area note (one short line in plain words) */}
                        <div style={{ fontSize: 12, color: "#334155", fontWeight: 500, lineHeight: 1.4 }}>
                            {getCenterHazardNote(target)}
                        </div>

                        {/* Exposure meters */}
                        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 600 }}>Route exposure: </span>
                            <span>{formatExposureSummary(selectedRoute?.meters_by_class) || "0 m flood-prone, 0 m landslide-prone"}</span>
                        </div>

                        {/* Route-hazard legend (shown only here) */}
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            fontSize: 11,
                            color: "#64748b",
                            flexWrap: "wrap",
                            paddingTop: 6,
                            borderTop: "1px dashed #e2e8f0",
                        }}>
                            <span style={{ fontWeight: 600 }}>Route hazard:</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 9, height: 9, borderRadius: 2, background: "#2563eb" }} /> Low / None
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 9, height: 9, borderRadius: 2, background: "#f59e0b" }} /> Moderate
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 9, height: 9, borderRadius: 2, background: "#ea580c" }} /> High
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span style={{ width: 9, height: 9, borderRadius: 2, background: "#991b1b" }} /> Very high
                            </span>
                        </div>

                        {/* Plain disclaimer */}
                        <div style={{ fontSize: 10, color: "#78716c", fontStyle: "italic" }}>
                            Based on MGB hazard maps, not live flooding.
                        </div>
                    </div>
                )}
            </div>

            {/* Safer center nearby suggestion card */}
            {lowerHazardSuggestion && activeOverrideId == null && (
                <div style={{
                    marginTop: 8,
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 8,
                    padding: "8px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                }}>
                    <div style={{ fontSize: 12, color: "#14532d", lineHeight: 1.4 }}>
                        <strong>Safer center nearby:</strong> {lowerHazardSuggestion.name}
                        {lowerHazardSuggestion.extraMin != null && (
                            <span style={{ color: "#15803d", fontWeight: 600 }}>
                                {formatSaferCenterDelta(lowerHazardSuggestion.extraMin)}
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        id="hazard-route-here-btn"
                        onClick={() => handleRouteToSaferCenter(lowerHazardSuggestion.id)}
                        style={{
                            alignSelf: "flex-start",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            background: "#16a34a",
                            color: "#fff",
                            border: "none",
                            borderRadius: 6,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            minHeight: 36,
                        }}
                    >
                        <Navigation size={12} />
                        Go to this center
                    </button>
                </div>
            )}

            {/* Back to original center button (when override is active) */}
            {activeOverrideId != null && (
                <button
                    type="button"
                    id="hazard-back-to-nearest-btn"
                    onClick={handleBackToOriginalCenter}
                    style={{
                        marginTop: 8,
                        alignSelf: "flex-start",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "#f1f5f9",
                        color: "#334155",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        minHeight: 36,
                    }}
                >
                    <ArrowLeft size={12} />
                    Back to {baseTarget?.name || (routeMode === "barangay" ? "barangay center" : "closest center")}
                </button>
            )}

            {/* Meta row */}
            <div style={{ ...styles.metaRow, marginTop: 8 }}>
                <span>Updated {secondsAgo}s ago</span>
                <span style={styles.metaDot}>•</span>
                <span>
                    {hasLiveGps && Number.isFinite(accuracy)
                        ? `GPS ±${Math.round(accuracy)} m`
                        : "Barangay coordinates"}
                </span>
            </div>
        </div>
    )

    return (
        <div style={styles.container}>
            {/* 5. The route info panel goes above the map on phones and desktop */}
            {infoPanel}

            {/* Map Container */}
            <div style={styles.mapWrap}>
                {/* Segmented Control in top-right corner */}
                <div style={styles.segmentedControl}>
                    <button
                        type="button"
                        onClick={() => setMapType("street")}
                        style={{
                            ...styles.segBtn,
                            ...(isMobile ? styles.segBtnMobile : {}),
                            ...(mapType === "street" ? styles.segBtnActive : styles.segBtnInactive),
                        }}
                    >
                        Street
                    </button>
                    <button
                        type="button"
                        onClick={() => setMapType("satellite")}
                        style={{
                            ...styles.segBtn,
                            ...(isMobile ? styles.segBtnMobile : {}),
                            ...(mapType === "satellite" ? styles.segBtnActive : styles.segBtnInactive),
                        }}
                    >
                        Satellite
                    </button>
                </div>

                {/* Hazard overlay control panel – positioned below Street/Satellite toggle */}
                <HazardControl
                    activeLayers={hazardLayers}
                    opacity={hazardOpacity}
                    onToggleLayer={handleHazardToggle}
                    onOpacityChange={setHazardOpacity}
                />

                {!mapReady && <div style={styles.loadingOverlay}>Loading map...</div>}
                {routeLoading && <div style={{ ...styles.loadingOverlay, top: mapReady ? 48 : 0 }}>Updating route...</div>}
                <MapContainer
                    center={mapCenter}
                    zoom={15}
                    style={isMobile ? styles.mapMobile : styles.map}
                    scrollWheelZoom={!isMobile}
                    whenReady={() => setMapReady(true)}
                >
                    <RouteBoundsFitter routeCoords={routeCoords} />
                    <TileLayer
                        url={mapType === "satellite" ? SATELLITE_URL : STREET_TILES_URL}
                        attribution={mapType === "satellite" ? SATELLITE_ATTRIBUTION : STREET_ATTRIBUTION}
                    />

                    {/* Hazard overlay renderer – inside MapContainer so useMap() works */}
                    <HazardOverlayRenderer activeLayers={hazardLayers} opacity={hazardOpacity} />

                    {/* Requirement 3: Accuracy circle sized from GPS accuracy */}
                    {hasLiveGps && Number.isFinite(accuracy) && accuracy > 0 && (
                        <Circle
                            center={[position.lat, position.lng]}
                            radius={accuracy}
                            pathOptions={{
                                color: "#2563eb",
                                fillColor: "#3b82f6",
                                fillOpacity: 0.15,
                                weight: 1,
                                opacity: 0.4,
                            }}
                        />
                    )}

                    {/* Requirement 3: User marker (blue dot with white border) */}
                    {hasLiveGps ? (
                        <Marker position={[position.lat, position.lng]} icon={userLiveIcon}>
                            <Popup>
                                <strong>Your Location</strong>
                            </Popup>
                        </Marker>
                    ) : (
                        barangay?.latitude && (
                            <Marker position={[Number(barangay.latitude), Number(barangay.longitude)]} icon={barangayIcon}>
                                <Popup>
                                    <strong>Barangay {barangay.name}</strong>
                                </Popup>
                            </Marker>
                        )
                    )}

                    {/* Requirement 4 & 5: Center marker with plain text popup (no emoji) */}
                    {target?.latitude && (
                        <Marker position={[Number(target.latitude), Number(target.longitude)]} icon={evacuationIcon}>
                            <Popup>
                                <strong>{target.name}</strong>
                                {target.address && <><br />{target.address}</>}
                                <br />Capacity: {target.capacity} persons
                            </Popup>
                        </Marker>
                    )}

                    {/* Requirement 2: Route polyline: 6px solid accent color with 9px white casing line beneath it */}
                    {routeCoords.length > 1 && (
                        <>
                            <Polyline
                                positions={routeCoords}
                                pathOptions={{
                                    color: "#ffffff",
                                    weight: 9,
                                    opacity: 1,
                                }}
                            />
                            {activeSegments && activeSegments.length > 0 ? (
                                activeSegments.map(([startIdx, endIdx, worstClass], sIdx) => {
                                    const segCoords = routeCoords.slice(startIdx, endIdx + 1)
                                    if (segCoords.length < 2) return null
                                    return (
                                        <Polyline
                                            key={`seg-${sIdx}-${startIdx}-${endIdx}-${worstClass}`}
                                            positions={segCoords}
                                            pathOptions={{
                                                color: isOfflineRoute ? "#dc2626" : getSegmentColor(worstClass),
                                                weight: 6,
                                                opacity: 1,
                                                dashArray: isOfflineRoute ? "6, 8" : undefined,
                                            }}
                                        />
                                    )
                                })
                            ) : (
                                <Polyline
                                    positions={routeCoords}
                                    pathOptions={{
                                        color: isOfflineRoute ? "#dc2626" : "#2563eb",
                                        weight: 6,
                                        opacity: 1,
                                        dashArray: isOfflineRoute ? "6, 8" : undefined,
                                    }}
                                />
                            )}
                        </>
                    )}
                </MapContainer>
            </div>

            {/* Photo Card */}
            <div style={styles.streetCard}>
                <div style={{ ...styles.streetTitle, display: "flex", alignItems: "center", gap: 6 }}>
                    <Camera size={14} style={{ color: "#1a237e" }} />
                    Evacuation Center Facility
                </div>
                <div style={styles.streetSub}>Photo of {target?.name}</div>
                {photoLoading ? (
                    <div style={styles.streetFallback}>Loading photo...</div>
                ) : photoUrl ? (
                    <img
                        src={photoUrl}
                        alt="Evacuation center"
                        style={styles.streetImage}
                        onError={() => setPhotoUrl(null)}
                    />
                ) : (
                    <div style={styles.streetFallback}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Photo coming soon</div>
                        <div style={styles.streetFallbackSub}>An image of this evacuation facility will be uploaded soon.</div>
                    </div>
                )}
                <div style={{ ...styles.streetCaption, display: "flex", alignItems: "center", gap: 5 }}>
                    <Info size={12} style={{ color: "#4b5563", flexShrink: 0 }} />
                    {target?.name} — {target?.address}
                </div>
            </div>
        </div>
    )
}

const styles = {
    container: {
        background: "#fff",
        borderRadius: 16,
        border: "1px solid #e2e8f0",
        padding: 14,
        marginTop: 14,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        display: "grid",
        gap: 12,
    },
    panelDesktop: {
        display: "grid",
        gap: 12,
        background: "#ffffff",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        padding: "14px 16px",
    },
    panelMobile: {
        display: "grid",
        gap: 12,
    },
    bottomSheetWrap: {
        background: "#ffffff",
        borderRadius: 14,
        border: "1px solid #e2e8f0",
        padding: "12px 14px 14px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        display: "grid",
        gap: 8,
    },
    sheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        background: "#cbd5e1",
        margin: "0 auto 4px",
    },
    titleBlock: {
        display: "grid",
        gap: 2,
    },
    centerTitle: {
        margin: 0,
        fontSize: 18,
        fontWeight: 700,
        color: "#1a237e",
        lineHeight: 1.25,
    },
    centerAddress: {
        margin: 0,
        fontSize: 13,
        color: "#64748b",
        lineHeight: 1.35,
    },
    figuresRow: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
    },
    figureCard: {
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
    },
    figureLabel: {
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#64748b",
    },
    figureValue: {
        fontSize: 22,
        fontWeight: 700,
        color: "#1e293b",
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.2,
    },
    capacitySection: {
        display: "grid",
        gap: 6,
    },
    capacityHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 12,
    },
    capacityLabel: {
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#64748b",
    },
    capacityValue: {
        fontWeight: 600,
        color: "#1e293b",
    },
    progressTrack: {
        width: "100%",
        height: 4,
        background: "#e2e8f0",
        borderRadius: 2,
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        background: "#1a237e",
        borderRadius: 2,
        transition: "width 0.3s ease",
    },
    alertBar: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 12px",
        borderRadius: 8,
        border: "1px solid transparent",
        fontSize: 12,
        lineHeight: 1.35,
    },
    alertText: {
        fontWeight: 500,
    },
    primaryNavBtn: {
        width: "100%",
        minHeight: 44,
        borderRadius: 10,
        border: "1px solid #1a237e",
        background: "#1a237e",
        color: "#fff",
        fontSize: 14,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        cursor: "pointer",
        padding: "10px 16px",
    },
    metaRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        fontSize: 11,
        color: "#64748b",
        fontWeight: 500,
    },
    metaDot: {
        color: "#94a3b8",
    },
    errorBanner: {
        background: "#fef2f2",
        border: "1px solid #fca5a5",
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        alignItems: "center",
        gap: 12,
    },
    segmentedControl: {
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 1000,
        display: "flex",
        background: "rgba(255, 255, 255, 0.94)",
        backdropFilter: "blur(4px)",
        borderRadius: 8,
        padding: 3,
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
        border: "1px solid rgba(0, 0, 0, 0.08)",
        gap: 2,
    },
    segBtn: {
        border: "none",
        background: "transparent",
        padding: "5px 11px",
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 6,
        cursor: "pointer",
        transition: "all 0.15s ease",
    },
    segBtnMobile: {
        minHeight: 44,
        padding: "10px 14px",
    },
    segBtnActive: {
        background: "#1e293b",
        color: "#ffffff",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
    },
    segBtnInactive: {
        color: "#64748b",
    },
    mapWrap: {
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
    },
    map: {
        width: "100%",
        height: 420,
    },
    mapMobile: {
        width: "100%",
        height: "55vh",
        minHeight: "55vh",
    },
    loadingOverlay: {
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        zIndex: 500,
        background: "rgba(255,255,255,0.88)",
        color: "#44506a",
        fontSize: 12,
        padding: "8px 10px",
        textAlign: "center",
    },
    streetCard: {
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 10,
        display: "grid",
        gap: 6,
    },
    streetTitle: {
        fontSize: 13,
        fontWeight: 700,
        color: "#1a237e",
    },
    streetSub: {
        fontSize: 11,
        color: "#6b7280",
    },
    streetImage: {
        width: "100%",
        height: 250,
        objectFit: "cover",
        borderRadius: 10,
        border: "0.5px solid #dbe3ef",
    },
    streetFallback: {
        width: "100%",
        height: 250,
        borderRadius: 10,
        border: "0.5px solid #dbe3ef",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        color: "#8b95a7",
        fontSize: 12,
        background: "#f8fafc",
        textAlign: "center",
        padding: 12,
        gap: 6,
    },
    streetFallbackSub: {
        fontSize: 11,
        color: "#6b7280",
    },
    streetCaption: {
        fontSize: 11,
        color: "#4b5563",
    },
}
