"use client";

import { useEffect } from "react";

// Route-segment error boundary (H3). Catches render/runtime errors and shows a friendly page
// instead of a blank screen, and logs to the console (picked up by the log drain).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[client-error]", JSON.stringify({ message: error.message, digest: error.digest }));
  }, [error]);
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-gray-500 mb-5">We hit an unexpected error. You can try again — nothing was lost.</p>
        <button onClick={reset} className="rounded-xl bg-gray-900 text-white px-5 py-2.5 text-sm font-semibold">Try again</button>
      </div>
    </main>
  );
}
