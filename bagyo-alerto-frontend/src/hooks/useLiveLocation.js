import { useState, useEffect } from "react"

/**
 * Hook to watch the user's live geolocation using navigator.geolocation.watchPosition.
 *
 * @param {boolean|{ enabled?: boolean }} optionsOrEnabled - Start watching only when enabled is true.
 * @returns {{
 *   position: { lat: number, lng: number } | null,
 *   accuracy: number | null,
 *   status: 'idle' | 'watching' | 'denied' | 'unavailable',
 *   error: string | null
 * }}
 */
export function useLiveLocation(optionsOrEnabled = false) {
    const enabled = typeof optionsOrEnabled === "boolean"
        ? optionsOrEnabled
        : Boolean(optionsOrEnabled?.enabled)

    const [watchState, setWatchState] = useState({
        position: null,
        accuracy: null,
        status: "watching",
        error: null,
    })

    useEffect(() => {
        if (!enabled) {
            return
        }

        if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
            const timer = setTimeout(() => {
                setWatchState({
                    position: null,
                    accuracy: null,
                    status: "unavailable",
                    error: "Geolocation is not supported by your browser.",
                })
            }, 0)
            return () => clearTimeout(timer)
        }

        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                setWatchState({
                    position: {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                    },
                    accuracy: pos.coords.accuracy,
                    status: "watching",
                    error: null,
                })
            },
            (err) => {
                let status = "unavailable"
                let message = err.message || "An unknown location error occurred"

                if (err.code === 1) { // PERMISSION_DENIED
                    status = "denied"
                    message = err.message || "Permission denied"
                } else if (err.code === 2) { // POSITION_UNAVAILABLE
                    status = "unavailable"
                    message = err.message || "Position unavailable"
                } else if (err.code === 3) { // TIMEOUT
                    status = "unavailable"
                    message = err.message || "Location request timed out"
                }

                setWatchState((prev) => ({
                    ...prev,
                    status,
                    error: message,
                }))
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
            }
        )

        return () => {
            if (typeof navigator !== "undefined" && navigator.geolocation) {
                navigator.geolocation.clearWatch(watchId)
            }
        }
    }, [enabled])

    if (!enabled) {
        return {
            position: null,
            accuracy: null,
            status: "idle",
            error: null,
        }
    }

    return watchState
}

export default useLiveLocation
