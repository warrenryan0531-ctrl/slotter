"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// B4: date-range picker + CSV download. Presets keep it one-click; custom dates for power users.
export function ReportControls(p: { from: string; to: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(p.from);
  const [to, setTo] = useState(p.to);
  const apply = (f: string, t: string) => router.push(`/dashboard/reports?from=${f}&to=${t}`);

  const preset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    apply(iso(start), iso(end));
  };

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="flex gap-2">
        <button onClick={() => preset(7)} className="btn btn-secondary btn-sm" data-testid="range-7">7 days</button>
        <button onClick={() => preset(30)} className="btn btn-secondary btn-sm" data-testid="range-30">30 days</button>
        <button onClick={() => preset(90)} className="btn btn-secondary btn-sm" data-testid="range-90">90 days</button>
      </div>
      <label className="text-sm"><span className="mr-1 text-[#64726b]">From</span>
        <input type="date" className="input inline-block w-auto py-1" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="from" />
      </label>
      <label className="text-sm"><span className="mr-1 text-[#64726b]">To</span>
        <input type="date" className="input inline-block w-auto py-1" value={to} onChange={(e) => setTo(e.target.value)} data-testid="to" />
      </label>
      <button onClick={() => apply(from, to)} className="btn btn-primary btn-sm" data-testid="apply-range">Apply</button>
      <a href={`/api/reports/export?from=${from}&to=${to}`} className="btn btn-secondary btn-sm ml-auto" data-testid="download-csv" download>⬇ Download CSV</a>
    </div>
  );
}
