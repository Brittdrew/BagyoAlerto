import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import axios from "axios"
import {
    Send,
    MessageCircle,
    Wind,
    CheckCircle2,
    XCircle,
    Briefcase,
    Backpack,
    Droplet,
    Utensils,
    Zap,
    Shield,
    FileText,
    Radio,
    Battery,
    DollarSign,
    Key,
    Smartphone,
    Home,
    User,
    MapPin,
    Sparkles,
    PhoneCall,
    Waves,
    ChevronRight,
    Bot,
    Compass,
    AlertTriangle,
    AlertCircle,
    Activity,
    BookOpen,
    CloudSun,
    Package,
    Trash2,
    Copy,
    Check,
    RefreshCw,
    Thermometer,
} from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"
import MapView from "../../components/MapView"

function getCookie(name) {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"))
    return match ? decodeURIComponent(match[2]) : null
}


axios.defaults.headers.common["X-XSRF-TOKEN"] = getCookie("XSRF-TOKEN")

const API_BASE = import.meta.env.VITE_API_BASE
const genId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 6)}`

// ─── Typing Indicator ────────────────────────────────────────────────────────
function TypingIndicator() {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 2px" }}>
            {[0, 150, 300].map((delay) => (
                <span
                    key={delay}
                    style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: "#94a3b8",
                        display: "inline-block",
                        animation: "typingBounce 1.2s ease-in-out infinite",
                        animationDelay: `${delay}ms`,
                    }}
                />
            ))}
        </div>
    )
}

// ─── Live Weather Mini Card ───────────────────────────────────────────────────
function WeatherMiniCard({ data }) {
    if (!data) return null
    return (
        <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.65rem",
            marginTop: "0.7rem",
            padding: "0.5rem 0.8rem",
            background: "#f0fdf4",
            borderRadius: "8px",
            border: "1px solid #bbf7d0",
            fontSize: "0.775rem",
            color: "#166534",
            alignItems: "center",
        }}>
            <span style={{ display: "flex", alignItems: "center", gap: "3px", fontWeight: 600 }}>
                <Wind size={11} style={{ color: "#3b82f6" }} />
                {(data.wind_speed ?? 0).toFixed(1)} km/h
            </span>
            <span style={{ color: "#bbf7d0" }}>|</span>
            <span style={{ display: "flex", alignItems: "center", gap: "3px", fontWeight: 600 }}>
                <Droplet size={11} style={{ color: "#06b6d4" }} />
                {(data.rainfall ?? 0).toFixed(1)} mm/hr
            </span>
            <span style={{ color: "#bbf7d0" }}>|</span>
            <span style={{ display: "flex", alignItems: "center", gap: "3px", fontWeight: 600 }}>
                <Thermometer size={11} style={{ color: "#f59e0b" }} />
                {(data.temperature ?? 0).toFixed(1)}°C
            </span>
            <span style={{ color: "#bbf7d0" }}>|</span>
            <span style={{ display: "flex", alignItems: "center", gap: "3px", fontWeight: 600 }}>
                <Activity size={11} style={{ color: "#8b5cf6" }} />
                {data.humidity ?? 0}% humidity
            </span>
            <span style={{
                marginLeft: "auto",
                fontSize: "0.68rem",
                opacity: 0.65,
                fontStyle: "italic",
                display: "flex",
                alignItems: "center",
                gap: "3px",
            }}>
                <RefreshCw size={9} /> Live data
            </span>
        </div>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdminChat() {
    const { authHeaders } = useAdminAuth()

    // Message list - completely session-based now (removed localStorage)
    const [messages, setMessages] = useState([])
    const [question, setQuestion] = useState("")
    const [loading, setLoading] = useState(false)
    const [barangays, setBarangays] = useState([])
    const [lastBarangay, setLastBarangay] = useState(null)   // context memory
    const [copiedId, setCopiedId] = useState(null)
    const [refreshingId, setRefreshingId] = useState(null)
    const [suggestions, setSuggestions] = useState([])
    const messagesEndRef = useRef(null)

    // Sidebar states for Recent Questions
    const [recentLogs, setRecentLogs] = useState([])
    const [sidebarLoading, setSidebarLoading] = useState(false)

    // ── Fetch Recent Questions from database history
    const fetchRecentLogs = useCallback(async () => {
        setSidebarLoading(true)
        try {
            const res = await axios.get(`${API_BASE}/chat/history`, { headers: authHeaders() })
            // Take the 12 most recent Q&A entries
            setRecentLogs((res.data.data || []).slice(0, 12))
        } catch (err) {
            console.error("Failed to load recent questions:", err)
        } finally {
            setSidebarLoading(false)
        }
    }, [authHeaders])

    // Load recent questions & barangays on mount
    useEffect(() => {
        fetchRecentLogs()

        axios.get(`${API_BASE}/barangays`)
            .then(res => setBarangays(res.data))
            .catch(err => console.error("Failed to load barangays:", err))
    }, [fetchRecentLogs])

    // ── Auto-scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages, loading])

    useEffect(() => {
        if (messages.length > 0) {
            try {
                sessionStorage.setItem(
                    "bagyoalerto_chat",
                    JSON.stringify(messages)
                )
                sessionStorage.setItem(
                    "bagyoalerto_last_barangay",
                    lastBarangay || ""
                )
            } catch(e) {}
        }
    }, [messages, lastBarangay])

    useEffect(() => {
        try {
            const saved = sessionStorage.getItem("bagyoalerto_chat")
            const savedBarangay = sessionStorage.getItem(
                "bagyoalerto_last_barangay"
            )
            if (saved) setMessages(JSON.parse(saved))
            if (savedBarangay) setLastBarangay(savedBarangay)
        } catch(e) {}
    }, [])

    // ── Click to load a recent question & historical response back into active view
    const handleLoadRecentLog = (log) => {
        if (log.barangay_name) {
            setLastBarangay(log.barangay_name)
        }

        // Try to pre-fill barangay coordinate from cache/list if matched
        const matchedBarangayObj = barangays.find(
            b => b.name.toLowerCase() === (log.barangay_name || "").toLowerCase()
        )

        // Construct Q&A message block
        const loadedMessages = [
            {
                id: `user-${log.id}`,
                type: "user",
                text: log.question,
                timestamp: log.created_at,
            },
            {
                id: `bot-${log.id}`,
                type: "bot",
                text: log.answer,
                barangay: log.barangay_name,
                severity: log.severity,
                intent: log.intent || "knowledge",
                weatherData: log.wind !== null ? {
                    wind_speed: log.wind,
                    rainfall: log.rainfall,
                    temperature: log.temperature,
                    humidity: log.humidity,
                    pressure: log.pressure || 1013,
                } : null,
                aiPowered: true,
                timestamp: log.created_at,
                originalQuestion: log.question,
                barangayCoords: matchedBarangayObj ? {
                    id: matchedBarangayObj.id,
                    name: matchedBarangayObj.name,
                    latitude: Number(matchedBarangayObj.latitude),
                    longitude: Number(matchedBarangayObj.longitude),
                } : null,
                evacuationCoords: null, // User can click Refresh to load active evacuation routes
            }
        ]
        setMessages(loadedMessages)
    }

    // ── Memoised symbol map — only built once
    const symbolMap = useMemo(() => [
        { char: "🌀", icon: <Wind size={15} style={{ color: "#10b981" }} />, isHeader: true },
        { char: "🧰", icon: <Briefcase size={15} style={{ color: "#2563eb" }} />, isHeader: true },
        { char: "🎒", icon: <Backpack size={15} style={{ color: "#6366f1" }} />, isHeader: true },
        { char: "🌤️", icon: <CloudSun size={15} style={{ color: "#f59e0b" }} />, isHeader: true },
        { char: "🌊", icon: <Waves size={15} style={{ color: "#2563eb" }} />, isHeader: true },
        { char: "📞", icon: <PhoneCall size={15} style={{ color: "#10b981" }} />, isHeader: true },
        { char: "👋", icon: <Sparkles size={15} style={{ color: "#ec4899" }} />, isHeader: true },
        { char: "⚠️", icon: <AlertTriangle size={15} style={{ color: "#ef4444" }} />, isHeader: true },
        { char: "✅", icon: <CheckCircle2 size={14} style={{ color: "#10b981" }} /> },
        { char: "❌", icon: <XCircle size={14} style={{ color: "#ef4444" }} /> },
        { char: "🟢", icon: <span style={{ width: "9px", height: "9px", borderRadius: "50%", display: "inline-block", backgroundColor: "#10b981" }} /> },
        { char: "🟡", icon: <span style={{ width: "9px", height: "9px", borderRadius: "50%", display: "inline-block", backgroundColor: "#eab308" }} /> },
        { char: "🟠", icon: <span style={{ width: "9px", height: "9px", borderRadius: "50%", display: "inline-block", backgroundColor: "#f97316" }} /> },
        { char: "🔴", icon: <span style={{ width: "9px", height: "9px", borderRadius: "50%", display: "inline-block", backgroundColor: "#ef4444" }} /> },
        { char: "⛔", icon: <AlertCircle size={14} style={{ color: "#b91c1c" }} /> },
        { char: "⛑️", icon: <Shield size={14} style={{ color: "#0284c7" }} /> },
        { char: "🔋", icon: <Battery size={14} style={{ color: "#10b981" }} /> },
        { char: "🩺", icon: <Activity size={14} style={{ color: "#f43f5e" }} /> },
        { char: "📄", icon: <FileText size={14} style={{ color: "#64748b" }} /> },
        { char: "📻", icon: <Radio size={14} style={{ color: "#8b5cf6" }} /> },
        { char: "💵", icon: <DollarSign size={14} style={{ color: "#10b981" }} /> },
        { char: "🔑", icon: <Key size={14} style={{ color: "#d97706" }} /> },
        { char: "📱", icon: <Smartphone size={14} style={{ color: "#475569" }} /> },
        { char: "🏠", icon: <Home size={14} style={{ color: "#0284c7" }} /> },
        { char: "📦", icon: <Package size={14} style={{ color: "#f97316" }} /> },
        { char: "🏃", icon: <User size={14} style={{ color: "#d97706" }} /> },
        { char: "📍", icon: <MapPin size={14} style={{ color: "#ec4899" }} /> },
        { char: "🆘", icon: <AlertTriangle size={14} style={{ color: "#b91c1c" }} /> },
        { char: "🚒", icon: <Shield size={14} style={{ color: "#ef4444" }} /> },
        { char: "🚔", icon: <Shield size={14} style={{ color: "#3b82f6" }} /> },
        { char: "🏥", icon: <Activity size={14} style={{ color: "#ec4899" }} /> },
        { char: "💧", icon: <Droplet size={14} style={{ color: "#3b82f6" }} /> },
        { char: "🍱", icon: <Utensils size={14} style={{ color: "#f97316" }} /> },
        { char: "🔦", icon: <Zap size={14} style={{ color: "#f59e0b" }} /> },
        { char: "🤒", icon: <Activity size={14} style={{ color: "#f43f5e" }} /> },
        { char: "🚗", icon: <ChevronRight size={14} style={{ color: "#64748b" }} /> },
        { char: "🚫", icon: <XCircle size={14} style={{ color: "#ef4444" }} /> },
        { char: "🔍", icon: <Compass size={14} style={{ color: "#6366f1" }} /> },
    ], [])

    // ── Send question
    const handleInputChange = (e) => {
        const val = e.target.value
        setQuestion(val)
        if (val.length >= 2) {
            const matches = barangays
                .filter(b => b.name.toLowerCase().includes(val.toLowerCase()))
                .slice(0, 5)
            setSuggestions(matches)
        } else {
            setSuggestions([])
        }
    }

    const handleSendQuestion = async (qText = null) => {
        const activeQuestion = qText || question
        if (!activeQuestion.trim() || loading) return

        const userMessage = {
            id: genId(),
            type: "user",
            text: activeQuestion,
            timestamp: new Date().toISOString(),
        }
        setMessages(prev => [...prev, userMessage])
        if (!qText) setQuestion("")
        setLoading(true)

        try {
            const res = await axios.post(`${API_BASE}/chat`, {
                question: activeQuestion,
                last_barangay: lastBarangay,
            }, { headers: authHeaders() })

            const data = res.data
            if (data.barangay_name) setLastBarangay(data.barangay_name)

            setMessages(prev => [...prev, {
                id: genId(),
                type: "bot",
                text: data.response,
                barangay: data.barangay_name,
                severity: data.severity,
                intent: data.intent,
                weatherData: data.weather_data || null,
                aiPowered: data.ai_powered || false,
                timestamp: new Date().toISOString(),
                originalQuestion: activeQuestion,
                barangayCoords: data.barangay || null,
                evacuationCoords: data.evacuation_center || null,
            }])

            // Dynamically refresh sidebar panel
            fetchRecentLogs()
        } catch (error) {
            console.error("Chat API error:", error)
            const is422 = error.response?.status === 422
            setMessages(prev => [...prev, {
                id: genId(),
                type: "bot",
                text: is422
                    ? "Your question is too long. Please keep it under 500 characters."
                    : "Sorry, I couldn't process your question. Please try again.",
                error: true,
                timestamp: new Date().toISOString(),
            }])
        } finally {
            setLoading(false)
        }
    }

    // ── Refresh weather for a barangay message
    const handleRefresh = async (msg) => {
        setRefreshingId(msg.id)
        try {
            const res = await axios.post(`${API_BASE}/chat`, {
                question: msg.originalQuestion,
                force_refresh: true,
            }, { headers: authHeaders() })
            const data = res.data
            setMessages(prev => prev.map(m =>
                m.id === msg.id
                    ? { 
                        ...m, 
                        text: data.response, 
                        severity: data.severity, 
                        weatherData: data.weather_data || null, 
                        timestamp: new Date().toISOString(), 
                        refreshed: true,
                        barangayCoords: data.barangay || null,
                        evacuationCoords: data.evacuation_center || null,
                      }
                    : m
            ))
            // Refresh sidebar list
            fetchRecentLogs()
        } catch (err) {
            console.error("Refresh error:", err)
        } finally {
            setRefreshingId(null)
        }
    }

    // ── Copy message text
    const handleCopy = (msg) => {
        navigator.clipboard.writeText(msg.text).then(() => {
            setCopiedId(msg.id)
            setTimeout(() => setCopiedId(null), 2000)
        }).catch(() => {})
    }

    // ── Clear all messages in current session view only
    const handleClearChat = () => {
        setMessages([])
        setLastBarangay(null)
        sessionStorage.removeItem("bagyoalerto_chat")
        sessionStorage.removeItem("bagyoalerto_last_barangay")
    }

    // ── Helpers
    const formatTimestamp = (ts) => {
        if (!ts) return ""
        return new Date(ts).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
    }

    const getSeverityBadgeStyle = (severity) => {
        const badge = (bg, color, border) => ({ bg, background: bg, color, border })
        if (!severity) return badge("#f1f5f9", "#475569", "#e2e8f0")
        const sev = severity.toLowerCase()
        if (sev.includes("normal"))   return badge("#dcfce7", "#166534", "#bbf7d0")
        if (sev.includes("watch"))    return badge("#e0f2fe", "#075985", "#bae6fd")
        if (sev.includes("elevated")) return badge("#ffedd5", "#9a3412", "#fed7aa")
        if (sev.includes("signal 1")) return badge("#fef9c3", "#854d0e", "#fef08a")
        if (sev.includes("signal 2")) return badge("#ffe4e6", "#9f1239", "#fecdd3")
        if (sev.includes("signal 3")) return badge("#fee2e2", "#991b1b", "#fecaca")
        if (sev.includes("signal 4")) return badge("#fca5a5", "#7f1d1d", "#f87171")
        if (sev.includes("signal 5")) return badge("#7f1d1d", "#fee2e2", "#ef4444")
        return badge("#ffe4e6", "#9f1239", "#fecdd3")
    }

    const getSeverityBubbleBorder = (severity) => {
        if (!severity) return "1px solid #e2e8f0"
        const sev = severity.toLowerCase()
        if (sev.includes("normal"))   return "1px solid #bbf7d0"
        if (sev.includes("watch"))    return "1px solid #bae6fd"
        if (sev.includes("elevated")) return "1px solid #fed7aa"
        if (sev.includes("signal 1")) return "1px solid #fde68a"
        if (sev.includes("signal 2") || sev.includes("signal 3")) return "2px solid #fca5a5"
        return "2px solid #fca5a5"
    }

    // ── Parse bot message text into styled lines
    const parseMessageText = (text) => {
        if (!text) return null
        try {
            return text.split("\n").map((line, idx) => {
                const trimmed = line.trim()
                if (trimmed === "") return <div key={idx} style={{ height: "0.5rem" }} />

                // ── [Live data · Barangay: X] footer tag ─────────────
                if (trimmed.startsWith("[Live data") && trimmed.endsWith("]")) {
                    return (
                        <div key={idx} style={{
                            marginTop: "0.6rem",
                            paddingTop: "0.5rem",
                            borderTop: "1px solid #f1f5f9",
                            fontSize: "0.7rem",
                            color: "#94a3b8",
                            fontStyle: "italic",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                        }}>
                            <RefreshCw size={9} />
                            {trimmed.slice(1, -1)}
                        </div>
                    )
                }

                // ── Status: X severity badge ──────────────────────────
                if (trimmed.startsWith("Status:")) {
                    const statusValue = trimmed.substring("Status:".length).trim()
                    const { bg, color, border } = getSeverityBadgeStyle(statusValue)
                    return (
                        <div key={idx} style={{
                            display: "flex", alignItems: "center",
                            gap: "0.5rem", margin: "0.35rem 0",
                        }}>
                            <span style={{
                                fontSize: "0.8rem", color: "#64748b",
                                fontWeight: 600, letterSpacing: "0.2px",
                            }}>
                                Status
                            </span>
                            <span style={{
                                display: "inline-flex", alignItems: "center",
                                fontSize: "0.8rem", fontWeight: 700,
                                padding: "0.2rem 0.8rem", borderRadius: "9999px",
                                background: bg, color, border: `1px solid ${border}`,
                            }}>
                                {statusValue}
                            </span>
                        </div>
                    )
                }

                // ── Weather metric lines (Wind / Rainfall / Temperature / Humidity) ──
                const weatherMatch = trimmed.match(/^(Wind|Rainfall|Temperature|Humidity):\s*(.+)$/)
                if (weatherMatch) {
                    const [, label, value] = weatherMatch
                    const weatherIconMap = {
                        Wind:        <Wind size={12} style={{ color: "#3b82f6" }} />,
                        Rainfall:    <Droplet size={12} style={{ color: "#06b6d4" }} />,
                        Temperature: <Thermometer size={12} style={{ color: "#f59e0b" }} />,
                        Humidity:    <Activity size={12} style={{ color: "#8b5cf6" }} />,
                    }
                    return (
                        <div key={idx} style={{
                            display: "flex", alignItems: "center",
                            gap: "0.45rem", margin: "0.1rem 0",
                        }}>
                            <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                                {weatherIconMap[label]}
                            </span>
                            <span style={{
                                fontSize: "0.78rem", color: "#94a3b8",
                                minWidth: "88px", flexShrink: 0,
                            }}>
                                {label}
                            </span>
                            <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0f172a" }}>
                                {value}
                            </span>
                        </div>
                    )
                }

                // ── Evacuation center detail lines ────────────────────
                const evacMatch = trimmed.match(/^(Nearest center|Address|Distance):\s*(.+)$/)
                if (evacMatch) {
                    const [, label, value] = evacMatch
                    const evacIconMap = {
                        "Nearest center": <MapPin size={12} style={{ color: "#ec4899" }} />,
                        "Address":        <Home size={12} style={{ color: "#0284c7" }} />,
                        "Distance":       <Compass size={12} style={{ color: "#6366f1" }} />,
                    }
                    return (
                        <div key={idx} style={{
                            display: "flex", alignItems: "flex-start",
                            gap: "0.45rem", margin: "0.1rem 0",
                        }}>
                            <span style={{ display: "flex", alignItems: "center", marginTop: "2px", flexShrink: 0 }}>
                                {evacIconMap[label]}
                            </span>
                            <span style={{
                                fontSize: "0.78rem", color: "#94a3b8",
                                minWidth: "100px", flexShrink: 0,
                            }}>
                                {label}
                            </span>
                            <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "#0f172a" }}>
                                {value}
                            </span>
                        </div>
                    )
                }

                // ── Existing emoji / symbol icon handling ─────────────
                let isHeader = false
                let icon = null
                let cleanText = line

                let matchedItem = null
                for (const item of symbolMap) {
                    if (trimmed.startsWith(item.char)) { matchedItem = item; break }
                }

                if (matchedItem) {
                    cleanText = trimmed.substring(matchedItem.char.length).trim()
                    isHeader = matchedItem.isHeader || false
                    icon = matchedItem.icon
                } else if (trimmed.startsWith("•") || trimmed.startsWith("*")) {
                    cleanText = trimmed.substring(1).trim()
                    icon = <ChevronRight size={12} style={{ color: "#94a3b8" }} />
                }

                const isIndented = line.startsWith("   ") || line.startsWith("  ") || line.startsWith("\t")

                if (isHeader) return (
                    <div key={idx} style={styles.lineHeader}>
                        {icon && <span style={styles.lineIcon}>{icon}</span>}
                        <span style={styles.lineHeaderText}>{cleanText}</span>
                    </div>
                )

                if (icon) return (
                    <div key={idx} style={{ ...styles.lineList, paddingLeft: isIndented ? "1.5rem" : "0.25rem" }}>
                        <span style={styles.lineIcon}>{icon}</span>
                        <span style={styles.lineListText}>{cleanText}</span>
                    </div>
                )

                return (
                    <p key={idx} style={{ ...styles.linePlain, paddingLeft: isIndented ? "1.5rem" : "0.25rem" }}>
                        {line}
                    </p>
                )
            })
        } catch (err) {
            console.error("parseMessageText error:", err)
            return <p style={styles.linePlain}>{text}</p>
        }
    }

    // ── Suggested questions
    const suggestedQuestions = barangays.length > 0
        ? [
            `Is ${barangays[0]?.name} safe?`,
            `What is the wind speed in ${barangays[1]?.name || barangays[0]?.name}?`,
            `Should I evacuate ${barangays[2]?.name || barangays[0]?.name}?`,
            `What is the rainfall in ${barangays[3]?.name || barangays[0]?.name}?`,
        ]
        : [
            "Is Barangay Carmen safe?",
            "What is the wind speed in Lipata?",
            "Should I evacuate Washington?",
            "What is the rainfall in Mabua?",
        ]

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <AdminLayout>
            <style>{`
                @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.15); opacity: .7; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes typingBounce {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
                    30% { transform: translateY(-7px); opacity: 1; }
                }
                @keyframes skeletonShimmer {
                    0% { background-position: -200px 0; }
                    100% { background-position: calc(200px + 100%) 0; }
                }
                .sidebar-skeleton {
                    background: linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 40%, #f1f5f9 80%);
                    background-size: 200px 100%;
                    animation: skeletonShimmer 1.2s ease-in-out infinite;
                }
                .suggested-btn:hover {
                    background-color: #f0fdf4 !important;
                    border-color: #86efac !important;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
                }
                .send-btn:hover:not(:disabled) {
                    background-color: #15803d !important;
                    transform: scale(1.03);
                }
                .chat-input:focus {
                    border-color: #1D9E75 !important;
                    background-color: white !important;
                    box-shadow: 0 0 0 3px rgba(29, 158, 117, 0.12) !important;
                }
                .msg-action-btn {
                    opacity: 0;
                    transition: opacity 0.15s ease;
                }
                .msg-bubble-group:hover .msg-action-btn {
                    opacity: 1;
                }
                .clear-btn:hover {
                    background: rgba(255,255,255,0.2) !important;
                    color: white !important;
                    border-color: rgba(255,255,255,0.3) !important;
                }
                .refresh-action:hover { color: #1D9E75 !important; }
                .copy-action:hover { color: #3b82f6 !important; }
                .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                
                .sidebar-item-btn {
                    transition: all 0.2s ease;
                }
                .sidebar-item-btn:hover {
                    background-color: #f1f5f9 !important;
                    border-left-color: #1D9E75 !important;
                }
            `}</style>

            <div style={styles.mainLayout}>

                {/* ── Sidebar: Recent Questions Panel ── */}
                <div style={styles.sidebar}>
                    <div style={styles.sidebarHeader}>
                        <MessageCircle size={15} style={{ color: "#1D9E75", marginRight: "6px" }} />
                        <span style={styles.sidebarTitle}>Recent Questions</span>
                    </div>

                    <div className="custom-scrollbar" style={styles.sidebarContent}>
                        {sidebarLoading && recentLogs.length === 0 ? (
                            <div style={styles.sidebarSkeletonList}>
                                {[...Array(6)].map((_, i) => (
                                    <div key={i} style={styles.sidebarSkeletonItem}>
                                        <div className="sidebar-skeleton" style={styles.sidebarSkeletonTitle} />
                                        <div className="sidebar-skeleton" style={styles.sidebarSkeletonMeta} />
                                    </div>
                                ))}
                            </div>
                        ) : recentLogs.length === 0 ? (
                            <div style={styles.sidebarEmptyState}>
                                <Bot size={22} style={{ color: "#cbd5e1", marginBottom: "6px" }} />
                                <span>No recent Q&A history.</span>
                            </div>
                        ) : (
                            recentLogs.map((log) => (
                                <div
                                    key={log.id}
                                    onClick={() => handleLoadRecentLog(log)}
                                    style={styles.sidebarItem}
                                    className="sidebar-item-btn"
                                >
                                    <div style={styles.sidebarItemQ}>
                                        {log.question}
                                    </div>
                                    <div style={styles.sidebarItemMeta}>
                                        <span style={{ fontWeight: 600, color: log.barangay_name ? "#1d9e75" : "#64748b" }}>
                                            {log.barangay_name || "General"}
                                        </span>
                                        <span>·</span>
                                        <span>
                                            {new Date(log.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* ── Active Chat Area ── */}
                <div style={styles.chatArea}>

                    {/* ── Header ── */}
                    <div style={styles.header}>
                        <div style={styles.headerIconWrapper}>
                            <MessageCircle size={22} style={{ color: "rgba(255,255,255,0.9)" }} />
                            <div style={styles.onlineDot} />
                        </div>
                        <div style={styles.headerTextContainer}>
                            <h1 style={styles.title}>Typhoon Operations AI Assistant</h1>
                            <p style={styles.subtitle}>
                                Real-time weather query resolution &amp; disaster response guides
                                {lastBarangay && (
                                    <span style={{ marginLeft: "8px", color: "#90caf9", fontWeight: 600, fontSize: "0.78rem" }}>
                                        · Tracking: {lastBarangay}
                                    </span>
                                )}
                            </p>
                        </div>
                        {messages.length > 0 && (
                            <button
                                className="clear-btn"
                                onClick={handleClearChat}
                                title="Clear chat history"
                                style={styles.clearButton}
                            >
                                <Trash2 size={13} />
                                Clear View
                            </button>
                        )}
                    </div>

                    {/* ── Messages Panel ── */}
                    <div className="custom-scrollbar" style={styles.messagesContainer}>
                        {messages.length === 0 ? (
                            <div style={styles.emptyState}>
                                <div style={styles.botIconWrapper}>
                                    <Bot size={44} style={{ color: "#1D9E75" }} />
                                </div>
                                <h2 style={styles.emptyTitle}>Welcome to BagyoAlerto Assistant</h2>
                                <p style={styles.emptySubtitle}>
                                    Your operational assistant for storm preparation and weather analytics. Input a barangay name to fetch immediate safety status or ask a general typhoon preparedness question.
                                </p>
                                <div style={styles.infoCardsGrid}>
                                    <div style={styles.infoCard}>
                                        <Compass size={18} style={{ color: "#3b82f6", marginBottom: "0.5rem" }} />
                                        <h4 style={styles.infoCardTitle}>Barangay Search</h4>
                                        <p style={styles.infoCardText}>Ask "Is Barangay Carmen safe?" to load live coordinates and weather metrics.</p>
                                    </div>
                                    <div style={styles.infoCard}>
                                        <Shield size={18} style={{ color: "#10b981", marginBottom: "0.5rem" }} />
                                        <h4 style={styles.infoCardTitle}>Safety Checklists</h4>
                                        <p style={styles.infoCardText}>Ask "what is in a go bag?" or "how to prepare" for expert emergency advice.</p>
                                    </div>
                                    <div style={styles.infoCard}>
                                        <BookOpen size={18} style={{ color: "#8b5cf6", marginBottom: "0.5rem" }} />
                                        <h4 style={styles.infoCardTitle}>PAGASA Signals</h4>
                                        <p style={styles.infoCardText}>Learn details on wind limits, class suspensions, and hazard responses.</p>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className="msg-bubble-group"
                                    style={{
                                        display: "flex",
                                        flexDirection: msg.type === "user" ? "row-reverse" : "row",
                                        alignItems: "flex-end",
                                        gap: "0.75rem",
                                        width: "100%",
                                    }}
                                >
                                    {/* Avatar */}
                                    <div style={{
                                        width: "36px", height: "36px", borderRadius: "50%",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0, alignSelf: "flex-end",
                                        backgroundColor: msg.type === "user" ? "#e6f6f0" : "#f1f5f9",
                                        border: msg.type === "user" ? "1px solid #ccece0" : "1px solid #e2e8f0",
                                        boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
                                    }}>
                                        {msg.type === "user"
                                            ? <User size={16} style={{ color: "#1D9E75" }} />
                                            : <Bot size={16} style={{ color: "#1D9E75" }} />}
                                    </div>

                                    {/* Bubble + meta column */}
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "0.25rem",
                                        maxWidth: "75%",
                                        alignItems: msg.type === "user" ? "flex-end" : "flex-start",
                                    }}>
                                        {/* The bubble itself */}
                                        <div style={{
                                            ...styles.messageBubble,
                                            ...(msg.type === "user" ? styles.userBubble : styles.botBubble),
                                            ...(msg.barangay ? { border: getSeverityBubbleBorder(msg.severity) } : {}),
                                            ...(msg.error ? { borderColor: "#fca5a5", background: "#fff5f5" } : {}),
                                        }}>
                                            {/* AI powered badge */}
                                            {msg.aiPowered && (
                                                <span style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "3px",
                                                    fontSize: "0.7rem",
                                                    fontWeight: 700,
                                                    padding: "0.15rem 0.5rem",
                                                    borderRadius: "4px",
                                                    background: "#e0f2fe",
                                                    color: "#0369a1",
                                                    marginBottom: "0.5rem",
                                                    textTransform: "uppercase",
                                                    letterSpacing: "0.3px",
                                                }}>
                                                    <Sparkles size={9} /> AI Powered
                                                </span>
                                            )}
                                            {!msg.aiPowered && msg.barangay && (
                                                <span style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "3px",
                                                    fontSize: "0.7rem",
                                                    fontWeight: 700,
                                                    padding: "0.15rem 0.5rem",
                                                    borderRadius: "4px",
                                                    background: "#fef3c7",
                                                    color: "#92400e",
                                                    marginBottom: "0.5rem",
                                                    textTransform: "uppercase",
                                                    letterSpacing: "0.3px",
                                                }}>
                                                    Template response · Ollama offline
                                                </span>
                                            )}

                                            {/* Plain message rendering or custom parsing */}
                                            {msg.type === "user" ? (
                                                <p style={styles.messageText}>{msg.text}</p>
                                            ) : (
                                                <div style={{ wordBreak: "break-word" }}>
                                                    {parseMessageText(msg.text)}
                                                </div>
                                            )}

                                            {/* Mini Weather Card (if weatherData present) */}
                                            {msg.weatherData && (
                                                <WeatherMiniCard data={msg.weatherData} />
                                            )}

                                            {/* Severity Metadata Badge */}
                                            {msg.barangay && (
                                                <div style={styles.badgeContainer}>
                                                    <span style={{
                                                        ...styles.metadataBadge,
                                                        ...getSeverityBadgeStyle(msg.severity),
                                                    }}>
                                                        {msg.severity || "Weather Clear"}
                                                    </span>
                                                    <span style={{
                                                        ...styles.metadataBadge,
                                                        bg: "#f8fafc",
                                                        color: "#475569",
                                                        border: "1px solid #cbd5e1",
                                                    }}>
                                                        {msg.barangay}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Evacuation Routing Map Card */}
                                            {msg.barangayCoords && msg.evacuationCoords && (
                                                <div style={{ 
                                                    marginTop: "1rem", 
                                                    borderRadius: "12px", 
                                                    overflow: "hidden", 
                                                    border: "1px solid #cbd5e1",
                                                    width: "100%",
                                                    maxWidth: "500px",
                                                }}>
                                                    <MapView 
                                                        barangay={msg.barangayCoords}
                                                        evacuationCenter={msg.evacuationCoords}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* Timestamp + Actions line */}
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            fontSize: "0.72rem",
                                            color: "#94a3b8",
                                            padding: "0 4px",
                                        }}>
                                            <span>{formatTimestamp(msg.timestamp)}</span>
                                            {msg.refreshed && <span style={{ color: "#1D9E75", fontWeight: 500 }}>· Refreshed</span>}
                                            {msg.type === "bot" && (
                                                <>
                                                    <span>·</span>
                                                    <button
                                                        onClick={() => handleCopy(msg)}
                                                        className="msg-action-btn copy-action"
                                                        style={styles.actionBtn}
                                                        title="Copy text"
                                                    >
                                                        {copiedId === msg.id ? <Check size={12} style={{ color: "#10b981" }} /> : <Copy size={12} />}
                                                    </button>
                                                    {msg.barangay && (
                                                        <>
                                                            <span>·</span>
                                                            <button
                                                                onClick={() => handleRefresh(msg)}
                                                                disabled={refreshingId === msg.id}
                                                                className="msg-action-btn refresh-action"
                                                                style={{
                                                                    ...styles.actionBtn,
                                                                    cursor: refreshingId === msg.id ? "not-allowed" : "pointer"
                                                                }}
                                                                title="Refresh weather data"
                                                            >
                                                                <RefreshCw
                                                                    size={12}
                                                                    style={{
                                                                        animation: refreshingId === msg.id ? "spin 1s linear infinite" : "none",
                                                                        color: refreshingId === msg.id ? "#1D9E75" : "inherit"
                                                                    }}
                                                                />
                                                            </button>
                                                        </>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}

                        {loading && (
                            <div style={{ display: "flex", gap: "0.75rem", width: "100%" }}>
                                <div style={{
                                    width: "36px", height: "36px", borderRadius: "50%",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    backgroundColor: "#f1f5f9", border: "1px solid #e2e8f0",
                                }}>
                                    <Bot size={16} style={{ color: "#1D9E75" }} />
                                </div>
                                <div style={{
                                    display: "flex", flexDirection: "column", gap: "0.25rem",
                                }}>
                                    <div style={{
                                        ...styles.messageBubble,
                                        ...styles.botBubble,
                                        padding: "0.6rem 0.9rem",
                                    }}>
                                        <TypingIndicator />
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* ── Suggested Questions Panel ── */}
                    {messages.length === 0 && (
                        <div style={styles.suggestedContainer}>
                            <h4 style={styles.suggestedLabel}>Common operational requests</h4>
                            <div style={styles.suggestedGrid}>
                                {suggestedQuestions.map((q, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handleSendQuestion(q)}
                                        className="suggested-btn"
                                        style={styles.suggestedButton}
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Input Panel ── */}
                    <div style={styles.inputContainer}>
                        <div style={{ display: "flex", flex: 1, position: "relative" }}>
                            <input
                                id="chat-question-input"
                                type="text"
                                maxLength={500}
                                placeholder="Type a message or ask about a barangay..."
                                value={question}
                                onChange={handleInputChange}
                                onKeyDown={(e) => e.key === "Enter" && handleSendQuestion()}
                                disabled={loading}
                                className="chat-input"
                                style={styles.input}
                            />
                            {question.length > 350 && (
                                <span style={{
                                    position: "absolute",
                                    right: "1.2rem",
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    fontSize: "0.72rem",
                                    color: question.length >= 480 ? "#ef4444" : "#94a3b8",
                                    fontWeight: 500,
                                }}>
                                    {question.length}/500
                                </span>
                            )}
                            {suggestions.length > 0 && (
                                <div style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    bottom: "calc(100% + 8px)",
                                    background: "white",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: "8px",
                                    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
                                    overflow: "hidden",
                                    zIndex: 20,
                                }}>
                                    {suggestions.map(b => (
                                        <button
                                            key={b.id}
                                            onClick={() => {
                                                setQuestion(`Is ${b.name} safe?`)
                                                setSuggestions([])
                                            }}
                                            style={{
                                                width: "100%",
                                                padding: "9px 16px",
                                                background: "none",
                                                border: "none",
                                                textAlign: "left",
                                                cursor: "pointer",
                                                fontSize: "0.88rem",
                                                color: "#334155",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                borderBottom: "1px solid #f1f5f9",
                                            }}
                                        >
                                            <MapPin size={13} style={{ color: "#1D9E75" }} />
                                            {b.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            id="chat-send-btn"
                            onClick={() => handleSendQuestion()}
                            disabled={!question.trim() || loading}
                            className="send-btn"
                            style={{
                                ...styles.sendButton,
                                ...((!question.trim() || loading) ? styles.sendButtonDisabled : {}),
                            }}
                        >
                            <Send size={16} />
                        </button>
                    </div>

                </div>

            </div>
        </AdminLayout>
    )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
    mainLayout: {
        display: "flex",
        flexDirection: "row",
        height: "calc(100vh - 120px)",
        gap: "16px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    sidebar: {
        width: "280px",
        background: "white",
        borderRadius: "16px",
        border: "1px solid #e2e8f0",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)",
    },
    sidebarHeader: {
        padding: "1rem 1.25rem",
        borderBottom: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "center",
        background: "#fafbff",
    },
    sidebarTitle: {
        fontSize: "0.85rem",
        fontWeight: "700",
        color: "#1e293b",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
    },
    sidebarContent: {
        flex: 1,
        overflowY: "auto",
        padding: "8px 0",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
    },
    sidebarItem: {
        padding: "10px 16px",
        cursor: "pointer",
        borderLeft: "3px solid transparent",
        backgroundColor: "transparent",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    sidebarItemQ: {
        fontSize: "0.825rem",
        color: "#334155",
        fontWeight: "500",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    sidebarItemMeta: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "0.7rem",
        color: "#94a3b8",
    },
    sidebarLoadingState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
    },
    sidebarSkeletonList: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px 16px",
    },
    sidebarSkeletonItem: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "8px 0",
    },
    sidebarSkeletonTitle: {
        width: "100%",
        height: "12px",
        borderRadius: "6px",
    },
    sidebarSkeletonMeta: {
        width: "58%",
        height: "10px",
        borderRadius: "6px",
    },
    sidebarEmptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        fontSize: "0.75rem",
        color: "#94a3b8",
        textAlign: "center",
    },
    chatArea: {
        flex: 1,
        background: "#f8fafc",
        borderRadius: "16px",
        border: "1px solid #e2e8f0",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        padding: "1.1rem 2rem",
        background: "linear-gradient(135deg, #1a237e, #1565c0)",
        borderBottom: "0.5px solid #1a237e",
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        gap: "1rem",
    },
    headerIconWrapper: {
        width: "42px", height: "42px", borderRadius: "12px",
        backgroundColor: "rgba(255,255,255,0.12)",
        border: "0.5px solid rgba(255,255,255,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", flexShrink: 0,
    },
    onlineDot: {
        width: "10px", height: "10px", backgroundColor: "#60efb0",
        borderRadius: "50%", position: "absolute", bottom: "-2px", right: "-2px",
        border: "2px solid #1a237e",
        animation: "pulse 2s infinite",
    },
    headerTextContainer: { display: "flex", flexDirection: "column" },
    title: { fontSize: "1.05rem", fontWeight: "700", color: "white", margin: 0 },
    subtitle: { fontSize: "0.82rem", color: "rgba(255,255,255,0.65)", margin: "2px 0 0 0", display: "flex", alignItems: "center", flexWrap: "wrap" },
    clearButton: {
        marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.4rem",
        padding: "0.4rem 0.8rem", background: "rgba(255,255,255,0.12)", border: "0.5px solid rgba(255,255,255,0.2)",
        borderRadius: "8px", cursor: "pointer", fontSize: "0.8rem", color: "rgba(255,255,255,0.85)",
        fontWeight: 500, transition: "all 0.2s ease", flexShrink: 0,
    },
    messagesContainer: {
        flex: 1, overflowY: "auto",
        display: "flex", flexDirection: "column", gap: "1.25rem",
        padding: "2rem", background: "#f8fafc",
    },
    messageBubble: {
        padding: "0.85rem 1.15rem",
        wordWrap: "break-word", whiteSpace: "pre-wrap", lineHeight: "1.55",
    },
    userBubble: {
        background: "#1D9E75", color: "white",
        borderRadius: "16px 16px 4px 16px",
        boxShadow: "0 2px 8px rgba(29, 158, 117, 0.15)",
    },
    botBubble: {
        background: "white", color: "#0f172a",
        border: "1px solid #e2e8f0",
        borderRadius: "16px 16px 16px 4px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
    },
    messageText: { margin: 0, fontSize: "0.95rem" },
    badgeContainer: { display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" },
    metadataBadge: {
        display: "inline-flex", alignItems: "center",
        fontSize: "0.75rem", fontWeight: "600",
        padding: "0.2rem 0.6rem", borderRadius: "9999px", border: "1px solid",
    },
    actionBtn: {
        background: "none", border: "none", cursor: "pointer",
        padding: "2px 3px", color: "#94a3b8",
        display: "flex", alignItems: "center", transition: "color 0.15s",
        borderRadius: "4px",
    },
    emptyState: {
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", flex: 1, padding: "2rem",
        textAlign: "center", maxWidth: "600px", margin: "0 auto",
    },
    botIconWrapper: {
        width: "72px", height: "72px", borderRadius: "20px",
        backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: "1.5rem", boxShadow: "0 4px 12px rgba(29, 158, 117, 0.06)",
    },
    emptyTitle: { fontSize: "1.35rem", fontWeight: "700", color: "#0f172a", margin: "0 0 0.5rem 0" },
    emptySubtitle: { fontSize: "0.9rem", color: "#64748b", margin: "0 0 2rem 0", lineHeight: "1.5" },
    infoCardsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", width: "100%", textAlign: "left" },
    infoCard: { background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "1rem", boxShadow: "0 2px 4px rgba(0,0,0,0.01)" },
    infoCardTitle: { fontSize: "0.85rem", fontWeight: "600", color: "#0f172a", margin: "0 0 0.25rem 0" },
    infoCardText: { fontSize: "0.75rem", color: "#64748b", margin: 0, lineHeight: "1.45" },
    suggestedContainer: { background: "white", padding: "1rem 2rem", borderTop: "1px solid #e2e8f0" },
    suggestedLabel: { fontSize: "0.8rem", fontWeight: "600", color: "#475569", margin: "0 0 0.65rem 0" },
    suggestedGrid: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
    suggestedButton: {
        padding: "0.45rem 1rem", background: "white", border: "1px solid #cbd5e1",
        borderRadius: "9999px", cursor: "pointer", fontSize: "0.825rem",
        color: "#1D9E75", fontWeight: "500", transition: "all 0.2s ease",
        boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
    },
    inputContainer: {
        display: "flex", gap: "0.75rem", background: "white",
        padding: "1rem 2rem", borderTop: "1px solid #e2e8f0", alignItems: "center",
    },
    input: {
        width: "100%", padding: "0.7rem 1.2rem",
        border: "1px solid #cbd5e1", borderRadius: "9999px",
        fontSize: "0.95rem", outline: "none",
        transition: "all 0.2s ease", backgroundColor: "#f8fafc",
        boxSizing: "border-box",
    },
    sendButton: {
        width: "38px", height: "38px", borderRadius: "50%",
        background: "#1D9E75", color: "white", border: "none",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.2s ease", flexShrink: 0,
        boxShadow: "0 4px 6px -1px rgba(29, 158, 117, 0.15)",
    },
    sendButtonDisabled: { background: "#e2e8f0", color: "#94a3b8", cursor: "not-allowed", boxShadow: "none" },
    lineHeader: {
        display: "flex", alignItems: "center", gap: "0.45rem",
        margin: "0.6rem 0 0.4rem 0", fontWeight: "600", color: "#0f172a", fontSize: "0.975rem",
    },
    lineHeaderText: { borderBottom: "2px solid #f0fdf4", paddingBottom: "1px" },
    lineList: { display: "flex", alignItems: "flex-start", gap: "0.45rem", margin: "0.2rem 0" },
    lineIcon: { display: "inline-flex", alignItems: "center", marginTop: "3px", flexShrink: 0 },
    lineListText: { fontSize: "0.925rem", color: "#334155" },
    linePlain: { margin: "0.4rem 0", fontSize: "0.925rem", color: "#334155" },
}
