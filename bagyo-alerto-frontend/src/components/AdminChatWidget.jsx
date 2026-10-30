import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import axios from "axios"
import {
    Bot,
    Check,
    Copy,
    History,
    MapPin,
    MessageCircle,
    RefreshCw,
    Send,
    Trash2,
    User,
    X,
} from "lucide-react"
import { useAdminAuth } from "../context/AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE
const CHAT_STORAGE_KEY = "bagyoalerto_chat"
const BARANGAY_STORAGE_KEY = "bagyoalerto_last_barangay"
const CONVERSATION_STORAGE_KEY = "bagyoalerto_admin_conversation_id"

const AdminChatContext = createContext(null)

function readStoredMessages() {
    try {
        const saved = sessionStorage.getItem(CHAT_STORAGE_KEY)
        return saved ? JSON.parse(saved) : []
    } catch {
        return []
    }
}

function readStoredBarangay() {
    try {
        return sessionStorage.getItem(BARANGAY_STORAGE_KEY) || null
    } catch {
        return null
    }
}

function readStoredConversationId() {
    try {
        const saved = sessionStorage.getItem(CONVERSATION_STORAGE_KEY)
        return saved ? Number(saved) : null
    } catch {
        return null
    }
}

export function AdminChatProvider({ children }) {
    const [messages, setMessages] = useState(readStoredMessages)
    const [lastBarangay, setLastBarangay] = useState(readStoredBarangay)
    const [conversationId, setConversationId] = useState(readStoredConversationId)
    const [isOpen, setIsOpen] = useState(false)

    useEffect(() => {
        try {
            if (messages.length > 0) {
                sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
            } else {
                sessionStorage.removeItem(CHAT_STORAGE_KEY)
            }
        } catch {
            // Keep in-memory chat available when browser storage is unavailable.
        }
    }, [messages])

    useEffect(() => {
        try {
            if (lastBarangay) {
                sessionStorage.setItem(BARANGAY_STORAGE_KEY, lastBarangay)
            } else {
                sessionStorage.removeItem(BARANGAY_STORAGE_KEY)
            }
        } catch {
            // Keep in-memory context available when browser storage is unavailable.
        }
    }, [lastBarangay])

    useEffect(() => {
        try {
            if (conversationId) {
                sessionStorage.setItem(CONVERSATION_STORAGE_KEY, String(conversationId))
            } else {
                sessionStorage.removeItem(CONVERSATION_STORAGE_KEY)
            }
        } catch {
            // Keep the active thread id in layout-level state when storage is unavailable.
        }
    }, [conversationId])

    const value = useMemo(() => ({
        messages,
        setMessages,
        lastBarangay,
        setLastBarangay,
        conversationId,
        setConversationId,
        isOpen,
        setIsOpen,
    }), [messages, lastBarangay, conversationId, isOpen])

    return <AdminChatContext.Provider value={value}>{children}</AdminChatContext.Provider>
}

function useAdminChat() {
    const context = useContext(AdminChatContext)
    if (!context) throw new Error("AdminChatWidget must be used inside AdminChatProvider")
    return context
}

function genId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function TypingIndicator() {
    return (
        <div style={styles.typingIndicator} aria-label="Assistant is typing">
            {[0, 150, 300].map(delay => (
                <span key={delay} style={{ ...styles.typingDot, animationDelay: `${delay}ms` }} />
            ))}
        </div>
    )
}

function WeatherMiniCard({ data }) {
    if (!data) return null

    return (
        <div style={styles.weatherCard}>
            <span>{Number(data.wind_speed ?? 0).toFixed(1)} km/h wind</span>
            <span>{Number(data.rainfall ?? 0).toFixed(1)} mm/hr rain</span>
            <span>{Number(data.temperature ?? 0).toFixed(1)}°C</span>
            <span>{Number(data.humidity ?? 0).toFixed(0)}% humidity</span>
        </div>
    )
}

function severityStyle(severity) {
    const value = String(severity || "").toLowerCase()
    if (value.includes("normal")) return { background: "#dcfce7", color: "#166534", borderColor: "#bbf7d0" }
    if (value.includes("watch")) return { background: "#e0f2fe", color: "#075985", borderColor: "#bae6fd" }
    if (value.includes("elevated") || value.includes("signal 1")) return { background: "#fef3c7", color: "#92400e", borderColor: "#fde68a" }
    if (value.includes("signal")) return { background: "#fee2e2", color: "#991b1b", borderColor: "#fecaca" }
    return { background: "#f1f5f9", color: "#475569", borderColor: "#e2e8f0" }
}

