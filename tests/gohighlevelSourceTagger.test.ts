import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureDirectWebsiteSignupLeadTag,
  extractContactTags,
  FACEBOOK_LEAD_TAG,
  isSafeDirectWebsiteSignup,
  WEBSITE_LEAD_TAG,
  type GoHighLevelContactTagClient
} from "../src/gohighlevel/sourceTagger.ts";
import type { GoHighLevelContact } from "../src/gohighlevel/client.ts";

class FakeTagClient implements GoHighLevelContactTagClient {
  readonly addedTags: string[] = [];
  private readonly contact: GoHighLevelContact;

  constructor(contact: GoHighLevelContact) {
    this.contact = contact;
  }

  async getContact(): Promise<GoHighLevelContact> {
    return this.contact;
  }

  async addContactTags(_contactId: string, tags: string[]): Promise<unknown> {
    this.addedTags.push(...tags);
    return { tags: this.addedTags };
  }
}

describe("GoHighLevel direct signup source tagger", () => {
  it("adds website lead for direct website signup with no existing source tag", async () => {
    const client = new FakeTagClient({ tags: ["customer"] });

    const result = await ensureDirectWebsiteSignupLeadTag({
      client,
      contactId: "ct_SANITIZED",
      evidence: {
        lead_source: "website",
        source_detail: "direct_signup"
      }
    });

    assert.equal(result.status, "added_website_lead_tag");
    assert.deepEqual(client.addedTags, [WEBSITE_LEAD_TAG]);
  });

  it("does not duplicate an existing website lead tag", async () => {
    const client = new FakeTagClient({ tags: ["Website Lead"] });

    const result = await ensureDirectWebsiteSignupLeadTag({
      client,
      contactId: "ct_SANITIZED",
      evidence: { lead_source: "website" }
    });

    assert.equal(result.status, "already_had_website_lead_tag");
    assert.deepEqual(client.addedTags, []);
  });

  it("preserves an existing facebook lead tag without adding website lead", async () => {
    const client = new FakeTagClient({ tags: [FACEBOOK_LEAD_TAG] });

    const result = await ensureDirectWebsiteSignupLeadTag({
      client,
      contactId: "ct_SANITIZED",
      evidence: { original_source: "website" }
    });

    assert.equal(result.status, "preserved_existing_facebook_lead_tag");
    assert.deepEqual(client.addedTags, []);
  });

  it("does not add website lead for unknown direct signup source", async () => {
    const client = new FakeTagClient({ tags: [] });

    const result = await ensureDirectWebsiteSignupLeadTag({
      client,
      contactId: "ct_SANITIZED",
      evidence: {
        source: "unknown",
        source_detail: "direct_signup"
      }
    });

    assert.equal(result.status, "skipped_unsafe_source");
    assert.deepEqual(client.addedTags, []);
  });

  it("does not use source_detail direct_signup by itself as source proof", async () => {
    const client = new FakeTagClient({ tags: [] });

    const result = await ensureDirectWebsiteSignupLeadTag({
      client,
      contactId: "ct_SANITIZED",
      evidence: {
        source_detail: "direct_signup"
      }
    });

    assert.equal(result.status, "skipped_unsafe_source");
    assert.deepEqual(client.addedTags, []);
  });

  it("accepts lead_source website as safe source proof", () => {
    assert.equal(isSafeDirectWebsiteSignup({
      lead_source: "website",
      source_detail: "direct_signup"
    }), true);
  });

  it("accepts original_source website as safe source proof", () => {
    assert.equal(isSafeDirectWebsiteSignup({
      original_source: "website",
      source_detail: "direct_signup"
    }), true);
  });

  it("supports a trusted website direct signup route as safe source proof", () => {
    assert.equal(isSafeDirectWebsiteSignup({
      trustedWebsiteDirectSignupRoute: true,
      source_detail: "direct_signup"
    }), true);
  });

  it("extracts current tags from common HighLevel contact response shapes", () => {
    assert.deepEqual(extractContactTags({ tags: ["website lead"] }), ["website lead"]);
    assert.deepEqual(extractContactTags({
      contact: {
        tags: [{ name: "facebook lead" }, { value: "ignored" }]
      }
    }), ["facebook lead"]);
  });
});
