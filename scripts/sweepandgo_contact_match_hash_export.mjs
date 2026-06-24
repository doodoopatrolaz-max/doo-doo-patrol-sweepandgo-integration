import crypto from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db/pool.ts";

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

function dateOnly(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

async function main() {
  const config = loadConfig();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = await createPool(config.databaseUrl);
  try {
    const result = await pool.query(
      `SELECT cu.id AS customer_id,
              c.primary_email,
              c.primary_phone,
              cu.first_recurring_date
       FROM customers cu
       JOIN contacts c ON c.id = cu.contact_id
       WHERE cu.external_sweepgo_id IS NOT NULL
       ORDER BY cu.created_at ASC`
    );

    const rows = result.rows.map((row) => {
      const email = normalizeEmail(row.primary_email);
      const phone = normalizePhone(row.primary_phone);
      return {
        customerKey: hmac(String(row.customer_id)),
        emailHash: email ? hmac(`email:${email}`) : null,
        phoneHash: phone ? hmac(`phone:${phone}`) : null,
        firstRecurringDate: dateOnly(row.first_recurring_date)
      };
    });

    process.stdout.write(
      `${JSON.stringify({
        version: 1,
        rowCount: rows.length,
        rows
      })}\n`
    );
  } finally {
    await pool.end();
  }
}

await main();
