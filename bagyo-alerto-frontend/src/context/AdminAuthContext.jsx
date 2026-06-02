import { createContext, useContext, useState, useEffect, useCallback } from "react"
import axios from "axios"

export const ADMIN_TOKEN_KEY = "admin_token"
const API_BASE = import.meta.env.VITE_API_BASE

const AdminAuthContext = createContext(null)

export function AdminAuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY))
    const [admin, setAdmin] = useState(null)
    const [authReady, setAuthReady] = useState(false)

    const getToken = useCallback(() => {
        return token || localStorage.getItem(ADMIN_TOKEN_KEY)
    }, [token])

    const login = (tokenValue, adminData) => {
        localStorage.setItem(ADMIN_TOKEN_KEY, tokenValue)
        setToken(tokenValue)
        setAdmin(adminData)
    }

    const logout = () => {
        localStorage.removeItem(ADMIN_TOKEN_KEY)
        setToken(null)
        setAdmin(null)
    }

    const authHeaders = useCallback(() => {
        const t = getToken()
        return {
            Authorization: `Bearer ${t}`,
            Accept: "application/json",
            "Content-Type": "application/json",
        }
    }, [getToken])

    // Restore admin profile when token exists in localStorage (e.g. after refresh)
    useEffect(() => {
        const stored = localStorage.getItem(ADMIN_TOKEN_KEY)
        if (!stored) {
            setAuthReady(true)
            return
        }
        if (!token) {
            setToken(stored)
        }
        if (admin) {
            setAuthReady(true)
            return
        }
        axios
            .get(`${API_BASE}/admin/me`, {
                headers: {
                    Authorization: `Bearer ${stored}`,
                    Accept: "application/json",
                },
            })
            .then((res) => setAdmin(res.data))
            .catch(() => {
                localStorage.removeItem(ADMIN_TOKEN_KEY)
                setToken(null)
                setAdmin(null)
            })
            .finally(() => setAuthReady(true))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const isAuthenticated = !!getToken()

    return (
        <AdminAuthContext.Provider
            value={{
                token,
                admin,
                login,
                logout,
                authHeaders,
                getToken,
                isAuthenticated,
                authReady,
            }}
        >
            {children}
        </AdminAuthContext.Provider>
    )
}

export function useAdminAuth() {
    const ctx = useContext(AdminAuthContext)
    if (!ctx) {
        throw new Error("useAdminAuth must be used within AdminAuthProvider")
    }
    return ctx
}
