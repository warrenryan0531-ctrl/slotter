import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { CopyButton } from "@/components/dash";

export const dynamic = "force-dynamic";

export default async function EmbedPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const hosted = `${base}/b/${tenant.slug}`;
  const scriptSnippet = `<script src="${base}/widget.js" data-tenant="${tenant.slug}" async></script>`;
  const iframeSnippet = `<iframe src="${base}/embed/${tenant.slug}" style="width:100%;height:720px;border:0" title="Book an appointment"></iframe>`;

  const Row = (p: { title: string; desc: string; code: string; testid: string }) => (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="font-semibold">{p.title}</h3>
        <CopyButton text={p.code} />
      </div>
      <p className="text-sm text-gray-500 mb-2">{p.desc}</p>
      <code className="block text-xs bg-gray-50 border border-gray-100 rounded-lg p-2 overflow-x-auto whitespace-pre" data-testid={p.testid}>{p.code}</code>
    </div>
  );

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-lg">Add booking to your website</h2>
      <p className="text-sm text-gray-500">Three ways, easiest first. Pick whichever your site supports.</p>
      <Row title="1 · Your booking page link" testid="snippet-link"
        desc="Works everywhere: your Google Business Profile 'appointment link', Instagram bio, text messages, email signature."
        code={hosted} />
      <Row title="2 · Auto-sizing widget (best for most sites)" testid="snippet-script"
        desc="WordPress (self-hosted), Squarespace code block, Webflow, and custom-coded sites. Paste where you want the widget."
        code={scriptSnippet} />
      <Row title="3 · Plain iframe (Wix, GoDaddy, restricted builders)" testid="snippet-iframe"
        desc="For site builders that only allow simple embeds: Wix 'Embed HTML', GoDaddy 'Custom code' — paste this."
        code={iframeSnippet} />
      <div className="rounded-lg bg-brand-50 border border-brand-100 p-3 text-sm text-brand-900">
        Platform notes: Wix &amp; GoDaddy require a paid plan for custom embeds — if yours doesn&apos;t allow it, use the link (#1) as a &quot;Book now&quot; button instead. It&apos;s just as effective.
      </div>
    </div>
  );
}
