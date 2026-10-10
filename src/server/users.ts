import type { Db } from "@/server/db";
import { users } from "@/server/db/schema";

export interface AuthIdentity {
  id?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}

export async function upsertUser(db: Db, user: AuthIdentity): Promise<boolean> {
  if (!user.id || !user.email) return false;
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
}
