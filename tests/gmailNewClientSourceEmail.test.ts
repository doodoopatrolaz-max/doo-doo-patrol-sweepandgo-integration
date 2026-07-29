import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchNewClientSourceEmail,
  parseSweepAndGoNewClientEmail
} from "../src/gmail/newClientSourceEmail.ts";
import { PostgresNewClientSourceEmailStore } from "../src/gmail/newClientSourceStore.ts";

const baseEmail = {
  messageId: "msg-test-1",
  subject: "Client with name \"Test Customer\" created new account",
  from: "SweepAndGo noreply@sweepandgo.com",
  receivedAt: "2026-07-26T15:00:00.000Z",
  body: [
    "A new client has just created an account",
    "",
    "Number Of Dogs",
    "",
    "2",
    "",
    "Clean Up Frequency",
    "",
    "One Time",
    "",
    "First Name",
    "",
    "Test",
    "",
    "Last Name",
    "",
    "Customer",
    "",
    "Email Address",
    "",
    "cleanup@example.invalid",
    "",
    "Cell Phone Number",
    "",
    "5550100",
    "",
    "Zip Code",
    "",
    "85000",
    "",
    "Home Address",
    "",
    "123 Test St",
    "",
    "How you heard about us",
    "",
    "Vehicle Signage"
  ].join("\n")
};

