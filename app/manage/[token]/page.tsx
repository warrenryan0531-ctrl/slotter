import { notFound } from "next/navigation";
import * as repo from "@/lib/repo";
import { tenantSettings } from "@/lib/types";
import { describeWhen } from "@/lib/booking";
import { onBrand } from "@/lib/contrast";
import ManageClient from "@/components/ManageClient";

export const dynamic = "force-dynamic";

export default async function ManagePage(props: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await props.params;
  const { paid } = await props.searchParams;
  const booking = await repo.bookingByManageToken(token);
  if (!booking) notFound();
  const tenant = await repo.tenantById(booking.tenant_id);
  const service = await repo.serviceById(booking.service_id);
  if (!tenant || !service) notFound();
  const s = tenantSettings(tenant);
  const canManage = booking.status === "confirmed" && Date.parse(booking.starts_at) - Date.now() >= s.cutoffHours * 3600000;
  const color = tenant.branding.color ?? "#0f62fe";
  const ink = onBrand(color);
  const statusLabel = booking.status === "pending" ? "AWAITING CONFIRMATION" : booking.status === "declined" ? "NOT AVAILABLE" : booking.status === "cancelled" ? "CANCELLED" : null;

  return (
    <main className="min-h-screen bg-gray-50">
      <header style={{ background: color, color: ink.strong }}>
        <div className="mx-auto max-w-md px-4 py-5">
          <h1 className="font-semibold text-lg">{tenant.name}</h1>
          <p className="text-sm" style={{ color: ink.subtle }}>Manage your booking</p>
        </div>
      </header>
      <div className="mx-auto max-w-md p-4">
        {paid && booking.payment_status === "paid" && (
          <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 p-3 text-sm mb-4" data-testid="paid-banner">✓ Deposit received — your booking is confirmed. A calendar invite is on its way.</div>
        )}
        <div className="rounded-xl bg-white border border-gray-200 p-4 mb-4">
          <p className="font-semibold">{service.name}</p>
          <p className="text-gray-700" data-testid="manage-when">{describeWhen(booking, tenant.tz)}</p>
          <p className="text-sm text-gray-500 mt-1">{booking.customer.name} · {booking.customer.phone}</p>
          {booking.address && <p className="text-sm text-gray-500">{booking.address.line}</p>}
          {statusLabel && <p className={`mt-2 inline-block rounded text-xs font-semibold px-2 py-1 ${booking.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{statusLabel}</p>}
        </div>
        {booking.status === "pending" && booking.payment_status === "awaiting" && (
          <div className="mb-4" data-testid="awaiting-payment">
            <p className="text-sm text-gray-600 mb-2">Your time is held, but not confirmed until your deposit is paid.</p>
            <a href={`/demo/pay/${token}`} className="block w-full text-center rounded-xl text-white font-semibold py-3" style={{ background: color }}>Complete deposit</a>
          </div>
        )}
        {booking.status === "pending" && booking.payment_status !== "awaiting" && (
          <p className="text-sm text-gray-600 mb-3 -mt-1">This time is being held for you while <strong>{tenant.name}</strong> reviews your request. You&apos;ll get an email as soon as it&apos;s confirmed.</p>
        )}
        <ManageClient
          token={token} slug={tenant.slug} serviceId={service.id} staffId={booking.staff_id}
          tz={tenant.tz} color={color} canManage={canManage} cutoffHours={s.cutoffHours}
          ownerPhone={tenant.branding.phone} status={booking.status}
        />
      </div>
    </main>
  );
}
