import crypto from "node:crypto";
import fs from "node:fs";
import { parseDashboardDateRange } from "../src/dashboard/dateRange.ts";

const HASH_KEY = "ddp-sweepandgo-local-csv-dry-run-v1";

function hmac(value) {
  return crypto.createHmac("sha256", HASH_KEY).update(value).digest("hex");
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const digits = String(value).replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).filter((values) => values.some((value) => value.trim())).map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index]?.trim() ?? "";
    });
    return record;
  });
}

function validDateOnly(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function indexByHash(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!value) {
      continue;
    }
    const list = index.get(value) ?? [];
    list.push(row);
    index.set(value, list);
  }
  return index;
}

function inRange(date, range) {
  return date >= range.startDate && date <= range.endDate;
}

function main() {
  const csvPath = process.argv[2];
  const hashPath = process.argv[3];
  if (!csvPath || !hashPath) {
    throw new Error("Usage: sweepandgo_csv_first_recurring_dry_run_from_hashes.mjs <csv-path> <hash-export-path>");
  }

  const records = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const exportData = JSON.parse(fs.readFileSync(hashPath, "utf8"));
  const customerRows = Array.isArray(exportData.rows) ? exportData.rows : [];
  const emailIndex = indexByHash(customerRows, "emailHash");
  const phoneIndex = indexByHash(customerRows, "phoneHash");
  const range = parseDashboardDateRange(() => "thisMonth", {
    timeZone: "America/Phoenix",
    now: new Date()
  });

  const result = {
    csvRowsRead: records.length,
    activeRows: 0,
    rowsWithValidCreatedAt: 0,
    existingBiCustomersMatchedByEmail: 0,
    existingBiCustomersMatchedByPhone: 0,
    ambiguousMatches: 0,
    unmatchedRows: 0,
    customersEligibleForFirstRecurringDateBackfill: 0,
    monthToDateNewRecurringCustomersBeforeProposedBackfill: customerRows.filter((row) =>
      row.firstRecurringDate && inRange(row.firstRecurringDate, range)
    ).length,
    monthToDateNewRecurringCustomersAfterProposedBackfill: 0
  };

  const proposedCustomerDates = new Map(
    customerRows
      .filter((row) => row.firstRecurringDate)
      .map((row) => [row.customerKey, row.firstRecurringDate])
  );

  for (const record of records) {
    const status = String(record.Status ?? "").trim().toLowerCase();
    if (status !== "active") {
      continue;
    }
    result.activeRows += 1;

    const createdAt = validDateOnly(record["Created At"]);
    if (!createdAt) {
      continue;
    }
    result.rowsWithValidCreatedAt += 1;

    const email = normalizeEmail(record.Email);
    const phone = normalizePhone(record["Cell Phone Number"]);
    const emailMatches = email ? emailIndex.get(hmac(`email:${email}`)) ?? [] : [];
    const phoneMatches = phone ? phoneIndex.get(hmac(`phone:${phone}`)) ?? [] : [];

    let match;
    if (emailMatches.length === 1) {
      match = emailMatches[0];
      result.existingBiCustomersMatchedByEmail += 1;
    } else if (emailMatches.length > 1) {
      result.ambiguousMatches += 1;
      continue;
    } else if (phoneMatches.length === 1) {
      match = phoneMatches[0];
      result.existingBiCustomersMatchedByPhone += 1;
    } else if (phoneMatches.length > 1) {
      result.ambiguousMatches += 1;
      continue;
    } else {
      result.unmatchedRows += 1;
      continue;
    }

    if (!match.firstRecurringDate && !proposedCustomerDates.has(match.customerKey)) {
      result.customersEligibleForFirstRecurringDateBackfill += 1;
      proposedCustomerDates.set(match.customerKey, createdAt);
    }
  }

  result.monthToDateNewRecurringCustomersAfterProposedBackfill = [...proposedCustomerDates.values()].filter((date) =>
    inRange(date, range)
  ).length;

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
