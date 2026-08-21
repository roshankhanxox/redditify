import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    backendToken?: string
    user: {
      id: string
      role: string
      must_change_password: boolean
    } & DefaultSession["user"]
  }

  interface User {
    role?: string
    must_change_password?: boolean
    backendToken?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    role?: string
    must_change_password?: boolean
    backendToken?: string
  }
}
