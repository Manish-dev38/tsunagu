import { auth, signIn } from "@/server/auth";
import { redirect } from "next/navigation";
import { connection } from "next/server";

// Blocking route: auth() verifies the session JWT (crypto.getRandomValues) per request,
// which cannot be baked into a prerendered shell (Cache Components + Instant Navigations)
export const instant = false;

export default async function Home() {
  await connection();
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Hello</h1>
        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <button className="rounded bg-neutral-900 px-4 py-2 text-sm text-white">
            Sign in with Google
          </button>
        </form>
      </div>
    );
  }

  // home is Chat's empty state, not a separate screen (sign-out lives on Account)
  redirect("/chat");
}
