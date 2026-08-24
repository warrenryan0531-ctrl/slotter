import { notFound } from "next/navigation";
import BookingFlow from "@/components/BookingFlow";
import { loadFlow } from "@/lib/flow-data";

export const dynamic = "force-dynamic";

export default async function EmbedPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const data = await loadFlow(slug);
  if (!data) notFound();
  const { tenant, services } = data;
  return (
    <main className="bg-white">
      <BookingFlow
        slug={tenant.slug} tenantName={tenant.name} tz={tenant.tz}
        color={tenant.branding.color ?? "#0f62fe"} accent={tenant.branding.accent ?? "#ff6a00"}
        intro={tenant.branding.intro} services={services} embedded smsEnabled={data.smsEnabled}
      />
    </main>
  );
}
