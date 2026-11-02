import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresDashboardDataSource } from '../src/dashboard/service.ts';
import { parseDashboardDateRange } from '../src/dashboard/dateRange.ts';
type Row = Record<string, unknown>;
const range = parseDashboardDateRange({ range: 'custom', start: '2026-11-01', end: '2026-11-02' });
async function check(input: { opportunities?: Row[]; direct?: Row[]; oneTime?: Row[] }, expected: number[]) {
  const queries: string[] = [];
  const service = new PostgresDashboardDataSource({ async query(sql: string) {
    queries.push(sql);
    if (sql.includes('FROM opportunities o')) {
      assert(sql.includes("AT TIME ZONE 'America/Phoenix'"));
      assert(sql.includes('AS dashboard_lead_date'));
      assert(sql.includes('reporting_exclusions'));
      return { rows: input.opportunities ?? [] };
    }
    return { rows: [] };
  }});
  // Isolate existing intake selection while exercising real card/trend query and aggregation.
  const seams = service as unknown as {
    directSignupLeadRows: () => Promise<Row[]>;
    oneTimeCleanupSignupRows: () => Promise<Row[]>;
    leadsBySource: (r: typeof range) => Promise<{legacy: Record<string, number>;detailed:Record<string,number>}>;
  };
  seams.directSignupLeadRows = async () => input.direct ?? [];
  seams.oneTimeCleanupSignupRows = async () => input.oneTime ?? [];
  const cards = await seams.leadsBySource(range);
  const trends = await service.getTrends(range);
  assert.deepEqual(trends.map(row => row.totalLeads), expected);
  assert.equal(trends.reduce((sum, row) => sum + row.totalLeads, 0), Object.values(cards.legacy).reduce((a,b) => a+b,0));
  assert.equal(trends.reduce((sum, row) => sum + row.facebookLeads, 0), cards.legacy.facebook);
  assert.equal(trends.reduce((sum, row) => sum + row.websiteLeads, 0), cards.legacy.website);
  assert(!queries.some(sql => sql.includes('COUNT(*) FILTER (WHERE original_lead_source')));
  return {cards,trends};
}
test('same-day inquiry and one-time signup count as one reporting lead', async () => {
  await check({ opportunities: [{dashboard_email:'same@example.invalid', dashboard_lead_date:'2026-11-02',source:'website'}], oneTime:[{cleanupDate:'2026-11-02',sourceInput:{dashboard_email:'same@example.invalid',source:'website'}}]}, [0,1]);
});
test('later paid signup reattributes original lead without another signup-day credit', async () => {
  const result = await check({opportunities:[{dashboard_email:'same@example.invalid',dashboard_lead_date:'2026-11-01',source:'website',matched_customer_source_evidence:[{source_raw:'Search Engine',evidence:{how_heard_about_us:'Search Engine'}}]}],direct:[]},[1,0]);
  assert.equal(result.cards.detailed.website_paid,1);
  assert.equal(result.cards.detailed.website_organic,0);
});
test('same identity in both inputs does not create signup-day credit', async () => {
  await check({opportunities:[{dashboard_email:'same@example.invalid',dashboard_lead_date:'2026-11-01',source:'website'}],direct:[{dashboard_email:'same@example.invalid',direct_signup_lead_date:'2026-11-02',source:'Google Ads'}]},[1,0]);
});
test('standalone recurring signup keeps its signup-day lead credit', async () => {
  await check({direct:[{dashboard_email:'direct@example.invalid',direct_signup_lead_date:'2026-11-02',source:'facebook'}]},[0,1]);
});
test('distinct identities stay distinct and same identity across opportunities counts once', async () => {
  await check({opportunities:[
    {dashboard_email:'a@example.invalid',dashboard_lead_date:'2026-11-01',source:'website'},
    {dashboard_email:'a@example.invalid',dashboard_lead_date:'2026-11-02',source:'Google Ads'},
    {dashboard_email:'b@example.invalid',dashboard_lead_date:'2026-11-02',source:'facebook'},
    {dashboard_email:'c@example.invalid',dashboard_lead_date:'2026-11-02',source:'referral'},
  ]},[1,2]);
});
test('standalone one-time signup keeps its signup-day lead credit', async () => {
  await check({oneTime:[{cleanupDate:'2026-11-02',sourceInput:{dashboard_email:'single@example.invalid',source:'website'}}]},[0,1]);
});
test('accepted phone bridge merges differently formatted intake evidence', async () => {
  await check({opportunities:[{dashboard_phone:'+1 (602) 555-0199',dashboard_lead_date:'2026-11-01',source:'website'}],oneTime:[{cleanupDate:'2026-11-02',sourceInput:{dashboard_phone:'6025550199',source:'facebook'}}]},[1,0]);
});
test('evidence ordering does not move the original lead date', async () => {
  await check({opportunities:[{dashboard_email:'a@example.invalid',dashboard_lead_date:'2026-11-02',source:'Google Ads'},{dashboard_email:'a@example.invalid',dashboard_lead_date:'2026-11-01',source:'website'}]},[1,0]);
});
test('organic inquiry plus same-day one-time identity keys and Google email evidence produce one paid lead', async () => {
  const result = await check({
    opportunities: [{
      dashboard_email: 'cleanup@example.invalid',
      dashboard_phone: '+1 (602) 555-0188',
      dashboard_lead_date: '2026-11-02',
      original_lead_source: 'website',
      source: 'website'
    }],
    oneTime: [{
      cleanupDate: '2026-11-02',
      sourceInput: {
        dashboard_identity_keys: ['email:cleanup@example.invalid', 'phone:6025550188'],
        source: 'sweepandgo_webhook_payload',
        metadata: {
          email_source_evidence: [{
            how_heard_about_us: 'Search Engine',
            how_heard_about_us_details: 'Google'
          }]
        }
      }
    }]
  }, [0, 1]);
  assert.equal(result.cards.detailed.website_paid, 1);
  assert.equal(result.cards.detailed.website_organic, 0);
  assert.equal(result.trends[1].totalLeads, 1);
  assert.equal(result.trends[1].websiteLeads, 1);
});