describe("Sweep&Go new-client email source capture", () => {
  it("parses Sweep&Go new-client email table fields", () => {
    const parsed = parseSweepAndGoNewClientEmail(baseEmail);

    assert.equal(parsed.cleanUpFrequency, "One Time");
    assert.equal(parsed.numberOfDogs, "2");
    assert.equal(parsed.firstName, "Test");
    assert.equal(parsed.lastName, "Customer");
    assert.equal(parsed.zipCode, "85000");
    assert.equal(parsed.howHeardAboutUs, "Vehicle Signage");
    assert.equal(parsed.sourceBucket, "truck_wrap");
  });

  it("maps Search Engine plus Google to Website Paid", () => {
    const parsed = parseSweepAndGoNewClientEmail({
      ...baseEmail,
      messageId: "msg-google",
      body: baseEmail.body
        .replace("Vehicle Signage", "Search Engine")
        .concat("\n\nHow you heard about us details\n\nGoogle")
    });

    assert.equal(parsed.howHeardAboutUs, "Search Engine");
    assert.equal(parsed.howHeardAboutUsDetails, "Google");
    assert.equal(parsed.sourceBucket, "website_paid");
  });

  it("matches one-time cleanup email evidence by safe email/date keys", () => {
    const parsed = parseSweepAndGoNewClientEmail(baseEmail);
    const match = matchNewClientSourceEmail(parsed, [
      {
        id: "intake-1",
        entityType: "one_time_cleanup_intake",
        businessDate: "2026-07-26",
        email: "cleanup@example.invalid"
      }
    ]);

    assert.equal(match.status, "matched");
    assert.equal(match.status === "matched" ? match.matchMethod : undefined, "email_date");
  });

  it("matches recurring signup email evidence by safe phone/date keys", () => {
    const parsed = parseSweepAndGoNewClientEmail(baseEmail);
    const match = matchNewClientSourceEmail(parsed, [
      {
        id: "customer-1",
        entityType: "recurring_customer",
        businessDate: "2026-07-26",
        phone: "(555) 0100"
      }
    ]);

    assert.equal(match.status, "matched");
    assert.equal(match.status === "matched" ? match.matchMethod : undefined, "phone_date");
  });

  it("routes multiple possible matches to needs review", () => {
    const parsed = parseSweepAndGoNewClientEmail(baseEmail);
    const match = matchNewClientSourceEmail(parsed, [
      {
        id: "intake-1",
        entityType: "one_time_cleanup_intake",
        businessDate: "2026-07-26",
        email: "cleanup@example.invalid"
      },
      {
        id: "intake-2",
        entityType: "one_time_cleanup_intake",
        businessDate: "2026-07-26",
        email: "cleanup@example.invalid"
      }
    ]);

    assert.equal(match.status, "needs_review");
  });

  it("does not process the same matched email twice", async () => {
    class ExistingMatchedPool {
      readonly queries: Array<{ sql: string; params: unknown[] }> = [];

      async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM sweepandgo_new_client_email_sources")) {
          return { rows: [{ match_status: "matched" }] };
        }
        return { rows: [] };
      }
    }

    const pool = new ExistingMatchedPool();
    const result = await new PostgresNewClientSourceEmailStore(pool).apply(parseSweepAndGoNewClientEmail(baseEmail));

    assert.equal(result.status, "skipped_existing");
    assert.equal(pool.queries.length, 1);
  });

  it("matches duplicate one-time intake rows as one deduped cleanup candidate", async () => {
    class DuplicateOneTimePool {
      readonly queries: Array<{ sql: string; params: unknown[] }> = [];

      async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM sweepandgo_new_client_email_sources")) {
          return { rows: [] };
        }
        if (sql.includes("FROM onboarding_intakes")) {
          return {
            rows: [
              {
                id: "5",
                business_date: "2026-07-26",
                customer_email: "cleanup@example.invalid",
                customer_name: "Test Customer",
                client_identifier: "client-duplicate",
                verified_details: {},
                payload: {},
                webhook_payload: {}
              },
              {
                id: "6",
                business_date: "2026-07-26",
                customer_email: "cleanup@example.invalid",
                customer_name: "Test Customer",
                client_identifier: "client-duplicate",
                verified_details: {},
                payload: {},
                webhook_payload: {}
              }
            ]
          };
        }
        return { rows: [] };
      }
    }

    const pool = new DuplicateOneTimePool();
    const result = await new PostgresNewClientSourceEmailStore(pool).apply(parseSweepAndGoNewClientEmail(baseEmail));

    assert.equal(result.status, "matched");
    assert.equal(result.entityType, "one_time_cleanup_intake");
    assert.equal(result.matchMethod, "email_date");
  });

  it("matches a singleton same-date recurring source email when no safer key is available", async () => {
    class SingletonRecurringPool {
      readonly queries: Array<{ sql: string; params: unknown[] }> = [];

      async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("SELECT match_status")) {
          return { rows: [] };
        }
        if (sql.includes("COUNT(*)::int AS count")) {
          return { rows: [{ count: 0 }] };
        }
        if (sql.includes("FROM customers c")) {
          return {
            rows: [{
              id: "customer-1",
              business_date: "2026-07-26",
              external_sweepgo_id: "stable-client-1",
              source: "unknown",
              source_raw: null,
              metadata: {},
              primary_email: null,
              primary_phone: null,
              full_name: null,
              first_name: null,
              last_name: null,
              service_address: null
            }]
          };
        }
        return { rows: [] };
      }
    }

    const parsed = parseSweepAndGoNewClientEmail(searchEngineGoogleRecurringEmail());
    const pool = new SingletonRecurringPool();
    const result = await new PostgresNewClientSourceEmailStore(pool).apply(parsed, {
      allowSingletonRecurringDateFallback: true
    });

    assert.equal(result.status, "matched");
    assert.equal(result.entityType, "recurring_customer");
    assert.equal(result.matchMethod, "singleton_recurring_customer_date");
    assert(pool.queries.some((query) => query.sql.includes("INSERT INTO customer_sources")));
    assert(pool.queries.some((query) => query.sql.includes("ON CONFLICT (customer_id, source_provider, source_raw)")));
  });

  it("does not singleton-match recurring source email evidence when another recurring email exists for the date", async () => {
    class ExistingEvidencePool {
      readonly queries: Array<{ sql: string; params: unknown[] }> = [];

      async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("SELECT match_status")) {
          return { rows: [] };
        }
        if (sql.includes("COUNT(*)::int AS count")) {
          return { rows: [{ count: 1 }] };
        }
        if (sql.includes("FROM customers c")) {
          return {
            rows: [{
              id: "customer-1",
              business_date: "2026-07-26",
              source: "unknown",
              source_raw: null,
              primary_email: null,
              primary_phone: null
            }]
          };
        }
        return { rows: [] };
      }
    }

    const result = await new PostgresNewClientSourceEmailStore(new ExistingEvidencePool()).apply(
      parseSweepAndGoNewClientEmail(searchEngineGoogleRecurringEmail()),
      { allowSingletonRecurringDateFallback: true }
    );

    assert.equal(result.status, "unmatched");
    assert.equal(result.reviewReason, "no_safe_match");
  });

  it("does not singleton-match when the only recurring customer already has source evidence", async () => {
    class ExistingSourcePool {
      readonly queries: Array<{ sql: string; params: unknown[] }> = [];

      async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("SELECT match_status")) {
          return { rows: [] };
        }
        if (sql.includes("COUNT(*)::int AS count")) {
          return { rows: [{ count: 0 }] };
        }
        if (sql.includes("FROM customers c")) {
          return {
            rows: [{
              id: "customer-1",
              business_date: "2026-07-26",
              source: "website",
              source_raw: "Website",
              primary_email: null,
              primary_phone: null
            }]
          };
        }
        return { rows: [] };
      }
    }

    const result = await new PostgresNewClientSourceEmailStore(new ExistingSourcePool()).apply(
      parseSweepAndGoNewClientEmail(searchEngineGoogleRecurringEmail()),
      { allowSingletonRecurringDateFallback: true }
    );

    assert.equal(result.status, "unmatched");
    assert.equal(result.reviewReason, "no_safe_match");
  });

  it("stores needs-review evidence without raw message body when no safe match exists", async () => {
    class NoMatchPool {
      readonly queries: Array<{ sql: string; params: unknown[] }> = [];

      async query(sql: string, params: unknown[] = []) {
        this.queries.push({ sql, params });
        if (sql.includes("FROM sweepandgo_new_client_email_sources")) {
          return { rows: [] };
        }
        if (sql.includes("FROM onboarding_intakes")) {
          return { rows: [] };
        }
        return { rows: [] };
      }
    }

    const pool = new NoMatchPool();
    const result = await new PostgresNewClientSourceEmailStore(pool).apply(parseSweepAndGoNewClientEmail(baseEmail));
    const insert = pool.queries.find((query) => query.sql.includes("INSERT INTO sweepandgo_new_client_email_sources"));

    assert.equal(result.status, "unmatched");
    assert(insert);
    assert(!JSON.stringify(insert?.params).includes("A new client has just created an account"));
  });
});

function searchEngineGoogleRecurringEmail() {
  return {
    ...baseEmail,
    messageId: "msg-google-recurring",
    body: baseEmail.body
      .replace("One Time", "Once A Week")
      .replace("Vehicle Signage", "Search Engine")
      .concat("\n\nHow you heard about us details\n\nGoogle")
  };
}
