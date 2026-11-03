import type { DashboardDateRange } from './dateRange.ts';

export type RecurringReturn = {
  customerId: string;
  episodeKey: string;
  returnedAt: string;
  verified: boolean;
  priorRecurringVerified: boolean;
  recurringServiceVerified: boolean;
  kind: 'return' | 'pause_resume';
  // This is an evidence-backed classification, not an invented cancellation date.
  priorLossTiming: 'earlier_month' | 'same_month' | 'unknown';
};
export type RecurringReturnMetrics = {
  count: number;
  growthContribution: number;
  sameMonthResumptions: number;
  needsReview: number;
  available: boolean;
};
export function recurringReturnMetrics(rows: RecurringReturn[], range: DashboardDateRange): RecurringReturnMetrics {
  const result = {count:0,growthContribution:0,sameMonthResumptions:0,needsReview:0,available:true};
  const dates = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'});
  // Resolve all versions before filtering the window: duplicate deliveries cannot move an episode's date.
  const episodes = new Map<string, RecurringReturn>();
  for(const row of rows){
    if(!row.customerId || !row.episodeKey || !Number.isFinite(Date.parse(row.returnedAt))) continue;
    const key=`${row.customerId}:${row.episodeKey}`;const previous=episodes.get(key);
    if (!previous) episodes.set(key,row);
    else {
      const earliest = Date.parse(row.returnedAt)<Date.parse(previous.returnedAt) ? row : previous;
      const consistent = previous.priorLossTiming===row.priorLossTiming && previous.kind===row.kind
        && previous.priorRecurringVerified===row.priorRecurringVerified && previous.recurringServiceVerified===row.recurringServiceVerified;
      episodes.set(key,{...earliest,verified:previous.verified && row.verified && consistent});
    }
  }
  const customerDays = new Map<string, RecurringReturn[]>();
  for(const row of episodes.values()){
    const day=dates.format(new Date(row.returnedAt));
    if(day<range.startDate || day>range.endDate || row.kind==='pause_resume') continue;
    const key=`${row.customerId}:${day}`;
    customerDays.set(key,[...(customerDays.get(key) ?? []),row]);
  }
  for(const group of customerDays.values()){
    if(group.some(row=>!row.verified || !row.priorRecurringVerified || !row.recurringServiceVerified)){result.needsReview++;continue;}
    result.count++;
    const timings=new Set(group.map(row=>row.priorLossTiming));
    if(timings.size!==1 || timings.has('unknown')) result.needsReview++;
    else if(timings.has('same_month')) result.sameMonthResumptions++;
    else result.growthContribution++;
  }
  return result;
}
