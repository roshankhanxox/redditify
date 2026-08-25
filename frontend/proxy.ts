import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { auth } from "@/auth"

const PROTECTED = ["/dashboard", "/admin"]

export default async function proxy(req: NextRequest) {
  const session = await auth().catch(() => null)
  const { pathname } = req.nextUrl

  const isProtected = PROTECTED.some((p) => pathname.startsWith(p))

  if (isProtected && !session) {
    const signInUrl = new URL("/sign-in", req.url)
    signInUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(signInUrl)
  }

  // Enforce must_change_password before any other navigation
  if (session?.user?.must_change_password && pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", req.url))
  }

  if (pathname.startsWith("/admin") && session?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
}
