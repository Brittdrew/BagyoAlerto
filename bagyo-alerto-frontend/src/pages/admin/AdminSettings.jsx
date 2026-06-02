import { useState } from "react"
import axios from "axios"
import { KeyRound, Loader } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE

export default function AdminSettings() {
    const { authHeaders, admin } = useAdminAuth()
    const [currentPassword, setCurrentPassword] = useState("")
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState(null)
    const [error, setError] = useState(null)

    const handleChangePassword = async () => {
        if (!currentPassword || !newPassword || !confirmPassword) {
            setError("All fields are required.")
            return
        }
        if (newPassword !== confirmPassword) {
            setError("New passwords do not match.")
            return
        }
        if (newPassword.length < 6) {
            setError("New password must be at least 6 characters.")
            return
        }
        setLoading(true)
        setError(null)
        setMessage(null)
        try {
            await axios.put(
                `${API_BASE}/admin/password`,
                {
                    current_password: currentPassword,
                    new_password: newPassword,
                    new_password_confirmation: confirmPassword,
                },
                { headers: authHeaders() }
            )
            setMessage("Password updated successfully.")
            setCurrentPassword("")
            setNewPassword("")
            setConfirmPassword("")
        } catch (err) {
            const msg = err.response?.data?.message
            const errors = err.response?.data?.errors
            if (errors?.new_password) {
                setError(errors.new_password[0])
            } else {
                setError(msg || "Failed to update password.")
            }
        }
        setLoading(false)
    }

    return (
        <AdminLayout title="Settings">
            <div style={styles.card}>
                <div style={styles.cardHeader}>
                    <KeyRound size={18} color="#1a237e" />
                    <span>Account Information</span>
                </div>
                <div style={styles.infoGrid}>
                    <div style={styles.infoItem}>
                        <span style={styles.infoLabel}>Name</span>
                        <span style={styles.infoValue}>{admin?.name || "—"}</span>
                    </div>
                    <div style={styles.infoItem}>
                        <span style={styles.infoLabel}>Username</span>
                        <span style={styles.infoValue}>{admin?.username || "—"}</span>
                    </div>
                </div>
            </div>

            <div style={styles.card}>
                <div style={styles.cardHeader}>
                    <KeyRound size={18} color="#1a237e" />
                    <span>Change Password</span>
                </div>

                {message && <div style={styles.successBox}>{message}</div>}
                {error && <div style={styles.errorBox}>{error}</div>}

                <div style={styles.field}>
                    <label style={styles.label}>Current Password</label>
                    <input
                        type="password"
                        style={styles.input}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                    />
                </div>
                <div style={styles.field}>
                    <label style={styles.label}>New Password</label>
                    <input
                        type="password"
                        style={styles.input}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                    />
                </div>
                <div style={styles.field}>
                    <label style={styles.label}>Confirm New Password</label>
                    <input
                        type="password"
                        style={styles.input}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                    />
                </div>

                <div
                    onClick={!loading ? handleChangePassword : undefined}
                    style={{
                        ...styles.btn,
                        opacity: loading ? 0.7 : 1,
                        cursor: loading ? "not-allowed" : "pointer",
                    }}
                >
                    {loading ? (
                        <>
                            <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                            Updating...
                        </>
                    ) : (
                        "Update Password"
                    )}
                </div>
            </div>
        </AdminLayout>
    )
}

const styles = {
    card: {
        background: "#fff",
        borderRadius: 10,
        padding: "24px",
        border: "1px solid #e8ecf0",
        marginBottom: 20,
        maxWidth: 480,
    },
    cardHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 15,
        fontWeight: 600,
        color: "#1a237e",
        marginBottom: 20,
    },
    infoGrid: { display: "flex", flexDirection: "column", gap: 12 },
    infoItem: { display: "flex", flexDirection: "column", gap: 4 },
    infoLabel: { fontSize: 11, color: "#888", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 },
    infoValue: { fontSize: 14, color: "#333", fontWeight: 500 },
    field: { marginBottom: 16 },
    label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 },
    input: {
        width: "100%",
        padding: "10px 12px",
        border: "1px solid #ddd",
        borderRadius: 8,
        fontSize: 14,
        boxSizing: "border-box",
    },
    btn: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "#1a237e",
        color: "#fff",
        padding: "10px 20px",
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 13,
        marginTop: 4,
    },
    successBox: {
        background: "#e1f5ee",
        color: "#085041",
        padding: "10px 14px",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 13,
    },
    errorBox: {
        background: "#fcebeb",
        color: "#a32d2d",
        padding: "10px 14px",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 13,
    },
}
