import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"

// Extra fields ReelBot threads through the JWT/session beyond Auth.js basics.
interface BackendUser {
  id: string
  email: string
  role: string
  must_change_password: boolean
  backendToken: string
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials) => {
        const res = await fetch(`${BACKEND_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: credentials?.email,
            password: credentials?.password,
          }),
        })
        if (!res.ok) return null
        const data = await res.json()
        const user: BackendUser = {
          id: data.user.id,
          email: data.user.email,
          role: data.user.role,
          must_change_password: data.user.must_change_password,
          backendToken: data.token,
        }
        return user
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        const u = user as BackendUser
        token.id = u.id
        token.email = u.email
        token.role = u.role
        token.must_change_password = u.must_change_password
        token.backendToken = u.backendToken
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as string
      session.user.must_change_password = token.must_change_password as boolean
      Object.assign(session, { backendToken: token.backendToken })
      return session
    },
  },
})
