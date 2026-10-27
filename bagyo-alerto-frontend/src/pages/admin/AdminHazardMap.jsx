import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { AlertTriangle, ChevronRight, ExternalLink, RefreshCw, Shield, Map } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"
import { HazardControl, HazardOverlayRenderer } from "../../components/HazardOverlay"
import HazardLegendDetailed from "../../components/HazardLegendDetailed"

const API_BASE = import.meta.env.VITE_API_BASE
const SURIGAO_CENTER = [9.7843, 125.4887]
const STREET_TILES_URL = import.meta.env.VITE_STREET_TILES_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const SATELLITE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
const HAZARD_LS_KEY = "bakwit_admin_hazard_layers"
const HAZARD_DEFAULT_OPACITY = 0.55

function loadHazardState() {
    try { const raw = localStorage.getItem(HAZARD_LS_KEY); return raw ? JSON.parse(raw) : null } catch (_e) { return null }
}

const RANK = { low: 1, moderate: 2, high: 3, very_high: 4 }
function worstClass(f, l) {
    if (!f && !l) return null
    if (!f) return l
    if (!l) return f
    return (RANK[f] || 0) >= (RANK[l] || 0) ? f : l
}
function hazardColor(cls) {
    if (!cls) return "#9ca3af"
    if (cls === "high" || cls === "very_high") return "#ef4444"
    if (cls === "moderate") return "#f59e0b"
    return "#22c55e"
}
function isHigh(f, l) {
    return f === "high" || f === "very_high" || l === "high" || l === "very_high"
}
function formatClass(cls) {
    if (cls === "very_high") return "Very high"
    if (cls === "high")     return "High"
    if (cls === "moderate") return "Moderate"
    if (cls === "low")      return "Low"
    return "—"
}

function centerIcon(color) {
    const svg = '<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">'
        + '<rect x="2" y="2" width="26" height="26" rx="6" fill="' + color + '" stroke="#fff" stroke-width="2.5"/>'
        + '<text x="15" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="#fff" font-family="sans-serif">E</text>'
        + '</svg>'
    return L.divIcon({ html: svg, className: "", iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -18] })
}

function MapController({ flyTo }) {
    const map = useMap()
    useEffect(() => { if (flyTo) map.flyTo([flyTo.lat, flyTo.lng], 16, { animate: true, duration: 1 }) }, [flyTo, map])
    return null
}

function CBadge({ cls }) {
    const bg = hazardColor(cls)
    return (
        <span style={{ display: "inline-block", background: bg, color: "#fff", borderRadius: 999,
            padding: "1px 8px", fontSize: 11, fontWeight: 700, marginLeft: 4, verticalAlign: "middle" }}>
            {formatClass(cls)}
        </span>
    )
}

