import { useState, useEffect } from "react"
import axios from "axios"
import { Plus, Pencil, Trash2, Loader, Inbox, X } from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = "http://127.0.0.1:8000/api"

const emptyForm = {
    name: "",
    barangay_id: "",
    address: "",
    latitude: "",
    longitude: "",
    capacity: "",
    is_active: "1",
}

export default function AdminEvacuationCenters() {
    const { authHeaders } = useAdminAuth()
    const [centers, setCenters] = useState([])
    const [barangays, setBarangays] = useState([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState(null)
    const [error, setError] = useState(null)
    const [modalOpen, setModalOpen] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [form, setForm] = useState(emptyForm)

    const fetchData = async () => {
        setLoading(true)
        setError(null)
        try {
            const [centersRes, barangaysRes] = await Promise.all([
                axios.get(`${API_BASE}/admin/evacuation-centers`, { headers: authHeaders() }),
                axios.get(`${API_BASE}/admin/barangays`, { headers: authHeaders() }),
            ])
            setCenters(centersRes.data)
            setBarangays(barangaysRes.data)
        } catch {
            setError("Failed to load evacuation centers.")
        }
        setLoading(false)
    }

    useEffect(() => { fetchData() }, [])

    const openAdd = () => {
        setEditingId(null)
        setForm({ ...emptyForm, barangay_id: barangays[0]?.id ? String(barangays[0].id) : "" })
        setModalOpen(true)
        setMessage(null)
    }

    const openEdit = (c) => {
        setEditingId(c.id)
        setForm({
            name: c.name,
            barangay_id: String(c.barangay_id),
            address: c.address,
            latitude: String(c.latitude),
            longitude: String(c.longitude),
            capacity: String(c.capacity),
            is_active: c.is_active ? "1" : "0",
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
        if (!form.name.trim() || !form.barangay_id) {
            setError("Name and barangay are required.")
            return
        }
        setSaving(true)
        setError(null)
        setMessage(null)
        const payload = {
            name: form.name,
            barangay_id: parseInt(form.barangay_id, 10),
            address: form.address,
            latitude: parseFloat(form.latitude),
            longitude: parseFloat(form.longitude),
            capacity: parseInt(form.capacity, 10),
            is_active: form.is_active === "1",
        }
        try {
            if (editingId) {
                await axios.put(`${API_BASE}/admin/evacuation-centers/${editingId}`, payload, { headers: authHeaders() })
                setMessage("Evacuation center updated successfully.")
            } else {
                await axios.post(`${API_BASE}/admin/evacuation-centers`, payload, { headers: authHeaders() })
                setMessage("Evacuation center added successfully.")
            }
            closeModal()
            fetchData()
        } catch (err) {
            setError(err.response?.data?.message || "Failed to save evacuation center.")
        }
        setSaving(false)
    }

    const handleDelete = async (id) => {
        if (!window.confirm("Delete this evacuation center?")) return
        setError(null)
        setMessage(null)
        try {
            await axios.delete(`${API_BASE}/admin/evacuation-centers/${id}`, { headers: authHeaders() })
            setMessage("Evacuation center deleted successfully.")
            fetchData()
        } catch (err) {
            setError(err.response?.data?.message || "Failed to delete evacuation center.")
        }
    }

    return (
        <AdminLayout title="Evacuation Centers">
            <div style={styles.toolbar}>
                <div style={styles.count}>{centers.length} center{centers.length !== 1 ? "s" : ""}</div>
                <div onClick={openAdd} style={styles.addBtn}>
                    <Plus size={16} /> Add Center
                </div>
            </div>

            {message && <div style={styles.successBox}>{message}</div>}
            {error && <div style={styles.errorBox}>{error}</div>}

            <div style={styles.tableWrap}>
                {loading ? (
                    <div style={styles.center}>
                        <Loader size={24} color="#1a237e" style={{ animation: "spin 1s linear infinite" }} />
                        <span style={{ color: "#888", marginTop: 10 }}>Loading centers...</span>
                    </div>
                ) : centers.length === 0 ? (
                    <div style={styles.center}>
                        <Inbox size={36} color="#ccc" />
                        <span style={{ color: "#888", marginTop: 10 }}>No evacuation centers found.</span>
                    </div>
                ) : (
                    <table style={styles.table}>
                        <thead>
                            <tr>
                                <th style={styles.th}>Name</th>
                                <th style={styles.th}>Barangay</th>
                                <th style={styles.th}>Address</th>
                                <th style={styles.th}>Capacity</th>
                                <th style={styles.th}>Status</th>
                                <th style={styles.th}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {centers.map((c) => (
                                <tr key={c.id} style={styles.tr}>
                                    <td style={styles.td}>{c.name}</td>
                                    <td style={styles.td}>{c.barangay?.name || "—"}</td>
                                    <td style={styles.td}>{c.address}</td>
                                    <td style={styles.td}>{c.capacity?.toLocaleString()}</td>
                                    <td style={styles.td}>
                                        <span style={{
                                            ...styles.badge,
                                            background: c.is_active ? "#e1f5ee" : "#f5f5f5",
                                            color: c.is_active ? "#085041" : "#888",
                                        }}>
                                            {c.is_active ? "Active" : "Inactive"}
                                        </span>
                                    </td>
                                    <td style={styles.td}>
                                        <div style={styles.actions}>
                                            <div onClick={() => openEdit(c)} style={styles.editBtn}><Pencil size={14} /></div>
                                            <div onClick={() => handleDelete(c.id)} style={styles.deleteBtn}><Trash2 size={14} /></div>
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
                            <h2 style={styles.modalTitle}>{editingId ? "Edit Center" : "Add Center"}</h2>
                            <div onClick={closeModal} style={styles.closeBtn}><X size={18} /></div>
                        </div>
                        <div style={styles.modalBody}>
                            <div style={styles.field}>
                                <label style={styles.label}>Name</label>
                                <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            </div>
                            <div style={styles.field}>
                                <label style={styles.label}>Barangay</label>
                                <select style={styles.input} value={form.barangay_id} onChange={(e) => setForm({ ...form, barangay_id: e.target.value })}>
                                    <option value="">Select barangay</option>
                                    {barangays.map((b) => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={styles.field}>
                                <label style={styles.label}>Address</label>
                                <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
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
                            <div style={styles.row}>
                                <div style={{ ...styles.field, flex: 1 }}>
                                    <label style={styles.label}>Capacity</label>
                                    <input style={styles.input} type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
                                </div>
                                <div style={{ ...styles.field, flex: 1 }}>
                                    <label style={styles.label}>Status</label>
                                    <select style={styles.input} value={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.value })}>
                                        <option value="1">Active</option>
                                        <option value="0">Inactive</option>
                                    </select>
                                </div>
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
    tableWrap: { background: "#fff", borderRadius: 10, border: "1px solid #e8ecf0", overflow: "hidden", minHeight: 200 },
    table: { width: "100%", borderCollapse: "collapse" },
    th: {
        textAlign: "left", padding: "12px 16px", fontSize: 11, fontWeight: 600,
        color: "#888", textTransform: "uppercase", letterSpacing: 0.5,
        background: "#f8f9fc", borderBottom: "1px solid #e8ecf0",
    },
    tr: { borderBottom: "1px solid #f0f0f0" },
    td: { padding: "12px 16px", fontSize: 13, color: "#333" },
    badge: { padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 },
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
    modal: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 520, boxShadow: "0 8px 32px rgba(0,0,0,0.2)" },
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
