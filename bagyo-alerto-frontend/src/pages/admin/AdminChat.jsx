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
    Loader,
} from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"
import MapView from "../../components/MapView"

const API_BASE = "http://127.0.0.1:8000/api"
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
    }

    // ── Helpers
    const formatTimestamp = (ts) => {
        if (!ts) return ""
        return new Date(ts).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
    }

    const getSeverityBadgeStyle = (severity) => {
        if (!severity) return { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0" }
        const sev = severity.toLowerCase()
        if (sev.includes("normal"))   return { bg: "#dcfce7", color: "#166534", border: "#bbf7d0" }
        if (sev.includes("watch"))    return { bg: "#e0f2fe", color: "#075985", border: "#bae6fd" }
        if (sev.includes("elevated")) return { bg: "#ffedd5", color: "#9a3412", border: "#fed7aa" }
        if (sev.includes("signal 1")) return { bg: "#fef9c3", color: "#854d0e", border: "#fef08a" }
        if (sev.includes("signal 2")) return { bg: "#ffe4e6", color: "#9f1239", border: "#fecdd3" }
        if (sev.includes("signal 3")) return { bg: "#fee2e2", color: "#991b1b", border: "#fecaca" }
        return { bg: "#ffe4e6", color: "#9f1239", border: "#fecdd3" }
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
                * { box-sizing: border-box; }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.15); opacity: .7; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes slideIn {
                    from { opacity: 0; transform: translateY(12px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes typingBounce {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
                    30% { transform: translateY(-8px); opacity: 1; }
                }
                @keyframes glow {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(29, 158, 117, 0); }
                    50% { box-shadow: 0 0 0 8px rgba(29, 158, 117, 0.1); }
                }
                @keyframes shimmer {
                    0% { background-position: -1000px 0; }
                    100% { background-position: 1000px 0; }
                }
                
                .suggested-btn {
                    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%) !important;
                    border: 1.5px solid #d1d5db !important;
                }
                .suggested-btn:hover {
                    background: linear-gradient(135deg, #1D9E75 0%, #0d8659 100%) !important;
                    border-color: #1D9E75 !important;
                    color: white !important;
                    transform: translateY(-3px);
                    box-shadow: 0 12px 24px rgba(29, 158, 117, 0.3) !important;
                }
                .suggested-btn:active {
                    transform: translateY(-1px);
                }
                
                .send-btn:hover:not(:disabled) {
                    background: linear-gradient(135deg, #0d8659 0%, #1D9E75 100%) !important;
                    transform: scale(1.1);
                    box-shadow: 0 12px 24px rgba(29, 158, 117, 0.35) !important;
                }
                .send-btn:active:not(:disabled) {
                    transform: scale(0.95);
                }
                
                .chat-input {
                    font-weight: 500 !important;
                }
                .chat-input:focus {
                    border-color: #1D9E75 !important;
                    background-color: #f0fdf4 !important;
                    box-shadow: 0 0 0 4px rgba(29, 158, 117, 0.15) !important;
                }
                
                .msg-action-btn {
                    opacity: 0;
                    transition: all 0.2s ease;
                }
                .msg-bubble-group:hover .msg-action-btn {
                    opacity: 1;
                }
                
                .clear-btn {
                    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%) !important;
                }
                .clear-btn:hover {
                    background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%) !important;
                    color: #991b1b !important;
                    border-color: #fca5a5 !important;
                    transform: translateY(-2px);
                    box-shadow: 0 8px 16px rgba(239, 68, 68, 0.15) !important;
                }
                
                .refresh-action:hover { color: #1D9E75 !important; transform: rotate(180deg); transition: all 0.3s ease; }
                .copy-action:hover { color: #3b82f6 !important; }
                
                .custom-scrollbar::-webkit-scrollbar { width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #1D9E75 0%, #0d8659 100%); border-radius: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #0d8659 0%, #1D9E75 100%); }
                
                .sidebar-item-btn {
                    transition: all 0.3s ease;
                    border-radius: 8px;
                    margin: 0 8px;
                }
                .sidebar-item-btn:hover {
                    background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%) !important;
                    border-left-color: #1D9E75 !important;
                    padding-left: 22px;
                    transform: translateX(4px);
                    box-shadow: 0 4px 12px rgba(29, 158, 117, 0.1) !important;
                }
                
                .message-animation {
                    animation: slideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                }
                
                .info-card-hover:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 12px 24px rgba(29, 158, 117, 0.15) !important;
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
                            <div style={styles.sidebarLoadingState}>
                                <Loader size={18} style={{ animation: "spin 1s linear infinite", color: "#1D9E75" }} />
                                <span style={{ marginTop: "8px", fontSize: "0.8rem", color: "#64748b" }}>Loading history...</span>
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
                            <MessageCircle size={22} style={{ color: "#1D9E75" }} />
                            <div style={styles.onlineDot} />
                        </div>
                        <div style={styles.headerTextContainer}>
                            <h1 style={styles.title}>Typhoon Operations AI Assistant</h1>
                            <p style={styles.subtitle}>
                                Real-time weather query resolution &amp; disaster response guides
                                {lastBarangay && (
                                    <span style={{ marginLeft: "8px", color: "#1D9E75", fontWeight: 600, fontSize: "0.78rem" }}>
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
                                onChange={(e) => setQuestion(e.target.value)}
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
        gap: "20px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "16px",
        background: "linear-gradient(135deg, #0f172a 0%, #1a2342 100%)",
    },
    sidebar: {
        width: "320px",
        background: "linear-gradient(180deg, #1a2342 0%, #1e2d4a 100%)",
        borderRadius: "20px",
        border: "1px solid #2d3f5f",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4), 0 0 1px rgba(29, 158, 117, 0.1)",
    },
    sidebarHeader: {
        padding: "1.5rem 1.75rem",
        borderBottom: "1.5px solid #2d3f5f",
        display: "flex",
        alignItems: "center",
        background: "linear-gradient(135deg, #162238 0%, #1a2d45 100%)",
    },
    sidebarTitle: {
        fontSize: "0.75rem",
        fontWeight: "800",
        color: "#4ade80",
        textTransform: "uppercase",
        letterSpacing: "0.8px",
    },
    sidebarContent: {
        flex: 1,
        overflowY: "auto",
        padding: "12px 8px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    sidebarItem: {
        padding: "12px 14px",
        cursor: "pointer",
        borderLeft: "3px solid transparent",
        backgroundColor: "transparent",
        display: "flex",
        flexDirection: "column",
        gap: "5px",
    },
    sidebarItemQ: {
        fontSize: "0.8rem",
        color: "#e5e7eb",
        fontWeight: "600",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        lineHeight: "1.4",
    },
    sidebarItemMeta: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "0.7rem",
        color: "#9ca3af",
        fontWeight: "600",
    },
    sidebarLoadingState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 16px",
    },
    sidebarEmptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 16px",
        fontSize: "0.75rem",
        color: "#9ca3af",
        textAlign: "center",
    },
    chatArea: {
        flex: 1,
        background: "linear-gradient(180deg, #1a2342 0%, #162238 100%)",
        borderRadius: "20px",
        border: "1px solid #2d3f5f",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4), 0 0 1px rgba(29, 158, 117, 0.1)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        padding: "1.5rem 2.25rem",
        background: "linear-gradient(135deg, #1a2342 0%, #1e2d4a 100%)",
        borderBottom: "1.5px solid #2d3f5f",
        gap: "1.4rem",
    },
    headerIconWrapper: {
        width: "52px", height: "52px", borderRadius: "14px",
        background: "linear-gradient(135deg, #1e4620 0%, #0d8659 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative", flexShrink: 0,
        border: "2px solid #4ade80",
        boxShadow: "0 8px 16px rgba(29, 158, 117, 0.25)",
    },
    onlineDot: {
        width: "12px", height: "12px", backgroundColor: "#4ade80",
        borderRadius: "50%", position: "absolute", bottom: "-4px", right: "-4px",
        border: "3px solid #1a2342", boxShadow: "0 0 8px rgba(74, 222, 128, 0.6)",
        animation: "pulse 2.5s ease-in-out infinite",
    },
    headerTextContainer: { display: "flex", flexDirection: "column" },
    title: { fontSize: "1.2rem", fontWeight: "800", color: "#f1f5f9", margin: 0, letterSpacing: "-0.4px" },
    subtitle: { fontSize: "0.8rem", color: "#cbd5e1", margin: "4px 0 0 0", display: "flex", alignItems: "center", flexWrap: "wrap", fontWeight: "600" },
    clearButton: {
        marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.6rem",
        padding: "0.6rem 1.2rem", background: "linear-gradient(135deg, #2d3f5f 0%, #334455 100%)", 
        border: "1.5px solid #475569",
        borderRadius: "12px", cursor: "pointer", fontSize: "0.8rem", color: "#cbd5e1",
        fontWeight: "700", transition: "all 0.3s ease", flexShrink: 0,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    },
    messagesContainer: {
        flex: 1, overflowY: "auto",
        display: "flex", flexDirection: "column", gap: "1.5rem",
        padding: "2.5rem 3rem", background: "linear-gradient(180deg, #1a2342 0%, #162238 100%)",
    },
    messageBubble: {
        padding: "1rem 1.4rem",
        wordWrap: "break-word", whiteSpace: "pre-wrap", lineHeight: "1.65",
    },
    userBubble: {
        background: "linear-gradient(135deg, #1D9E75 0%, #0d8659 100%)", color: "white",
        borderRadius: "20px 20px 8px 20px",
        boxShadow: "0 8px 20px rgba(29, 158, 117, 0.4)",
    },
    botBubble: {
        background: "linear-gradient(135deg, #2d3f5f 0%, #334455 100%)", color: "#e5e7eb",
        border: "1.5px solid #475569",
        borderRadius: "20px 20px 20px 8px",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
    },
    messageText: { margin: 0, fontSize: "0.95rem", fontWeight: "500", letterSpacing: "-0.2px" },
    badgeContainer: { display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" },
    metadataBadge: {
        display: "inline-flex", alignItems: "center",
        fontSize: "0.7rem", fontWeight: "800",
        padding: "0.35rem 0.9rem", borderRadius: "24px", border: "1.5px solid",
        textTransform: "capitalize",
        letterSpacing: "0.3px",
    },
    actionBtn: {
        background: "none", border: "none", cursor: "pointer",
        padding: "4px 6px", color: "#9ca3af",
        display: "flex", alignItems: "center", transition: "all 0.3s ease",
        borderRadius: "8px",
    },
    emptyState: {
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", flex: 1, padding: "3.5rem 2.5rem",
        textAlign: "center", maxWidth: "700px", margin: "0 auto",
    },
    botIconWrapper: {
        width: "92px", height: "92px", borderRadius: "28px",
        background: "linear-gradient(135deg, #1e4620 0%, #0d8659 100%)", 
        border: "2.5px solid #4ade80",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: "2rem", boxShadow: "0 16px 32px rgba(29, 158, 117, 0.3)",
    },
    emptyTitle: { fontSize: "1.5rem", fontWeight: "800", color: "#f1f5f9", margin: "0 0 0.75rem 0", letterSpacing: "-0.6px" },
    emptySubtitle: { fontSize: "0.95rem", color: "#cbd5e1", margin: "0 0 2.75rem 0", lineHeight: "1.7", fontWeight: "600" },
    infoCardsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem", width: "100%", textAlign: "left" },
    infoCard: { 
        background: "linear-gradient(135deg, #2d3f5f 0%, #334455 100%)", 
        border: "1.5px solid #475569", 
        borderRadius: "16px", 
        padding: "1.5rem", 
        boxShadow: "0 6px 16px rgba(0,0,0,0.3)", 
        transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        cursor: "default",
    },
    infoCardTitle: { fontSize: "0.9rem", fontWeight: "800", color: "#f1f5f9", margin: "0 0 0.5rem 0", letterSpacing: "-0.2px" },
    infoCardText: { fontSize: "0.8rem", color: "#cbd5e1", margin: 0, lineHeight: "1.6", fontWeight: "600" },
    suggestedContainer: { background: "linear-gradient(180deg, #1a2342 0%, #1e2d4a 100%)", padding: "1.5rem 2.25rem", borderTop: "1.5px solid #2d3f5f" },
    suggestedLabel: { fontSize: "0.75rem", fontWeight: "800", color: "#f1f5f9", margin: "0 0 1rem 0", textTransform: "uppercase", letterSpacing: "0.6px" },
    suggestedGrid: { display: "flex", gap: "0.8rem", flexWrap: "wrap" },
    suggestedButton: {
        padding: "0.6rem 1.4rem", background: "linear-gradient(135deg, #2d3f5f 0%, #334455 100%)", 
        border: "1.5px solid #475569",
        borderRadius: "24px", cursor: "pointer", fontSize: "0.8rem",
        color: "#cbd5e1", fontWeight: "700", transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        letterSpacing: "-0.2px",
    },
    inputContainer: {
        display: "flex", gap: "1rem", background: "linear-gradient(180deg, #1a2342 0%, #1e2d4a 100%)",
        padding: "1.5rem 2.25rem", borderTop: "1.5px solid #2d3f5f", alignItems: "center",
    },
    input: {
        width: "100%", padding: "0.9rem 1.5rem",
        border: "1.5px solid #475569", borderRadius: "28px",
        fontSize: "0.95rem", outline: "none",
        transition: "all 0.3s ease", backgroundColor: "#2d3f5f",
        boxSizing: "border-box", fontWeight: "600", color: "#f1f5f9",
    },
    sendButton: {
        width: "44px", height: "44px", borderRadius: "50%",
        background: "linear-gradient(135deg, #1D9E75 0%, #0d8659 100%)", color: "white", border: "none",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)", flexShrink: 0,
        boxShadow: "0 8px 20px rgba(29, 158, 117, 0.4)",
    },
    sendButtonDisabled: { background: "#475569", color: "#9ca3af", cursor: "not-allowed", boxShadow: "none" },
    lineHeader: {
        display: "flex", alignItems: "center", gap: "0.6rem",
        margin: "0.8rem 0 0.6rem 0", fontWeight: "800", color: "#f1f5f9", fontSize: "0.95rem",
        letterSpacing: "-0.2px",
    },
    lineHeaderText: { borderBottom: "2.5px solid #4ade80", paddingBottom: "3px" },
    lineList: { display: "flex", alignItems: "flex-start", gap: "0.6rem", margin: "0.4rem 0" },
    lineIcon: { display: "inline-flex", alignItems: "center", marginTop: "3px", flexShrink: 0 },
    lineListText: { fontSize: "0.9rem", color: "#cbd5e1", fontWeight: "600", letterSpacing: "-0.2px" },
    linePlain: { margin: "0.4rem 0", fontSize: "0.9rem", color: "#cbd5e1", fontWeight: "600", letterSpacing: "-0.2px" },
}
