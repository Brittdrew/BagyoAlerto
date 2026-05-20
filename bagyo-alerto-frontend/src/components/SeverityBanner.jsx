import { Info, AlertTriangle } from "lucide-react"

export default function SeverityBanner({ severity, message }) {
    const config = {
        low:      { color: '#28a745', bg: '#f0fff4', icon: <Info size={36} style={{ color: '#28a745' }} />, label: 'LOW',      signal: 'Signal #1' },
        moderate: { color: '#ffc107', bg: '#fffdf0', icon: <AlertTriangle size={36} style={{ color: '#ffc107' }} />, label: 'MODERATE', signal: 'Signal #2' },
        high:     { color: '#fd7e14', bg: '#fff8f0', icon: <AlertTriangle size={36} style={{ color: '#fd7e14' }} />, label: 'HIGH',     signal: 'Signal #3' },
        critical: { color: '#dc3545', bg: '#fff0f0', icon: <AlertTriangle size={36} style={{ color: '#dc3545' }} />, label: 'CRITICAL', signal: 'Signal #4–5' },
    }

    const current = config[severity] || config.low

    return (
        <div style={{
            ...styles.banner,
            background: current.bg,
            borderColor: current.color,
        }}>
            <div style={styles.top}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {current.icon}
                </div>
                <div>
                    <p style={styles.label}>SEVERITY LEVEL</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h2 style={{ ...styles.level, color: current.color }}>
                            {current.label}
                        </h2>
                        <span style={{ 
                            fontSize: '0.8rem', 
                            background: current.color, 
                            color: 'white',
                            padding: '4px 12px', 
                            borderRadius: '20px', 
                            fontWeight: '700' 
                        }}>
                            PAGASA {current.signal}
                        </span>
                    </div>
                </div>
            </div>
            <p style={{ ...styles.message, color: current.color }}>
                {message}
            </p>
        </div>
    )
}

const styles = {
    banner: {
        padding: '24px',
        borderRadius: '16px',
        borderLeft: '8px solid',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        marginBottom: '16px',
    },
    top: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        marginBottom: '12px',
    },
    label: {
        fontSize: '0.75rem',
        fontWeight: '600',
        color: '#888',
        letterSpacing: '2px',
    },
    level: {
        fontSize: '2rem',
        fontWeight: 'bold',
    },
    message: {
        fontSize: '1rem',
        fontWeight: '500',
    }
}