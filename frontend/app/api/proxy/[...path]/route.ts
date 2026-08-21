import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"

async function proxy(req: NextRequest, path: string[]) {
  const session = await auth()
  if (!session?.backendToken) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 })
  }
  const url = `${BACKEND_URL}/${path.join("/")}${req.nextUrl.search}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.backendToken}`,
  }
  if (!(req.method === "GET" || req.method === "HEAD")) {
    headers["Content-Type"] = req.headers.get("content-type") || "application/json"
  }

  const backendRes = await fetch(url, {
    method: req.method,
    headers,
    body: req.body && !(req.method === "GET" || req.method === "HEAD") ? await req.arrayBuffer() : undefined,
    // @ts-expect-error — duplex is valid for streaming bodies in undici
    duplex: "half",
  })

  const contentType = backendRes.headers.get("content-type") || ""
  if (contentType.includes("video/mp4") || contentType.includes("octet-stream")) {
    return new NextResponse(backendRes.body, {
      status: backendRes.status,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": backendRes.headers.get("content-disposition") || "",
      },
    })
  }

  const data = await backendRes.arrayBuffer()
  return new NextResponse(data, {
    status: backendRes.status,
    headers: { "Content-Type": contentType || "application/json" },
  })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(req, path)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxy(req, path)
}
