import { notFound } from "next/navigation";
import Link from "next/link";
import { isMarket } from "@/lib/edition";
import { APP_NAME } from "@/lib/brand";
import { SignupForm } from "@/components/dash";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (!isMarket()) notFound(); // R6: signup exists only in the market edition
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-gray-200 p-6">
        <p className="text-sm font-semibold text-indigo-600 mb-1">{APP_NAME}</p>
        <h1 className="font-bold text-xl mb-1">Start taking bookings</h1>
        <p className="text-sm text-gray-500 mb-4">Create your free booking page in about a minute. No card required.</p>
        <SignupForm />
        <p className="text-xs text-gray-500 mt-4">Already have an account? <Link href="/dashboard" className="underline">Sign in</Link>.</p>
      </div>
    </main>
  );
}
