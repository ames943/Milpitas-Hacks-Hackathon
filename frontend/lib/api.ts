export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"

export async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json.error || `Request failed: ${res.status}`)
  }
  return json.data ?? json
}

export function getUserId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("mosaic_user_id")
}

export function setUserId(id: string) {
  localStorage.setItem("mosaic_user_id", id)
}
