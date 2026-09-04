import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GmailReadOnlyClient } from "../src/gmail/readOnlyClient.ts";

const config = {
  gmailClientId: "client-id",
  gmailClientSecret: "client-secret",
  gmailRefreshToken: "refresh-token",
  gmailUserEmail: "me",
  gmailApiBaseUrl: "https://gmail.googleapis.com",
  gmailOAuthTokenUrl: "https://oauth2.googleapis.com/token"
};

describe("Gmail read-only client retry behavior", () => {
  it("retries transient network failures during OAuth refresh", async () => {
    const calls: Array<string | URL> = [];
    const sleeps: number[] = [];
    const responses: Array<Response | Error> = [
      new TypeError("fetch failed"),
      jsonResponse({ access_token: "token", expires_in: 3600 }),
      jsonResponse({ messages: [] })
    ];
    const client = new GmailReadOnlyClient(config, {
      fetchImpl: async (input) => {
        calls.push(input);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next ?? jsonResponse({});
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      baseDelayMs: 25,
      maxAttempts: 3
    });

    const messages = await client.searchNewClientEmails({
      query: 'subject:"created new account"',
      maxResults: 10
    });

    assert.deepEqual(messages, []);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [25]);
  });

  it("retries transient Gmail read HTTP failures and honors capped Retry-After", async () => {
    const sleeps: number[] = [];
    const responses: Response[] = [
      jsonResponse({ access_token: "token", expires_in: 3600 }),
      jsonResponse({ error: "temporary" }, { status: 503, headers: { "retry-after": "5" } }),
      jsonResponse({ messages: [] })
    ];
    const client = new GmailReadOnlyClient(config, {
      fetchImpl: async () => responses.shift() ?? jsonResponse({}),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      baseDelayMs: 25,
      maxDelayMs: 250,
      maxAttempts: 3
    });

    await client.searchNewClientEmails({
      query: 'subject:"created new account"',
      maxResults: 10
    });

    assert.deepEqual(sleeps, [250]);
  });

  it("does not retry OAuth credential failures", async () => {
    let calls = 0;
    const client = new GmailReadOnlyClient(config, {
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: "invalid_grant" }, { status: 401 });
      },
      sleep: async () => {
        throw new Error("credential failures should not sleep");
      },
      maxAttempts: 3
    });

    await assert.rejects(
      () => client.searchNewClientEmails({
        query: 'subject:"created new account"',
        maxResults: 10
      }),
      /Gmail OAuth refresh failed with HTTP 401/
    );
    assert.equal(calls, 1);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
}
