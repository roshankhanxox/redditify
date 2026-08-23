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

/**
 * Download a finished reel.
 * - S3 backend: the API returns a short-lived presigned URL (JSON) — hand it to
 *   the browser directly; the bucket domain never sees app cookies.
 * - Local backend: the API streams the MP4 (blob) — save via a temporary
 *   object URL. Never persisted anywhere beyond this function scope.
 */
export async function downloadReel(jobId: string, fallbackName = "reel.mp4") {
  const res = await api.get<Blob>(`/jobs/${jobId}/download`, { responseType: "blob" })
  if (res.data instanceof Blob && res.data.type === "application/json") {
    const { url } = JSON.parse(await res.data.text()) as { url: string }
    window.location.href = url
    return
  }
  const disposition = (res.headers["content-disposition"] as string | undefined) ?? ""
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  const name = match ? decodeURIComponent(match[1]) : fallbackName
  const objectUrl = URL.createObjectURL(res.data)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}