export default function AdminHazardMap() {
    const { authHeaders, logout } = useAdminAuth()
    const navigate = useNavigate()
    const [data, setData] = useState({ barangays: [], centers: [] })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [showBarangays, setShowBarangays] = useState(true)
    const [showCenters, setShowCenters] = useState(true)
    const [showOnlyHighHazard, setShowOnlyHighHazard] = useState(false)
    const [activeLayers, setActiveLayers] = useState(() => {
        const s = loadHazardState(); return s?.activeLayers ?? { flood: true, landslide: true }
    })
    const [opacity, setOpacity] = useState(() => {
        const s = loadHazardState(); return s?.opacity ?? HAZARD_DEFAULT_OPACITY
    })
    const [satellite, setSatellite] = useState(false)
    const [flyTo, setFlyTo] = useState(null)

    const saveHazard = (layers, op) => {
        try { localStorage.setItem(HAZARD_LS_KEY, JSON.stringify({ activeLayers: layers, opacity: op })) } catch (_e) {}
    }
    const handleToggleLayer = useCallback((key) => {
        setActiveLayers((prev) => { const next = { ...prev, [key]: !prev[key] }; saveHazard(next, opacity); return next })
    }, [opacity])
    const handleOpacityChange = useCallback((val) => { setOpacity(val); saveHazard(activeLayers, val) }, [activeLayers])

    const fetchData = useCallback(async () => {
        setLoading(true); setError(null)
        try {
            const res = await axios.get(API_BASE + "/admin/hazard-map", { headers: authHeaders() })
            setData(res.data); setLastUpdated(new Date())
        } catch (err) {
            if (err.response?.status === 401) { logout(); navigate("/admin/login"); return }
            setError("Failed to load hazard map data.")
        } finally { setLoading(false) }
    }, [authHeaders, logout, navigate])

    useEffect(() => { fetchData() }, [fetchData])

    const highHazardCenters = data.centers
        .filter((c) => isHigh(c.flood_class, c.landslide_class))
        .sort((a, b) => {
            const rankA = RANK[worstClass(a.flood_class, a.landslide_class)] || 0
            const rankB = RANK[worstClass(b.flood_class, b.landslide_class)] || 0
            if (rankB !== rankA) return rankB - rankA
            return a.name.localeCompare(b.name)
        })
    const visibleCenters = showOnlyHighHazard ? highHazardCenters : data.centers
    const visibleBarangays = showOnlyHighHazard
        ? data.barangays.filter((b) => isHigh(b.flood_class, b.landslide_class))
        : data.barangays

    return (
        <AdminLayout>
            <div style={S.pageShell}>
                <section style={S.hero}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                        <div>
                            <div style={S.heroTitle}>Hazard Map</div>
                            <div style={S.heroSub}>Surigao City — barangay &amp; evacuation center flood/landslide susceptibility</div>
                        </div>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                            {lastUpdated && <span style={S.tsBadge}>Updated {lastUpdated.toLocaleTimeString()}</span>}
                            <button type="button" onClick={fetchData} disabled={loading} style={S.refreshBtn}>
                                <RefreshCw size={14} /> {loading ? "Loading…" : "Refresh"}
                            </button>
                        </div>
                    </div>
                </section>

                <section style={S.summaryBar}>
                    {[
                        { icon: <Shield size={18} color="#ef4444"/>, num: highHazardCenters.length + " of " + data.centers.length, lbl: "centers in High hazard zone" },
                        { icon: <Map size={18} color="#1a237e"/>, num: data.barangays.length, lbl: "barangays mapped" },
                        { icon: <AlertTriangle size={18} color="#f59e0b"/>, num: data.barangays.filter(b => isHigh(b.flood_class, b.landslide_class)).length, lbl: "barangays in High hazard zone" },
                    ].map(({ icon, num, lbl }, i) => (
                        <div key={i} style={S.summaryCard}>
                            {icon}
                            <div><div style={S.summaryNum}>{num}</div><div style={S.summaryLbl}>{lbl}</div></div>
                        </div>
                    ))}
                </section>

                {error && <div style={S.errBanner}><AlertTriangle size={15}/> {error}</div>}

                <div style={S.mainLayout}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={S.ctrlRow}>
                            <div style={S.tileSel}>
                                {["Street", "Satellite"].map((t, i) => (
                                    <button key={t} type="button" onClick={() => setSatellite(i === 1)}
                                        style={{ ...S.tileBtn, ...(satellite ? (i === 1 ? S.tileBtnOn : {}) : (i === 0 ? S.tileBtnOn : {})) }}>
                                        {t}
                                    </button>
                                ))}
                            </div>
                            <label style={S.layerTog}>
                                <input id="tog-brgy" type="checkbox" checked={showBarangays}
                                    onChange={e => setShowBarangays(e.target.checked)} style={{ accentColor: "#1a237e" }}/>
                                Barangay pins
                            </label>
                            <label style={S.layerTog}>
                                <input id="tog-ctr" type="checkbox" checked={showCenters}
                                    onChange={e => setShowCenters(e.target.checked)} style={{ accentColor: "#1a237e" }}/>
                                Center pins
                            </label>
                            <label style={{ ...S.layerTog, color: "#ef4444", fontWeight: 700 }}>
                                <input id="tog-high" type="checkbox" checked={showOnlyHighHazard}
                                    onChange={e => setShowOnlyHighHazard(e.target.checked)} style={{ accentColor: "#ef4444" }}/>
                                High hazard only
                            </label>
                        </div>

                        <div style={S.mapWrap}>
                            <MapContainer center={SURIGAO_CENTER} zoom={13}
                                style={{ width: "100%", height: "100%" }} zoomControl>
                                <TileLayer
                                    url={satellite ? SATELLITE_URL : STREET_TILES_URL}
                                    attribution={satellite ? "Tiles © Esri" : "© OpenStreetMap contributors"}
                                    maxZoom={19}/>
                                <HazardOverlayRenderer activeLayers={activeLayers} opacity={opacity}/>
                                <MapController flyTo={flyTo}/>

                                {showBarangays && visibleBarangays.map((b) => {
                                    if (b.lat == null || b.lng == null) return null
                                    const color = hazardColor(worstClass(b.flood_class, b.landslide_class))
                                    return (
                                        <CircleMarker key={"brgy-" + b.id} center={[b.lat, b.lng]} radius={10}
                                            pathOptions={{ color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.9 }}>
                                            <Popup>
                                                <div style={S.popup}>
                                                    <div style={S.popTitle}>{b.name}</div>
                                                    <div style={S.popType}>Barangay</div>
                                                    <table style={{ width: "100%", fontSize: 12, marginTop: 6, borderCollapse: "collapse" }}>
                                                        <tbody>
                                                            <tr><td style={S.popLbl}>Flood</td><td><CBadge cls={b.flood_class}/></td></tr>
                                                            <tr><td style={S.popLbl}>Landslide</td><td><CBadge cls={b.landslide_class}/></td></tr>
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </Popup>
                                        </CircleMarker>
                                    )
                                })}

                                {showCenters && visibleCenters.map((c) => {
                                    if (c.lat == null || c.lng == null) return null
                                    const color = hazardColor(worstClass(c.flood_class, c.landslide_class))
                                    const high = isHigh(c.flood_class, c.landslide_class)
                                    return (
                                        <Marker key={"ctr-" + c.id} position={[c.lat, c.lng]} icon={centerIcon(color)}>
                                            <Popup>
                                                <div style={S.popup}>
                                                    <div style={S.popTitle}>{c.name}</div>
                                                    <div style={S.popType}>Evacuation Center</div>
                                                    {high && <div style={S.highBadge}>⚠ High Hazard Zone</div>}
                                                    <table style={{ width: "100%", fontSize: 12, marginTop: 6, borderCollapse: "collapse" }}>
                                                        <tbody>
                                                            <tr><td style={S.popLbl}>Flood</td><td><CBadge cls={c.flood_class}/></td></tr>
                                                            <tr><td style={S.popLbl}>Landslide</td><td><CBadge cls={c.landslide_class}/></td></tr>
                                                            <tr><td style={S.popLbl}>Occupancy</td>
                                                                <td style={{ fontWeight: 600, paddingLeft: 4 }}>{c.current_occupancy} / {c.capacity}</td></tr>
                                                        </tbody>
                                                    </table>
                                                    <button type="button" onClick={() => navigate("/admin/evacuation-centers")} style={S.editLink}>
                                                        <ExternalLink size={11}/> Edit center
                                                    </button>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )
                                })}
                            </MapContainer>

                            <HazardControl activeLayers={activeLayers} opacity={opacity}
                                onToggleLayer={handleToggleLayer} onOpacityChange={handleOpacityChange}/>

                            <div style={S.pinLegend}>
                                <div style={S.pinLegTitle}>Pin Legend</div>
                                {[
                                    { lbl: "High / Very High", c: "#ef4444" },
                                    { lbl: "Moderate", c: "#f59e0b" },
                                    { lbl: "Low", c: "#22c55e" },
                                    { lbl: "Unknown", c: "#9ca3af" },
                                ].map(({ lbl, c }) => (
                                    <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: c,
                                            border: "1.5px solid #fff", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,0,0,.25)" }}/>
                                        {lbl}
                                    </div>
                                ))}
                                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 4, marginTop: 2 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                                        <div style={{ width: 14, height: 14, borderRadius: 3, background: "#64748b",
                                            border: "1.5px solid #fff", flexShrink: 0, display: "grid", placeItems: "center" }}>
                                            <span style={{ color: "#fff", fontSize: 9, fontWeight: 900 }}>E</span>
                                        </div>
                                        Evacuation center
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 4 }}>
                                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#1a237e",
                                            border: "1.5px solid #fff", flexShrink: 0 }}/>
                                        Barangay
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <aside style={S.sidePanel}>
                        <div style={S.sidePanelHead}>
                            <AlertTriangle size={16} color="#ef4444"/>
                            <span>High Hazard Centers</span>
                            <span style={S.sidePanelCnt}>{highHazardCenters.length}</span>
                        </div>
                        <div style={S.sidePanelNote}>Click a row to pan to the center on the map.</div>
                        {highHazardCenters.length === 0 ? (
                            <div style={S.sidePanelEmpty}>No centers are currently in a High hazard zone.</div>
                        ) : (
                            <div style={S.sidePanelList}>
                                {highHazardCenters.map((c) => (
                                    <div key={c.id} style={S.sidePanelRow}
                                        onClick={() => {
                                            if (c.lat != null && c.lng != null) {
                                                setFlyTo({ lat: c.lat, lng: c.lng, _id: c.id })
                                                setShowCenters(true)
                                            }
                                        }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={S.sidePanelName}>{c.name}</div>
                                            <div style={S.sidePanelMeta}>{c.barangay_name || ("Barangay ID " + c.barangay_id)}</div>
                                            <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                                                {(c.flood_class === "high" || c.flood_class === "very_high") &&
                                                    <span style={{ ...S.hazTag, background: "#fee2e2", color: "#b91c1c" }}>Flood: {formatClass(c.flood_class)}</span>}
                                                {(c.landslide_class === "high" || c.landslide_class === "very_high") &&
                                                    <span style={{ ...S.hazTag, background: "#fef3c7", color: "#92400e" }}>Landslide: {formatClass(c.landslide_class)}</span>}
                                            </div>
                                        </div>
                                        <div style={S.sidePanelCap}>
                                            <div style={{ fontSize: 13, fontWeight: 700 }}>{c.current_occupancy}/{c.capacity}</div>
                                            <div style={{ fontSize: 10, color: "#64748b" }}>occupancy</div>
                                        </div>
                                        <ChevronRight size={14} color="#94a3b8" style={{ flexShrink: 0 }}/>
                                    </div>
                                ))}
                            </div>
                        )}
                    </aside>
                </div>
                <HazardLegendDetailed />
            </div>
            <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        </AdminLayout>
    )
}

