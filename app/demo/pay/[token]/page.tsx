import { notFound } from "next/navigation";
import * as repo from "@/lib/repo";
import { describeWhen } from "@/lib/booking";
import { onBrand } from "@/lib/contrast";
import { DemoPayButtons } from "@/components/dash";

export const dynamic = "force-dynamic";

// Built-in DEMO checkout. This is NOT Stripe and takes NO real payment — it simulates the
// pending→paid→confirmed round-trip so the flow is demoable at $0. Prod uses real Stripe Checkout.
export default async function DemoPayPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const booking = await repo.bookingByManageToken(token);
  if (!booking) notFound();
  const tenant = await repo.tenantById(booking.tenant_id);
  const service = await repo.serviceById(booking.service_id);
  if (!tenant || !service) notFound();
  const paid = booking.payment_status === "paid";
  const amount = ((booking.deposit_cents ?? 0) / 100).toFixed(2);
  const color = tenant.branding.color ?? "#0f62fe";
  const ink = onBrand(color);

  return (
    <main className="min-h-screen bg-gray-50">
      <header style={{ background: color, color: ink.strong }}>
        <div className="mx-auto max-w-md px-4 py-5">
          <h1 className="font-semibold text-lg">{tenant.name}</h1>
          <p className="text-sm" style={{ color: ink.subtle }}>Secure a deposit to confirm your booking</p>
        </div>
      </header>
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-xl bg-white border border-gray-200 p-4 mb-4">
          <p className="font-semibold">{service.name}</p>
          <p className="text-gray-700">{describeWhen(booking, tenant.tz)}</p>
          <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-3">
            <span className="text-gray-600">Deposit due now</span>
            <span className="text-xl font-bold">${amount}</span>
          </div>
        </div>
        {paid ? (
          <p className="rounded-lg bg-green-50 border border-green-200 text-green-800 p-3 text-sm" data-testid="already-paid">This deposit is already paid — you&apos;re confirmed.</p>
        ) : (
          <DemoPayButtons token={token} slug={tenant.slug} amount={amount} />
        )}
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900" data-testid="demo-notice">
          <strong>Demo checkout — no real charge.</strong> On a live site this step is Stripe Checkout on the business&apos;s own Stripe account — card data never touches this app.
        </div>
      </div>
    </main>
  );
}
