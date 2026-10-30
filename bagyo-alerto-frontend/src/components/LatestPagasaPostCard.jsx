import { useCallback, useEffect, useState } from "react"
import axios from "axios"
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react"

const API_BASE = import.meta.env.VITE_API_BASE
const PAGASA_BULLETIN_URL = "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin"
const PAGASA_FACEBOOK_URL = "https://www.facebook.com/PAGASA.DOST.GOV.PH"
const REFRESH_INTERVAL = 5 * 60 * 1000

function formatDate(value) {
    if (!value) return null

    return new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Manila",
    }).format(new Date(value))
}

function SignalItem({ label, value }) {
    return (
        <div style={styles.signalItem}>
            <span style={styles.signalLabel}>{label}</span>
            <strong style={value ? styles.signalValueActive : styles.signalValueNone}>
                {value ? `Signal No. ${value}` : "No signal"}
            </strong>
        </div>
    )
}

export default function LatestPagasaPostCard() {
    const [bulletin, setBulletin] = useState(null)
    const [loading, setLoading] = useState(true)
    const [refreshError, setRefreshError] = useState(false)

    const fetchBulletin = useCallback(async () => {
        try {
            const response = await axios.get(`${API_BASE}/pagasa/bulletin`, { timeout: 12000 })
            setBulletin(response.data)
            setRefreshError(false)
        } catch (error) {
            // Keep the last successful bulletin visible during temporary failures.
            console.error("Failed to refresh the PAGASA bulletin:", error)
            setRefreshError(true)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        const initialRequest = window.setTimeout(fetchBulletin, 0)
        const refreshTimer = window.setInterval(fetchBulletin, REFRESH_INTERVAL)

        return () => {
            window.clearTimeout(initialRequest)
            window.clearInterval(refreshTimer)
        }
    }, [fetchBulletin])

    useEffect(() => {
        if (!bulletin?.refreshing) return undefined

        const refreshCheck = window.setTimeout(fetchBulletin, 5000)
        return () => window.clearTimeout(refreshCheck)
    }, [bulletin?.refreshing, fetchBulletin])

    const unavailable = bulletin && ["fetch_failed", "parse_failed"].includes(bulletin.status)
    const sourceUrl = bulletin?.active && bulletin?.source_url
        ? bulletin.source_url
        : PAGASA_BULLETIN_URL

    return (
        <section style={styles.card} aria-labelledby="latest-pagasa-bulletin-title">
            <div style={styles.header}>
                <div style={{ width: "100%" }}>
                    <div style={styles.eyebrowRow}>
                        <span style={styles.eyebrow}>PAGASA bulletin</span>
                        <span style={styles.pinnedBadge}>Pinned</span>
                    </div>
                    <h2 id="latest-pagasa-bulletin-title" style={styles.title}>Latest PAGASA Bulletin</h2>
                    <p style={styles.helper}>Official tropical cyclone information from DOST-PAGASA</p>
                </div>
            </div>

            {loading && !bulletin && (
                <div style={styles.stateBox}><RefreshCw size={18} /> Checking the official bulletin…</div>
            )}

            {!loading && !bulletin && (
                <div style={styles.warningBox}>
                    <AlertTriangle size={18} /> The official bulletin is temporarily unavailable.
                </div>
            )}

            {bulletin && (
                <div style={styles.bulletinBody}>
                    {(refreshError || unavailable || bulletin.is_stale) && (
                        <div style={styles.warningBox}>
                            <AlertTriangle size={17} /> Updates may be delayed. Check PAGASA directly.
                        </div>
                    )}

                    {bulletin.active ? (
                        <>
                            <div style={styles.statusRow}>
                                <span style={styles.activeBadge}>Active bulletin</span>
                                {bulletin.bulletin_no && <span style={styles.bulletinNo}>Bulletin #{bulletin.bulletin_no}</span>}
                            </div>
                            <h3 style={styles.stormName}>{bulletin.storm_name || "Tropical Cyclone"}</h3>
                            {bulletin.issued_at && <p style={styles.issueTime}>Issued {formatDate(bulletin.issued_at)}</p>}

                            <div style={styles.signalGrid}>
                                <SignalItem label="Surigao del Norte" value={bulletin.sdn_signal} />
                                <SignalItem label="Siargao Islands" value={bulletin.siargao_signal} />
                                <SignalItem label="Bucas Grande Islands" value={bulletin.bucas_grande_signal} />
                            </div>
                        </>
                    ) : unavailable ? (
                        <div style={styles.noActiveBox}>
                            <strong>Official bulletin temporarily unavailable.</strong>
                            <span>Use the official PAGASA link below while Bakwit retries.</span>
                        </div>
                    ) : (
                        <div style={styles.noActiveBox}>
                            <strong>No active tropical cyclone bulletin.</strong>
                            <span>PAGASA currently lists no active tropical cyclone bulletin.</span>
                        </div>
                    )}

                    {bulletin.last_checked_at && (
                        <p style={styles.lastChecked}>Last checked {formatDate(bulletin.last_checked_at)}</p>
                    )}
                </div>
            )}

            <div style={styles.actions}>
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={styles.primaryLink}>
                    Open official bulletin <ExternalLink size={14} />
                </a>
                <a href={PAGASA_FACEBOOK_URL} target="_blank" rel="noopener noreferrer" style={styles.secondaryLink}>
                    PAGASA on Facebook <ExternalLink size={13} />
                </a>
            </div>
        </section>
    )
}

const styles = {
    card: {
        height: "100%",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        fontFamily: "var(--sans)",
    },
    header: { display: "flex", alignItems: "center", marginBottom: 14 },
    eyebrowRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 7, marginBottom: 10 },
    eyebrow: { color: "var(--muted-foreground)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" },
    pinnedBadge: { padding: "2px 7px", borderRadius: 999, color: "var(--accent-foreground)", background: "var(--accent)", fontSize: 10, fontWeight: 700 },
    title: { margin: 0, color: "var(--foreground)", fontSize: 14, lineHeight: 1.3, fontWeight: 650 },
    helper: { margin: "3px 0 0", color: "var(--muted-foreground)", fontSize: 12 },
    bulletinBody: { minWidth: 0 },
    stateBox: {
        minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center",
        gap: 8, borderRadius: 9, color: "var(--muted-foreground)", background: "var(--secondary)", fontSize: 13,
    },
    warningBox: {
        display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", marginBottom: 12,
        border: "1px solid var(--warning)", borderRadius: 8, background: "var(--warning-soft)", color: "#7c4a03", fontSize: 12,
    },
    statusRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 },
    activeBadge: {
        padding: "4px 9px", borderRadius: 999, background: "#dcfce7", color: "#166534",
        fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.03em",
    },
    bulletinNo: { color: "var(--muted-foreground)", fontSize: 12, fontWeight: 700 },
    stormName: { margin: "12px 0 2px", color: "var(--foreground)", fontSize: 20 },
    issueTime: { margin: 0, color: "var(--muted-foreground)", fontSize: 12, fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" },
    signalGrid: {
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 16,
    },
    signalItem: {
        display: "flex", flexDirection: "column", gap: 4, padding: 12, border: "1px solid #e2e8f0",
        borderRadius: 8, background: "var(--card)",
    },
    signalLabel: { color: "#64748b", fontSize: 11, fontWeight: 700 },
    signalValueActive: { color: "#b91c1c", fontSize: 15 },
    signalValueNone: { color: "#15803d", fontSize: 14 },
    noActiveBox: { display: "flex", flexDirection: "column", gap: 5, color: "#334155", fontSize: 13 },
    lastChecked: { margin: "12px 0 0", color: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" },
    actions: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 12 },
    primaryLink: {
        display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 7,
        background: "var(--secondary)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, fontWeight: 700, textDecoration: "none",
    },
    secondaryLink: {
        display: "inline-flex", alignItems: "center", gap: 5, color: "var(--primary)",
        fontSize: 12, fontWeight: 600, textDecoration: "none",
    },
}
