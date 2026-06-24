import crypto from "node:crypto";
import fs from "node:fs";

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

function main() {
  const csvPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!csvPath || !outputPath) {
    throw new Error("Usage: sweepandgo_csv_api_bridge_payload.mjs <csv-path> <output-path>");
  }

  const records = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const rows = [];
  const summary = {
    csvRowsRead: records.length,
    activeRows: 0,
    rowsWithValidCreatedAt: 0,
    rowsCreatedInJune2026: 0,
    rowsCreatedBeforeJune2026: 0,
    rowsCreatedAfterJune2026: 0,
    activeRowsMissingEmail: 0,
    activeRowsMissingCellPhone: 0
  };

  for (const record of records) {
    const status = String(record.Status ?? "").trim().toLowerCase();
    if (status !== "active") {
      continue;
    }
    summary.activeRows += 1;

    const createdAt = validDateOnly(record["Created At"]);
    if (!createdAt) {
      continue;
    }
    summary.rowsWithValidCreatedAt += 1;
    if (createdAt >= "2026-06-01" && createdAt <= "2026-06-30") {
      summary.rowsCreatedInJune2026 += 1;
    } else if (createdAt < "2026-06-01") {
      summary.rowsCreatedBeforeJune2026 += 1;
    } else {
      summary.rowsCreatedAfterJune2026 += 1;
    }

    const email = normalizeEmail(record.Email);
    const phone = normalizePhone(record["Cell Phone Number"]);
    if (!email) {
      summary.activeRowsMissingEmail += 1;
    }
    if (!phone) {
      summary.activeRowsMissingCellPhone += 1;
    }

    rows.push({
      emailHash: email ? hmac(`email:${email}`) : null,
      phoneHash: phone ? hmac(`phone:${phone}`) : null,
      createdAt
    });
  }

  fs.writeFileSync(outputPath, `${JSON.stringify({ version: 1, summary, rows })}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
