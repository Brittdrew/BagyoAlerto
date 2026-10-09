import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { MapContainer, TileLayer, Marker, Popup, Polyline, Circle, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { Navigation, AlertTriangle, CheckCircle2, WifiOff, MapPin, Loader, Footprints, Camera, Info } from "lucide-react"
import { useLiveLocation } from "../hooks/useLiveLocation"

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

async function fetchOsrmRoute(startLng, startLat, endLng, endLat, { signal, timeoutMs = 20000 } = {}) {
    const qs = new URLSearchParams({
        from_lat: startLat, from_lng: startLng, to_lat: endLat, to_lng: endLng,
    })
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener("abort", onAbort)
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        console.log("[Route] requesting", { startLat, startLng, endLat, endLng })
        const res = await fetch(`${API_BASE}/route?${qs}`, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.json() // { route, isBackup }
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
    }
}

function formatWalkTime(minutes) {
    if (minutes == null || !Number.isFinite(minutes)) return "—"
    const m = Math.round(minutes)
    if (m < 60) {
        return `${m} min`
    }
    const hrs = Math.floor(m / 60)
    const remMins = m % 60
    return remMins > 0 ? `${hrs} h ${remMins} min` : `${hrs} h`
}

export default function MapView({ evacuationCenter: initialCenter, barangay }) {
    const [mapType, setMapType] = useState("street")
    const [mapReady, setMapReady] = useState(false)
    const [target, setTarget] = useState(initialCenter || null)
    const [targetLoading, setTargetLoading] = useState(false)
    const [targetError, setTargetError] = useState(null)

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

    // Throttle tracking refs: re-fetch only after moving > 30 m AND at least 15 s have passed
    const lastFetchedPosRef = useRef(null)
    const lastFetchedTimeRef = useRef(0)
    const activeTargetIdRef = useRef(null)

    const routeAbortRef = useRef(null)
    const routeReqIdRef = useRef(0)

    const loadRoute = useCallback(async ({ startLat, startLng, destLat, destLng, cacheKey, onFail }) => {
        routeAbortRef.current?.abort()
        const controller = new AbortController()
        routeAbortRef.current = controller
        const reqId = ++routeReqIdRef.current
        setRouteLoading(true)

        try {
            const { route, isBackup } = await fetchOsrmRoute(startLng, startLat, destLng, destLat, {
                signal: controller.signal,
            })
            if (reqId !== routeReqIdRef.current) return

            const coords = route.geometry.coordinates.map((c) => [c[1], c[0]])
            const distKm = (route.distance / 1000).toFixed(2)
            const mins = isBackup
                ? Math.max(1, Math.round((route.distance / 1000 / 4.5) * 60))
                : Math.max(1, Math.round(route.duration / 60))

            setRouteCoords(coords)
            setRouteDistance(distKm)
            setRouteMinutes(mins)
            setIsOfflineRoute(false)

            if (cacheKey) {
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({ coords, distance: distKm, duration: mins }))
                } catch (_e) { /* ignore */ }
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
                        setIsOfflineRoute(true)
                        return
                    }
                }
            } catch (_e) { /* ignore */ }

            setRouteCoords([[startLat, startLng], [destLat, destLng]])
            const d = (getDistanceInMeters(startLat, startLng, destLat, destLng) / 1000).toFixed(2)
            setRouteDistance(d)
            setRouteMinutes(Math.max(1, Math.round((d / 4) * 60)))
            setIsOfflineRoute(true)
        } finally {
            if (reqId === routeReqIdRef.current) setRouteLoading(false)
        }
    }, [])

    useEffect(() => () => routeAbortRef.current?.abort(), [])

    // Requirement 2: Call useLiveLocation with enabled = true once a barangay is selected
    const { position, accuracy, status: gpsStatus } = useLiveLocation(Boolean(barangayId))

    useEffect(() => {
        setLastUpdated(Date.now())
        setSecondsAgo(0)
    }, [routeCoords, position, target])

    useEffect(() => {
        const timer = setInterval(() => {
            setSecondsAgo(Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000)))
        }, 1000)
        return () => clearInterval(timer)
    }, [lastUpdated])

    // Requirement 1: Fetch target from GET /api/barangays/{barangayId}/evacuation-target
    useEffect(() => {
        if (!barangayId) {
            return
        }

        routeAbortRef.current?.abort()
        routeReqIdRef.current++
        setTarget(null)
        setRouteCoords([])
        setIsOfflineRoute(false)
        setTargetLoading(true)
        activeTargetIdRef.current = null
        lastFetchedPosRef.current = null
        lastFetchedTimeRef.current = 0

        let active = true

        fetch(`${API_BASE}/barangays/${barangayId}/evacuation-target`)
            .then(async (res) => {
                if (!active) return
                if (res.status === 404) {
                    setTarget(null)
                    setTargetError("No evacuation center available")
                    return
                }
                if (!res.ok) {
                    throw new Error(`Server returned status ${res.status}`)
                }
                const data = await res.json()
                if (!active) return
                setTarget(data)
                setTargetError(null)
                // Cache target in localStorage (Requirement 8)
                try {
                    localStorage.setItem(`bakwit_target_${barangayId}`, JSON.stringify(data))
                } catch (err) {
                    console.warn("Failed to cache target:", err)
                }
            })
            .catch(() => {
                if (!active) return
                // Try reading cached target (Requirement 8)
                try {
                    const cached = localStorage.getItem(`bakwit_target_${barangayId}`)
                    if (cached) {
                        setTarget(JSON.parse(cached))
                        setTargetError(null)
                        return
                    }
                } catch (_e) {
                    // ignore
                }

                if (initialCenter) {
                    setTarget(initialCenter)
                    setTargetError(null)
                } else {
                    setTarget(null)
                    setTargetError("No evacuation center available")
                }
            })
            .finally(() => {
                if (active) setTargetLoading(false)
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

            let shouldFetch = false
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
                cacheKey: `bakwit_route_${barangayId}_${target.id}`,
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
            })
        }
    }, [target, position, barangayId, barangay?.latitude, barangay?.longitude, loadRoute])

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
    const hasLiveGps = position && Number.isFinite(position.lat) && Number.isFinite(position.lng)

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
    }, [target?.latitude, target?.longitude])

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

    const navUrl = target
        ? `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}`
        : "#"

    const capacityNum = target?.capacity ? Number(target.capacity) : 0
    const occupancyNum = target?.current_occupancy ? Number(target.current_occupancy) : 0
    const capacityPercent = capacityNum > 0
        ? Math.min(100, Math.max(0, Math.round((occupancyNum / capacityNum) * 100)))
        : 0

    // activeAlert useMemo was moved above the early returns (see above)

    // Redesigned Info Panel
    const infoPanel = (
        <div style={isMobile ? styles.panelMobile : styles.panelDesktop}>
            {/* 1. Hierarchy: Center name as title; address under it */}
            <div style={styles.titleBlock}>
                <h3 style={styles.centerTitle}>{target?.name || "Evacuation Center"}</h3>
                <p style={styles.centerAddress}>{target?.address || "Address unavailable"}</p>
            </div>

            {/* 1. Distance & Walking time as two large figures (tabular-nums) */}
            <div style={styles.figuresRow}>
                <div style={styles.figureCard}>
                    <span style={styles.figureLabel}>Distance</span>
                    <span style={styles.figureValue}>{routeDistance ? `${routeDistance} km` : "—"}</span>
                </div>
                <div style={styles.figureCard}>
                    <span style={styles.figureLabel}>Walking Time</span>
                    <span style={styles.figureValue}>{formatWalkTime(routeMinutes)}</span>
                </div>
            </div>

            {/* 2. Capacity: Thin progress bar with text "300 capacity" */}
            <div style={styles.capacitySection}>
                <div style={styles.capacityHeader}>
                    <span style={styles.capacityLabel}>Capacity</span>
                    <span style={styles.capacityValue}>
                        {capacityNum > 0 ? `${capacityNum} capacity` : "Capacity unavailable"}
                    </span>
                </div>
                <div style={styles.progressTrack}>
                    <div
                        style={{
                            ...styles.progressFill,
                            width: `${capacityPercent}%`,
                        }}
                    />
                </div>
            </div>

            {/* 4. Single alert bar with Lucide icon and plain, short text (no emoji) */}
            {activeAlert && (
                <div
                    style={{
                        ...styles.alertBar,
                        background: activeAlert.bg,
                        borderColor: activeAlert.border,
                        color: activeAlert.color,
                    }}
                >
                    <activeAlert.icon size={16} style={{ color: activeAlert.iconColor, flexShrink: 0 }} />
                    <span style={styles.alertText}>{activeAlert.text}</span>
                </div>
            )}

            {/* 3. Primary button: Open in Google Maps and no other competing buttons */}
            <button
                type="button"
                style={styles.primaryNavBtn}
                onClick={() => window.open(navUrl, "_blank", "noopener,noreferrer")}
            >
                <Navigation size={18} />
                Open in Google Maps
            </button>

            {/* 5. "Updated Xs ago" and small GPS accuracy label */}
            <div style={styles.metaRow}>
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
                            <Polyline
                                positions={routeCoords}
                                pathOptions={{
                                    color: isOfflineRoute ? "#dc2626" : "#2563eb",
                                    weight: 6,
                                    opacity: 1,
                                    dashArray: isOfflineRoute ? "6, 8" : undefined,
                                }}
                            />
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
