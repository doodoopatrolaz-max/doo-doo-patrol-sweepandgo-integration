import type { SweepAndGoClient } from "../sweepandgo/client.ts";

type UnknownRecord = Record<string, unknown>;

export type TechDashboardRow = {
  techName: string;
  jobs: number;
  physicalStops: number;
  miles?: number;
  routeMinutes?: number;
  driveMinutes?: number;
  stopsPerHour?: number;
  driveGapPercent?: number;
  skippedJobs: number;
  routeExceptions: string[];
};

export type DailyDashboardReport = {
  date: string;
  generatedAt: string;
  totals: TechDashboardRow;
  techs: TechDashboardRow[];
  notes: string[];
};

export async function buildDailyDashboardReport(input: {
  date: string;
  client: Pick<SweepAndGoClient, "getDispatchJobs">;
  generatedAt?: Date;
}): Promise<DailyDashboardReport> {
  const dispatchResponse = await input.client.getDispatchJobs(input.date);
  return createDailyDashboardReport({
    date: input.date,
    generatedAt: input.generatedAt ?? new Date(),
    dispatchResponse
  });
}

export function createDailyDashboardReport(input: {
  date: string;
  generatedAt: Date;
  dispatchResponse: unknown;
}): DailyDashboardReport {
  const jobs = extractJobs(input.dispatchResponse);
  const rows = aggregateByTech(jobs);
  const totals = buildTotals(rows);
  const notes = [
    "Physical stops are counted as unique non-skipped service locations per tech.",
    "Stops/hour uses route span when available, then clock span, then service window span.",
    "Drive gap % is drive minutes divided by route minutes when both values are available."
  ];

  if (jobs.length === 0) {
    notes.push("No dispatch jobs were found in the Sweep & Go response for this date.");
  }

  return {
    date: input.date,
    generatedAt: input.generatedAt.toISOString(),
    totals,
    techs: rows.sort((a, b) => a.techName.localeCompare(b.techName)),
    notes
  };
}

