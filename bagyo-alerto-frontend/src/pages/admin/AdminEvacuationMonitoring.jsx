import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import axios from "axios"
import {
    Users,
    UserPlus,
    UserMinus,
    RotateCcw,
    RefreshCw,
    AlertCircle,
    CheckCircle2,
    MapPin,
    School,
    ArrowUpRight,
    ArrowDownRight,
    Clock,
    ShieldAlert,
    ChevronDown,
    Building2,
} from "lucide-react"
import AdminLayout from "../../components/AdminLayout"
import { useAdminAuth } from "../../context/AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE

export default function AdminEvacuationMonitoring() {
    const { authHeaders, logout } = useAdminAuth()
    const navigate = useNavigate()

    // Master data
    const [barangays, setBarangays] = useState([])
    const [centers, setCenters] = useState([])
    const [loadingInitial, setLoadingInitial] = useState(true)

    // Selection
    const [selectedBarangayId, setSelectedBarangayId] = useState("")
    const [selectedCenterId, setSelectedCenterId] = useState("")

    // Center data
    const [occupancy, setOccupancy] = useState(null)
    const [logs, setLogs] = useState([])
    const [evacueesSummary, setEvacueesSummary] = useState(null)

    // Loading & Refresh states
    const [loadingOccupancy, setLoadingOccupancy] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [fetchError, setFetchError] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)

    // Form state
    const [logType, setLogType] = useState("arrival") // 'arrival' | 'departure'
    const [headcount, setHeadcount] = useState("1")
    const [originBarangayId, setOriginBarangayId] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [formError, setFormError] = useState(null)
    const [formSuccess, setFormSuccess] = useState(null)

    // Undo state
    const [undoing, setUndoing] = useState(false)

    // 401 error handler
    const handleAuthError = useCallback((err) => {
        if (err.response?.status === 401) {
            logout()
            navigate("/admin/login")
            return true
        }
        return false
    }, [logout, navigate])

    // Fetch initial master lists (barangays and evacuation centers)
    useEffect(() => {
        const fetchMasterData = async () => {
            setLoadingInitial(true)
            setFetchError(null)
            try {
                const [bRes, cRes] = await Promise.all([
                    axios.get(`${API_BASE}/barangays`, { headers: authHeaders() }),
                    axios.get(`${API_BASE}/evacuation-centers`, { headers: authHeaders() }),
                ])

                const bList = bRes.data || []
                const cList = cRes.data || []

                setBarangays(bList)
                setCenters(cList)

                if (bList.length > 0) {
                    const firstBId = String(bList[0].id)
                    setSelectedBarangayId(firstBId)

                    // Find first center for this barangay
                    const matchingCenters = cList.filter((c) => String(c.barangay_id) === firstBId)
                    if (matchingCenters.length > 0) {
                        setSelectedCenterId(String(matchingCenters[0].id))
                    }
                }
            } catch (err) {
                if (!handleAuthError(err)) {
                    setFetchError("Failed to load initial barangay and evacuation center data.")
                }
            } finally {
                setLoadingInitial(false)
            }
        }

        fetchMasterData()
    }, [authHeaders, handleAuthError])

    // Centers filtered by selected barangay
    const filteredCenters = centers.filter(
        (c) => String(c.barangay_id) === String(selectedBarangayId)
    )

    // Current selected center and barangay objects
    const currentCenter = centers.find((c) => String(c.id) === String(selectedCenterId))
    const currentBarangay = barangays.find((b) => String(b.id) === String(selectedBarangayId))

    // Set origin barangay default when center or barangay changes
    useEffect(() => {
        if (currentCenter?.barangay_id) {
            setOriginBarangayId(String(currentCenter.barangay_id))
        } else if (selectedBarangayId) {
            setOriginBarangayId(String(selectedBarangayId))
        }
    }, [currentCenter, selectedBarangayId])

    // Fetch detailed center occupancy and logs
    const fetchCenterData = useCallback(async (centerId, barangayId, isSilent = false) => {
        if (!centerId) return

        if (!isSilent) setLoadingOccupancy(true)
        setFetchError(null)

        try {
            const requests = [
                axios.get(`${API_BASE}/evacuation-centers/${centerId}/occupancy`, { headers: authHeaders() }),
                axios.get(`${API_BASE}/evacuation-centers/${centerId}/logs`, { headers: authHeaders() }),
            ]

            if (barangayId) {
                requests.push(
                    axios.get(`${API_BASE}/barangays/${barangayId}/evacuees`, { headers: authHeaders() })
                )
            }

            const results = await Promise.all(requests)
            setOccupancy(results[0].data)
            setLogs(results[1].data || [])

            if (results[2]) {
                setEvacueesSummary(results[2].data)
            }

            setLastUpdated(new Date())
        } catch (err) {
            if (!handleAuthError(err)) {
                setFetchError(err.response?.data?.message || "Failed to fetch center occupancy data.")
            }
        } finally {
            if (!isSilent) setLoadingOccupancy(false)
        }
    }, [authHeaders, handleAuthError])

    // Trigger fetch on selection change
    useEffect(() => {
        if (selectedCenterId) {
            fetchCenterData(selectedCenterId, selectedBarangayId, false)
        } else {
            setOccupancy(null)
            setLogs([])
            // Still fetch evacuees for the barangay if barangay selected
            if (selectedBarangayId) {
                axios
                    .get(`${API_BASE}/barangays/${selectedBarangayId}/evacuees`, { headers: authHeaders() })
                    .then((res) => setEvacueesSummary(res.data))
                    .catch((err) => handleAuthError(err))
            }
        }
    }, [selectedCenterId, selectedBarangayId, fetchCenterData, authHeaders, handleAuthError])

    // 30-second polling interval
    useEffect(() => {
        if (!selectedCenterId) return

        const timer = setInterval(() => {
            fetchCenterData(selectedCenterId, selectedBarangayId, true)
        }, 30000)

        return () => clearInterval(timer)
    }, [selectedCenterId, selectedBarangayId, fetchCenterData])

    // Handle manual refresh button
    const handleManualRefresh = async () => {
        setRefreshing(true)
        await fetchCenterData(selectedCenterId, selectedBarangayId, false)
        setRefreshing(false)
    }

    // Handle Barangay change
    const handleBarangayChange = (bId) => {
        setSelectedBarangayId(bId)
        setFormError(null)
        setFormSuccess(null)

        const matching = centers.filter((c) => String(c.barangay_id) === String(bId))
        if (matching.length > 0) {
            setSelectedCenterId(String(matching[0].id))
        } else {
            setSelectedCenterId("")
            setOccupancy(null)
            setLogs([])
        }
    }

    // Submit new Arrival or Departure log
    const handleSubmitLog = async (e) => {
        e.preventDefault()
        if (!selectedCenterId) {
            setFormError("Please select an evacuation center first.")
            return
        }

        const countNum = parseInt(headcount, 10)
        if (!countNum || countNum < 1) {
            setFormError("Headcount must be an integer greater than or equal to 1.")
            return
        }

        setSubmitting(true)
        setFormError(null)
        setFormSuccess(null)

        const payload = {
            type: logType,
            headcount: countNum,
            origin_barangay_id: originBarangayId ? parseInt(originBarangayId, 10) : null,
        }

        try {
            await axios.post(
                `${API_BASE}/evacuation-centers/${selectedCenterId}/logs`,
                payload,
                { headers: authHeaders() }
            )

            setFormSuccess(
                `Successfully recorded ${logType === "arrival" ? "arrival" : "departure"} of ${countNum} evacuee${countNum !== 1 ? "s" : ""}!`
            )
            setHeadcount("1")

            // Refresh data immediately
            await fetchCenterData(selectedCenterId, selectedBarangayId, true)

            // Auto-clear success message after 4s
            setTimeout(() => {
                setFormSuccess(null)
            }, 4000)
        } catch (err) {
            if (!handleAuthError(err)) {
                // Display 422 inline validation message from backend
                const backendMsg =
                    err.response?.data?.errors?.headcount?.[0] ||
                    err.response?.data?.message ||
                    "Failed to record evacuation log."
                setFormError(backendMsg)
            }
        } finally {
            setSubmitting(false)
        }
    }

    // Handle Undo latest log
    const handleUndoLatest = async (logId) => {
        if (!logId) return
        const confirmed = window.confirm(
            "Are you sure you want to undo the latest log entry? This will revert the headcounts recorded in that entry."
        )
        if (!confirmed) return

        setUndoing(true)
        setFormError(null)
        setFormSuccess(null)

        try {
            await axios.delete(`${API_BASE}/evacuation-logs/${logId}`, {
                headers: authHeaders(),
            })

            setFormSuccess("Successfully undone latest log entry.")
            await fetchCenterData(selectedCenterId, selectedBarangayId, true)

            setTimeout(() => {
                setFormSuccess(null)
            }, 4000)
        } catch (err) {
            if (!handleAuthError(err)) {
                setFormError(
                    err.response?.data?.message || "Failed to undo log entry."
                )
            }
        } finally {
            setUndoing(false)
        }
    }

    // Status styling helpers
    const getStatusStyle = (status) => {
        switch (status) {
            case "full":
                return {
                    label: "Full",
                    barColor: "#EF4444",
                    badgeBg: "#fcebeb",
                    badgeColor: "#a32d2d",
                    badgeBorder: "#fca5a5",
                }
            case "almost_full":
                return {
                    label: "Almost Full (70%+)",
                    barColor: "#F59E0B",
                    badgeBg: "#fef3c7",
                    badgeColor: "#b45309",
                    badgeBorder: "#fcd34d",
                }
            case "available":
            default:
                return {
                    label: "Available (<70%)",
                    barColor: "#10B981",
                    badgeBg: "#e1f5ee",
                    badgeColor: "#085041",
                    badgeBorder: "#6ee7b7",
                }
        }
    }

    // Over-capacity fields from backend
    const isOverCapacity = occupancy?.over_capacity === true
    const overBy = Number(occupancy?.over_by ?? 0)

    // Calculate percentage using the center's capacity field
    const capacityNum = Number(occupancy?.capacity ?? currentCenter?.capacity ?? 0)
    const currentNum = Number(occupancy?.current ?? 0)
    const freeSpaceNum = occupancy?.free_space !== undefined
        ? Number(occupancy.free_space)
        : Math.max(0, capacityNum - currentNum)
    // Cap the bar at 100%; show over-capacity visually as full red bar
    const occupancyPercent =
        capacityNum > 0
            ? Math.min(100, Math.round((currentNum / capacityNum) * 100))
            : currentNum > 0
            ? 100
            : 0

    const statusInfo = getStatusStyle(occupancy?.status || "available")
    // Override colors when over capacity (status is still 'full')
    const occupancyColor = isOverCapacity ? "#EF4444" : statusInfo.barColor

    return (
        <AdminLayout title="Evacuation Monitoring">
            {/* Top Toolbar / Filter Controls */}
            <div style={styles.topBar}>
                <div style={styles.selectorGroup}>
                    {/* Barangay Selector */}
                    <div style={styles.filterBox}>
                        <label style={styles.filterLabel}>
                            <MapPin size={13} style={{ color: "#1a237e" }} />
                            <span>Barangay</span>
                        </label>
                        <select
                            style={styles.select}
                            value={selectedBarangayId}
                            onChange={(e) => handleBarangayChange(e.target.value)}
                            disabled={loadingInitial}
                        >
                            <option value="">Select a barangay...</option>
                            {barangays.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Evacuation Center Selector */}
                    <div style={styles.filterBox}>
                        <label style={styles.filterLabel}>
                            <School size={13} style={{ color: "#1a237e" }} />
                            <span>Evacuation Center</span>
                        </label>
                        <select
                            style={styles.select}
                            value={selectedCenterId}
                            onChange={(e) => {
                                setSelectedCenterId(e.target.value)
                                setFormError(null)
                                setFormSuccess(null)
                            }}
                            disabled={loadingInitial || filteredCenters.length === 0}
                        >
                            {filteredCenters.length === 0 ? (
                                <option value="">No centers in this barangay</option>
                            ) : (
                                filteredCenters.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name} (Cap: {c.capacity})
                                    </option>
                                ))
                            )}
                        </select>
                    </div>
                </div>

                {/* Auto-refresh indicator & Manual refresh */}
                <div style={styles.refreshGroup}>
                    <div style={styles.autoRefreshPill}>
                        <span style={styles.pulsingDot} />
                        <span>Live auto-sync (30s)</span>
                    </div>
                    {lastUpdated && (
                        <span style={styles.lastUpdatedText}>
                            Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={handleManualRefresh}
                        disabled={refreshing || !selectedCenterId}
                        style={{
                            ...styles.refreshBtn,
                            opacity: refreshing ? 0.7 : 1,
                        }}
                        title="Refresh occupancy now"
                    >
                        <RefreshCw size={14} className={refreshing ? "spin" : ""} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {fetchError && (
                <div style={styles.alertError}>
                    <AlertCircle size={16} />
                    <span>{fetchError}</span>
                </div>
            )}

            {/* If no center is selected */}
            {!selectedCenterId && !loadingInitial && (
                <div style={styles.emptyPrompt}>
                    <School size={48} style={{ color: "#9ca3af", marginBottom: 12 }} />
                    <h3 style={{ margin: "0 0 6px", color: "#1a237e" }}>No Evacuation Center Selected</h3>
                    <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
                        Select a barangay and evacuation center from the dropdowns above to monitor and record occupancy.
                    </p>
                </div>
            )}

            {selectedCenterId && (
                <div style={styles.mainGrid}>
                    {/* LEFT COLUMN: Occupancy Card & Record Headcount Form */}
                    <div style={styles.leftCol}>
                        {/* Occupancy Card */}
                        <div style={styles.card}>
                            <div style={styles.cardHeader}>
                                <div>
                                    <div style={styles.cardOverline}>Real-Time Occupancy</div>
                                    <h2 style={styles.cardTitle}>{currentCenter?.name || "Evacuation Center"}</h2>
                                    <div style={styles.cardSub}>
                                        <MapPin size={12} style={{ display: "inline", marginRight: 4 }} />
                                        {currentCenter?.address || currentBarangay?.name || "Surigao City"}
                                    </div>
                                </div>
                                <span
                                    style={{
                                        ...styles.statusBadge,
                                        background: isOverCapacity ? "#fcebeb" : statusInfo.badgeBg,
                                        color: isOverCapacity ? "#a32d2d" : statusInfo.badgeColor,
                                        border: `1px solid ${isOverCapacity ? "#fca5a5" : statusInfo.badgeBorder}`,
                                    }}
                                >
                                    {isOverCapacity
                                        ? `OVER CAPACITY (+${overBy.toLocaleString()})`
                                        : statusInfo.label}
                                </span>
                            </div>

                            {/* Numbers Display */}
                            <div style={styles.statsRow}>
                                <div style={styles.statBox}>
                                    <span style={styles.statLabel}>Current Occupancy</span>
                                    <div style={styles.statBig}>
                                        <span style={{ color: occupancyColor }}>
                                            {currentNum.toLocaleString()}
                                        </span>
                                        <span style={styles.statCapacity}> / {capacityNum.toLocaleString()}</span>
                                    </div>
                                </div>

                                <div style={styles.statBoxRight}>
                                    <span style={styles.statLabel}>Available Space</span>
                                    <div style={styles.freeSpacePill}>
                                        <span style={{ fontWeight: 700, fontSize: 18, color: "#085041" }}>
                                            {freeSpaceNum.toLocaleString()}
                                        </span>
                                        <span style={{ fontSize: 12, color: "#085041", marginLeft: 4 }}>
                                            free beds/slots
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Progress Bar */}
                            <div style={styles.progressContainer}>
                                <div style={styles.progressLabels}>
                                    <span>Occupancy Rate</span>
                                    <span style={{ fontWeight: 700, color: statusInfo.badgeColor }}>
                                        {occupancyPercent}%
                                    </span>
                                </div>
                                <div style={styles.progressBarTrack}>
                                    <div
                                        style={{
                                            ...styles.progressBarFill,
                                            width: `${occupancyPercent}%`,
                                            backgroundColor: statusInfo.barColor,
                                        }}
                                    />
                                </div>
                                <div style={styles.thresholdMarkers}>
                                    <span>0%</span>
                                    <span style={{ color: "#F59E0B" }}>70% (Almost Full)</span>
                                    <span style={{ color: "#EF4444" }}>100% (Full)</span>
                                </div>
                            </div>
                        </div>

                        {/* Record Headcount Form */}
                        <div style={styles.card}>
                            <div style={styles.cardHeader}>
                                <div>
                                    <div style={styles.cardOverline}>Log Activity</div>
                                    <h3 style={styles.formTitle}>Record Evacuee Movement</h3>
                                </div>
                            </div>

                            {/* Inline Messages */}
                            {formSuccess && (
                                <div style={styles.alertSuccess}>
                                    <CheckCircle2 size={16} />
                                    <span>{formSuccess}</span>
                                </div>
                            )}

                            {formError && (
                                <div style={styles.alertError}>
                                    <AlertCircle size={16} />
                                    <span>{formError}</span>
                                </div>
                            )}

                            <form onSubmit={handleSubmitLog} style={styles.form}>
                                {/* Arrival / Departure Toggle */}
                                <div style={styles.field}>
                                    <label style={styles.inputLabel}>Movement Type</label>
                                    <div style={styles.toggleGroup}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setLogType("arrival")
                                                setFormError(null)
                                            }}
                                            style={{
                                                ...styles.toggleBtn,
                                                ...(logType === "arrival" ? styles.toggleBtnArrivalActive : {}),
                                            }}
                                        >
                                            <UserPlus size={16} />
                                            <span>Arrival (+)</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setLogType("departure")
                                                setFormError(null)
                                            }}
                                            style={{
                                                ...styles.toggleBtn,
                                                ...(logType === "departure" ? styles.toggleBtnDepartureActive : {}),
                                            }}
                                        >
                                            <UserMinus size={16} />
                                            <span>Departure (-)</span>
                                        </button>
                                    </div>
                                </div>

                                <div style={styles.formRow}>
                                    {/* Headcount Input */}
                                    <div style={{ ...styles.field, flex: 1 }}>
                                        <label style={styles.inputLabel}>Headcount (min 1)</label>
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            required
                                            value={headcount}
                                            onChange={(e) => setHeadcount(e.target.value)}
                                            placeholder="e.g. 5"
                                            style={styles.input}
                                        />
                                    </div>

                                    {/* Origin Barangay Dropdown */}
                                    <div style={{ ...styles.field, flex: 1.5 }}>
                                        <label style={styles.inputLabel}>
                                            Origin Barangay
                                            <span style={styles.inputHint}>
                                                (defaults to center's barangay)
                                            </span>
                                        </label>
                                        <select
                                            value={originBarangayId}
                                            onChange={(e) => setOriginBarangayId(e.target.value)}
                                            style={styles.select}
                                        >
                                            <option value="">Unspecified / External</option>
                                            {barangays.map((b) => (
                                                <option key={b.id} value={b.id}>
                                                    {b.name} {String(b.id) === String(currentCenter?.barangay_id) ? "(Local)" : ""}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{
                                        ...styles.submitBtn,
                                        backgroundColor: logType === "arrival" ? "#10B981" : "#EF4444",
                                        opacity: submitting ? 0.7 : 1,
                                    }}
                                >
                                    {submitting ? (
                                        <span>Saving...</span>
                                    ) : (
                                        <>
                                            {logType === "arrival" ? (
                                                <>
                                                    <ArrowUpRight size={16} />
                                                    <span>Record Arrival (+{headcount || 1})</span>
                                                </>
                                            ) : (
                                                <>
                                                    <ArrowDownRight size={16} />
                                                    <span>Record Departure (-{headcount || 1})</span>
                                                </>
                                            )}
                                        </>
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Recent Activity List & Barangay Origin Summary */}
                    <div style={styles.rightCol}>
                        {/* Recent Activity List */}
                        <div style={styles.card}>
                            <div style={styles.cardHeader}>
                                <div>
                                    <div style={styles.cardOverline}>Audit Trail</div>
                                    <h3 style={styles.cardTitle}>Recent Activity</h3>
                                </div>
                                <span style={styles.logCountBadge}>{logs.length} logged</span>
                            </div>

                            {logs.length === 0 ? (
                                <div style={styles.emptyLogs}>
                                    <Clock size={28} style={{ color: "#d1d5db", marginBottom: 8 }} />
                                    <p style={{ margin: 0, color: "#9ca3af", fontSize: 13 }}>
                                        No arrival or departure logs recorded for this center yet.
                                    </p>
                                </div>
                            ) : (
                                <div style={styles.logsList}>
                                    {logs.map((log, index) => {
                                        const isLatest = index === 0
                                        const isArrival = log.type === "arrival"
                                        const isDifferentOrigin =
                                            log.origin_barangay_id &&
                                            String(log.origin_barangay_id) !== String(currentCenter?.barangay_id)

                                        const formattedTime = log.created_at
                                            ? new Date(log.created_at).toLocaleString([], {
                                                  month: "short",
                                                  day: "numeric",
                                                  hour: "2-digit",
                                                  minute: "2-digit",
                                              })
                                            : "Just now"

                                        return (
                                            <div
                                                key={log.id}
                                                style={{
                                                    ...styles.logItem,
                                                    background: isLatest ? "#f8fafc" : "#fff",
                                                    borderLeft: isLatest
                                                        ? "3px solid #1a237e"
                                                        : "3px solid transparent",
                                                }}
                                            >
                                                <div style={styles.logLeft}>
                                                    <span
                                                        style={{
                                                            ...styles.typePill,
                                                            background: isArrival ? "#e1f5ee" : "#fcebeb",
                                                            color: isArrival ? "#085041" : "#a32d2d",
                                                        }}
                                                    >
                                                        {isArrival ? "+ Arrival" : "- Departure"}
                                                    </span>
                                                    <span style={styles.headcountBadge}>
                                                        {log.headcount} evacuee{log.headcount !== 1 ? "s" : ""}
                                                    </span>
                                                </div>

                                                <div style={styles.logCenter}>
                                                    <div style={styles.originText}>
                                                        <span>Origin: </span>
                                                        <strong>
                                                            {log.origin_barangay?.name || "Local / Center Barangay"}
                                                        </strong>
                                                        {isDifferentOrigin && (
                                                            <span style={styles.externalTag} title="Evacuees originated from a neighboring barangay">
                                                                Transferred / External
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={styles.timeText}>
                                                        <Clock size={11} style={{ marginRight: 4, display: "inline" }} />
                                                        {formattedTime}
                                                        {log.admin?.name && ` · recorded by ${log.admin.name}`}
                                                    </div>
                                                </div>

                                                {/* Undo Button on Latest Entry Only */}
                                                {isLatest && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUndoLatest(log.id)}
                                                        disabled={undoing}
                                                        style={styles.undoBtn}
                                                        title="Undo this most recent log entry (correct typo)"
                                                    >
                                                        <RotateCcw size={13} />
                                                        <span>Undo</span>
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Arrivals by Origin Barangay Summary */}
                        <div style={styles.card}>
                            <div style={styles.cardHeader}>
                                <div>
                                    <div style={styles.cardOverline}>Barangay Overview</div>
                                    <h3 style={styles.cardTitle}>
                                        Arrivals by Origin in {currentBarangay?.name || "Barangay"}
                                    </h3>
                                </div>
                            </div>

                            {(!evacueesSummary?.arrivals_by_origin || evacueesSummary.arrivals_by_origin.length === 0) ? (
                                <div style={styles.emptyLogs}>
                                    <p style={{ margin: 0, color: "#9ca3af", fontSize: 13 }}>
                                        No arrivals recorded across centers in this barangay yet.
                                    </p>
                                </div>
                            ) : (
                                <div style={styles.originsList}>
                                    {evacueesSummary.arrivals_by_origin.map((item, idx) => (
                                        <div key={idx} style={styles.originRow}>
                                            <div style={styles.originRowLeft}>
                                                <MapPin size={14} style={{ color: "#6366f1" }} />
                                                <span style={styles.originName}>
                                                    {item.origin_barangay_name || "Unspecified"}
                                                </span>
                                            </div>
                                            <div style={styles.originCountBadge}>
                                                {item.headcount ?? item.total_arrivals} arrived
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </AdminLayout>
    )
}

const styles = {
    topBar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        background: "#fff",
        padding: "16px 20px",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        marginBottom: 24,
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
    },
    selectorGroup: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
        flex: 1,
    },
    filterBox: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 220,
    },
    filterLabel: {
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        color: "#475569",
    },
    select: {
        padding: "9px 12px",
        borderRadius: 8,
        border: "1px solid #cbd5e1",
        background: "#fff",
        fontSize: 13,
        color: "#1e293b",
        outline: "none",
        cursor: "pointer",
        minWidth: 200,
    },
    refreshGroup: {
        display: "flex",
        alignItems: "center",
        gap: 12,
    },
    autoRefreshPill: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "#64748b",
        background: "#f1f5f9",
        padding: "5px 10px",
        borderRadius: 20,
        fontWeight: 500,
    },
    pulsingDot: {
        width: 7,
        height: 7,
        borderRadius: "50%",
        backgroundColor: "#10B981",
        display: "inline-block",
    },
    lastUpdatedText: {
        fontSize: 11,
        color: "#94a3b8",
    },
    refreshBtn: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        background: "#f8fafc",
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        color: "#1e293b",
        cursor: "pointer",
        transition: "all 0.15s ease",
    },
    emptyPrompt: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        textAlign: "center",
    },
    mainGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 24,
        alignItems: "start",
    },
    leftCol: {
        display: "flex",
        flexDirection: "column",
        gap: 24,
    },
    rightCol: {
        display: "flex",
        flexDirection: "column",
        gap: 24,
    },
    card: {
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        padding: "20px 24px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
    },
    cardHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 16,
    },
    cardOverline: {
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: "#64748b",
        marginBottom: 2,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: 700,
        color: "#0f172a",
        margin: 0,
    },
    cardSub: {
        fontSize: 12,
        color: "#64748b",
        marginTop: 4,
    },
    statusBadge: {
        padding: "4px 12px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.3,
    },
    statsRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        padding: "16px 0",
        borderTop: "1px solid #f1f5f9",
        borderBottom: "1px solid #f1f5f9",
        marginBottom: 16,
    },
    statBox: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    statBoxRight: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
    },
    statLabel: {
        fontSize: 11,
        fontWeight: 600,
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: 0.4,
    },
    statBig: {
        fontSize: 28,
        fontWeight: 800,
        lineHeight: 1,
    },
    statCapacity: {
        fontSize: 18,
        fontWeight: 600,
        color: "#94a3b8",
    },
    freeSpacePill: {
        display: "flex",
        alignItems: "center",
        background: "#e1f5ee",
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid #a7f3d0",
    },
    progressContainer: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
    },
    progressLabels: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        fontWeight: 600,
        color: "#475569",
    },
    progressBarTrack: {
        width: "100%",
        height: 10,
        background: "#e2e8f0",
        borderRadius: 6,
        overflow: "hidden",
    },
    progressBarFill: {
        height: "100%",
        borderRadius: 6,
        transition: "width 0.4s ease, background-color 0.4s ease",
    },
    thresholdMarkers: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 10,
        color: "#94a3b8",
        fontWeight: 500,
    },
    formTitle: {
        fontSize: 16,
        fontWeight: 700,
        color: "#0f172a",
        margin: 0,
    },
    form: {
        display: "flex",
        flexDirection: "column",
        gap: 16,
    },
    field: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
    },
    formRow: {
        display: "flex",
        gap: 14,
    },
    inputLabel: {
        fontSize: 12,
        fontWeight: 600,
        color: "#334155",
    },
    inputHint: {
        fontSize: 11,
        fontWeight: 400,
        color: "#94a3b8",
        marginLeft: 4,
    },
    input: {
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #cbd5e1",
        fontSize: 14,
        color: "#1e293b",
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
    },
    toggleGroup: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        background: "#f1f5f9",
        padding: 4,
        borderRadius: 10,
    },
    toggleBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: "#64748b",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
    },
    toggleBtnArrivalActive: {
        background: "#10B981",
        color: "#fff",
        boxShadow: "0 2px 8px rgba(16, 185, 129, 0.25)",
    },
    toggleBtnDepartureActive: {
        background: "#EF4444",
        color: "#fff",
        boxShadow: "0 2px 8px rgba(239, 68, 68, 0.25)",
    },
    submitBtn: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "12px 20px",
        borderRadius: 8,
        border: "none",
        color: "#fff",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        transition: "opacity 0.2s ease, transform 0.1s ease",
        marginTop: 4,
    },
    alertSuccess: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#e1f5ee",
        color: "#085041",
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        marginBottom: 12,
        border: "1px solid #a7f3d0",
    },
    alertError: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fcebeb",
        color: "#a32d2d",
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        marginBottom: 12,
        border: "1px solid #fca5a5",
    },
    logCountBadge: {
        fontSize: 11,
        color: "#64748b",
        background: "#f1f5f9",
        padding: "4px 8px",
        borderRadius: 12,
        fontWeight: 600,
    },
    emptyLogs: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "36px 16px",
        textAlign: "center",
    },
    logsList: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxHeight: 380,
        overflowY: "auto",
        paddingRight: 4,
    },
    logItem: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid #e2e8f0",
        transition: "background 0.15s ease",
    },
    logLeft: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 100,
    },
    typePill: {
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 700,
        width: "fit-content",
    },
    headcountBadge: {
        fontSize: 13,
        fontWeight: 700,
        color: "#1e293b",
    },
    logCenter: {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        flex: 1,
    },
    originText: {
        fontSize: 12,
        color: "#334155",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
    },
    externalTag: {
        background: "#fef3c7",
        color: "#b45309",
        border: "1px solid #fcd34d",
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 10,
        fontWeight: 600,
    },
    timeText: {
        fontSize: 11,
        color: "#94a3b8",
    },
    undoBtn: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#fff",
        border: "1px solid #cbd5e1",
        borderRadius: 6,
        padding: "6px 10px",
        fontSize: 11,
        fontWeight: 600,
        color: "#dc2626",
        cursor: "pointer",
        transition: "all 0.15s ease",
        whiteSpace: "nowrap",
    },
    originsList: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    originRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        background: "#f8fafc",
        borderRadius: 8,
        border: "1px solid #f1f5f9",
    },
    originRowLeft: {
        display: "flex",
        alignItems: "center",
        gap: 8,
    },
    originName: {
        fontSize: 13,
        fontWeight: 600,
        color: "#1e293b",
    },
    originCountBadge: {
        fontSize: 12,
        fontWeight: 700,
        color: "#4f46e5",
        background: "#eef2ff",
        padding: "3px 8px",
        borderRadius: 6,
    },
}
