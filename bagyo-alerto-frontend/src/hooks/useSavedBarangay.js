import { useState, useCallback, useEffect } from "react"

const STORAGE_KEY = "bakwit_barangay_id"

/**
 * Hook to read and write the selected barangay ID in localStorage under the key "bakwit_barangay_id".
 * Handles localStorage errors with try/catch and falls back to in-memory state.
 *
 * @param {any} initialValue - Optional fallback if nothing is stored in localStorage
 * @returns {{ barangayId: any, setBarangayId: (val: any) => void }}
 */
export function useSavedBarangay(initialValue = null) {
    const [barangayId, setBarangayIdState] = useState(() => {
        try {
            if (typeof window !== "undefined" && window.localStorage) {
                const item = window.localStorage.getItem(STORAGE_KEY)
                if (item !== null && item !== undefined && item !== "") {
                    try {
                        const parsed = JSON.parse(item)
                        return parsed !== null ? parsed : null
                    } catch {
                        return item
                    }
                }
            }
        } catch (err) {
            console.warn("Failed to read from localStorage:", err)
        }
        return initialValue
    })

    const setBarangayId = useCallback((valueOrFn) => {
        setBarangayIdState((prev) => {
            const nextValue = typeof valueOrFn === "function" ? valueOrFn(prev) : valueOrFn
            try {
                if (typeof window !== "undefined" && window.localStorage) {
                    if (nextValue === null || nextValue === undefined || nextValue === "") {
                        window.localStorage.removeItem(STORAGE_KEY)
                    } else {
                        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextValue))
                    }
                }
            } catch (err) {
                console.warn("Failed to write to localStorage:", err)
            }
            return nextValue
        })
    }, [])

    useEffect(() => {
        const handleStorage = (event) => {
            if (event.key === STORAGE_KEY) {
                try {
                    if (event.newValue === null) {
                        setBarangayIdState(null)
                    } else {
                        try {
                            setBarangayIdState(JSON.parse(event.newValue))
                        } catch {
                            setBarangayIdState(event.newValue)
                        }
                    }
                } catch {
                    // Ignore storage event parsing error
                }
            }
        }

        if (typeof window !== "undefined" && window.addEventListener) {
            window.addEventListener("storage", handleStorage)
            return () => window.removeEventListener("storage", handleStorage)
        }
    }, [])

    return { barangayId, setBarangayId }
}

export default useSavedBarangay
