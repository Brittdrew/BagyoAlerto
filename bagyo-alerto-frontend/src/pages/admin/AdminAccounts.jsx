import { useCallback, useEffect, useMemo, useState } from "react"
import axios from "axios"
import { Loader, Plus, Trash2, UserCog } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE
const emptyForm = { name: "", email: "", password: "", role: "admin" }

export default function AdminAccounts() {
    const { admin, authHeaders } = useAdminAuth()
    const [accounts, setAccounts] = useState([])
    const [form, setForm] = useState(emptyForm)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)
    const [message, setMessage] = useState(null)

    const loadAccounts = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const response = await axios.get(`${API_BASE}/admin/accounts`, { headers: authHeaders() })
            setAccounts(response.data || [])
        } catch (requestError) {
            setError(requestError.response?.data?.message || "Failed to load admin accounts.")
        } finally {
            setLoading(false)
        }
    }, [authHeaders])

    useEffect(() => { loadAccounts() }, [loadAccounts])

    const superAdminCount = useMemo(
        () => accounts.filter(account => account.role === "super_admin").length,
        [accounts]
    )

    const handleAdd = async () => {
        if (!form.name.trim() || !form.email.trim() || !form.password) {
            setError("Name, email, and password are required.")
            return
        }
        setSaving(true)
        setError(null)
        setMessage(null)
        try {
            await axios.post(`${API_BASE}/admin/accounts`, {
                ...form,
                password_confirmation: form.password,
            }, { headers: authHeaders() })
            setForm(emptyForm)
            setMessage("Admin account added successfully.")
            await loadAccounts()
        } catch (requestError) {
            const errors = requestError.response?.data?.errors
            setError(errors ? Object.values(errors).flat()[0] : requestError.response?.data?.message || "Failed to add account.")
        } finally {
            setSaving(false)
        }
    }

    const handleRoleChange = async (account, role) => {
        setError(null)
        setMessage(null)
        try {
            await axios.put(`${API_BASE}/admin/accounts/${account.id}/role`, { role }, { headers: authHeaders() })
            setMessage("Role updated successfully.")
            await loadAccounts()
        } catch (requestError) {
            setError(requestError.response?.data?.message || "Failed to update role.")
        }
    }

    const handleDelete = async account => {
        if (!window.confirm(`Remove ${account.name}?`)) return
        setError(null)
        setMessage(null)
        try {
            await axios.delete(`${API_BASE}/admin/accounts/${account.id}`, { headers: authHeaders() })
            setMessage("Admin account removed successfully.")
            await loadAccounts()
        } catch (requestError) {
            setError(requestError.response?.data?.message || "Failed to remove account.")
        }
    }

    return (
        <AdminLayout title="Admin Accounts">
            <div style={styles.formCard}>
                <div style={styles.cardTitle}><UserCog size={18} /> Add admin account</div>
                <div style={styles.formGrid}>
                    <input style={styles.input} placeholder="Name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
                    <input style={styles.input} type="email" placeholder="Email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
                    <input style={styles.input} type="password" placeholder="Password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} />
                    <select style={styles.input} value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}>
                        <option value="admin">Admin</option>
                        <option value="super_admin">Super Admin</option>
                    </select>
                    <button type="button" onClick={handleAdd} disabled={saving} style={styles.primaryButton}>
                        {saving ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Plus size={14} />}
                        Add account
                    </button>
                </div>
            </div>

            {message && <div style={styles.success}>{message}</div>}
            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.tableCard}>
                {loading ? (
                    <div style={styles.loading}><Loader size={22} style={{ animation: "spin 1s linear infinite" }} /> Loading accounts...</div>
                ) : (
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                <th style={styles.th}>Name</th>
                                <th style={styles.th}>Email</th>
                                <th style={styles.th}>Role</th>
                                <th style={styles.th}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map(account => {
                                const isSelf = Number(account.id) === Number(admin?.id)
                                const isLastSuperAdmin = account.role === "super_admin" && superAdminCount === 1
                                return (
                                    <tr key={account.id} style={styles.tr}>
                                        <td style={styles.td}>{account.name}{isSelf ? " (you)" : ""}</td>
                                        <td style={styles.td}>{account.email}</td>
                                        <td style={styles.td}>
                                            <select
                                                style={styles.select}
                                                value={account.role}
                                                disabled={isSelf || isLastSuperAdmin}
                                                onChange={event => handleRoleChange(account, event.target.value)}
                                            >
                                                <option value="admin">Admin</option>
                                                <option value="super_admin">Super Admin</option>
                                            </select>
                                        </td>
                                        <td style={styles.td}>
                                            {!isSelf && !isLastSuperAdmin && (
                                                <button type="button" onClick={() => handleDelete(account)} style={styles.deleteButton}>
                                                    <Trash2 size={13} /> Remove
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </AdminLayout>
    )
}

const styles = {
    formCard: { background: "#fff", border: "1px solid #e8ecf0", borderRadius: 10, padding: 18, marginBottom: 16 },
    cardTitle: { display: "flex", alignItems: "center", gap: 8, color: "#1a237e", fontWeight: 700, marginBottom: 14 },
    formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "center" },
    input: { padding: "9px 10px", border: "1px solid #d8dee8", borderRadius: 7, fontSize: 13, boxSizing: "border-box" },
    primaryButton: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 12px", border: 0, borderRadius: 7, background: "#1a237e", color: "#fff", fontWeight: 700, cursor: "pointer" },
    tableCard: { background: "#fff", border: "1px solid #e8ecf0", borderRadius: 10, overflow: "hidden" },
    table: { width: "100%", borderCollapse: "collapse" },
    th: { padding: "11px 14px", background: "#f8fafc", color: "#64748b", fontSize: 11, textAlign: "left", borderBottom: "1px solid #e8ecf0" },
    td: { padding: "12px 14px", color: "#334155", fontSize: 13, borderBottom: "1px solid #f1f5f9" },
    tr: { background: "#fff" },
    select: { padding: "6px 8px", border: "1px solid #d8dee8", borderRadius: 6, background: "#fff" },
    deleteButton: { display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #fecaca", borderRadius: 6, padding: "6px 9px", background: "#fff", color: "#b91c1c", cursor: "pointer" },
    loading: { minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#64748b" },
    success: { marginBottom: 12, padding: "10px 12px", borderRadius: 7, background: "#dcfce7", color: "#166534", fontSize: 13 },
    error: { marginBottom: 12, padding: "10px 12px", borderRadius: 7, background: "#fee2e2", color: "#991b1b", fontSize: 13 },
}
