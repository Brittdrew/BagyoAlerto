import { Navigate } from "react-router-dom"
import { useAdminAuth, ADMIN_TOKEN_KEY } from "../context/AdminAuthContext"

export default function AdminProtectedRoute({ children }) {
    const { isAuthenticated, authReady } = useAdminAuth()

    const storedToken = localStorage.getItem(ADMIN_TOKEN_KEY)
    const hasToken = isAuthenticated || !!storedToken

    if (!authReady) {
        return (
            <div style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#f5f7fa",
                color: "#1a237e",
                fontSize: 14,
            }}>
                Loading...
            </div>
        )
    }

    if (!hasToken) {
        return <Navigate to="/admin/login" replace />
    }

    return children
}
