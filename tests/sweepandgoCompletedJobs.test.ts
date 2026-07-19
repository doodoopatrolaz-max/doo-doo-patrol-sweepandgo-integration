import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completedJobsDateRangeFromRollingDays,
  completedJobsSyncOptionsFromArgs,
} from "../src/sweepandgo/completedJobsSync.ts";
import {
  extractCompletedJobReportRows,
  mapSweepAndGoCompletedJob,
  summarizeCompletedJobFacts
} from "../src/sweepandgo/completedJobsMapper.ts";
import { SweepAndGoCompletedJobsStore } from "../src/sweepandgo/completedJobsStore.ts";

describe("Sweep&Go completed jobs mapping", () => {
  it("extracts completed job report rows from job_list", () => {
    const rows = extractCompletedJobReportRows({ job_list: [{ status_name: "completed" }, null, "skip" ] });

    assert.equal(rows.length, 1);
  });

  it("maps completed scooping rows without storing raw customer fields", () => {
    const fact = mapSweepAndGoCompletedJob({
      date: "2026-07-01",
      status_name: "completed",
      type: "recurring",
      assigned_to_id: 10,
      client_id: "private-client-id",
      price: "$65.00",
      duration: "00:30"
    });

    assert(fact);
    assert.equal(fact.serviceDate, "2026-07-01");
    assert.equal(fact.jobStatus, "completed");
    assert.equal(fact.serviceCategory, "recurring");
    assert.equal(fact.isScoop, true);
    assert.equal(fact.allocatedServicePrice, 65);
    assert.equal(fact.recordedDurationMinutes, 30);
    assert.notEqual(fact.stopFingerprint, "private-client-id");
  });

  it("classifies spray and initial revenue separately", () => {
    const spray = mapSweepAndGoCompletedJob({
      date: "2026-07-01",
      status_name: "completed",
      pricing_plan_name: "Fresh Poo Monthly Sanitize/Deodorize Application",
      price: "20",
      duration: "00:00"
    });
    const initial = mapSweepAndGoCompletedJob({
      date: "2026-07-01",
      status_name: "completed",
      type: "initial",
      price: "120",
      duration: "01:15"
    });

    assert.equal(spray?.serviceCategory, "spray");
    assert.equal(spray?.isSpray, true);
    assert.equal(initial?.serviceCategory, "initial");
    assert.equal(initial?.isInitial, true);
  });

  it("summarizes skipped, missing price, and zero-duration rows", () => {
    const facts = [
      mapSweepAndGoCompletedJob({ date: "2026-07-01", status_name: "completed", type: "recurring", price: "50", duration: "00:20" }),
      mapSweepAndGoCompletedJob({ date: "2026-07-01", status_name: "skipped", type: "recurring", price: "50", duration: "00:20" }),
      mapSweepAndGoCompletedJob({ date: "2026-07-01", status_name: "completed", type: "recurring", duration: "00:20" }),
      mapSweepAndGoCompletedJob({ date: "2026-07-01", status_name: "completed", type: "recurring", price: "10", duration: "00:00" })
    ].filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));

    const summary = summarizeCompletedJobFacts(facts);

    assert.equal(summary.rowsFound, 4);
    assert.equal(summary.rowsEligible, 3);
    assert.equal(summary.rowsExcludedByStatus, 1);
    assert.equal(summary.rowsMissingPrice, 1);
    assert.equal(summary.rowsMissingOrZeroDuration, 1);
  });
});

describe("Sweep&Go completed jobs store", () => {
  it("uses an idempotent completed job upsert", async () => {
    const pool = {
      queries: [] as Array<{ sql: string; params: unknown[] }>,
      async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        return { rows: [{ inserted: this.queries.length === 1 }] };
      }
    };
    const store = new SweepAndGoCompletedJobsStore(pool);
    const fact = mapSweepAndGoCompletedJob({
      date: "2026-07-01",
      status_name: "completed",
      type: "recurring",
      assigned_to_id: 10,
      price: "65.00",
      duration: "00:30"
    });

    assert(fact);
    const first = await store.upsertCompletedJob(fact);
    const second = await store.upsertCompletedJob(fact);

    assert.equal(first.inserted, true);
    assert.equal(second.updated, true);
    assert(pool.queries[0]?.sql.includes("ON CONFLICT (provider, job_fingerprint)"));
  });
});

describe("Sweep&Go completed jobs sync options", () => {
  it("calculates rolling days in America/Phoenix and excludes today", () => {
    const range = completedJobsDateRangeFromRollingDays(
      3,
      new Date("2026-07-19T06:30:00.000Z")
    );

    assert.deepEqual(range, {
      startDate: "2026-07-15",
      endDate: "2026-07-17"
    });
  });

  it("parses rolling-days and max-pages without breaking bounded sync limits", () => {
    const options = completedJobsSyncOptionsFromArgs([
      "--rolling-days=3",
      "--max-pages=25",
      "--dry-run"
    ]);

    assert.equal(options.maxPages, 25);
    assert.equal(options.dryRun, true);
    assert.match(options.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(options.endDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps explicit start and end support working", () => {
    const options = completedJobsSyncOptionsFromArgs([
      "--start=2026-07-01",
      "--end=2026-07-19",
      "--max-pages=19"
    ]);

    assert.equal(options.startDate, "2026-07-01");
    assert.equal(options.endDate, "2026-07-19");
    assert.equal(options.maxPages, 19);
  });
});