export function renderDailyDashboardEmail(report: DailyDashboardReport): {
  subject: string;
  text: string;
  html: string;
} {
  const dateLabel = formatDateLabel(report.date);
  const subject = `Doo Doo Patrol daily route dashboard - ${dateLabel}`;
  const rows = report.techs.length ? report.techs : [emptyRow("No tech assigned")];

  const text = [
    `Doo Doo Patrol daily route dashboard - ${dateLabel}`,
    "",
    `Total jobs: ${report.totals.jobs}`,
    `Physical stops: ${report.totals.physicalStops}`,
    `Miles: ${formatNumber(report.totals.miles)}`,
    `Stops/hour: ${formatNumber(report.totals.stopsPerHour)}`,
    `Drive gap: ${formatPercent(report.totals.driveGapPercent)}`,
    `Skipped jobs: ${report.totals.skippedJobs}`,
    "",
    "By tech:",
    ...rows.map((row) =>
      [
        `${row.techName}:`,
        `jobs ${row.jobs}`,
        `physical stops ${row.physicalStops}`,
        `miles ${formatNumber(row.miles)}`,
        `stops/hour ${formatNumber(row.stopsPerHour)}`,
        `drive gap ${formatPercent(row.driveGapPercent)}`,
        `skipped ${row.skippedJobs}`,
        `exceptions ${row.routeExceptions.length ? row.routeExceptions.join("; ") : "none"}`
      ].join(" ")
    ),
    "",
    "Notes:",
    ...report.notes.map((note) => `- ${note}`)
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7f9;color:#17202a;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:960px;margin:0 auto;padding:24px;">
      <h1 style="margin:0 0 6px;font-size:24px;">Daily route dashboard</h1>
      <div style="margin:0 0 20px;color:#536170;">Doo Doo Patrol - ${escapeHtml(dateLabel)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
        <tr>
          ${summaryCell("Jobs", report.totals.jobs)}
          ${summaryCell("Physical stops", report.totals.physicalStops)}
          ${summaryCell("Miles", formatNumber(report.totals.miles))}
          ${summaryCell("Stops/hour", formatNumber(report.totals.stopsPerHour))}
          ${summaryCell("Drive gap", formatPercent(report.totals.driveGapPercent))}
          ${summaryCell("Skipped", report.totals.skippedJobs)}
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9dee5;">
        <thead>
          <tr style="background:#17202a;color:#fff;">
            ${headerCell("Tech")}
            ${headerCell("Jobs")}
            ${headerCell("Physical stops")}
            ${headerCell("Miles")}
            ${headerCell("Stops/hour")}
            ${headerCell("Drive gap")}
            ${headerCell("Skipped")}
            ${headerCell("Route exceptions")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderTechRow).join("")}
        </tbody>
      </table>
      <div style="margin-top:18px;font-size:13px;color:#536170;">
        ${report.notes.map((note) => `<div>${escapeHtml(note)}</div>`).join("")}
      </div>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

function aggregateByTech(jobs: NormalizedJob[]): TechDashboardRow[] {
  const grouped = new Map<string, NormalizedJob[]>();
  for (const job of jobs) {
    const key = job.techName || "Unassigned";
    grouped.set(key, [...(grouped.get(key) ?? []), job]);
  }

  return [...grouped.entries()].map(([techName, techJobs]) => {
    const skippedJobs = techJobs.filter((job) => job.skipped).length;
    const serviceJobs = techJobs.filter((job) => !job.skipped);
    const physicalStops = new Set(serviceJobs.map(stopKey)).size;
    const miles = sumNumbers(techJobs.map((job) => job.miles));
    const routeMinutes = bestRouteMinutes(techJobs);
    const driveMinutes = sumNumbers(techJobs.map((job) => job.driveMinutes));
    const stopsPerHour = routeMinutes ? round(physicalStops / (routeMinutes / 60), 1) : undefined;
    const driveGapPercent = routeMinutes && driveMinutes !== undefined
      ? round((driveMinutes / routeMinutes) * 100, 1)
      : undefined;

    const row: TechDashboardRow = {
      techName,
      jobs: techJobs.length,
      physicalStops,
      miles,
      routeMinutes,
      driveMinutes,
      stopsPerHour,
      driveGapPercent,
      skippedJobs,
      routeExceptions: []
    };
    row.routeExceptions = routeExceptions(row, techJobs);
    return row;
  });
}

function buildTotals(rows: TechDashboardRow[]): TechDashboardRow {
  const physicalStops = rows.reduce((total, row) => total + row.physicalStops, 0);
  const routeMinutes = sumNumbers(rows.map((row) => row.routeMinutes));
  const driveMinutes = sumNumbers(rows.map((row) => row.driveMinutes));
  const stopsPerHour = routeMinutes ? round(physicalStops / (routeMinutes / 60), 1) : undefined;
  const driveGapPercent = routeMinutes && driveMinutes !== undefined
    ? round((driveMinutes / routeMinutes) * 100, 1)
    : undefined;

  return {
    techName: "Total",
    jobs: rows.reduce((total, row) => total + row.jobs, 0),
    physicalStops,
    miles: sumNumbers(rows.map((row) => row.miles)),
    routeMinutes,
    driveMinutes,
    stopsPerHour,
    driveGapPercent,
    skippedJobs: rows.reduce((total, row) => total + row.skippedJobs, 0),
    routeExceptions: rows.flatMap((row) => row.routeExceptions)
  };
}

type NormalizedJob = {
  id?: string;
  techName: string;
  customerName?: string;
  address?: string;
  status?: string;
  skipped: boolean;
  miles?: number;
  driveMinutes?: number;
  routeStart?: Date;
  routeEnd?: Date;
  jobStart?: Date;
  jobEnd?: Date;
  raw: UnknownRecord;
};

function extractJobs(value: unknown): NormalizedJob[] {
  const records = findJobRecords(value);
  return records.map(normalizeJob);
}

function findJobRecords(value: unknown): UnknownRecord[] {
  const preferred = findFirstArray(value, ["jobs", "dispatch_jobs", "dispatchJobs", "data"]);
  if (preferred) {
    return preferred.flatMap((item) => flattenJobRecord(item));
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJobRecord(item));
  }

  return flattenJobRecord(value);
}

function flattenJobRecord(value: unknown): UnknownRecord[] {
  if (!isRecord(value)) {
    return [];
  }

  const nestedJobs = findFirstArray(value, ["jobs", "route_jobs", "routeJobs", "items", "stops"]);
  if (!nestedJobs) {
    return [value];
  }

  return nestedJobs
    .filter(isRecord)
    .map((job) => ({ ...value, ...job, route: value }));
}

function normalizeJob(raw: UnknownRecord): NormalizedJob {
  const route = isRecord(raw.route) ? raw.route : {};
  const techName = firstString(
    raw.tech_name,
    raw.technician_name,
    raw.staff_name,
    raw.assigned_staff_name,
    nestedString(raw, ["tech", "name"]),
    nestedString(raw, ["technician", "name"]),
    nestedString(raw, ["staff", "name"]),
    route.tech_name,
    route.staff_name,
    nestedString(route, ["staff", "name"])
  ) ?? "Unassigned";
  const status = firstString(raw.status, raw.job_status, raw.dispatch_status, raw.type);
  const skipped = looksSkipped(raw) || looksSkipped(route);

  return {
    id: firstString(raw.id, raw.job_id, raw.dispatch_job_id),
    techName,
    customerName: firstString(raw.customer_name, raw.client_name, raw.name, nestedString(raw, ["client", "name"])),
    address: firstString(raw.address, raw.service_address, raw.full_address, nestedString(raw, ["client", "address"])),
    status,
    skipped,
    miles: firstNumber(raw.miles, raw.route_miles, raw.distance_miles, raw.drive_miles, route.miles, route.route_miles),
    driveMinutes: firstMinutes(raw.drive_minutes, raw.travel_minutes, raw.duration_drive, raw.drive_time, route.drive_minutes, route.travel_minutes),
    routeStart: firstDate(raw.route_started_at, raw.route_start, raw.shift_start, route.started_at, route.start_time),
    routeEnd: firstDate(raw.route_completed_at, raw.route_end, raw.shift_end, route.completed_at, route.end_time),
    jobStart: firstDate(raw.started_at, raw.start_time, raw.arrival_time, raw.scheduled_start),
    jobEnd: firstDate(raw.completed_at, raw.end_time, raw.departure_time, raw.scheduled_end),
    raw
  };
}

function routeExceptions(row: TechDashboardRow, jobs: NormalizedJob[]): string[] {
  const exceptions = new Set<string>();

  if (row.techName === "Unassigned") {
    exceptions.add("unassigned jobs");
  }
  if (row.skippedJobs > 0) {
    exceptions.add(`${row.skippedJobs} skipped job${row.skippedJobs === 1 ? "" : "s"}`);
  }
  if (row.jobs > 0 && row.physicalStops === 0) {
    exceptions.add("no completed physical stops");
  }
  if (row.miles === undefined) {
    exceptions.add("missing mileage");
  }
  if (row.routeMinutes === undefined) {
    exceptions.add("missing route time");
  }
  if (row.stopsPerHour !== undefined && row.stopsPerHour < 3) {
    exceptions.add("low stops/hour");
  }
  if (row.driveGapPercent !== undefined && row.driveGapPercent > 45) {
    exceptions.add("high drive gap");
  }

  for (const job of jobs) {
    const status = job.status?.toLowerCase() ?? "";
    if (status.includes("late")) {
      exceptions.add("late job");
    }
    if (status.includes("off schedule")) {
      exceptions.add("off schedule");
    }
  }

  return [...exceptions];
}

function bestRouteMinutes(jobs: NormalizedJob[]): number | undefined {
  const starts = jobs.flatMap((job) => [job.routeStart, job.jobStart]).filter(isDate);
  const ends = jobs.flatMap((job) => [job.routeEnd, job.jobEnd]).filter(isDate);
  if (!starts.length || !ends.length) {
    return undefined;
  }

  const start = Math.min(...starts.map((date) => date.getTime()));
  const end = Math.max(...ends.map((date) => date.getTime()));
  if (end <= start) {
    return undefined;
  }

  return Math.round((end - start) / 60000);
}

function stopKey(job: NormalizedJob): string {
  return normalizeText(job.address) || normalizeText(job.customerName) || job.id || JSON.stringify(job.raw);
}

function looksSkipped(record: UnknownRecord): boolean {
  const text = [
    record.status,
    record.job_status,
    record.dispatch_status,
    record.skip_reason,
    record.skipped_reason,
    record.reason
  ].filter((value) => typeof value === "string").join(" ").toLowerCase();

  return /\b(skip|skipped|cancelled|canceled|no service|not serviced)\b/.test(text)
    || record.skipped === true
    || record.is_skipped === true;
}

function findFirstArray(value: unknown, keys: string[]): unknown[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const nested = value[key];
    if (Array.isArray(nested)) {
      return nested;
    }
  }

  for (const nested of Object.values(value)) {
    if (isRecord(nested)) {
      const found = findFirstArray(nested, keys);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function nestedString(value: UnknownRecord, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }

  return firstString(current);
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function firstMinutes(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = firstNumber(value);
    if (number !== undefined) {
      return number > 300 ? Math.round(number / 60) : number;
    }
  }

  return undefined;
}

function firstDate(...values: unknown[]): Date | undefined {
  for (const value of values) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return undefined;
}

function sumNumbers(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => value !== undefined);
  if (!numbers.length) {
    return undefined;
  }

  return round(numbers.reduce((total, value) => total + value, 0), 1);
}

function emptyRow(techName: string): TechDashboardRow {
  return {
    techName,
    jobs: 0,
    physicalStops: 0,
    skippedJobs: 0,
    routeExceptions: ["no route data"]
  };
}

function renderTechRow(row: TechDashboardRow): string {
  const exceptionText = row.routeExceptions.length ? row.routeExceptions.join("; ") : "None";
  const background = row.routeExceptions.length ? "#fff8e6" : "#ffffff";

  return `<tr style="background:${background};">
    ${bodyCell(row.techName, true)}
    ${bodyCell(row.jobs)}
    ${bodyCell(row.physicalStops)}
    ${bodyCell(formatNumber(row.miles))}
    ${bodyCell(formatNumber(row.stopsPerHour), isLow(row.stopsPerHour, 3))}
    ${bodyCell(formatPercent(row.driveGapPercent), isHigh(row.driveGapPercent, 45))}
    ${bodyCell(row.skippedJobs, row.skippedJobs > 0)}
    ${bodyCell(exceptionText, row.routeExceptions.length > 0)}
  </tr>`;
}

function summaryCell(label: string, value: string | number): string {
  return `<td style="padding:14px;background:#fff;border:1px solid #d9dee5;">
    <div style="font-size:12px;color:#536170;">${escapeHtml(label)}</div>
    <div style="font-size:22px;font-weight:700;">${escapeHtml(String(value))}</div>
  </td>`;
}

function headerCell(value: string): string {
  return `<th align="left" style="padding:10px;border:1px solid #263241;font-size:12px;">${escapeHtml(value)}</th>`;
}

function bodyCell(value: string | number, highlight = false): string {
  return `<td style="padding:10px;border:1px solid #d9dee5;font-size:13px;${highlight ? "font-weight:700;color:#9a3d00;" : ""}">${escapeHtml(String(value))}</td>`;
}

function isLow(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value < threshold;
}

function isHigh(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value > threshold;
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? "n/a" : String(value);
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value}%`;
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(parsed);
}

function normalizeText(value: string | undefined): string {
  return value?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isDate(value: Date | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
