import { createContext, useContext, useState, useCallback, useRef } from "react"
import axios from "axios"
import { useAdminAuth } from "./AdminAuthContext"

const API_BASE = import.meta.env.VITE_API_BASE

const AdminListsContext = createContext(null)

/**
 * AdminListsProvider
 *
 * Loads /api/barangays and /api/evacuation-centers exactly once per session
 * (or until explicitly refreshed). Any component that needs these lists
 * reads them from this context instead of fetching independently.
 *
 * Call `refreshBarangays()` or `refreshCenters()` after a create/edit/delete
 * to get fresh data from the server.
 */
export function AdminListsProvider({ children }) {
    const { authHeaders } = useAdminAuth()

    const [barangays, setBarangays] = useState([])
    const [barangaysLoading, setBarangaysLoading] = useState(false)
    const [barangaysLoaded, setBarangaysLoaded] = useState(false)

    const [centers, setCenters] = useState([])
    const [centersLoading, setCentersLoading] = useState(false)
    const [centersLoaded, setCentersLoaded] = useState(false)

    // Prevent concurrent fetches
    const barangaysFetching = useRef(false)
    const centersFetching   = useRef(false)

    const loadBarangays = useCallback(async (force = false) => {
        if (barangaysFetching.current) return
        if (barangaysLoaded && !force) return
        barangaysFetching.current = true
        setBarangaysLoading(true)
        try {
            // Public endpoint — no auth header needed
            const res = await axios.get(`${API_BASE}/barangays`)
            setBarangays(res.data || [])
            setBarangaysLoaded(true)
        } catch {
            // silently tolerate; caller can retry
        } finally {
            setBarangaysLoading(false)
            barangaysFetching.current = false
        }
    }, [barangaysLoaded])

    const refreshBarangays = useCallback(() => loadBarangays(true), [loadBarangays])

    const loadCenters = useCallback(async (force = false) => {
        if (centersFetching.current) return
        if (centersLoaded && !force) return
        centersFetching.current = true
        setCentersLoading(true)
        try {
            const res = await axios.get(`${API_BASE}/evacuation-centers`)
            setCenters(res.data || [])
            setCentersLoaded(true)
        } catch {
            // silently tolerate
        } finally {
            setCentersLoading(false)
            centersFetching.current = false
        }
    }, [centersLoaded])

    const refreshCenters = useCallback(() => loadCenters(true), [loadCenters])

    return (
        <AdminListsContext.Provider value={{
            barangays,
            barangaysLoading,
            barangaysLoaded,
            loadBarangays,
            refreshBarangays,

            centers,
            centersLoading,
            centersLoaded,
            loadCenters,
            refreshCenters,
        }}>
            {children}
        </AdminListsContext.Provider>
    )
}

export function useAdminLists() {
    const ctx = useContext(AdminListsContext)
    if (!ctx) throw new Error("useAdminLists must be used within AdminListsProvider")
    return ctx
}
