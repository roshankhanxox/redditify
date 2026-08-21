import axios from "axios"

/**
 * Thin axios client pointed at the Next.js proxy layer.
 * The proxy route (app/api/proxy/[...path]) attaches the FastAPI JWT
 * server-side from the Auth.js session — no business logic lives here.
 */
export const api = axios.create({
  baseURL: "/api/proxy",
  headers: { "Content-Type": "application/json" },
})

/** Optional client-side auth header injection (e.g. for direct-backend calls). */
export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common["Authorization"]
  }
}
