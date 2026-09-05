import axios from "axios"
import type { UserBackground } from "./types"

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

/* ------------------------------------------------------------------ */
/* User background footage (plan.md phase 2)                           */
/* ------------------------------------------------------------------ */

export interface BackgroundInit {
  id: string
  label: string
  status: string
  part_size: number
  parts: { part_number: number; url: string }[]
}

/**
 * Raw XHR PUT of one multipart part. Deliberately sends NO Content-Type
 * header (part URLs are signed without one); a Blob without a mime type
 * keeps browsers from adding it.
 */
function putPart(url: string, blob: Blob, onProgress: (loadedDelta: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    let last = 0
    xhr.upload.onprogress = (e) => {
      onProgress(e.loaded - last)
      last = e.loaded
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`))
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.send(blob)
  })
}

export interface UploadHooks {
  onPhase?: (phase: "uploading" | "processing") => void
  onProgress?: (fraction: number) => void
}

/**
 * Full background upload orchestration:
 * init -> parallel-safe sequential part PUTs -> complete -> poll until ready/failed.
 * Presigned part URLs live only inside this call chain.
 */
export async function uploadBackground(file: File, hooks: UploadHooks = {}): Promise<UserBackground> {
  if (file.size === 0) throw new Error("Empty file")
  const contentType = file.type || "video/mp4"
  hooks.onPhase?.("uploading")

  const init = await api
    .post<BackgroundInit>("/backgrounds/init", {
      label: file.name.slice(0, 80),
      size_bytes: file.size,
      content_type: contentType,
    })
    .then((r) => r.data)

  let uploaded = 0
  for (const part of init.parts) {
    const start = (part.part_number - 1) * init.part_size
    // Strip the mime type so no Content-Type header is sent.
    const chunk = new Blob([file.slice(start, start + init.part_size)])
    await putPart(part.url, chunk, (delta) => hooks.onProgress?.((uploaded + delta) / file.size))
    uploaded += chunk.size
  }

  hooks.onPhase?.("processing")
  await api.post(`/backgrounds/${init.id}/complete`)

  // Poll until the probe/transcode task settles (bounded ~5 min).
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 1500 : 3000))
    const bg = await api.get<UserBackground>(`/backgrounds/${init.id}`).then((r) => r.data)
    if (bg.status === "ready" || bg.status === "failed") return bg
  }
  throw new Error("Processing timed out — check My footage in a minute")
}

/* ------------------------------------------------------------------ */
/* Character assets (V2 Phase 7)                                       */
/* ------------------------------------------------------------------ */

export interface CharacterAsset {
  id: string
  label: string
  status: "pending" | "ready" | "failed"
  width: number | null
  height: number | null
  file_size_bytes: number | null
  bg_removed: boolean
  error_message: string | null
  created_at: string
}

/** Upload one character image: presigned PUT, optional in-browser background
 *  removal (WASM), then server-side normalization to RGBA WebP. */
export async function uploadCharacter(
  file: File,
  opts: { bgRemoved?: boolean; onPhase?: (p: "uploading" | "processing") => void } = {},
): Promise<CharacterAsset> {
  if (file.size === 0) throw new Error("Empty file")
  let blob: Blob = file
  let bgRemoved = false

  if (opts.bgRemoved) {
    try {
      const { removeBackground } = await import("@imgly/background-removal")
      // Pin the data package version to the installed lib — the CDN's
      // `latest` tag 404s, which silently disabled background removal.
      const dataVersion = "1.7.0"
      const out = await removeBackground(file, {
        publicPath:
          process.env.NEXT_PUBLIC_IMGLY_PATH ||
          `https://staticimgly.com/@imgly/background-removal-data/${dataVersion}/dist/`,
      })
      blob = out
      bgRemoved = true
    } catch {
      // Model assets unavailable — fall back to the original image.
    }
  }

  opts.onPhase?.("uploading")
  const init = await api
    .post<{ asset_id: string; url: string }>("/characters/init", {
      label: file.name.slice(0, 80),
      size_bytes: blob.size,
      content_type: bgRemoved ? "image/png" : file.type || "image/png",
      bg_removed: bgRemoved,
    })
    .then((r) => r.data)

  const putRes = await fetch(init.url, { method: "PUT", body: blob })
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`)

  opts.onPhase?.("processing")
  return api.post<CharacterAsset>(`/characters/${init.asset_id}/complete`).then((r) => r.data)
}

/* ------------------------------------------------------------------ */
/* Content Engine — clip jobs                                          */
/* ------------------------------------------------------------------ */

export async function downloadClip(jobId: string, clipId: string, index: number) {
  const res = await api.get<Blob>(`/clip-jobs/${jobId}/clips/${clipId}/download`, { responseType: "blob" })
  if (res.data instanceof Blob && res.data.type === "application/json") {
    const { url } = JSON.parse(await res.data.text()) as { url: string }
    window.location.href = url
    return
  }
  const objectUrl = URL.createObjectURL(res.data)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = `clip_${index + 1}.mp4`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

export async function listCharacters() {
  return api.get<{ items: CharacterAsset[] }>("/characters").then((r) => r.data)
}

export async function deleteCharacter(id: string) {
  return api.delete(`/characters/${id}`).then((r) => r.data)
}
