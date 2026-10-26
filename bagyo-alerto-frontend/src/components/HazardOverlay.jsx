import { useEffect, useRef, useState, useCallback } from "react"
import { useMap } from "react-leaflet"
import L from "leaflet"

// ─── Config ────────────────────────────────────────────────────────────────────
const HAZARD_BASE =
    import.meta.env.VITE_HAZARD_BASE ||
    "https://ulap-hazards.georisk.gov.ph/arcgis/rest/services/MGBPublic"

const LAYER_DEFS = {
    flood: {
        key: "flood",
        label: "Flood",
        service: `${HAZARD_BASE}/Flood/MapServer`,
    },
    landslide: {
        key: "landslide",
        label: "Landslide",
        service: `${HAZARD_BASE}/RainInducedLandslide/MapServer`,
    },
}

const PANE_NAME = "hazardPane"
const PANE_ZINDEX = 350
const DEBOUNCE_MS = 400
const FETCH_TIMEOUT_MS = 10000
const MAX_IMG_DIM = 1600
const DEFAULT_OPACITY = 0.55
const LS_KEY = "bakwit_hazard_layers"

// ─── Helpers ───────────────────────────────────────────────────────────────────
function loadFromStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return null
        return JSON.parse(raw)
    } catch (_e) {
        return null
    }
}

function saveToStorage(val) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(val))
    } catch (_e) {
        /* ignore */
    }
}

function buildExportUrl(service, map) {
    const bounds = map.getBounds()
    const sw = L.CRS.EPSG3857.project(bounds.getSouthWest())
    const ne = L.CRS.EPSG3857.project(bounds.getNorthEast())
    const bbox = `${sw.x},${sw.y},${ne.x},${ne.y}`

    const container = map.getContainer()
    const rawW = container.clientWidth || 800
    const rawH = container.clientHeight || 600
    const ratio = Math.max(rawW, rawH) / MAX_IMG_DIM
    const W = ratio > 1 ? Math.round(rawW / ratio) : rawW
    const H = ratio > 1 ? Math.round(rawH / ratio) : rawH

    const params = new URLSearchParams({
        bbox,
        bboxSR: "3857",
        imageSR: "3857",
        size: `${W},${H}`,
        layers: "show:0",
        format: "png32",
        transparent: "true",
        f: "image",
    })
    return `${service}/export?${params}`
}

