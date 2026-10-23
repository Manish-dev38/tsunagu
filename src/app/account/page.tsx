"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { api } from "@/trpc/provider";

export default function AccountPage() {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const me = api.me.useQuery();
  const deleteData = api.account.deleteData.useMutation({
    onSuccess: () => {
      setError(null);
      setDeleted(true);
      setConfirming(false);
    },
    onError: (e) => setError(e.message),
  });

  if (me.isPending) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (me.error)
    return <p className="text-sm text-red-600">Couldn&apos;t load account: {me.error.message}</p>;

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm text-neutral-800">{me.data.name ?? "Unnamed"}</p>
        <p className="text-sm text-neutral-500">{me.data.email}</p>
        <button
          onClick={() => void signOut()}
          className="mt-2 rounded border border-neutral-300 px-3 py-1.5 text-sm"
        >
          Sign out
        </button>
      </div>

      <div className="space-y-2 rounded border border-red-200 p-4">
        <h2 className="text-sm font-semibold text-red-700">Delete my data</h2>
        {deleted ? (
          <p className="text-sm text-neutral-600">
            Your Memory and Chat sessions have been deleted. Mail and calendar connections were
            kept; disconnect them on the Connector screen if you want.
          </p>
        ) : (
          <>
            <p className="text-sm text-neutral-600">
              Removes everything in Memory and all Chat sessions. Your Gmail and Calendar
              connections stay connected until you disconnect them on the Connector screen. This
              cannot be undone.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {confirming ? (
              <div className="flex gap-2">
                <button
                  onClick={() => deleteData.mutate()}
                  disabled={deleteData.isPending}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Yes, delete everything
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700"
              >
                Delete my data
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