export default function AdminChatWidget() {
    const { authHeaders } = useAdminAuth()
    const {
        messages,
        setMessages,
        lastBarangay,
        setLastBarangay,
        conversationId,
        setConversationId,
        isOpen,
        setIsOpen,
    } = useAdminChat()

    const [question, setQuestion] = useState("")
    const [loading, setLoading] = useState(false)
    const [barangays, setBarangays] = useState([])
    const [recentLogs, setRecentLogs] = useState([])
    const [historyLoading, setHistoryLoading] = useState(true)
    const [showHistory, setShowHistory] = useState(false)
    const [suggestions, setSuggestions] = useState([])
    const [copiedId, setCopiedId] = useState(null)
    const [refreshingId, setRefreshingId] = useState(null)
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
    const messagesEndRef = useRef(null)
    const inputRef = useRef(null)

    const fetchRecentLogs = useCallback(async () => {
        setHistoryLoading(true)
        try {
            const response = await axios.get(`${API_BASE}/chat/history`, {
                params: { context: "admin" },
                headers: authHeaders(),
            })
            setRecentLogs((response.data.data || []).slice(0, 12))
        } catch (error) {
            console.error("Failed to load recent questions:", error)
        } finally {
            setHistoryLoading(false)
        }
    }, [authHeaders])

    useEffect(() => {
        let active = true
        axios.get(`${API_BASE}/chat/history`, {
            params: { context: "admin" },
            headers: authHeaders(),
        })
            .then(response => {
                if (active) setRecentLogs((response.data.data || []).slice(0, 12))
            })
            .catch(error => console.error("Failed to load recent questions:", error))
            .finally(() => {
                if (active) setHistoryLoading(false)
            })
        axios.get(`${API_BASE}/barangays`)
            .then(response => {
                if (active) setBarangays(response.data)
            })
            .catch(error => console.error("Failed to load barangays:", error))

        return () => {
            active = false
        }
    }, [authHeaders])

    useEffect(() => {
        if (isOpen && !showHistory) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
        }
    }, [messages, loading, isOpen, showHistory])

    useEffect(() => {
        if (!isOpen) return undefined

        const focusFrame = requestAnimationFrame(() => inputRef.current?.focus())
        const handleKeyDown = event => {
            if (event.key === "Escape") {
                setClearConfirmOpen(false)
                setIsOpen(false)
            }
        }

        document.addEventListener("keydown", handleKeyDown)
        return () => {
            cancelAnimationFrame(focusFrame)
            document.removeEventListener("keydown", handleKeyDown)
        }
    }, [isOpen, setIsOpen])

    const handleInputChange = event => {
        const value = event.target.value
        setQuestion(value)
        if (value.length >= 2) {
            setSuggestions(
                barangays
                    .filter(barangay => barangay.name.toLowerCase().includes(value.toLowerCase()))
                    .slice(0, 5)
            )
        } else {
            setSuggestions([])
        }
    }

    const handleSendQuestion = async (quickQuestion = null) => {
        const activeQuestion = quickQuestion || question
        if (!activeQuestion.trim() || loading) return

        setMessages(previous => [...previous, {
            id: genId(),
            type: "user",
            text: activeQuestion,
            timestamp: new Date().toISOString(),
        }])
        setQuestion("")
        setSuggestions([])
        setShowHistory(false)
        setLoading(true)

        try {
            const response = await axios.post(`${API_BASE}/chat`, {
                question: activeQuestion,
                last_barangay: lastBarangay,
                conversation_id: conversationId,
                context: "admin",
            }, { headers: authHeaders() })

            const data = response.data
            if (data.conversation_id) setConversationId(data.conversation_id)
            if (data.last_barangay || data.barangay_name) {
                setLastBarangay(data.last_barangay || data.barangay_name)
            }

            setMessages(previous => [...previous, {
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
            fetchRecentLogs()
        } catch (error) {
            console.error("Chat API error:", error)
            const isValidationError = error.response?.status === 422
            setMessages(previous => [...previous, {
                id: genId(),
                type: "bot",
                text: isValidationError
                    ? "Your question is too long. Please keep it under 500 characters."
                    : "Sorry, I couldn't process your question. Please try again.",
                error: true,
                timestamp: new Date().toISOString(),
            }])
        } finally {
            setLoading(false)
        }
    }

    const handleRefresh = async message => {
        setRefreshingId(message.id)
        try {
            const response = await axios.post(`${API_BASE}/chat`, {
                question: message.originalQuestion,
                force_refresh: true,
                last_barangay: lastBarangay,
                conversation_id: conversationId,
                context: "admin",
            }, { headers: authHeaders() })
            const data = response.data
            if (data.conversation_id) setConversationId(data.conversation_id)
            if (data.last_barangay || data.barangay_name) {
                setLastBarangay(data.last_barangay || data.barangay_name)
            }
            setMessages(previous => [...previous, {
                id: genId(),
                type: "user",
                text: message.originalQuestion,
                timestamp: new Date().toISOString(),
            }, {
                id: genId(),
                type: "bot",
                text: data.response,
                barangay: data.barangay_name,
                severity: data.severity,
                intent: data.intent,
                weatherData: data.weather_data || null,
                aiPowered: data.ai_powered || false,
                timestamp: new Date().toISOString(),
                refreshed: true,
                originalQuestion: message.originalQuestion,
                barangayCoords: data.barangay || null,
                evacuationCoords: data.evacuation_center || null,
            }])
            fetchRecentLogs()
        } catch (error) {
            console.error("Refresh error:", error)
        } finally {
            setRefreshingId(null)
        }
    }

    const handleLoadRecentLog = log => {
        setConversationId(log.id)
        setLastBarangay(log.last_barangay || null)
        setMessages((log.messages || []).map((message, index) => ({
            ...message,
            id: message.id || `${message.type || message.role}-${log.id}-${index}`,
            type: message.type || (message.role === "assistant" ? "bot" : "user"),
            text: message.text || message.content,
        })))
        setShowHistory(false)
    }

    const handleCopy = message => {
        navigator.clipboard.writeText(message.text).then(() => {
            setCopiedId(message.id)
            setTimeout(() => setCopiedId(null), 2000)
        }).catch(() => {})
    }

    const handleClear = () => {
        setMessages([])
        setLastBarangay(null)
        setConversationId(null)
        setShowHistory(false)
        setClearConfirmOpen(false)
    }

    const quickRequests = [
        "Which barangays are at highest risk now?",
        "Which centers are near capacity?",
        "Summarize current conditions",
        "Should I evacuate Mabua?",
    ]

    return (
        <>
            <style>{`
                @keyframes adminChatTyping {
                    0%, 60%, 100% { transform: translateY(0); opacity: .4; }
                    30% { transform: translateY(-5px); opacity: 1; }
                }
                @keyframes adminChatSpin { to { transform: rotate(360deg); } }
                .admin-chat-scroll::-webkit-scrollbar { width: 5px; }
                .admin-chat-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
                .admin-chat-quick:hover, .admin-chat-history-item:hover { background: #f0fdf4 !important; }
                .admin-chat-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(26,35,126,.35) !important; }
                @media (max-width: 600px) {
                    .admin-chat-panel {
                        inset: 0 !important;
                        width: 100vw !important;
                        height: 100dvh !important;
                        max-height: none !important;
                        border-radius: 0 !important;
                    }
                    .admin-chat-fab[data-open="true"] { display: none !important; }
                }
            `}</style>

            <button
                type="button"
                className="admin-chat-fab"
                data-open={isOpen ? "true" : "false"}
                style={styles.floatingButton}
                onClick={() => {
                    if (isOpen) setClearConfirmOpen(false)
                    setIsOpen(value => !value)
                }}
                aria-label={isOpen ? "Close AI Assistant" : "Open AI Assistant"}
                aria-expanded={isOpen}
            >
                <MessageCircle size={25} />
            </button>

            {isOpen && (
                <section className="admin-chat-panel" style={styles.panel} aria-label="Typhoon Operations AI Assistant">
                    <header style={styles.header}>
                        <div style={styles.headerIcon}><Bot size={19} /></div>
                        <div style={styles.headerCopy}>
                            <strong style={styles.headerTitle}>Typhoon Operations AI Assistant</strong>
                            {lastBarangay && <span style={styles.trackingText}>Tracking: {lastBarangay}</span>}
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setClearConfirmOpen(false)
                                setIsOpen(false)
                            }}
                            style={styles.iconButton}
                            aria-label="Close AI Assistant"
                        >
                            <X size={18} />
                        </button>
                    </header>

                    <div style={styles.toolbar}>
                        <button
                            type="button"
                            onClick={() => setShowHistory(value => !value)}
                            style={{ ...styles.toolbarButton, ...(showHistory ? styles.toolbarButtonActive : {}) }}
                        >
                            <History size={13} /> {showHistory ? "← Back to chat" : "History"}
                        </button>
                        {messages.length > 0 && (
                            clearConfirmOpen ? (
                                <div style={styles.clearConfirm}>
                                    <span style={styles.clearConfirmText}>Clear this chat?</span>
                                    <button type="button" onClick={() => setClearConfirmOpen(false)} style={styles.confirmButton}>Cancel</button>
                                    <button type="button" onClick={handleClear} style={{ ...styles.confirmButton, ...styles.confirmClearButton }}>Clear</button>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setClearConfirmOpen(true)} style={styles.toolbarButton} title="Clear current conversation">
                                    <Trash2 size={13} /> Clear
                                </button>
                            )
                        )}
                    </div>

                    {showHistory ? (
                        <div className="admin-chat-scroll" style={styles.historyList}>
                            {historyLoading && recentLogs.length === 0 ? (
                                <div style={styles.centerState}><RefreshCw size={18} style={{ animation: "adminChatSpin 1s linear infinite" }} /> Loading history…</div>
                            ) : recentLogs.length === 0 ? (
                                <div style={styles.centerState}>No recent Q&amp;A history.</div>
                            ) : recentLogs.map(log => (
                                <button
                                    type="button"
                                    key={log.id}
                                    className="admin-chat-history-item"
                                    style={styles.historyItem}
                                    onClick={() => handleLoadRecentLog(log)}
                                >
                                    <span style={styles.historyQuestion}>{log.question}</span>
                                    <span style={styles.historyMeta}>
                                        {log.last_barangay || "General"} · {log.message_count || 2} messages · {new Date(log.updated_at || log.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="admin-chat-scroll" style={styles.messages}>
                            {messages.length === 0 ? (
                                <div style={styles.emptyState}>
                                    <Bot size={34} color="#1D9E75" />
                                    <strong>How can I help operations?</strong>
                                    <span>Ask about barangay weather, evacuation guidance, or typhoon preparedness.</span>
                                </div>
                            ) : messages.map(message => (
                                <div key={message.id} style={{ ...styles.messageRow, justifyContent: message.type === "user" ? "flex-end" : "flex-start" }}>
                                    {message.type === "bot" && <div style={styles.avatar}><Bot size={13} /></div>}
                                    <div style={styles.messageColumn}>
                                        <div style={{
                                            ...styles.messageBubble,
                                            ...(message.type === "user" ? styles.userBubble : styles.botBubble),
                                            ...(message.error ? styles.errorBubble : {}),
                                        }}>
                                            <div style={styles.messageText}>{message.text}</div>
                                            <WeatherMiniCard data={message.weatherData} />
                                            {message.barangay && (
                                                <div style={styles.badges}>
                                                    <span style={{ ...styles.badge, ...severityStyle(message.severity) }}>{message.severity || "Weather Clear"}</span>
                                                    <span style={styles.badge}><MapPin size={10} /> {message.barangay}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ ...styles.messageActions, justifyContent: message.type === "user" ? "flex-end" : "flex-start" }}>
                                            <span>{message.timestamp ? new Date(message.timestamp).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                                            {message.type === "bot" && (
                                                <>
                                                    <button type="button" style={styles.inlineAction} onClick={() => handleCopy(message)} title="Copy response">
                                                        {copiedId === message.id ? <Check size={11} /> : <Copy size={11} />}
                                                    </button>
                                                    {message.barangay && (
                                                        <button
                                                            type="button"
                                                            style={styles.inlineAction}
                                                            onClick={() => handleRefresh(message)}
                                                            disabled={refreshingId === message.id}
                                                            title="Refresh weather data"
                                                        >
                                                            <RefreshCw size={11} style={{ animation: refreshingId === message.id ? "adminChatSpin 1s linear infinite" : "none" }} />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {message.type === "user" && <div style={styles.userAvatar}><User size={13} /></div>}
                                </div>
                            ))}

                            {loading && (
                                <div style={styles.messageRow}>
                                    <div style={styles.avatar}><Bot size={13} /></div>
                                    <div style={{ ...styles.messageBubble, ...styles.botBubble }}><TypingIndicator /></div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    )}

                    {!showHistory && messages.length === 0 && (
                        <div style={styles.quickArea}>
                            {quickRequests.map(request => (
                                <button
                                    type="button"
                                    key={request}
                                    className="admin-chat-quick"
                                    style={styles.quickChip}
                                    onClick={() => handleSendQuestion(request)}
                                    disabled={loading}
                                >
                                    {request}
                                </button>
                            ))}
                        </div>
                    )}

                    <div style={styles.inputArea}>
                        {suggestions.length > 0 && (
                            <div style={styles.suggestions}>
                                {suggestions.map(barangay => (
                                    <button
                                        type="button"
                                        key={barangay.id}
                                        style={styles.suggestion}
                                        onClick={() => {
                                            setQuestion(`Is ${barangay.name} safe?`)
                                            setSuggestions([])
                                        }}
                                    >
                                        <MapPin size={12} /> {barangay.name}
                                    </button>
                                ))}
                            </div>
                        )}
                        <input
                            ref={inputRef}
                            value={question}
                            onChange={handleInputChange}
                            onKeyDown={event => {
                                if (event.key === "Enter") handleSendQuestion()
                            }}
                            maxLength={500}
                            disabled={loading}
                            placeholder="Ask about a barangay…"
                            style={styles.input}
                            aria-label="Ask the AI Assistant"
                        />
                        <button
                            type="button"
                            onClick={() => handleSendQuestion()}
                            disabled={!question.trim() || loading}
                            style={{ ...styles.sendButton, ...((!question.trim() || loading) ? styles.sendButtonDisabled : {}) }}
                            aria-label="Send message"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </section>
            )}
        </>
    )
}

const styles = {
    floatingButton: {
        position: "fixed",
        right: 24,
        bottom: 24,
        width: 58,
        height: 58,
        borderRadius: "50%",
        border: "none",
        background: "linear-gradient(135deg, #1a237e, #1565c0)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 9px 24px rgba(26,35,126,.28)",
        zIndex: 10001,
        transition: "transform .2s ease, box-shadow .2s ease",
    },
    panel: {
        position: "fixed",
        right: 24,
        bottom: 94,
        width: 380,
        height: 520,
        maxHeight: "calc(100vh - 120px)",
        background: "#fff",
        border: "1px solid #dbe3ee",
        borderRadius: 16,
        boxShadow: "0 18px 50px rgba(15,23,42,.25)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        zIndex: 10000,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    },
    header: {
        minHeight: 62,
        padding: "11px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "#fff",
        background: "linear-gradient(135deg, #1a237e, #1565c0)",
        boxSizing: "border-box",
    },
    headerIcon: {
        width: 34,
        height: 34,
        borderRadius: 10,
        background: "rgba(255,255,255,.14)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    headerCopy: { display: "flex", flexDirection: "column", minWidth: 0, flex: 1 },
    headerTitle: { fontSize: 13, lineHeight: 1.25 },
    trackingText: { fontSize: 10, color: "rgba(255,255,255,.72)", marginTop: 3 },
    iconButton: {
        width: 32,
        height: 32,
        border: "none",
        borderRadius: 8,
        background: "rgba(255,255,255,.12)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
    },
    toolbar: {
        minHeight: 38,
        padding: "6px 10px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #e2e8f0",
        background: "#f8fafc",
        boxSizing: "border-box",
    },
    toolbarButton: {
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        background: "#fff",
        color: "#475569",
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 4,
        cursor: "pointer",
    },
    toolbarButtonActive: { background: "#e8eaf6", borderColor: "#9fa8da", color: "#1a237e" },
    clearConfirm: { display: "flex", alignItems: "center", gap: 4 },
    clearConfirmText: { color: "#475569", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" },
    confirmButton: {
        border: "1px solid #cbd5e1",
        borderRadius: 5,
        background: "#fff",
        color: "#475569",
        padding: "3px 5px",
        fontSize: 9,
        fontWeight: 700,
        cursor: "pointer",
    },
    confirmClearButton: { background: "#b91c1c", borderColor: "#b91c1c", color: "#fff" },
    messages: {
        flex: 1,
        overflowY: "auto",
        padding: 12,
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },
    emptyState: {
        margin: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 7,
        color: "#64748b",
        fontSize: 12,
        maxWidth: 270,
        lineHeight: 1.45,
    },
    messageRow: { display: "flex", alignItems: "flex-end", gap: 6, width: "100%" },
    avatar: {
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "#e8eaf6",
        color: "#1a237e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    userAvatar: {
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "#d1fae5",
        color: "#047857",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    messageColumn: { maxWidth: "82%", minWidth: 0 },
    messageBubble: { padding: "8px 10px", fontSize: 12, lineHeight: 1.45, wordBreak: "break-word" },
    userBubble: { background: "#1D9E75", color: "#fff", borderRadius: "13px 13px 3px 13px" },
    botBubble: { background: "#fff", color: "#1e293b", border: "1px solid #e2e8f0", borderRadius: "13px 13px 13px 3px" },
    errorBubble: { background: "#fff5f5", borderColor: "#fca5a5" },
    messageText: { whiteSpace: "pre-wrap" },
    weatherCard: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 4,
        marginTop: 8,
        padding: 7,
        borderRadius: 7,
        background: "#f0fdf4",
        color: "#166534",
        fontSize: 10,
        fontWeight: 600,
    },
    badges: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 },
    badge: {
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        border: "1px solid #e2e8f0",
        borderRadius: 999,
        background: "#f8fafc",
        color: "#475569",
        fontSize: 9,
        fontWeight: 700,
    },
    messageActions: { display: "flex", alignItems: "center", gap: 4, padding: "3px 3px 0", color: "#94a3b8", fontSize: 9 },
    inlineAction: { border: "none", background: "none", color: "#64748b", padding: 1, cursor: "pointer", display: "flex" },
    typingIndicator: { display: "flex", alignItems: "center", gap: 4, padding: "3px 1px" },
    typingDot: { width: 6, height: 6, borderRadius: "50%", background: "#94a3b8", animation: "adminChatTyping 1.2s ease-in-out infinite" },
    quickArea: {
        padding: "7px 10px",
        borderTop: "1px solid #e2e8f0",
        background: "#fff",
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
    },
    quickChip: {
        border: "1px solid #a7d7c5",
        borderRadius: 999,
        background: "#fff",
        color: "#13795b",
        padding: "5px 8px",
        fontSize: 9,
        cursor: "pointer",
        textAlign: "left",
    },
    inputArea: {
        minHeight: 56,
        padding: "8px 10px",
        display: "flex",
        gap: 7,
        alignItems: "center",
        background: "#fff",
        borderTop: "1px solid #e2e8f0",
        position: "relative",
        boxSizing: "border-box",
    },
    input: {
        flex: 1,
        minWidth: 0,
        border: "1px solid #cbd5e1",
        borderRadius: 999,
        padding: "9px 12px",
        outline: "none",
        fontSize: 12,
        background: "#f8fafc",
    },
    sendButton: {
        width: 34,
        height: 34,
        border: "none",
        borderRadius: "50%",
        background: "#1D9E75",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
    },
    sendButtonDisabled: { background: "#e2e8f0", color: "#94a3b8", cursor: "not-allowed" },
    suggestions: {
        position: "absolute",
        left: 10,
        right: 51,
        bottom: "calc(100% + 5px)",
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 9,
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(15,23,42,.15)",
        zIndex: 2,
    },
    suggestion: {
        width: "100%",
        padding: "8px 10px",
        border: "none",
        borderBottom: "1px solid #f1f5f9",
        background: "#fff",
        color: "#334155",
        fontSize: 11,
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 5,
        cursor: "pointer",
    },
    historyList: { flex: 1, overflowY: "auto", background: "#fff", padding: 6 },
    historyItem: {
        width: "100%",
        border: "none",
        borderBottom: "1px solid #f1f5f9",
        background: "#fff",
        padding: "9px 10px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 3,
        cursor: "pointer",
        textAlign: "left",
    },
    historyQuestion: { width: "100%", color: "#334155", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    historyMeta: { color: "#94a3b8", fontSize: 9 },
    centerState: { minHeight: 180, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: "#94a3b8", fontSize: 11 },
}