// ─── Per-layer manager hook ────────────────────────────────────────────────────
function useLayerManager(map, def, enabled, opacity) {
    const overlayRef = useRef(null)
    const reqCounterRef = useRef(0)
    const timerRef = useRef(null)
    const debounceTimerRef = useRef(null)
    const opacityRef = useRef(opacity)
    const [unavailable, setUnavailable] = useState(false)

    // Keep opacityRef current without triggering re-fetches
    useEffect(() => {
        opacityRef.current = opacity
        if (overlayRef.current) {
            overlayRef.current.setOpacity(opacity)
        }
    }, [opacity])

    // Ensure custom pane exists once
    useEffect(() => {
        if (!map) return
        if (!map.getPane(PANE_NAME)) {
            const pane = map.createPane(PANE_NAME)
            pane.style.zIndex = String(PANE_ZINDEX)
            pane.style.pointerEvents = "none"
        }
    }, [map])

    const fetchAndSwap = useCallback(() => {
        if (!map || !enabled) return
        const reqId = ++reqCounterRef.current
        const url = buildExportUrl(def.service, map)
        const bounds = map.getBounds()

        const img = new window.Image()
        let settled = false

        const cleanup = () => {
            settled = true
            clearTimeout(timerRef.current)
        }

        timerRef.current = setTimeout(() => {
            if (settled) return
            cleanup()
            if (reqId !== reqCounterRef.current) return
            setUnavailable(true)
            if (overlayRef.current && map.hasLayer(overlayRef.current)) {
                map.removeLayer(overlayRef.current)
                overlayRef.current = null
            }
        }, FETCH_TIMEOUT_MS)

        img.onload = () => {
            cleanup()
            if (reqId !== reqCounterRef.current) return // stale – discard
            setUnavailable(false)
            const currentOpacity = opacityRef.current
            if (!overlayRef.current) {
                overlayRef.current = L.imageOverlay(url, bounds, {
                    opacity: currentOpacity,
                    pane: PANE_NAME,
                    interactive: false,
                }).addTo(map)
            } else {
                overlayRef.current.setBounds(bounds)
                overlayRef.current.setUrl(url)
                overlayRef.current.setOpacity(currentOpacity)
                if (!map.hasLayer(overlayRef.current)) {
                    overlayRef.current.addTo(map)
                }
            }
        }

        img.onerror = () => {
            cleanup()
            if (reqId !== reqCounterRef.current) return
            setUnavailable(true)
            if (overlayRef.current && map.hasLayer(overlayRef.current)) {
                map.removeLayer(overlayRef.current)
                overlayRef.current = null
            }
        }

        img.src = url
    }, [map, enabled, def.service])

    const debouncedFetch = useCallback(() => {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = setTimeout(fetchAndSwap, DEBOUNCE_MS)
    }, [fetchAndSwap])

    useEffect(() => {
        if (!map) return
        if (enabled) {
            setUnavailable(false)
            fetchAndSwap() // immediate first fetch on enable
            map.on("moveend zoomend", debouncedFetch)
        } else {
            map.off("moveend zoomend", debouncedFetch)
            clearTimeout(debounceTimerRef.current)
            clearTimeout(timerRef.current)
            reqCounterRef.current++ // invalidate in-flight
            if (overlayRef.current) {
                if (map.hasLayer(overlayRef.current)) {
                    map.removeLayer(overlayRef.current)
                }
                overlayRef.current = null
            }
        }
        return () => {
            map.off("moveend zoomend", debouncedFetch)
            clearTimeout(debounceTimerRef.current)
            clearTimeout(timerRef.current)
        }
    }, [map, enabled, debouncedFetch, fetchAndSwap])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            reqCounterRef.current++
            clearTimeout(debounceTimerRef.current)
            clearTimeout(timerRef.current)
            if (overlayRef.current && map) {
                try {
                    if (map.hasLayer(overlayRef.current)) {
                        map.removeLayer(overlayRef.current)
                    }
                } catch (_e) {
                    /* map may already be gone */
                }
                overlayRef.current = null
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return { unavailable }
}

// ─── Inner component – must be inside <MapContainer> to call useMap() ──────────
function HazardOverlayInner({ activeLayers, opacity }) {
    const map = useMap()

    const { unavailable: floodUnavailable } = useLayerManager(
        map,
        LAYER_DEFS.flood,
        activeLayers.flood,
        opacity
    )
    const { unavailable: landslideUnavailable } = useLayerManager(
        map,
        LAYER_DEFS.landslide,
        activeLayers.landslide,
        opacity
    )

    const anyUnavailable =
        (activeLayers.flood && floodUnavailable) ||
        (activeLayers.landslide && landslideUnavailable)

    if (!anyUnavailable) return null

    return (
        <div
            style={{
                position: "absolute",
                bottom: 30,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 800,
                background: "rgba(255,255,255,0.93)",
                border: "1px solid #fca5a5",
                borderRadius: 8,
                padding: "5px 14px",
                fontSize: 11,
                color: "#991b1b",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 4px rgba(0,0,0,0.14)",
            }}
        >
            Hazard layer unavailable
        </div>
    )
}

// ─── Legend image – hidden silently on error ───────────────────────────────────
function LegendImg({ src, alt }) {
    const [hidden, setHidden] = useState(false)
    if (hidden) return null
    return (
        <img
            src={src}
            alt={alt}
            onError={() => setHidden(true)}
            style={{ maxWidth: "100%", borderRadius: 4, display: "block" }}
        />
    )
}

// ─── The renderer that lives inside <MapContainer> ─────────────────────────────
// Exported so MapView can place it as a child of <MapContainer>
export function HazardOverlayRenderer({ activeLayers, opacity }) {
    return <HazardOverlayInner activeLayers={activeLayers} opacity={opacity} />
}

// ─── The control panel + renderer – used as a sibling of <MapContainer> ────────
// MapView renders this inside its mapWrap div (position:relative), so the
// absolute-positioned panel appears over the map.
export function HazardControl({ activeLayers, opacity, onToggleLayer, onOpacityChange }) {
    const [legendOpen, setLegendOpen] = useState(false)
    const anyActive = activeLayers.flood || activeLayers.landslide

    return (
        <div
            id="hazard-control-panel"
            style={{
                position: "absolute",
                top: 48,
                right: 10,
                zIndex: 1000,
                background: "rgba(255,255,255,0.96)",
                backdropFilter: "blur(4px)",
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 10,
                boxShadow: "0 2px 8px rgba(0,0,0,0.13)",
                padding: "8px 10px",
                minWidth: 150,
                fontSize: 12,
                color: "#1e293b",
                display: "grid",
                gap: 6,
                userSelect: "none",
            }}
        >
            <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", color: "#64748b", textTransform: "uppercase" }}>
                Hazard Layers
            </div>

            {Object.values(LAYER_DEFS).map((def) => (
                <label
                    key={def.key}
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 500 }}
                >
                    <input
                        type="checkbox"
                        id={`hazard-toggle-${def.key}`}
                        checked={activeLayers[def.key]}
                        onChange={() => onToggleLayer(def.key)}
                        style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#1a237e" }}
                    />
                    {def.label}
                </label>
            ))}

            <div style={{ display: "grid", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 10 }}>
                    <span>Opacity</span>
                    <span>{Math.round(opacity * 100)}%</span>
                </div>
                <input
                    id="hazard-opacity-slider"
                    type="range"
                    min={0.2}
                    max={0.9}
                    step={0.05}
                    value={opacity}
                    onChange={(e) => onOpacityChange(Number(e.target.value))}
                    style={{ width: "100%", accentColor: "#1a237e", cursor: "pointer" }}
                />
            </div>

            {anyActive && (
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 6 }}>
                    <button
                        type="button"
                        id="hazard-legend-toggle"
                        onClick={() => setLegendOpen((v) => !v)}
                        style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            color: "#1a237e",
                            fontWeight: 600,
                            fontSize: 11,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                        }}
                    >
                        <span>{legendOpen ? "▲" : "▼"}</span> Legend
                    </button>
                    {legendOpen && (
                        <div style={{ marginTop: 6, display: "grid", gap: 8 }}>
                            {activeLayers.flood && (
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 10, color: "#64748b", marginBottom: 3 }}>FLOOD</div>
                                    <LegendImg
                                        src={`${HAZARD_BASE}/Flood/MapServer/WMSServer?request=GetLegendGraphic&version=1.3.0&format=image/png&layer=0`}
                                        alt="Flood legend"
                                    />
                                </div>
                            )}
                            {activeLayers.landslide && (
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 10, color: "#64748b", marginBottom: 3 }}>LANDSLIDE</div>
                                    <LegendImg
                                        src={`${HAZARD_BASE}/RainInducedLandslide/MapServer/WMSServer?request=GetLegendGraphic&version=1.3.0&format=image/png&layer=0`}
                                        alt="Landslide legend"
                                    />
                                </div>
                            )}
                            <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.4, fontStyle: "italic" }}>
                                Susceptibility maps, not live flooding. Source: MGB via GeoRisk PH.
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ─── Default export: full self-contained component with state ──────────────────
// Renders both the control panel AND the HazardOverlayRenderer (via a
// render-prop / context pattern isn't needed because MapView wires them together).
export default function HazardOverlay({ renderControl = true, renderOverlay = true }) {
    const [activeLayers, setActiveLayers] = useState(() => {
        const stored = loadFromStorage()
        return stored?.activeLayers ?? { flood: false, landslide: false }
    })
    const [opacity, setOpacity] = useState(() => {
        const stored = loadFromStorage()
        return stored?.opacity ?? DEFAULT_OPACITY
    })

    useEffect(() => {
        saveToStorage({ activeLayers, opacity })
    }, [activeLayers, opacity])

    const handleToggle = useCallback((key) => {
        setActiveLayers((prev) => ({ ...prev, [key]: !prev[key] }))
    }, [])

    return (
        <>
            {renderControl && (
                <HazardControl
                    activeLayers={activeLayers}
                    opacity={opacity}
                    onToggleLayer={handleToggle}
                    onOpacityChange={setOpacity}
                />
            )}
            {renderOverlay && (
                <HazardOverlayRenderer activeLayers={activeLayers} opacity={opacity} />
            )}
        </>
    )
}
