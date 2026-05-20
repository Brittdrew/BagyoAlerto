import { useState, useEffect } from "react"
import axios from "axios"
import { MapPin, Wind, CloudRain, Gauge, Clock, Radio, Sun, CloudSun, Cloud, Snowflake, CloudLightning } from "lucide-react"

// Default: Surigao City center coordinates
const DEFAULT_LAT = 9.7843
const DEFAULT_LNG = 125.4887
const DEFAULT_LOCATION = "Surigao City"

// Auto-refresh every 10 minutes
const REFRESH_INTERVAL = 10 * 60 * 1000

export default function WeatherTicker({ latitude, longitude, locationName }) {
    const [weather, setWeather] = useState(null)
    const [time, setTime] = useState(new Date())

    const lat  = latitude  || DEFAULT_LAT
    const lng  = longitude || DEFAULT_LNG
    const name = locationName || DEFAULT_LOCATION

    const fetchWeather = async () => {
        try {
            const url =
                `https://api.open-meteo.com/v1/forecast` +
                `?latitude=${lat}&longitude=${lng}` +
                `&current=wind_speed_10m,precipitation,surface_pressure,temperature_2m,weathercode`
            const res = await axios.get(url)
            setWeather(res.data.current)
        } catch {
            console.error("WeatherTicker: failed to fetch weather")
        }
    }

    useEffect(() => {
        fetchWeather()
        const weatherTimer = setInterval(fetchWeather, REFRESH_INTERVAL)
        const clockTimer   = setInterval(() => setTime(new Date()), 1000)
        return () => {
            clearInterval(weatherTimer)
            clearInterval(clockTimer)
        }
    }, [lat, lng])

    const getWeatherIcon = (code) => {
        const style = { marginRight: '4px', verticalAlign: 'middle', display: 'inline-block' }
        if (code === 0) return <Sun size={14} style={{ ...style, color: '#ffb300' }} />
        if (code <= 3) return <CloudSun size={14} style={{ ...style, color: '#ffe082' }} />
        if (code <= 48) return <Cloud size={14} style={{ ...style, color: '#b0bec5' }} />
        if (code <= 67) return <CloudRain size={14} style={{ ...style, color: '#64b5f6' }} />
        if (code <= 77) return <Snowflake size={14} style={{ ...style, color: '#e0f7fa' }} />
        if (code <= 82) return <CloudRain size={14} style={{ ...style, color: '#42a5f5' }} />
        if (code <= 99) return <CloudLightning size={14} style={{ ...style, color: '#ba68c8' }} />
        return <Gauge size={14} style={style} />
    }

    const formatTime = (d) =>
        d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

    const renderTickerContent = () => {
        if (!weather) {
            return (
                <div style={styles.tickerGroup}>
                    <span style={styles.tickerItem}>⏳ Fetching live weather data for {name}...</span>
                </div>
            )
        }

        return (
            <div style={styles.tickerGroup}>
                <span style={styles.tickerItem}>
                    <MapPin size={14} style={styles.inlineIcon} /> {name}
                </span>
                <span style={styles.divider}>|</span>
                <span style={styles.tickerItem}>
                    {getWeatherIcon(weather.weathercode)} {weather.temperature_2m}°C
                </span>
                <span style={styles.divider}>|</span>
                <span style={styles.tickerItem}>
                    <Wind size={14} style={styles.inlineIcon} /> Wind: {weather.wind_speed_10m} km/h
                </span>
                <span style={styles.divider}>|</span>
                <span style={styles.tickerItem}>
                    <CloudRain size={14} style={styles.inlineIcon} /> Rainfall: {weather.precipitation} mm/hr
                </span>
                <span style={styles.divider}>|</span>
                <span style={styles.tickerItem}>
                    <Gauge size={14} style={styles.inlineIcon} /> Pressure: {weather.surface_pressure} hPa
                </span>
                <span style={styles.divider}>|</span>
                <span style={styles.tickerItem}>
                    <Clock size={14} style={styles.inlineIcon} /> {formatTime(time)}
                </span>
                <span style={styles.divider}>|</span>
                <span style={styles.tickerItem}>
                    <Radio size={14} style={styles.inlineIcon} /> Live via Open-Meteo
                </span>
            </div>
        )
    }

    return (
        <div style={styles.wrapper}>
            {/* LIVE badge */}
            <span style={styles.liveBadge}>● LIVE</span>

            {/* Scrolling ticker */}
            <div style={styles.tickerWindow}>
                <div style={styles.tickerTrack}>
                    {renderTickerContent()}
                    {renderTickerContent()}
                </div>
            </div>
        </div>
    )
}

const styles = {
    wrapper: {
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        height: '36px',
        overflow: 'hidden',
        borderTop: '1px solid rgba(255,255,255,0.1)',
    },
    liveBadge: {
        flexShrink: 0,
        padding: '0 14px',
        color: '#00e676',
        fontWeight: '800',
        fontSize: '0.75rem',
        letterSpacing: '1.5px',
        borderRight: '1px solid rgba(255,255,255,0.15)',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        animation: 'pulse-live 2s ease-in-out infinite',
        background: 'rgba(0,200,83,0.08)',
    },
    tickerWindow: {
        flex: 1,
        overflow: 'hidden',
        position: 'relative',
    },
    tickerTrack: {
        display: 'flex',
        animation: 'ticker 35s linear infinite',
        whiteSpace: 'nowrap',
    },
    tickerGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        paddingLeft: '40px',
    },
    tickerItem: {
        color: 'rgba(255,255,255,0.88)',
        fontSize: '0.82rem',
        fontWeight: '500',
        letterSpacing: '0.3px',
        display: 'inline-flex',
        alignItems: 'center',
    },
    divider: {
        color: 'rgba(255,255,255,0.2)',
        margin: '0 20px',
        fontSize: '0.8rem',
    },
    inlineIcon: {
        marginRight: '6px',
        color: 'rgba(255,255,255,0.7)',
    },
}
