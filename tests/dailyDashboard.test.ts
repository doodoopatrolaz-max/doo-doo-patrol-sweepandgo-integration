import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDailyDashboardReport,
  renderDailyDashboardEmail
} from "../src/reports/dailyDashboard.ts";

describe("daily dashboard report", () => {
  it("summarizes jobs, physical stops, drive gap, skipped jobs, and exceptions by tech", () => {
    const report = createDailyDashboardReport({
      date: "2026-06-12",
      generatedAt: new Date("2026-06-12T23:55:00.000Z"),
      dispatchResponse: {
        data: [
          {
            id: "job_1",
            tech_name: "Alex",
            customer_name: "Blue House",
            service_address: "101 Main St",
            status: "completed",
            miles: 4,
            drive_minutes: 20,
            started_at: "2026-06-12T14:00:00.000Z",
            completed_at: "2026-06-12T14:15:00.000Z"
          },
          {
            id: "job_2",
            tech_name: "Alex",
            customer_name: "Blue House",
            service_address: "101 Main St",
            status: "completed",
            miles: 3,
            drive_minutes: 10,
            started_at: "2026-06-12T14:30:00.000Z",
            completed_at: "2026-06-12T14:45:00.000Z"
          },
          {
            id: "job_3",
            tech_name: "Alex",
            customer_name: "Skipped House",
            service_address: "222 Main St",
            status: "skipped",
            miles: 1,
            drive_minutes: 5
          },
          {
            id: "job_4",
            technician: { name: "Jamie" },
            customer_name: "Green House",
            service_address: "303 Main St",
            status: "completed",
            miles: 8,
            drive_minutes: 30,
            started_at: "2026-06-12T15:00:00.000Z",
            completed_at: "2026-06-12T16:00:00.000Z"
          }
        ]
      }
    });

    const alex = report.techs.find((row) => row.techName === "Alex");
    const jamie = report.techs.find((row) => row.techName === "Jamie");

    assert(alex);
    assert(jamie);
    assert.equal(alex.jobs, 3);
    assert.equal(alex.physicalStops, 1);
    assert.equal(alex.miles, 8);
    assert.equal(alex.skippedJobs, 1);
    assert(alex.routeExceptions.includes("1 skipped job"));
    assert.equal(jamie.physicalStops, 1);
    assert.equal(report.totals.jobs, 4);
    assert.equal(report.totals.physicalStops, 2);
    assert.equal(report.totals.skippedJobs, 1);

    const email = renderDailyDashboardEmail(report);
    assert(email.subject.includes("Doo Doo Patrol daily route dashboard"));
    assert(email.text.includes("By tech:"));
    assert(email.html.includes("Route exceptions"));
  });
});
