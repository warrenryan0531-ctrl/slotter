import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isMarket } from "@/lib/edition";
import { planStateFor } from "@/lib/billing";
import { UpgradeButton } from "@/components/dash";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  if (!isMarket()) notFound(); // billing is a market-edition concern only
  const session = await getSession();
  if (!session?.tenantId) return null;
  const plan = await planStateFor(session.tenantId);
  const billingConfigured = process.env.SLOTTER_BILLING === "stripe";

  return (
    <div className="space-y-6 max-w-lg" data-testid="billing">
      <div>
        <h2 className="font-semibold text-lg mb-1">Plan &amp; billing</h2>
        <p className="text-sm text-gray-500">You&apos;re on the <strong className="uppercase" data-testid="plan-name">{plan.plan}</strong> plan{plan.status !== "active" ? ` (${plan.status})` : ""}.</p>
      </div>

      {plan.plan === "pro" ? (
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-sm text-green-900">
          You&apos;re on Pro — thank you! Everything is unlocked.
        </div>
      ) : (
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold">Upgrade to Pro</h3>
          <p className="text-sm text-gray-600">Unlock everything and support ongoing development. Cancel anytime.</p>
          <UpgradeButton />
          {!billingConfigured && <p className="text-xs text-gray-600">Demo mode: upgrading flips your plan instantly with no charge.</p>}
        </div>
      )}
    </div>
  );
}
