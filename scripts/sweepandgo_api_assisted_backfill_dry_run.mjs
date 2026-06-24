import crypto from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db/pool.ts";
import { SweepAndGoClient } from "../src/sweepandgo/client.ts";
import { extractSweepAndGoRows } from "../src/sweepandgo/reportingMapper.ts";

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

function stringValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function dateOnly(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function isJune2026(date) {
  return date >= "2026-06-01" && date <= "2026-06-30";
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

function parsePayload() {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error("A base64url-encoded CSV hash payload is required");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return {
    summary: payload.summary ?? {},
    rows: Array.isArray(payload.rows) ? payload.rows : []
  };
}

async function loadBiCustomers(pool) {
  const result = await pool.query(
    `SELECT external_sweepgo_id,
            first_recurring_date
     FROM customers
     WHERE external_sweepgo_id IS NOT NULL`
  );

  return new Map(result.rows.map((row) => [
    stringValue(row.external_sweepgo_id),
    { firstRecurringDate: dateOnly(row.first_recurring_date) }
  ]));
}

async function loadBiCounts(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM customers)::int AS customers_total,
       (SELECT COUNT(*) FROM customers WHERE first_recurring_date IS NOT NULL)::int AS customers_with_first_recurring_date,
       (SELECT COUNT(*) FROM customers WHERE first_recurring_date BETWEEN '2026-06-01'::date AND '2026-06-30'::date)::int AS customers_with_first_recurring_date_in_june`
  );
  const row = result.rows[0] ?? {};
  return {
    totalBiCustomers: Number(row.customers_total ?? 0),
    totalBiCustomersWithFirstRecurringDate: Number(row.customers_with_first_recurring_date ?? 0),
    totalBiCustomersWithFirstRecurringDateInJune: Number(row.customers_with_first_recurring_date_in_june ?? 0)
  };
}

async function loadApiClients(config) {
  const client = new SweepAndGoClient(config);
  const response = await client.getActiveClients({ allPages: true, maxPages: 100 });
  const rows = extractSweepAndGoRows(response);
  return {
    apiActiveClientCount: rows.length,
    pagesFetched: typeof response === "object" && response ? Number(response.pagesFetched ?? 0) : 0,
    totalPages: typeof response === "object" && response && "paginate" in response
      ? Number(response.paginate?.total_pages ?? 0)
      : 0,
    rows: rows.map((row) => {
      const externalSweepGoId = stringValue(row.client);
      const email = normalizeEmail(row.email);
      const phone = normalizePhone(row.cell_phone);
      return {
        externalSweepGoId,
        emailHash: email ? hmac(`email:${email}`) : null,
        phoneHash: phone ? hmac(`phone:${phone}`) : null
      };
    }).filter((row) => row.externalSweepGoId)
  };
}

function resolveApiMatch(csvRow, emailIndex, phoneIndex) {
  const emailMatches = csvRow.emailHash ? emailIndex.get(csvRow.emailHash) ?? [] : [];
  const phoneMatches = csvRow.phoneHash ? phoneIndex.get(csvRow.phoneHash) ?? [] : [];
  const uniqueEmail = emailMatches.length === 1 ? emailMatches[0] : undefined;
  const uniquePhone = phoneMatches.length === 1 ? phoneMatches[0] : undefined;

  if (emailMatches.length > 1 || phoneMatches.length > 1) {
    return { type: "ambiguous" };
  }
  if (uniqueEmail && uniquePhone && uniqueEmail.externalSweepGoId !== uniquePhone.externalSweepGoId) {
    return { type: "ambiguous" };
  }
  if (uniqueEmail) {
    return { type: "email", apiClient: uniqueEmail };
  }
  if (uniquePhone) {
    return { type: "phone", apiClient: uniquePhone };
  }
  return { type: "none" };
}

async function main() {
  const payload = parsePayload();
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = await createPool(config.databaseUrl);
  try {
    const [api, biCustomers, biCounts] = await Promise.all([
      loadApiClients(config),
      loadBiCustomers(pool),
      loadBiCounts(pool)
    ]);

    const emailIndex = indexByHash(api.rows, "emailHash");
    const phoneIndex = indexByHash(api.rows, "phoneHash");
    const proposedDates = new Map();
    const result = {
      ...payload.summary,
      apiActiveClientCount: api.apiActiveClientCount,
      apiPagesFetched: api.pagesFetched,
      apiTotalPagesReported: api.totalPages,
      apiActiveRowsWithEmail: api.rows.filter((row) => row.emailHash).length,
      apiActiveRowsWithCellPhone: api.rows.filter((row) => row.phoneHash).length,
      apiDuplicateEmailMatchGroups: [...emailIndex.values()].filter((rows) => rows.length > 1).length,
      apiDuplicatePhoneMatchGroups: [...phoneIndex.values()].filter((rows) => rows.length > 1).length,
      rowsMatchedToSweepAndGoApiClientByEmail: 0,
      rowsMatchedToSweepAndGoApiClientByPhone: 0,
      rowsMatchedToBiCustomerBySweepAndGoClientId: 0,
      ambiguousApiMatches: 0,
      noApiMatch: 0,
      apiMatchButNoBiCustomerMatch: 0,
      customersEligibleForFirstRecurringDateBackfill: 0,
      duplicateCsvRowsForSameBiCustomer: 0,
      monthToDateNewRecurringBeforeProposedBackfill: biCounts.totalBiCustomersWithFirstRecurringDateInJune,
      monthToDateNewRecurringAfterProposedBackfill: 0,
      juneRowsMatchedToSweepAndGoApiClient: 0,
      juneRowsMatchedToBiCustomerBySweepAndGoClientId: 0,
      juneRowsNoApiMatch: 0,
      juneRowsApiMatchButNoBiCustomerMatch: 0,
      juneRowsEligibleForFirstRecurringDateBackfill: 0,
      ...biCounts
    };

    const matchedBiCustomers = new Set();
    for (const csvRow of payload.rows) {
      const createdAt = stringValue(csvRow.createdAt);
      const inJune = isJune2026(createdAt);
      const match = resolveApiMatch(csvRow, emailIndex, phoneIndex);
      if (match.type === "ambiguous") {
        result.ambiguousApiMatches += 1;
        continue;
      }
      if (match.type === "none") {
        result.noApiMatch += 1;
        if (inJune) {
          result.juneRowsNoApiMatch += 1;
        }
        continue;
      }

      if (match.type === "email") {
        result.rowsMatchedToSweepAndGoApiClientByEmail += 1;
      } else {
        result.rowsMatchedToSweepAndGoApiClientByPhone += 1;
      }
      if (inJune) {
        result.juneRowsMatchedToSweepAndGoApiClient += 1;
      }

      const biCustomer = biCustomers.get(match.apiClient.externalSweepGoId);
      if (!biCustomer) {
        result.apiMatchButNoBiCustomerMatch += 1;
        if (inJune) {
          result.juneRowsApiMatchButNoBiCustomerMatch += 1;
        }
        continue;
      }

      result.rowsMatchedToBiCustomerBySweepAndGoClientId += 1;
      if (inJune) {
        result.juneRowsMatchedToBiCustomerBySweepAndGoClientId += 1;
      }

      if (matchedBiCustomers.has(match.apiClient.externalSweepGoId)) {
        result.duplicateCsvRowsForSameBiCustomer += 1;
        continue;
      }
      matchedBiCustomers.add(match.apiClient.externalSweepGoId);

      if (!biCustomer.firstRecurringDate) {
        proposedDates.set(match.apiClient.externalSweepGoId, createdAt);
        if (inJune) {
          result.juneRowsEligibleForFirstRecurringDateBackfill += 1;
        }
      }
    }

    result.customersEligibleForFirstRecurringDateBackfill = proposedDates.size;
    result.monthToDateNewRecurringAfterProposedBackfill =
      result.monthToDateNewRecurringBeforeProposedBackfill +
      [...proposedDates.values()].filter(isJune2026).length;

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

await main();
