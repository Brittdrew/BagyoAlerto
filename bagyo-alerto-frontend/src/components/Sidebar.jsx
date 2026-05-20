import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Tornado, BarChart2, Clock, CloudSun } from 'lucide-react'

export default function Sidebar({ children, activePage }) {
    const navigate = useNavigate()
    const location = useLocation()

    const navItems = [
        { id: 'dashboard', icon: <BarChart2 size={14} />, label: 'Dashboard', path: '/' },
        { id: 'forecast', icon: <CloudSun size={14} />, label: 'Forecast', path: '/forecast' },
        { id: 'history', icon: <Clock size={14} />, label: 'History', path: '/history' },
    ]

    return (
        <aside style={styles.sidebar}>
            <div style={styles.sidebarLogo}>
                <Tornado size={20} style={{ color: '#1a237e', animation: 'spin 10s linear infinite' }} />
                <div>
                    <div style={styles.sidebarTitle}>BagyoAlerto</div>
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
                            background: isActive ? '#f0f4ff' : 'transparent',
                            color: isActive ? '#1a237e' : '#555',
                            fontWeight: isActive ? 600 : 500,
                            cursor: 'pointer',
                            borderLeft: isActive ? '3px solid #1a237e' : '3px solid transparent',
                            paddingLeft: isActive ? 11 : 14,
                        }}
                    >
                        {icon}
                        <span>{label}</span>
                    </div>
                )
            })}

            {children}
        </aside>
    )
}

const styles = {
    sidebar: {
        width: 220,
        minWidth: 220,
        background: 'white',
        borderRight: '0.5px solid #e8ecf0',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
    },
    sidebarLogo: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '16px 14px 12px',
        borderBottom: '0.5px solid #f0f0f0',
    },
    sidebarTitle: {
        fontSize: 14,
        fontWeight: 700,
        color: '#1a237e',
    },
    sidebarSub: {
        fontSize: 10,
        color: '#888',
    },
    navSection: {
        fontSize: 10,
        color: '#bbb',
        padding: '12px 14px 4px',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
    },
    sidebarItem: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 14px',
        fontSize: 13,
        transition: 'background 0.15s, color 0.15s',
    },
}
