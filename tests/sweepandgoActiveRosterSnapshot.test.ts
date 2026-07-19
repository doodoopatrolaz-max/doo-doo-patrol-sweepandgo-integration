import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildActiveRosterSnapshot, upsertActiveRosterSnapshot } from "../src/sweepandgo/activeRosterSnapshot.ts";

describe("Sweep&Go active roster snapshot", () => {
  it("maps the official active count plus active roster aggregates without private rows", async () => {
    const snapshot = await buildActiveRosterSnapshot({
      snapshotDate: "2026-07-18",
      maxPages: 2,
      client: {
        async countActiveClients() {
          return { data: 258 };
        },
        async getActiveClients() {
          return {
            data: [
              { client: "client-1", status: "active", subscription_names: "Regular Plan", one_time_client: false },
              { client: "client-2", status: "active", subscription_names: null, one_time_client: false },
              { client: "client-3", status: "active", subscription_names: "One Time", one_time_client: true }
            ],
            pagesFetched: 1
          };
        },
        async getActiveClientsWithoutSubscription() {
          return {
            data: [
              { client: "client-2", status: "active", subscription_names: null, one_time_client: false }
            ],
            pagesFetched: 1
          };
        }
      }
    });

    assert.equal(snapshot.activeClientCount, 258);
    assert.equal(snapshot.activeApiClientCount, 3);
    assert.equal(snapshot.activeNoSubscriptionCount, 1);
    assert.equal(snapshot.derivedActiveWithSubscriptionCount, 2);
    assert.equal(snapshot.derivedActiveRecurringCount, 1);
    assert.equal(snapshot.recordsRead, 5);
    assert.equal(snapshot.recordsWritten, 1);
  });

  it("upserts snapshots idempotently by date and source", async () => {
    const pool = new RecordingPool();

    await upsertActiveRosterSnapshot(pool, {
      snapshotDate: "2026-07-18",
      source: "sweepandgo_count_active_clients",
      activeClientCount: 258,
      activeApiClientCount: 225,
      activeNoSubscriptionCount: 39,
      derivedActiveWithSubscriptionCount: 186,
      derivedActiveRecurringCount: 183,
      sourceReportCount: 258,
      recordsRead: 265,
      recordsWritten: 1,
      activePagesFetched: 15,
      activeNoSubscriptionPagesFetched: 3
    });

    assert.equal(pool.queries.length, 1);
    assert(pool.queries[0].sql.includes("ON CONFLICT (snapshot_date, source)"));
    assert.equal(pool.queries[0].params[2], 258);
    assert.equal(JSON.parse(String(pool.queries[0].params[8])).containsPrivateRosterRows, false);
  });
});

class RecordingPool {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];

  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    return { rows: [] };
  }
}