const S = {
    pageShell: { display: "grid", gap: 16 },
    hero: { borderRadius: 16, background: "linear-gradient(135deg,#1a237e,#283593)", color: "#fff", padding: "22px 24px", boxShadow: "0 8px 20px rgba(26,35,126,0.22)" },
    heroTitle: { fontSize: 26, fontWeight: 700 },
    heroSub: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.85)" },
    tsBadge: { fontSize: 11, color: "rgba(255,255,255,0.75)", background: "rgba(255,255,255,0.1)", padding: "5px 10px", borderRadius: 999 },
    refreshBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" },
    summaryBar: { display: "flex", gap: 12, flexWrap: "wrap" },
    summaryCard: { flex: "1 1 160px", display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 14, border: "1px solid #e4e8f2", padding: "14px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
    summaryNum: { fontSize: 22, fontWeight: 800, color: "#1e293b", lineHeight: 1 },
    summaryLbl: { fontSize: 11, color: "#64748b", marginTop: 3 },
    errBanner: { background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 },
    mainLayout: { display: "flex", gap: 16, alignItems: "flex-start" },
    ctrlRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 10, background: "#fff", borderRadius: 12, border: "1px solid #e4e8f2", padding: "10px 14px", boxShadow: "0 2px 6px rgba(0,0,0,0.04)" },
    tileSel: { display: "inline-flex", borderRadius: 8, overflow: "hidden", border: "1px solid #d1d5db" },
    tileBtn: { padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#f8fafc", color: "#64748b", border: "none" },
    tileBtnOn: { background: "#1a237e", color: "#fff" },
    layerTog: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, cursor: "pointer", color: "#374151" },
    mapWrap: { position: "relative", height: 560, borderRadius: 16, overflow: "hidden", border: "1px solid #e4e8f2", boxShadow: "0 4px 16px rgba(0,0,0,0.07)" },
    pinLegend: { position: "absolute", bottom: 30, right: 10, zIndex: 1000, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(4px)", border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,0.13)", padding: "8px 10px", fontSize: 12, color: "#1e293b", display: "grid", gap: 5, userSelect: "none", minWidth: 140 },
    pinLegTitle: { fontWeight: 700, fontSize: 10, letterSpacing: "0.06em", color: "#64748b", textTransform: "uppercase", marginBottom: 2 },
    popup: { minWidth: 180, maxWidth: 240 },
    popTitle: { fontWeight: 700, fontSize: 14, color: "#1e293b", marginBottom: 2 },
    popType: { fontSize: 11, color: "#64748b", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" },
    popLbl: { color: "#64748b", paddingRight: 6, paddingTop: 3, fontSize: 12 },
    highBadge: { marginTop: 6, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, display: "inline-block" },
    editLink: { marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#1a237e", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" },
    sidePanel: { width: 280, flexShrink: 0, background: "#fff", borderRadius: 16, border: "1px solid #e4e8f2", boxShadow: "0 4px 16px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column", maxHeight: 640, overflow: "hidden" },
    sidePanelHead: { display: "flex", alignItems: "center", gap: 8, padding: "14px 16px 10px", fontWeight: 700, fontSize: 14, borderBottom: "1px solid #f1f5f9", color: "#1e293b" },
    sidePanelCnt: { marginLeft: "auto", background: "#fef2f2", color: "#b91c1c", borderRadius: 999, padding: "1px 8px", fontSize: 12, fontWeight: 700 },
    sidePanelNote: { padding: "6px 16px", fontSize: 11, color: "#94a3b8", fontStyle: "italic" },
    sidePanelEmpty: { padding: "20px 16px", fontSize: 13, color: "#64748b", textAlign: "center" },
    sidePanelList: { overflowY: "auto", flex: 1 },
    sidePanelRow: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderBottom: "1px solid #f1f5f9", cursor: "pointer" },
    sidePanelName: { fontWeight: 600, fontSize: 13, color: "#1e293b" },
    sidePanelMeta: { fontSize: 11, color: "#64748b", marginTop: 1 },
    hazTag: { borderRadius: 999, padding: "1px 7px", fontSize: 10, fontWeight: 700 },
    sidePanelCap: { textAlign: "center", flexShrink: 0, minWidth: 48 },
}
