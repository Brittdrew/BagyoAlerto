import { useEffect, useMemo, useRef, useState } from "react"
import { Bot, MessageCircle, Send, X } from "lucide-react"

const SYSTEM_PROMPT = `You are BagyoBot, an AI typhoon assistant for BagyoAlerto - a disaster response system for Surigao City, Surigao del Norte, Philippines.

Your role is to help residents of Surigao City with:
1. Typhoon safety and preparedness tips
2. Explaining PAGASA typhoon signal levels (Signal #1 to #5)
3. Evacuation guidance and what to bring
4. What to do before, during, and after a typhoon
5. Information about storm surge, flooding, and landslides
6. Emergency contacts (NDRRMC: 1-800-1000-5911, Surigao DRRMO: (086) 826-8354)
7. Answering questions about the BagyoAlerto system

You can respond in English, Filipino, or Bisaya depending on what language the user uses.

Keep responses concise, clear, and actionable. Use bullet points when listing steps or tips. Always prioritize resident safety.

If asked about current weather or severity, tell them to check the Dashboard for live assessment.

You are focused ONLY on typhoon and disaster-related topics for Surigao City. For unrelated questions, politely redirect to typhoon safety topics.`

const INITIAL_MESSAGE = `👋 Kumusta! I'm BagyoBot, your typhoon safety assistant for Surigao City!

I can help you with:
- Typhoon safety tips
- PAGASA signal explanations
- Evacuation guidance
- Emergency contacts

Ask me anything in English, Filipino, or Bisaya! 😊`

const SUGGESTIONS = [
    "What to bring when evacuating?",
    "Unsa ang Signal #3?",
    "Emergency hotlines",
]

const ERROR_MESSAGE = "⚠️ Sorry, I'm having trouble connecting.\nPlease try again or call DRRMO: (086) 826-8354"

const formatTime = () => {
    return new Date().toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
}

const sanitizeInput = (value) => {
    return value
        .replace(/[<>]/g, "")
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .trim()
}

