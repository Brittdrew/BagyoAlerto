import AdminSidebar from "./AdminSidebar"

export default function AdminLayout({ children, title }) {
    return (
        <div style={styles.root}>
            <AdminSidebar />
            <main style={styles.main}>
                {title && <h1 style={styles.pageTitle}>{title}</h1>}
                {children}
            </main>
        </div>
    )
}

const styles = {
    root: {
        display: "flex",
        minHeight: "100vh",
        background: "#f5f7fa",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
    },
    main: {
        flex: 1,
        padding: "28px 32px",
        overflowY: "auto",
        maxHeight: "100vh",
    },
    pageTitle: {
        fontSize: 22,
        fontWeight: 700,
        color: "#1a237e",
        margin: "0 0 24px",
    },
}
