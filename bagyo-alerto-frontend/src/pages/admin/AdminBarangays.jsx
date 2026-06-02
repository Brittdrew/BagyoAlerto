import { useState, useEffect } from "react"
import axios from "axios"
import { Plus, Pencil, Trash2, Loader, Inbox, X } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE
const RISK_LEVELS = ["low", "moderate", "high", "critical"]
const RISK_COLORS = { low: "#1D9E75", moderate: "#BA7517", high: "#D85A30", critical: "#A32D2D" }

const emptyForm = { name: "", city: "", latitude: "", longitude: "", risk_level: "low" }

export default function AdminBarangays() {
    const { authHeaders } = useAdminAuth()
    const [barangays, setBarangays] = useState([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState(null)
    const [error, setError] = useState(null)
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [form, setForm] = useState(emptyForm)

    const fetchBarangays = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await axios.get(`${API_BASE}/admin/barangays`, { headers: authHeaders() })
            setBarangays(res.data)
        } catch {
            setError("Failed to load barangays.")
        }
        setLoading(false)
    }

    useEffect(() => { fetchBarangays() }, [])

    const openAdd = () => {
        setEditingId(null)
        setForm(emptyForm)
        setModalOpen(true)
        setMessage(null)
    }

    const openEdit = (b) => {
        setEditingId(b.id)
        setForm({
            name: b.name,
            city: b.city,
            latitude: String(b.latitude),
            longitude: String(b.longitude),
            risk_level: b.risk_level,
        })
        setModalOpen(true)
        setMessage(null)
    }

    const closeModal = () => {
        setModalOpen(false)
        setEditingId(null)
        setForm(emptyForm)
    }

    const handleSave = async () => {
        if (!form.name.trim() || !form.city.trim()) {
            setError("Name and city are required.")
            return
        }
        setSaving(true)
        setError(null)
        setMessage(null)
        const payload = {
            name: form.name,
            city: form.city,
            latitude: parseFloat(form.latitude),
            longitude: parseFloat(form.longitude),
            risk_level: form.risk_level,
        }
        try {
            if (editingId) {
                await axios.put(`${API_BASE}/admin/barangays/${editingId}`, payload, { headers: authHeaders() })
                setMessage("Barangay updated successfully.")
            } else {
                await axios.post(`${API_BASE}/admin/barangays`, payload, { headers: authHeaders() })
                setMessage("Barangay added successfully.")
            }
            closeModal()
            fetchBarangays()
        } catch (err) {
            setError(err.response?.data?.message || "Failed to save barangay.")
        }
        setSaving(false)
    }

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this barangay?")) return
        setError(null)
        setMessage(null)
        try {
            await axios.delete(`${API_BASE}/admin/barangays/${id}`, { headers: authHeaders() })
            setMessage("Barangay deleted successfully.")
            fetchBarangays()
        } catch (err) {
            setError(err.response?.data?.message || "Failed to delete barangay.")
        }
    }

    return (
        <AdminLayout title="Barangays">
            <div style={styles.toolbar}>
                <div style={styles.count}>{barangays.length} barangay{barangays.length !== 1 ? "s" : ""}</div>
                <div onClick={openAdd} style={styles.addBtn}>
                    <Plus size={16} /> Add Barangay
                </div>
            </div>

            {message && <div style={styles.successBox}>{message}</div>}
            {error && <div style={styles.errorBox}>{error}</div>}

            <div style={styles.tableWrap}>
                {loading ? (
                    <div style={styles.center}>
                        <Loader size={24} color="#1a237e" style={{ animation: "spin 1s linear infinite" }} />
                        <span style={{ color: "#888", marginTop: 10 }}>Loading barangays...</span>
                    </div>
                ) : barangays.length === 0 ? (
                    <div style={styles.center}>
                        <Inbox size={36} color="#ccc" />
                        <span style={{ color: "#888", marginTop: 10 }}>No barangays found.</span>
                    </div>
                ) : (
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                <th style={styles.th}>Name</th>
                                <th style={styles.th}>City</th>
                                <th style={styles.th}>Latitude</th>
                                <th style={styles.th}>Longitude</th>
                                <th style={styles.th}>Risk Level</th>
                                <th style={styles.th}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {barangays.map((b) => (
                                <tr key={b.id} style={styles.tr}>
                                    <td style={styles.td}>{b.name}</td>
                                    <td style={styles.td}>{b.city}</td>
                                    <td style={styles.td}>{b.latitude}</td>
                                    <td style={styles.td}>{b.longitude}</td>
                                    <td style={styles.td}>
                                        <span style={{
                                            ...styles.badge,
                                            background: `${RISK_COLORS[b.risk_level]}20`,
                                            color: RISK_COLORS[b.risk_level],
                                        }}>
                                            {b.risk_level}
                                        </span>
                                    </td>
                                    <td style={styles.td}>
                                        <div style={styles.actions}>
                                            <div onClick={() => openEdit(b)} style={styles.editBtn} title="Edit">
                                                <Pencil size={14} />
                                            </div>
                                            <div onClick={() => handleDelete(b.id)} style={styles.deleteBtn} title="Delete">
                                                <Trash2 size={14} />
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {modalOpen && (
                <div style={styles.overlay} onClick={closeModal}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>{editingId ? "Edit Barangay" : "Add Barangay"}</h2>
                            <div onClick={closeModal} style={styles.closeBtn}><X size={18} /></div>
                        </div>
                        <div style={styles.modalBody}>
                            <div style={styles.field}>
                                <label style={styles.label}>Name</label>
                                <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            </div>
                            <div style={styles.field}>
                                <label style={styles.label}>City</label>
                                <input style={styles.input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                            </div>
                            <div style={styles.row}>
                                <div style={{ ...styles.field, flex: 1 }}>
                                    <label style={styles.label}>Latitude</label>
                                    <input style={styles.input} type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
                                </div>
                                <div style={{ ...styles.field, flex: 1 }}>
                                    <label style={styles.label}>Longitude</label>
                                    <input style={styles.input} type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
                                </div>
                            </div>
                            <div style={styles.field}>
                                <label style={styles.label}>Risk Level</label>
                                <select style={styles.input} value={form.risk_level} onChange={(e) => setForm({ ...form, risk_level: e.target.value })}>
                                    {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>
                        </div>
                        <div style={styles.modalFooter}>
                            <div onClick={closeModal} style={styles.cancelBtn}>Cancel</div>
                            <div
                                onClick={!saving ? handleSave : undefined}
                                style={{ ...styles.saveBtn, opacity: saving ? 0.7 : 1, cursor: saving ? "not-allowed" : "pointer" }}
                            >
                                {saving ? "Saving..." : editingId ? "Update" : "Add"}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    )
}

const styles = {
    toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    count: { fontSize: 13, color: "#888" },
    addBtn: {
        display: "flex", alignItems: "center", gap: 6,
        background: "#1a237e", color: "#fff", padding: "8px 16px",
        borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
    },
    tableWrap: {
        background: "#fff", borderRadius: 10, border: "1px solid #e8ecf0",
        overflow: "hidden", minHeight: 200,
    },
    table: { width: "100%", borderCollapse: "collapse" },
    th: {
        textAlign: "left", padding: "12px 16px", fontSize: 11,
        fontWeight: 600, color: "#888", textTransform: "uppercase",
        letterSpacing: 0.5, background: "#f8f9fc", borderBottom: "1px solid #e8ecf0",
    },
    tr: { borderBottom: "1px solid #f0f0f0" },
    td: { padding: "12px 16px", fontSize: 13, color: "#333" },
    badge: { padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, textTransform: "capitalize" },
    actions: { display: "flex", gap: 8 },
    editBtn: { padding: 6, borderRadius: 6, background: "#f0f4ff", color: "#1a237e", cursor: "pointer" },
    deleteBtn: { padding: 6, borderRadius: 6, background: "#fcebeb", color: "#a32d2d", cursor: "pointer" },
    center: { display: "flex", flexDirection: "column", alignItems: "center", padding: 48 },
    successBox: { background: "#e1f5ee", color: "#085041", padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13 },
    errorBox: { background: "#fcebeb", color: "#a32d2d", padding: "10px 14px", borderRadius: 8, marginBottom: 12, fontSize: 13 },
    overlay: {
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    },
    modal: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid #eee" },
    modalTitle: { margin: 0, fontSize: 16, fontWeight: 600, color: "#1a237e" },
    closeBtn: { cursor: "pointer", color: "#888", padding: 4 },
    modalBody: { padding: "20px" },
    modalFooter: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid #eee" },
    field: { marginBottom: 14 },
    row: { display: "flex", gap: 12 },
    label: { display: "block", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 5 },
    input: { width: "100%", padding: "9px 11px", border: "1px solid #ddd", borderRadius: 8, fontSize: 13, boxSizing: "border-box" },
    cancelBtn: { padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer", color: "#666", border: "1px solid #ddd" },
    saveBtn: { padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#1a237e", color: "#fff" },
}