export default function BagyoBot() {
    const [isOpen, setIsOpen] = useState(false)
    const [input, setInput] = useState("")
    const [isTyping, setIsTyping] = useState(false)
    const [messages, setMessages] = useState([
        { id: "initial", role: "bot", text: INITIAL_MESSAGE, time: formatTime() },
    ])
    const messagesRef = useRef(null)

    useEffect(() => {
        if (!messagesRef.current) return
        messagesRef.current.scrollTo({
            top: messagesRef.current.scrollHeight,
            behavior: "smooth",
        })
    }, [messages, isTyping, isOpen])

    const hasUserMessage = useMemo(
        () => messages.some((message) => message.role === "user"),
        [messages]
    )

    const sendMessage = async (userMessage) => {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: `${SYSTEM_PROMPT}\n\nUser: ${userMessage}`,
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 500,
                    },
                }),
            }
        )

        if (!response.ok) {
            const errorData = await response.json()
            console.error("API Error:", response.status, errorData)
            throw new Error("Failed to connect to Gemini API")
        }

        const data = await response.json()
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || ERROR_MESSAGE
    }

    const handleSend = async (rawMessage) => {
        if (isTyping) return
        const cleanMessage = sanitizeInput(rawMessage || input)
        if (!cleanMessage) return

        const userMessage = {
            id: `user-${Date.now()}`,
            role: "user",
            text: cleanMessage,
            time: formatTime(),
        }
        setMessages((prev) => [...prev, userMessage])
        setInput("")
        setIsTyping(true)

        try {
            const botReply = await sendMessage(cleanMessage)
            setMessages((prev) => [
                ...prev,
                {
                    id: `bot-${Date.now()}`,
                    role: "bot",
                    text: botReply,
                    time: formatTime(),
                },
            ])
        } catch (err) {
            console.error("Bot error:", err)
            setMessages((prev) => [
                ...prev,
                {
                    id: `bot-error-${Date.now()}`,
                    role: "bot",
                    text: ERROR_MESSAGE,
                    time: formatTime(),
                },
            ])
        } finally {
            setIsTyping(false)
        }
    }

    return (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999 }}>
            <style>{`
                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                @keyframes pulse-bot {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                }
                @keyframes typing {
                    0%, 60%, 100% { transform: translateY(0); }
                    30% { transform: translateY(-4px); }
                }
                .bagyobot-window {
                    width: 360px;
                    height: 500px;
                }
                @media (max-width: 768px) {
                    .bagyobot-wrap {
                        right: 12px !important;
                        left: 12px !important;
                        bottom: 12px !important;
                    }
                    .bagyobot-window {
                        width: 100% !important;
                        height: 78vh !important;
                        max-height: 580px !important;
                    }
                }
            `}</style>

            {!isOpen && (
                <div className="bagyobot-wrap" style={{ position: "fixed", bottom: 24, right: 24 }}>
                    <div
                        style={{
                            position: "absolute",
                            bottom: 65,
                            right: 0,
                            background: "#1f2937",
                            color: "#fff",
                            padding: "6px 10px",
                            borderRadius: 8,
                            fontSize: 12,
                            opacity: 0,
                            pointerEvents: "none",
                            transition: "opacity 0.2s",
                        }}
                        className="bagyobot-tooltip"
                    >
                        Ask BagyoBot
                    </div>
                    <div
                        onMouseEnter={(e) => {
                            const tooltip = e.currentTarget.previousSibling
                            if (tooltip) tooltip.style.opacity = "1"
                        }}
                        onMouseLeave={(e) => {
                            const tooltip = e.currentTarget.previousSibling
                            if (tooltip) tooltip.style.opacity = "0"
                        }}
                        onClick={() => setIsOpen(true)}
                        style={{
                            width: 56,
                            height: 56,
                            borderRadius: "50%",
                            background: "#1a237e",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            cursor: "pointer",
                            boxShadow: "0 12px 25px rgba(26,35,126,0.35)",
                            animation: "pulse-bot 1.8s ease-in-out infinite",
                            position: "relative",
                        }}
                    >
                        <MessageCircle size={24} />
                        <span
                            style={{
                                position: "absolute",
                                top: -6,
                                right: -4,
                                fontSize: 10,
                                fontWeight: 700,
                                background: "#d32f2f",
                                color: "white",
                                borderRadius: 10,
                                padding: "2px 6px",
                                border: "1px solid #fff",
                            }}
                        >
                            AI
                        </span>
                    </div>
                </div>
            )}

            {isOpen && (
                <div
                    className="bagyobot-wrap"
                    style={{ position: "fixed", bottom: 24, right: 24, animation: "slideUp 0.25s ease" }}
                >
                    <div
                        className="bagyobot-window"
                        style={{
                            background: "#fff",
                            borderRadius: 16,
                            boxShadow: "0 20px 45px rgba(0,0,0,0.22)",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            border: "1px solid #e8ecf6",
                        }}
                    >
                        <div style={{ background: "#1a237e", color: "#fff", padding: "12px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <Bot size={18} />
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 700 }}>BagyoBot</div>
                                        <div style={{ fontSize: 11, opacity: 0.9 }}>Typhoon Assistant</div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4caf50" }} />
                                            <span style={{ fontSize: 10 }}>Online</span>
                                        </div>
                                    </div>
                                </div>
                                <div
                                    onClick={() => setIsOpen(false)}
                                    style={{ cursor: "pointer", color: "#fff", padding: 4, borderRadius: 6 }}
                                >
                                    <X size={18} />
                                </div>
                            </div>
                        </div>

                        <div
                            ref={messagesRef}
                            style={{
                                flex: 1,
                                padding: "12px 12px 6px",
                                overflowY: "auto",
                                background: "#f8f9fc",
                                display: "flex",
                                flexDirection: "column",
                                gap: 10,
                            }}
                        >
                            {messages.map((message) => {
                                const isBot = message.role === "bot"
                                return (
                                    <div
                                        key={message.id}
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: isBot ? "flex-start" : "flex-end",
                                        }}
                                    >
                                        <div
                                            style={{
                                                maxWidth: "85%",
                                                background: isBot ? "#edf0f5" : "#1a237e",
                                                color: isBot ? "#1f2937" : "#fff",
                                                borderRadius: 12,
                                                padding: "9px 11px",
                                                fontSize: 13,
                                                lineHeight: 1.4,
                                                whiteSpace: "pre-wrap",
                                            }}
                                        >
                                            {isBot && (
                                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, fontWeight: 700, fontSize: 11 }}>
                                                    <Bot size={12} /> BagyoBot
                                                </div>
                                            )}
                                            {message.text}
                                        </div>
                                        <div style={{ marginTop: 4, fontSize: 10, color: "#94a3b8" }}>{message.time}</div>
                                    </div>
                                )
                            })}

                            {!hasUserMessage && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "2px 2px 8px" }}>
                                    {SUGGESTIONS.map((chip) => (
                                        <div
                                            key={chip}
                                            onClick={() => handleSend(chip)}
                                            style={{
                                                fontSize: 11,
                                                border: "1px solid #c7d2fe",
                                                color: "#1a237e",
                                                background: "#eef2ff",
                                                borderRadius: 20,
                                                padding: "6px 10px",
                                                cursor: "pointer",
                                            }}
                                        >
                                            {chip}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {isTyping && (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                                    <div style={{ background: "#edf0f5", borderRadius: 12, padding: "8px 10px", maxWidth: "85%" }}>
                                        <div style={{ fontSize: 11, color: "#334155", marginBottom: 6 }}>🤖 BagyoBot is typing...</div>
                                        <div style={{ display: "flex", gap: 4 }}>
                                            {[0, 1, 2].map((dot) => (
                                                <span
                                                    key={dot}
                                                    style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: "50%",
                                                        background: "#64748b",
                                                        display: "inline-block",
                                                        animation: `typing 1s ${dot * 0.15}s infinite`,
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div style={{ borderTop: "1px solid #e5e7eb", background: "#fff", padding: 10, display: "flex", gap: 8 }}>
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSend()
                                }}
                                disabled={isTyping}
                                placeholder="Type your question..."
                                style={{
                                    flex: 1,
                                    border: "1px solid #d1d5db",
                                    borderRadius: 10,
                                    padding: "10px 11px",
                                    outline: "none",
                                    fontSize: 13,
                                    color: "#111827",
                                    background: isTyping ? "#f3f4f6" : "#fff",
                                }}
                            />
                            <div
                                onClick={() => handleSend()}
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 10,
                                    background: isTyping ? "#9ca3af" : "#1a237e",
                                    color: "#fff",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: isTyping ? "not-allowed" : "pointer",
                                }}
                            >
                                <Send size={16} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}