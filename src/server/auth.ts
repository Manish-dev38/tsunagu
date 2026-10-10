import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      if (!user.id || !user.email) return false;
      const db = getDb();
      await db
        .insert(users)
        .values({
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { email: user.email, name: user.name ?? null, image: user.image ?? null },
        });
      return true;
    },
    async session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
});
