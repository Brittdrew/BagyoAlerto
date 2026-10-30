import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Tornado, BarChart2, Clock, CloudSun, Layers, Menu, X } from 'lucide-react'

export default function Sidebar({ children, activePage }) {
    const navigate = useNavigate()
    const location = useLocation()
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)

    // Close drawer on Escape key press
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsDrawerOpen(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    const navItems = [
        { id: 'dashboard', icon: <BarChart2 size={14} />, label: 'Dashboard', path: '/' },
        { id: 'map', icon: <Layers size={14} />, label: 'Weather Map', path: '/map' },
        { id: 'forecast', icon: <CloudSun size={14} />, label: 'Forecast', path: '/forecast' },
        { id: 'history', icon: <Clock size={14} />, label: 'History', path: '/history' },
    ]

    return (
        <>
            {/* ── Mobile Top Bar (under 768px) ── */}
            <header className="bakwit-mobile-topbar" style={styles.mobileTopbar}>
                <div style={styles.mobileTopbarLeft}>
                    <button
                        type="button"
                        aria-label="Open navigation menu"
                        onClick={() => setIsDrawerOpen(true)}
                        style={styles.hamburgerBtn}
                    >
                        <Menu size={22} />
                    </button>
                    <div style={styles.mobileBrand}>
                        <Tornado size={18} style={{ color: '#1a237e', animation: 'spin 10s linear infinite' }} />
                        <span style={styles.mobileBrandText}>Bakwit</span>
                    </div>
                </div>
            </header>

            {/* ── Mobile Slide-Over Drawer & Backdrop ── */}
            {isDrawerOpen && (
                <div
                    className="bakwit-drawer-backdrop"
                    style={styles.backdrop}
                    onClick={() => setIsDrawerOpen(false)}
                />
            )}

            <aside
                className="bakwit-mobile-drawer"
                style={{
                    ...styles.drawer,
                    transform: isDrawerOpen ? 'translateX(0)' : 'translateX(-100%)',
                }}
                aria-hidden={!isDrawerOpen}
            >
                <div style={styles.drawerHeader}>
                    <div style={styles.sidebarLogo}>
                        <Tornado size={20} style={{ color: '#1a237e', animation: 'spin 10s linear infinite' }} />
                        <div>
                            <div style={styles.sidebarTitle}>Bakwit</div>
                            <div style={styles.sidebarSub}>Severity Assessment</div>
                        </div>
                    </div>
                    <button
                        type="button"
                        aria-label="Close navigation menu"
                        onClick={() => setIsDrawerOpen(false)}
                        style={styles.closeBtn}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div style={styles.navSection}>Main</div>
                {navItems.map(({ id, icon, label, path }) => {
                    const isActive = activePage === id || location.pathname === path
                    return (
                        <div
                            key={id}
                            className="bagyo-sidebar-item"
                            onClick={() => {
                                navigate(path)
                                setIsDrawerOpen(false)
                            }}
                            style={{
                                ...styles.sidebarItem,
                                background: isActive ? 'var(--accent)' : 'transparent',
                                color: isActive ? 'var(--accent-foreground)' : 'var(--muted-foreground)',
                                fontWeight: isActive ? 650 : 500,
                                cursor: 'pointer',
                                minHeight: 44,
                            }}
                        >
                            {icon}
                            <span>{label}</span>
                        </div>
                    )
                })}

                {children}
            </aside>

            {/* ── Desktop Sidebar (768px and above) ── */}
            <aside className="bakwit-desktop-sidebar" style={styles.sidebar}>
                <div style={styles.sidebarLogo}>
                    <Tornado size={20} style={{ color: '#1a237e', animation: 'spin 10s linear infinite' }} />
                    <div>
                        <div style={styles.sidebarTitle}>Bakwit</div>
                        <div style={styles.sidebarSub}>Severity Assessment</div>
                    </div>
                </div>

                <div style={styles.navSection}>Main</div>
                {navItems.map(({ id, icon, label, path }) => {
                    const isActive = activePage === id || location.pathname === path
                    return (
                        <div
                            key={id}
                            className="bagyo-sidebar-item"
                            onClick={() => navigate(path)}
                            style={{
                                ...styles.sidebarItem,
                                background: isActive ? 'var(--accent)' : 'transparent',
                                color: isActive ? 'var(--accent-foreground)' : 'var(--muted-foreground)',
                                fontWeight: isActive ? 650 : 500,
                                cursor: 'pointer',
                            }}
                        >
                            {icon}
                            <span>{label}</span>
                        </div>
                    )
                })}

                {children}
            </aside>
        </>
    )
}

const styles = {
    sidebar: {
        width: 256,
        minWidth: 256,
        background: 'var(--card)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
    },
    mobileTopbar: {
        height: 52,
        background: 'color-mix(in oklch, var(--card) 92%, transparent)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(12px)',
        width: '100%',
        boxSizing: 'border-box',
    },
    mobileTopbarLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
    },
    hamburgerBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        minWidth: 44,
        minHeight: 44,
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        color: '#1a237e',
        padding: 0,
    },
    mobileBrand: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
    },
    mobileBrandText: {
        fontSize: 16,
        fontWeight: 700,
        color: '#1a237e',
        letterSpacing: 0.3,
    },
    backdrop: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        zIndex: 1100,
        backdropFilter: 'blur(2px)',
    },
    drawer: {
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 280,
        maxWidth: '85vw',
        background: 'var(--card)',
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: 'none',
        borderRight: '1px solid var(--border)',
        overflowY: 'auto',
        transition: 'transform 0.25s ease-in-out',
    },
    drawerHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
    },
    closeBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        minWidth: 44,
        minHeight: 44,
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        color: '#666',
        padding: 0,
    },
    sidebarLogo: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '16px 18px 14px',
    },
    sidebarTitle: {
        fontSize: 14,
        fontWeight: 700,
        color: 'var(--primary)',
    },
    sidebarSub: {
        fontSize: 10,
        color: 'var(--muted-foreground)',
    },
    navSection: {
        fontSize: 10,
        color: 'var(--muted-foreground)',
        padding: '18px 20px 6px',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
    },
    sidebarItem: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        margin: '2px 12px',
        borderRadius: 10,
        fontSize: 13,
        transition: 'background 0.15s, color 0.15s',
    },
}
