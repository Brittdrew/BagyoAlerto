const thresholds = {
    wind_speed:  { warn: 88,  danger: 118 },
    rainfall:    { warn: 15,  danger: 30  },
    pressure:    { warn: 990, danger: 970 },
}

export default function WeatherCard({ icon, label, value, unit, name, onChange }) {
    const t = thresholds[name]
    const num = parseFloat(value)
    
    // For pressure, lower = worse. For wind/rain, higher = worse.
    const isPressure = name === 'pressure'
    const isTemperature = name === 'temperature'
    
    const pct = isTemperature
        ? Math.min(100, Math.max(0, ((num - 20) / (45 - 20)) * 100))
        : (t ? (isPressure
            ? Math.min(100, Math.max(0, ((1020 - num) / (1020 - 940)) * 100))
            : Math.min(100, (num / (t.danger * 1.3)) * 100)) : 0)
        
    const barColor = isTemperature
        ? (num < 25 ? '#378ADD' : num <= 32 ? '#28a745' : '#dc3545')
        : (!t || !num ? '#ddd'
            : (isPressure ? num < t.danger : num > t.danger) ? '#dc3545'
            : (isPressure ? num < t.warn  : num > t.warn)  ? '#fd7e14'
            : '#28a745')

    return (
        <div style={styles.card}>
            <div style={styles.icon}>{icon}</div>
            <label style={styles.label}>{label}</label>
            <input
                style={styles.input}
                type="number"
                name={name}
                placeholder="Enter value"
                value={value}
                onChange={onChange}
            />
            <span style={styles.unit}>{unit}</span>
            {value && (
                <div style={{ width: '100%', height: '4px', background: '#eee', borderRadius: '2px', marginTop: '4px' }}>
                    <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: barColor,
                        borderRadius: '2px',
                        transition: 'width 0.4s ease-out, background 0.3s'
                    }} />
                </div>
            )}
        </div>
    )
}

const styles = {
    card: {
        background: 'white',
        padding: '20px',
        borderRadius: '16px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
    },
    icon: {
        fontSize: '2rem',
    },
    label: {
        fontSize: '0.85rem',
        fontWeight: '600',
        color: '#555',
    },
    input: {
        width: '100%',
        padding: '10px',
        borderRadius: '8px',
        border: '1px solid #ddd',
        fontSize: '1rem',
        textAlign: 'center',
        outline: 'none',
    },
    unit: {
        fontSize: '0.8rem',
        color: '#888',
    }
}