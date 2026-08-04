import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDashboardSource } from "../src/dashboard/sourceAttribution.ts";

describe("dashboard source attribution classifier", () => {
  it("maps gclid proof to Website Paid", () => {
    const result = classifyDashboardSource({ tracking_field: "utm_source=google&gclid=click-proof" });

    assert.equal(result.bucket, "website_paid");
    assert.equal(result.paidProof, true);
  });

  it("maps paid Google UTM medium to Website Paid", () => {
    const result = classifyDashboardSource({ utm_source: "google", utm_medium: "cpc", utm_campaign: "safe-campaign" });

    assert.equal(result.bucket, "website_paid");
    assert.equal(result.paidProof, true);
  });

  it("maps Google Ads attribution text to Website Paid", () => {
    const result = classifyDashboardSource({ attribution: { source: "Google Ads", medium: "Paid Search" } });

    assert.equal(result.bucket, "website_paid");
    assert.equal(result.paidProof, true);
  });

  it("maps Search Engine plus Google to Website Paid by owner-approved dashboard rule", () => {
    const result = classifyDashboardSource({
      how_heard_answer: "Search Engine",
      how_heard_about_us_details: "Google"
    });

    assert.equal(result.bucket, "website_paid");
    assert.equal(result.googleSearchOnlyProof, true);
    assert.equal(result.paidProof, false);
  });

  it("maps Search Engine alone to Website Paid by owner-approved dashboard rule", () => {
    const result = classifyDashboardSource({ how_heard_answer: "Search Engine" });

    assert.equal(result.bucket, "website_paid");
    assert.equal(result.googleSearchOnlyProof, true);
    assert.equal(result.paidProof, false);
  });

  it("maps Search Engine plus Google case-insensitively", () => {
    const result = classifyDashboardSource({
      how_heard_answer: "search engine",
      how_heard_about_us_details: "GOOGLE"
    });

    assert.equal(result.bucket, "website_paid");
    assert.equal(result.googleSearchOnlyProof, true);
    assert.equal(result.paidProof, false);
  });

  it("can map Search Engine plus Google to Website Organic by explicit config if the business rule changes", () => {
    const result = classifyDashboardSource(
      {
        how_heard_answer: "Search Engine",
        how_heard_about_us_details: "Google"
      },
      { googleSearchDefault: "website_organic" }
    );

    assert.equal(result.bucket, "website_organic");
    assert.equal(result.googleSearchOnlyProof, true);
  });

  it("maps direct website source to Website Organic when no paid proof exists", () => {
    const result = classifyDashboardSource({ lead_source: "website", source_detail: "direct_signup" });

    assert.equal(result.bucket, "website_organic");
  });

  it("preserves Facebook over website signals", () => {
    const result = classifyDashboardSource({ lead_source: "website", tags: ["facebook lead"] });

    assert.equal(result.bucket, "facebook");
  });

  it("maps Social Media plus Facebook to Facebook", () => {
    const result = classifyDashboardSource({
      how_heard_about_us: "Social Media",
      how_heard_about_us_details: "Facebook"
    });

    assert.equal(result.bucket, "facebook");
  });

  it("maps Facebook in how-heard details to Facebook", () => {
    const result = classifyDashboardSource({
      how_heard_about_us: "Social Media",
      source_detail: "Facebook"
    });

    assert.equal(result.bucket, "facebook");
  });

  it("maps referral source to Referral", () => {
    const result = classifyDashboardSource({ how_heard_answer: "Referral", source_detail: "Neighbor" });

    assert.equal(result.bucket, "referral");
    assert.equal(result.referralProof, true);
  });

  it("maps Referred By Family Or Friend how-heard evidence to Referral", () => {
    const result = classifyDashboardSource({
      how_heard_about_us: "Referred By Family Or Friend",
      how_heard_about_us_details: "Safe Referrer"
    });

    assert.equal(result.bucket, "referral");
    assert.equal(result.referralProof, true);
  });

  it("maps Family or Friend source evidence to Referral", () => {
    const result = classifyDashboardSource({ source_raw: "Family or Friend" });

    assert.equal(result.bucket, "referral");
    assert.equal(result.referralProof, true);
  });

  it("does not map unrelated comment text containing friend to Referral", () => {
    const result = classifyDashboardSource({ internal_comment: "A friend helped fill this out." });

    assert.equal(result.bucket, "other_unknown");
    assert.equal(result.referralProof, false);
  });

  it("maps truck wrap source to Truck Wrap", () => {
    const result = classifyDashboardSource({ how_heard_answer: "Saw your truck wrap" });

    assert.equal(result.bucket, "truck_wrap");
    assert.equal(result.truckWrapProof, true);
  });

  it("maps vehicle signage source to Truck Wrap", () => {
    const result = classifyDashboardSource({ how_heard_answer: "Vehicle Signage" });

    assert.equal(result.bucket, "truck_wrap");
    assert.equal(result.truckWrapProof, true);
  });

  it("keeps ambiguous source in Other/Unknown", () => {
    const result = classifyDashboardSource({ source_detail: "direct_signup" });

    assert.equal(result.bucket, "other_unknown");
  });
});
