import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapSweepAndGoContactDetails,
  normalizeEmail,
  normalizePhone
} from "../src/sweepandgo/contactEnrichment.ts";
import { SweepAndGoReportingStore } from "../src/sweepandgo/reportingStore.ts";

describe("Sweep&Go contact enrichment", () => {
  it("normalizes email and phone without preserving display formatting", () => {
    assert.equal(normalizeEmail("  PERSON@Example.COM "), "person@example.com");
    assert.equal(normalizeEmail("not-an-email"), undefined);
    assert.equal(normalizePhone("+1 (602) 555-0199"), "6025550199");
    assert.equal(normalizePhone("555"), undefined);
  });

  it("maps client_details email and cell phone from array responses", () => {
    const mapped = mapSweepAndGoContactDetails([
      {
        email: "  CLIENT@Example.Invalid ",
        cell_phone: "(602) 555-0101",
        home_phone: "(602) 555-0102"
      }
    ]);

    assert.equal(mapped?.email, "client@example.invalid");
    assert.equal(mapped?.cellPhone, "6025550101");
    assert.equal(mapped?.homePhone, "6025550102");
  });

  it("does not promote home phone into the approved cell phone field", () => {
    const mapped = mapSweepAndGoContactDetails([
      {
        email: "client@example.invalid",
        home_phone: "(602) 555-0102"
      }
    ]);

    assert.equal(mapped?.email, "client@example.invalid");
    assert.equal(mapped?.cellPhone, undefined);
    assert.equal(mapped?.homePhone, "6025550102");
  });

  it("reports contact fields updated only when prior values were blank", async () => {
    const pool = new FakePool({
      previousEmail: "",
      previousPhone: null,
      primaryEmail: "client@example.invalid",
      primaryPhone: "6025550101"
    });
    const store = new SweepAndGoReportingStore(pool);

    const result = await store.enrichExistingSweepAndGoContact({
      contactId: "contact-1",
      email: "client@example.invalid",
      phone: "6025550101"
    });

    assert.equal(result.emailUpdated, true);
    assert.equal(result.phoneUpdated, true);
  });

  it("does not report existing contact fields as newly updated", async () => {
    const pool = new FakePool({
      previousEmail: "existing@example.invalid",
      previousPhone: "6025550100",
      primaryEmail: "existing@example.invalid",
      primaryPhone: "6025550100"
    });
    const store = new SweepAndGoReportingStore(pool);

    const result = await store.enrichExistingSweepAndGoContact({
      contactId: "contact-1",
      email: "client@example.invalid",
      phone: "6025550101"
    });

    assert.equal(result.emailUpdated, false);
    assert.equal(result.phoneUpdated, false);
  });
});

class FakePool {
  private readonly row: Record<string, unknown>;

  constructor(input: {
    previousEmail: string | null;
    previousPhone: string | null;
    primaryEmail: string | null;
    primaryPhone: string | null;
  }) {
    this.row = {
      previous_email: input.previousEmail,
      previous_phone: input.previousPhone,
      primary_email: input.primaryEmail,
      primary_phone: input.primaryPhone
    };
  }

  async query() {
    return { rows: [this.row] };
  }
}
