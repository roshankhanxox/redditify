import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"

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
        return {
          id: data.user.id,
          email: data.user.email,
          role: data.user.role,
          must_change_password: data.user.must_change_password,
          backendToken: data.token,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.email = user.email as string
        token.role = (user as any).role
        token.must_change_password = (user as any).must_change_password
        token.backendToken = (user as any).backendToken
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as string
      session.user.must_change_password = token.must_change_password as boolean
      ;(session as any).backendToken = token.backendToken
      return session
    },
  },
})
