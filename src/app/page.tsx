import { auth, signIn, signOut } from "@/server/auth";

// auth() reads cookies per request; this route is never prerendered
export const instant = false;

export default async function Home() {
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

  const first = session.user.name?.split(" ")[0] ?? "there";

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6">
      <h1 className="text-3xl font-semibold">Hello {first}</h1>
      <button
        disabled
        className="cursor-not-allowed rounded border border-neutral-300 px-6 py-2 text-sm text-neutral-400"
      >
        Ask AI
      </button>
      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <button className="text-xs text-neutral-500 underline">Sign out</button>
      </form>
    </div>
  );
}
