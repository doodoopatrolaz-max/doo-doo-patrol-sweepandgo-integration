import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderDashboard,renderDashboardLogin} from '../src/dashboard/render.ts';
import {EmptyDashboardDataSource} from '../src/dashboard/service.ts';
import {parseDashboardDateRange} from '../src/dashboard/dateRange.ts';
import type {DashboardData} from '../src/dashboard/types.ts';
async function fixture():Promise<DashboardData>{
 const ds=new EmptyDashboardDataSource();const range=parseDashboardDateRange({range:'custom',start:'2026-01-01',end:'2026-01-31'});
 const summary=await ds.getSummary(range);const sources=await ds.getSources(range);
 Object.assign(summary,{totalActiveClients:100,totalActiveClientsAsOf:'2026-02-01T14:00:00Z',netRecurringCustomerGrowth:2,totalLeads:10,totalAdSpend:100,googleSpend:100,metaSpend:0,newRecurringCustomers:2,cancellations:0,churnRate:0,churnRateDenominator:98,costPerLead:10,costPerNewRecurringCustomer:50,costPerNewRecurringCustomerStatus:'available',averageRevenuePerShiftHour:25,googleAdsStatus:{connected:true,latestFailed:false,hasHistoricalPerformance:true}});
 summary.closeRateMetrics.totalMatchedConversions=2;summary.closeRateMetrics.totalCloseRate=20;
 summary.closeRateMetrics.sourceBreakdown.website_paid={leads:6,conversions:1,closeRate:16.67};summary.closeRateMetrics.sourceBreakdown.facebook={leads:4,conversions:1,closeRate:25};
 sources.leadSources=[{source:'website_paid',leads:6,newRecurringCustomers:1},{source:'facebook',leads:4,newRecurringCustomers:1}];
 sources.campaignPerformance=[{provider:'google_ads',campaignCount:1,spend:100,impressions:1000,clicks:20,averageCpc:5,leads:0,conversions:2,adPlatformConversions:2,costPerAdPlatformConversion:50,dashboardLeads:6}];
 return {summary,sources,trends:await ds.getTrends(range),syncHealth:{rows:[]}};
}
test('eight-card owner layout retains live values without mutating data',async()=>{const data=await fixture(),before=JSON.stringify(data),html=renderDashboard(data);assert.equal(JSON.stringify(data),before);const primary=html.split('class="cards owner-scoreboard primary"')[1].split('</section>')[0];assert.equal((primary.match(/<article /g)||[]).length,8);for(const value of ['100','+2','10','20%','0%','$25.00'])assert(primary.includes('>'+value+'</strong>'));assert(primary.includes('Per lead'));assert(primary.includes('$10.00'));assert(primary.includes('$50.00'));for(const label of ['One-Time Cleanups','New Recurring Customers','Average Monthly Ticket','Lifetime Value','Recurring Route Productivity','Data Notes','Sync Health'])assert(html.includes(label));assert(html.includes('datetime="2026-02-01T14:00:00Z"'));assert(html.includes('Updated Feb 1, 7:00 AM MST'));assert(!html.includes('Saved Nov 2'));assert(!html.includes('Layout preview'));});
test('channel details preserve Facebook activity without claiming Meta spend or ad-linked customers',async()=>{const html=renderDashboard(await fixture()),fb=html.split('aria-label="Facebook / Meta acquisition details"')[1].split('</section>')[0],google=html.split('aria-label="Google acquisition details"')[1].split('</section>')[0];assert(fb.includes('Facebook leads · all sources</dt><dd>4'));assert(fb.includes('Facebook conversions</dt><dd>1'));assert(fb.includes('Not available · no spend rows'));assert(google.includes('$100.00 · recorded'));assert(google.includes('Website Paid leads · proxy</dt><dd>6'));assert(google.includes('Paid-channel CPL</dt><dd>Not available'));assert(google.includes('not unique paying customers'));});
test('missing spend, recorded zero, disconnected Google and missing customer denominator remain distinct',async()=>{const data=await fixture();data.sources.campaignPerformance.push({...data.sources.campaignPerformance[0],provider:'meta',spend:0,adPlatformConversions:0,costPerAdPlatformConversion:null});assert(renderDashboard(data).includes('$0.00 · recorded zero'));data.summary.googleAdsStatus.connected=false;assert(renderDashboard(data).includes('Not available · Google not connected'));data.sources.campaignPerformance=[];data.summary.googleAdsStatus.connected=true;data.summary.newRecurringCustomers=0;data.summary.costPerNewRecurringCustomer=0;const html=renderDashboard(data);assert.equal((html.match(/Not available · no spend rows/g)||[]).length,2);assert(html.includes('Per new recurring unavailable: no new recurring signups'));assert(html.includes('class="unavailable-value">Unavailable'));});
test('date form, authentication and responsive disclosures remain native',async()=>{const html=renderDashboard(await fixture());assert(html.includes('method="get" action="/dashboard"'));assert(html.includes('name="start"'));assert(html.includes('name="end"'));assert(html.includes('href="/dashboard/logout"'));assert(html.includes('class="metric-details"'));assert(html.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));assert(html.includes('class="table-scroll"'));const login=renderDashboardLogin({disabled:false});assert(login.includes('action="/dashboard/login"'));assert(login.includes('type="password"'));assert(login.includes('autocomplete="current-password"'));});
test('closing source details pair existing cohort conversions and rates, including empty denominators',async()=>{
 const data=await fixture();
 data.summary.closeRateMetrics.sourceBreakdown.website_paid={leads:2,conversions:2,closeRate:100};
 data.summary.closeRateMetrics.sourceBreakdown.facebook={leads:1,conversions:1,closeRate:100};
 let html=renderDashboard(data);
 assert(html.includes('Website Paid</dt><dd class="">2 · 100%</dd>'));
 assert(html.includes('Facebook</dt><dd class="">1 · 100%</dd>'));
 assert(html.includes('0 · No leads</dd>'));
 data.summary.closeRateMetrics.sourceBreakdown.facebook={leads:3,conversions:0,closeRate:0};
 html=renderDashboard(data);assert(html.includes('Facebook</dt><dd class="">0 · 0%</dd>'));
 data.summary.closeRateMetrics.sourceBreakdown.facebook={leads:3,conversions:1,closeRate:33.33};
 html=renderDashboard(data);assert(html.includes('Facebook</dt><dd class="">1 · 33.33%</dd>'));
});
