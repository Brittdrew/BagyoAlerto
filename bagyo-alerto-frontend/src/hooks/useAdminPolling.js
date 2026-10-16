import { useEffect, useRef, useCallback } from "react"

/**
 * useAdminPolling
 *
 * Calls `fn` immediately, then every `intervalMs`.
 * Rules:
 *  - If the previous invocation is still in-flight, skip the tick.
 *  - If the tab is hidden, pause polling and resume once on visibilitychange.
 *  - Clears the interval on unmount.
 *
 * @param {() => Promise<void>} fn   Async function to call. Must not change on every render (use useCallback).
 * @param {number}  intervalMs       Polling interval in milliseconds (default 30 000).
 * @param {boolean} enabled          Set false to skip registering the interval at all.
 */
export function useAdminPolling(fn, intervalMs = 30_000, enabled = true) {
    const inFlight = useRef(false)
    const savedFn  = useRef(fn)

    // Always keep the ref up-to-date without re-registering the interval.
    useEffect(() => {
        savedFn.current = fn
    }, [fn])

    const tick = useCallback(async () => {
        if (inFlight.current) return
        if (document.visibilityState !== "visible") return
        inFlight.current = true
        try {
            await savedFn.current()
        } finally {
            inFlight.current = false
        }
    }, [])

    useEffect(() => {
        if (!enabled) return

        // Fire immediately.
        tick()

        const id = setInterval(tick, intervalMs)

        // Resume once when tab becomes visible again.
        const onVisibility = () => {
            if (document.visibilityState === "visible") tick()
        }
        document.addEventListener("visibilitychange", onVisibility)

        return () => {
            clearInterval(id)
            document.removeEventListener("visibilitychange", onVisibility)
        }
        // `tick` is stable (useCallback with empty deps), `intervalMs` and `enabled`
        // should not change on every render.
    }, [tick, intervalMs, enabled])
}
