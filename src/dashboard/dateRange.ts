export type DashboardRangeKey = "today" | "yesterday" | "last7" | "thisMonth" | "lastMonth" | "custom";

export type DashboardDateRange = {
  key: DashboardRangeKey;
  label: string;
  startDate: string;
  endDate: string;
  timeZone: string;
};

const DEFAULT_TIME_ZONE = "America/Phoenix";

export function parseDashboardDateRange(
  input: URLSearchParams | Record<string, string | undefined>,
  now: Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE
): DashboardDateRange {
  const get = (key: string) => input instanceof URLSearchParams ? input.get(key) ?? undefined : input[key];
  const range = (get("range") ?? "last7") as DashboardRangeKey;
  const today = zonedDateString(now, timeZone);

  if (range === "today") {
    return { key: "today", label: "Today", startDate: today, endDate: today, timeZone };
  }

  if (range === "yesterday") {
    const yesterday = addDays(today, -1);
    return { key: "yesterday", label: "Yesterday", startDate: yesterday, endDate: yesterday, timeZone };
  }

  if (range === "thisMonth") {
    return {
      key: "thisMonth",
      label: "This month",
      startDate: monthStart(today),
      endDate: today,
      timeZone
    };
  }

  if (range === "lastMonth") {
    const firstThisMonth = monthStart(today);
    const lastMonthEnd = addDays(firstThisMonth, -1);
    return {
      key: "lastMonth",
      label: "Last month",
      startDate: monthStart(lastMonthEnd),
      endDate: lastMonthEnd,
      timeZone
    };
  }

  if (range === "custom") {
    const start = normalizeDateInput(get("start"));
    const end = normalizeDateInput(get("end"));
    if (start && end && start <= end) {
      return { key: "custom", label: "Custom", startDate: start, endDate: end, timeZone };
    }
  }

  return {
    key: "last7",
    label: "Last 7 days",
    startDate: addDays(today, -6),
    endDate: today,
    timeZone
  };
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function zonedDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateText: string, days: number): string {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStart(dateText: string): string {
  return `${dateText.slice(0, 8)}01`;
}

function normalizeDateInput(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  return value;
}
