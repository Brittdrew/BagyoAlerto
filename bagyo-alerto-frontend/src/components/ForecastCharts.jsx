import { useEffect, useState, useRef, useMemo } from "react"
import axios from "axios"

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Wind direction helper
const getWindDirection = (degrees) => {
    if (!degrees) return "↑"
    const dirs = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"]
    const index = Math.round(degrees / 45) % 8
    return dirs[index]
}

export default function ForecastCharts({ selectedBarangay }) {
    const [hourlyData, setHourlyData] = useState(null)
    const [loadingHourly, setLoadingHourly] = useState(false)
    const [chartTab, setChartTab] = useState("overview")
    const [selectedDayIndex, setSelectedDayIndex] = useState(0)
    const [showWindGusts, setShowWindGusts] = useState(true)

    const chartOverviewRef = useRef(null)
    const chartPrecipRef = useRef(null)
    const chartWindRef = useRef(null)
    const chartHumidityRef = useRef(null)

    const chartInstancesRef = useRef({
        overview: null,
        precip: null,
        wind: null,
        humidity: null,
    })

    // Fetch hourly data
    useEffect(() => {
        if (!selectedBarangay) return

        setLoadingHourly(true)
        const lat = Number(selectedBarangay.latitude)
        const lng = Number(selectedBarangay.longitude)

        axios.get(
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat}&longitude=${lng}` +
            `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,windgusts_10m,wind_direction_10m,relative_humidity_2m` +
            `&wind_speed_unit=kmh&timezone=Asia%2FManila&forecast_days=2`
        ).then(res => {
            const data = res.data
            setHourlyData(data.hourly)
            setSelectedDayIndex(0)
            setLoadingHourly(false)
        }).catch(err => {
            console.error("Failed to fetch hourly data:", err)
            setLoadingHourly(false)
        })
    }, [selectedBarangay])

    // Get 24-hour slice for selected day
    const get24HourSlice = (dayIndex) => {
        if (!hourlyData) return null

        const now = new Date()
        const startOfDay = new Date(now)
        startOfDay.setHours(0, 0, 0, 0)

        const dayStart = new Date(startOfDay)
        dayStart.setDate(dayStart.getDate() + dayIndex)

        const dayEnd = new Date(dayStart)
        dayEnd.setDate(dayEnd.getDate() + 1)

        const times = hourlyData.time.map(t => new Date(t))
        const relevantIndices = times
            .map((t, idx) => (t >= dayStart && t < dayEnd) ? idx : -1)
            .filter(idx => idx !== -1)

        if (relevantIndices.length === 0) return null

        const startIdx = relevantIndices[0]
        const endIdx = relevantIndices[relevantIndices.length - 1] + 1

        return {
            times: hourlyData.time.slice(startIdx, endIdx),
            temp: hourlyData.temperature_2m.slice(startIdx, endIdx),
            precip: hourlyData.precipitation_probability.slice(startIdx, endIdx),
            windSpeed: hourlyData.wind_speed_10m.slice(startIdx, endIdx),
            windGusts: hourlyData.windgusts_10m.slice(startIdx, endIdx),
            windDir: hourlyData.wind_direction_10m.slice(startIdx, endIdx),
            humidity: hourlyData.relative_humidity_2m.slice(startIdx, endIdx),
        }
    }

    const chartData = useMemo(() => get24HourSlice(selectedDayIndex), [hourlyData, selectedDayIndex])

    // Get available days
    const availableDays = useMemo(() => {
        if (!hourlyData) return []

        const now = new Date()
        const days = []

        for (let i = -1; i < 2; i++) {
            const date = new Date(now)
            date.setDate(date.getDate() + i)
            date.setHours(0, 0, 0, 0)

            const times = hourlyData.time.map(t => new Date(t))
            const hasData = times.some(t => {
                const tDate = new Date(t)
                tDate.setHours(0, 0, 0, 0)
                return tDate.getTime() === date.getTime()
            })

            if (hasData) {
                days.push({
                    date,
                    label: i === 0 ? "Today" : i === -1 ? "Yesterday" : DAYS_SHORT[date.getDay()],
                    dateStr: date.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
                })
            }
        }

        return days
    }, [hourlyData])

    // Render Overview Chart
    useEffect(() => {
        if (!chartData || chartTab !== "overview" || !chartOverviewRef.current) return

        if (chartInstancesRef.current.overview) chartInstancesRef.current.overview.destroy()

        const ctx = chartOverviewRef.current.getContext("2d")
        const labels = chartData.times.map(t => {
            const d = new Date(t)
            return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })
        })

        const gradient = ctx.createLinearGradient(0, 0, 0, 280)
        gradient.addColorStop(0, "rgba(79, 195, 247, 0.3)")
        gradient.addColorStop(1, "rgba(79, 195, 247, 0)")

        chartInstancesRef.current.overview = new window.Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Temperature (°C)",
                    data: chartData.temp,
                    borderColor: "#4fc3f7",
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    backgroundColor: gradient,
                    pointBackgroundColor: "#4fc3f7",
                    pointRadius: 5,
                    pointHoverRadius: 7,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.parsed.y.toFixed(1)} °C`
                        },
                        backgroundColor: "rgba(0,0,0,0.8)",
                        titleColor: "#fff",
                        bodyColor: "#4fc3f7",
                    }
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255,255,255,0.1)" },
                        ticks: { font: { size: 11 }, color: "#ccc" }
                    },
                    y: {
                        grid: { color: "rgba(255,255,255,0.1)" },
                        ticks: {
                            font: { size: 11 },
                            color: "#ccc",
                            callback: (val) => `${val}°C`
                        }
                    }
                }
            }
        })

        return () => {
            if (chartInstancesRef.current.overview) chartInstancesRef.current.overview.destroy()
        }
    }, [chartData, chartTab])

    // Render Precipitation Chart
    useEffect(() => {
        if (!chartData || chartTab !== "precip" || !chartPrecipRef.current) return

        if (chartInstancesRef.current.precip) chartInstancesRef.current.precip.destroy()

        const ctx = chartPrecipRef.current.getContext("2d")
        const labels = chartData.times.map(t => {
            const d = new Date(t)
            return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })
        })

        chartInstancesRef.current.precip = new window.Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label: "Precipitation Probability (%)",
                    data: chartData.precip,
                    backgroundColor: "rgba(79, 195, 247, 0.7)",
                    borderColor: "#4fc3f7",
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.parsed.y}%`
                        },
                        backgroundColor: "rgba(0,0,0,0.8)",
                        bodyColor: "#4fc3f7",
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 }, color: "#ccc" }
                    },
                    y: {
                        grid: { color: "rgba(255,255,255,0.1)" },
                        ticks: {
                            font: { size: 11 },
                            color: "#ccc",
                            callback: (val) => `${val}%`
                        },
                        max: 100
                    }
                }
            }
        })

        return () => {
            if (chartInstancesRef.current.precip) chartInstancesRef.current.precip.destroy()
        }
    }, [chartData, chartTab])

    // Render Wind Chart
    useEffect(() => {
        if (!chartData || chartTab !== "wind" || !chartWindRef.current) return

        if (chartInstancesRef.current.wind) chartInstancesRef.current.wind.destroy()

        const ctx = chartWindRef.current.getContext("2d")
        const labels = chartData.times.map(t => {
            const d = new Date(t)
            return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })
        })

        const gradient = ctx.createLinearGradient(0, 0, 0, 280)
        gradient.addColorStop(0, "rgba(79, 195, 247, 0.3)")
        gradient.addColorStop(1, "rgba(79, 195, 247, 0)")

        const datasets = [{
            label: "Wind Speed (km/h)",
            data: chartData.windSpeed,
            borderColor: "#4fc3f7",
            borderWidth: 3,
            tension: 0.4,
            fill: true,
            backgroundColor: gradient,
            pointBackgroundColor: "#4fc3f7",
            pointRadius: 5,
            pointHoverRadius: 7,
        }]

        if (showWindGusts) {
            datasets.push({
                label: "Wind Gusts (km/h)",
                data: chartData.windGusts,
                borderColor: "#ffb300",
                borderWidth: 2,
                borderDash: [5, 5],
                tension: 0.4,
                fill: false,
                pointBackgroundColor: "#ffb300",
                pointRadius: 4,
                pointHoverRadius: 6,
            })
        }

        chartInstancesRef.current.wind = new window.Chart(ctx, {
            type: "line",
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, labels: { color: "#ccc", font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)} km/h`
                        },
                        backgroundColor: "rgba(0,0,0,0.8)",
                        bodyColor: "#4fc3f7",
                    }
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255,255,255,0.1)" },
                        ticks: { font: { size: 11 }, color: "#ccc" }
                    },
                    y: {
                        grid: { color: "rgba(255,255,255,0.1)" },
                        ticks: {
                            font: { size: 11 },
                            color: "#ccc",
                            callback: (val) => `${val} km/h`
                        }
                    }
                }
            }
        })

        return () => {
            if (chartInstancesRef.current.wind) chartInstancesRef.current.wind.destroy()
        }
    }, [chartData, chartTab, showWindGusts])

    // Render Humidity Chart
    useEffect(() => {
        if (!chartData || chartTab !== "humidity" || !chartHumidityRef.current) return

        if (chartInstancesRef.current.humidity) chartInstancesRef.current.humidity.destroy()

        const ctx = chartHumidityRef.current.getContext("2d")
        const labels = chartData.times.map(t => {
            const d = new Date(t)
            return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", hour12: true })
        })

        const gradient = ctx.createLinearGradient(0, 0, 0, 280)
        gradient.addColorStop(0, "rgba(102, 187, 106, 0.3)")
        gradient.addColorStop(1, "rgba(102, 187, 106, 0)")

        chartInstancesRef.current.humidity = new window.Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [{
                    label: "Humidity (%)",
                    data: chartData.humidity,
                    borderColor: "#66bb6a",
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    backgroundColor: gradient,
                    pointBackgroundColor: "#66bb6a",
                    pointRadius: 5,
                    pointHoverRadius: 7,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.parsed.y}%`
                        },
                        backgroundColor: "rgba(0,0,0,0.8)",
                        bodyColor: "#66bb6a",
                    }
                },
                scales: {
                    x: {
                        grid: { color: "rgba(255,255,255,0.1)" },
                        ticks: { font: { size: 11 }, color: "#ccc" }
                    },
                    y: {
                        grid: { color: "rgba(255,255,255,0.1)" },
                        ticks: {
                            font: { size: 11 },
                            color: "#ccc",
                            callback: (val) => `${val}%`
                        },
                        max: 100
                    }
                }
            }
        })

        return () => {
            if (chartInstancesRef.current.humidity) chartInstancesRef.current.humidity.destroy()
        }
    }, [chartData, chartTab])

    if (loadingHourly) {
        return (
            <div style={styles.loadingBox}>
                <div style={{ fontSize: 13, color: "#888" }}>Loading hourly forecast data...</div>
            </div>
        )
    }

    if (!chartData) {
        return (
            <div style={styles.loadingBox}>
                <div style={{ fontSize: 13, color: "#888" }}>No hourly data available</div>
            </div>
        )
    }

    return (
        <div style={styles.container}>
            {/* Day Selector Row */}
            <div style={styles.dayRow}>
                {availableDays.map((day, idx) => {
                    const avgWind = chartData.windSpeed.reduce((a, b) => a + b, 0) / chartData.windSpeed.length
                    const maxGust = Math.max(...chartData.windGusts)

                    return (
                        <div
                            key={idx}
                            onClick={() => setSelectedDayIndex(idx)}
                            style={{
                                ...styles.dayCard,
                                ...(selectedDayIndex === idx ? styles.dayCardActive : {}),
                            }}
                        >
                            <div style={styles.dayLabel}>{day.label}</div>
                            <div style={styles.dayDate}>{day.dateStr}</div>
                            <div style={styles.dayWind}>{Math.round(avgWind)} km/h</div>
                            <div style={styles.dayGust}>{Math.round(maxGust)} km/h gusts</div>
                        </div>
                    )
                })}
            </div>

            {/* Chart Tabs */}
            <div style={styles.tabsRow}>
                {[
                    { id: "overview", label: "Overview" },
                    { id: "precip", label: "Precipitation" },
                    { id: "wind", label: "Wind" },
                    { id: "humidity", label: "Humidity" },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setChartTab(tab.id)}
                        style={{
                            ...styles.chartTab,
                            ...(chartTab === tab.id ? styles.chartTabActive : {}),
                        }}
                    >
                        {tab.label}
                    </button>
                ))}

                {/* Wind Gust Toggle */}
                {chartTab === "wind" && (
                    <div style={styles.gustToggle}>
                        <label style={styles.gustLabel}>
                            <input
                                type="checkbox"
                                checked={showWindGusts}
                                onChange={(e) => setShowWindGusts(e.target.checked)}
                                style={{ marginRight: 6 }}
                            />
                            Wind Gusts
                        </label>
                    </div>
                )}
            </div>

            {/* Charts */}
            <div style={styles.chartContainer}>
                {chartTab === "overview" && <canvas ref={chartOverviewRef} />}
                {chartTab === "precip" && <canvas ref={chartPrecipRef} />}
                {chartTab === "wind" && <canvas ref={chartWindRef} />}
                {chartTab === "humidity" && <canvas ref={chartHumidityRef} />}
            </div>
        </div>
    )
}

const styles = {
    container: {
        background: "#1a2a6c",
        borderRadius: 12,
        padding: 16,
        color: "white",
    },
    loadingBox: {
        padding: 40,
        textAlign: "center",
        color: "#aaa",
        background: "#1a2a6c",
        borderRadius: 12,
    },
    dayRow: {
        display: "flex",
        gap: 10,
        overflowX: "auto",
        marginBottom: 16,
        paddingBottom: 8,
        scrollBehavior: "smooth",
        WebkitOverflowScrolling: "touch",
    },
    dayCard: {
        flex: "0 0 auto",
        minWidth: 120,
        padding: 12,
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(255,255,255,0.05)",
        cursor: "pointer",
        transition: "all 0.2s",
        textAlign: "center",
    },
    dayCardActive: {
        background: "#185FA5",
        borderColor: "#185FA5",
    },
    dayLabel: {
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 4,
    },
    dayDate: {
        fontSize: 11,
        color: "rgba(255,255,255,0.7)",
        marginBottom: 6,
    },
    dayWind: {
        fontSize: 13,
        fontWeight: 700,
        color: "#4fc3f7",
        marginBottom: 2,
    },
    dayGust: {
        fontSize: 10,
        color: "rgba(255,255,255,0.6)",
    },
    tabsRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 16,
        flexWrap: "wrap",
    },
    chartTab: {
        padding: "6px 14px",
        borderRadius: 6,
        border: "0.5px solid rgba(255,255,255,0.3)",
        background: "transparent",
        color: "rgba(255,255,255,0.7)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s",
    },
    chartTabActive: {
        background: "#185FA5",
        borderColor: "#185FA5",
        color: "white",
    },
    gustToggle: {
        marginLeft: "auto",
    },
    gustLabel: {
        display: "flex",
        alignItems: "center",
        fontSize: 12,
        color: "rgba(255,255,255,0.8)",
        cursor: "pointer",
        userSelect: "none",
    },
    chartContainer: {
        height: 280,
        position: "relative",
    },
}
