export default function Footer() {
    return (
        <footer style={styles.footer}>
            <p style={styles.text}>
                🌀 BagyoAlerto — Typhoon Severity Assessment System
            </p>
            <p style={styles.sub}>
                📍 Barangay Washington, Surigao City | © 2026 All Rights Reserved
            </p>
        </footer>
    )
}

const styles = {
    footer: {
        background: 'linear-gradient(135deg, #1a237e, #1565c0)',
        color: 'white',
        textAlign: 'center',
        padding: '24px',
        marginTop: '40px',
    },
    text: {
        fontSize: '1rem',
        fontWeight: 'bold',
        marginBottom: '6px',
    },
    sub: {
        fontSize: '0.85rem',
        opacity: 0.8,
    }
}