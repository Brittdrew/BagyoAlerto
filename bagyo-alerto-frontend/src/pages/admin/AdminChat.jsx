import { useState, useEffect, useRef } from "react"
import axios from "axios"
import { Send, Loader, MessageCircle } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = "http://127.0.0.1:8000/api"

export default function AdminChat() {
    const { authHeaders } = useAdminAuth()
    const [messages, setMessages] = useState([])
    const [question, setQuestion] = useState("")
    const [loading, setLoading] = useState(false)
    const [barangays, setBarangays] = useState([])
    const messagesEndRef = useRef(null)

    // Load barangays on mount
    useEffect(() => {
        const loadBarangays = async () => {
            try {
                const res = await axios.get(`${API_BASE}/barangays`)
                setBarangays(res.data)
            } catch (error) {
                console.error("Failed to load barangays:", error)
            }
        }
        loadBarangays()
    }, [])

    // Auto-scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    // Send question to chat API
    const handleSendQuestion = async () => {
        if (!question.trim()) return

        // Add user message
        const userMessage = { type: "user", text: question }
        setMessages(prev => [...prev, userMessage])
        setQuestion("")
        setLoading(true)

        try {
            const res = await axios.post(`${API_BASE}/chat`, {
                question: question,
            }, { headers: authHeaders() })

            const data = res.data
            const botMessage = {
                type: "bot",
                text: data.response,
                barangay: data.barangay_name,
                severity: data.severity,
                intent: data.intent,
            }
            setMessages(prev => [...prev, botMessage])
        } catch (error) {
            const errorMessage = {
                type: "bot",
                text: "Sorry, I couldn't process your question. Please try again.",
                error: true,
            }
            setMessages(prev => [...prev, errorMessage])
        }

        setLoading(false)
    }

    // Suggested questions
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

    return (
        <AdminLayout>
            <div style={styles.container}>
                <div style={styles.header}>
                    <MessageCircle style={{ fontSize: "2rem", color: "#1D9E75" }} />
                    <h1 style={styles.title}>Typhoon Q&A Assistant</h1>
                    <p style={styles.subtitle}>Ask about weather conditions, typhoon signals, and evacuation centers</p>
                </div>

                {/* Chat Messages */}
                <div style={styles.messagesContainer}>
                    {messages.length === 0 ? (
                        <div style={styles.emptyState}>
                            <MessageCircle style={{ fontSize: "3rem", color: "#ccc", marginBottom: "1rem" }} />
                            <p style={styles.emptyText}>No messages yet. Ask a question to get started!</p>
                        </div>
                    ) : (
                        messages.map((msg, idx) => (
                            <div
                                key={idx}
                                style={{
                                    ...styles.messageBubble,
                                    ...(msg.type === "user" ? styles.userBubble : styles.botBubble),
                                }}
                            >
                                <p style={styles.messageText}>{msg.text}</p>
                                {msg.barangay && (
                                    <small style={styles.metadata}>
                                        📍 {msg.barangay} • Severity: {msg.severity}
                                    </small>
                                )}
                            </div>
                        ))
                    )}
                    {loading && (
                        <div style={{ ...styles.messageBubble, ...styles.botBubble }}>
                            <div style={styles.loadingSpinner}>
                                <Loader style={{ animation: "spin 1s linear infinite" }} />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Suggested Questions */}
                {messages.length === 0 && (
                    <div style={styles.suggestedContainer}>
                        <p style={styles.suggestedLabel}>Suggested Questions:</p>
                        <div style={styles.suggestedGrid}>
                            {suggestedQuestions.map((q, idx) => (
                                <button
                                    key={idx}
                                    style={styles.suggestedButton}
                                    onClick={() => {
                                        setQuestion(q)
                                    }}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Input Section */}
                <div style={styles.inputContainer}>
                    <input
                        type="text"
                        placeholder="Ask about weather, typhoon signals, evacuation centers..."
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && !loading && handleSendQuestion()}
                        style={styles.input}
                        disabled={loading}
                    />
                    <button
                        onClick={handleSendQuestion}
                        disabled={!question.trim() || loading}
                        style={{
                            ...styles.sendButton,
                            ...((!question.trim() || loading) ? styles.sendButtonDisabled : {}),
                        }}
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </AdminLayout>
    )
}

const styles = {
    container: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#f8f9fa",
        padding: "2rem",
        gap: "1.5rem",
    },
    header: {
        textAlign: "center",
        paddingBottom: "1rem",
        borderBottom: "1px solid #e0e0e0",
    },
    title: {
        fontSize: "1.8rem",
        fontWeight: "700",
        color: "#333",
        margin: "0.5rem 0 0 0",
    },
    subtitle: {
        fontSize: "0.95rem",
        color: "#666",
        margin: "0.5rem 0 0 0",
    },
    messagesContainer: {
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1rem",
        background: "white",
        borderRadius: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    },
    messageBubble: {
        maxWidth: "70%",
        padding: "1rem",
        borderRadius: "12px",
        wordWrap: "break-word",
        whiteSpace: "pre-wrap",
    },
    userBubble: {
        alignSelf: "flex-end",
        background: "#1D9E75",
        color: "white",
        borderBottomRightRadius: "4px",
    },
    botBubble: {
        alignSelf: "flex-start",
        background: "#f0f0f0",
        color: "#333",
        borderBottomLeftRadius: "4px",
    },
    messageText: {
        margin: "0 0 0.25rem 0",
        fontSize: "0.95rem",
        lineHeight: "1.5",
    },
    metadata: {
        display: "block",
        marginTop: "0.5rem",
        opacity: 0.7,
        fontSize: "0.8rem",
    },
    loadingSpinner: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        color: "#aaa",
    },
    emptyText: {
        fontSize: "1rem",
        color: "#aaa",
    },
    suggestedContainer: {
        background: "white",
        padding: "1.5rem",
        borderRadius: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    },
    suggestedLabel: {
        fontSize: "0.9rem",
        fontWeight: "600",
        color: "#666",
        margin: "0 0 1rem 0",
    },
    suggestedGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
        gap: "1rem",
    },
    suggestedButton: {
        padding: "1rem",
        background: "#f0f7f5",
        border: "1px solid #d0e8e4",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "0.9rem",
        color: "#1D9E75",
        fontWeight: "500",
        transition: "all 0.3s ease",
        textAlign: "left",
    },
    inputContainer: {
        display: "flex",
        gap: "1rem",
        background: "white",
        padding: "1rem",
        borderRadius: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    },
    input: {
        flex: 1,
        padding: "0.75rem 1rem",
        border: "1px solid #ddd",
        borderRadius: "8px",
        fontSize: "0.95rem",
        outline: "none",
        transition: "border-color 0.3s",
    },
    sendButton: {
        padding: "0.75rem 1.5rem",
        background: "#1D9E75",
        color: "white",
        border: "none",
        borderRadius: "8px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        transition: "background 0.3s",
        fontWeight: "600",
    },
    sendButtonDisabled: {
        background: "#ccc",
        cursor: "not-allowed",
    },
}
