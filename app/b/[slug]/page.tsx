import { notFound } from "next/navigation";
import BookingFlow from "@/components/BookingFlow";
import { loadFlow } from "@/lib/flow-data";
import { onBrand } from "@/lib/contrast";

export const dynamic = "force-dynamic";

export default async function BookingPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const data = await loadFlow(slug);
  if (!data) notFound();
  const { tenant, services } = data;
  const color = tenant.branding.color ?? "#0f62fe";
  const ink = onBrand(color);
  return (
    <main className="min-h-screen bg-gray-50">
      <header style={{ background: color, color: ink.strong }}>
        <div className="mx-auto max-w-md px-4 py-6 flex items-center gap-3">
          {tenant.branding.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.branding.logo_url} alt="" className="h-10 w-10 rounded-full bg-white object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold" style={{ background: ink.strong === "#ffffff" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.12)" }}>{tenant.name[0]}</div>
          )}
          <div>
            <h1 className="font-semibold text-lg leading-tight">{tenant.name}</h1>
            <p className="text-sm" style={{ color: ink.subtle }}>Book online — it takes under a minute</p>
          </div>
        </div>
      </header>
      <BookingFlow
        slug={tenant.slug} tenantName={tenant.name} tz={tenant.tz}
        color={color} accent={tenant.branding.accent ?? "#ff6a00"}
        intro={tenant.branding.intro} services={services} smsEnabled={data.smsEnabled}
      />
    </main>
  );
}
