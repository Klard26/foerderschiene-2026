function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function toIcsDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

export function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  durationMinutes: number;
  location?: string;
}

export function buildIcs(events: IcsEvent[], calName: string): string {
  const now = toIcsDate(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Klard//Booking//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calName)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
  ];
  for (const ev of events) {
    const end = new Date(ev.start.getTime() + ev.durationMinutes * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${toIcsDate(ev.start)}`,
      `DTEND:${toIcsDate(end)}`,
      `SUMMARY:${escapeIcs(ev.summary)}`,
    );
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcs(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcs(ev.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
