import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_DAILY_SWEEPGO_MAX_PAGES, maxPagesFromArgs } from "../src/sweepandgo/sync.ts";

describe("Sweep&Go sync max pages", () => {
  it("defaults the daily sync to the wider production page limit", () => {
    assert.equal(DEFAULT_DAILY_SWEEPGO_MAX_PAGES, 25);
    assert.equal(maxPagesFromArgs([], DEFAULT_DAILY_SWEEPGO_MAX_PAGES), 25);
  });

  it("allows an explicit max-pages override", () => {
    assert.equal(maxPagesFromArgs(["--max-pages=7"], DEFAULT_DAILY_SWEEPGO_MAX_PAGES), 7);
  });
});
