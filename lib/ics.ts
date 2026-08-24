import { APP_NAME } from "./brand";
// RFC 5545 / iTIP generation. SEQUENCE-aware; METHOD:REQUEST for create/reschedule, METHOD:CANCEL for cancels.

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  // 75-octet folding (approximate by chars; ASCII-safe for our content)
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  return parts.join("\r\n");
}

function dt(utcMs: number): string {
  return new Date(utcMs).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type IcsEvent = {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  start: number; end: number; // UTC ms
  summary: string;
  description?: string;
  location?: string;
  organizerName: string;
  organizerEmail: string;
  attendees: { name: string; email: string }[];
  status?: "CONFIRMED" | "CANCELLED";
  stampNow: number;
};

export function buildIcs(ev: IcsEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    `PRODID:-//${APP_NAME}//Booking//EN`,
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${ev.method}`,
    "BEGIN:VEVENT",
    `UID:${esc(ev.uid)}`,
    `SEQUENCE:${ev.sequence}`,
    `DTSTAMP:${dt(ev.stampNow)}`,
    `DTSTART:${dt(ev.start)}`,
    `DTEND:${dt(ev.end)}`,
    `SUMMARY:${esc(ev.summary)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  lines.push(`ORGANIZER;CN=${esc(ev.organizerName)}:mailto:${ev.organizerEmail}`);
  for (const a of ev.attendees) {
    lines.push(`ATTENDEE;CN=${esc(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`);
  }
  lines.push(`STATUS:${ev.status ?? (ev.method === "CANCEL" ? "CANCELLED" : "CONFIRMED")}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function buildFeed(name: string, events: Omit<IcsEvent, "method" | "organizerName" | "organizerEmail" | "attendees">[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    `PRODID:-//${APP_NAME}//Booking//EN`,
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(name)}`,
  ];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${esc(ev.uid)}`,
      `SEQUENCE:${ev.sequence}`,
      `DTSTAMP:${dt(ev.stampNow)}`,
      `DTSTART:${dt(ev.start)}`,
      `DTEND:${dt(ev.end)}`,
      `SUMMARY:${esc(ev.summary)}`,
    );
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    lines.push(`STATUS:${ev.status ?? "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
