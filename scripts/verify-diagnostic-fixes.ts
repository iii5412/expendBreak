import fs from 'node:fs';
import assert from 'node:assert/strict';
import { calculateMonthSummary, getAccountingPeriod, isDateInPeriod } from '../src/utils/calculations';
import { calculateMonthlyCardSettlementSummary } from '../src/utils/cardPayments';
import { calculateFutureCommitments } from '../src/utils/futureCommitments';
import { summarizeHistory, isTransactionInPeriod, matchesHistoryKind } from '../src/utils/history';
const files=process.argv.slice(2);
if(files.length!==2) throw Error('Provide August and September diagnostic JSON paths.');
const outputs=files.map(path=>{
 const data=JSON.parse(fs.readFileSync(path,'utf8').replace(/^\uFEFF/,''));
 const {records:r,classification:c,context:ctx}=data;
 const ym=ctx.selectedYearMonth;
 const templates=r.recurringTemplates.filter((t:any)=>!c.excludedCardSettlementTemplateIds.includes(t.id));
 const transactions=r.transactions.filter((t:any)=>!c.excludedCardSettlementTemplateIds.includes(t.recurringTemplateId));
 const occurrences=r.recurringOccurrences.filter((o:any)=>!c.excludedCardSettlementTemplateIds.includes(o.templateId));
 const period=getAccountingPeriod(ym,ctx.monthStartDay,new Date(data.exportedAt));
 const cards=calculateMonthlyCardSettlementSummary(ym,transactions,r.paymentCards,ctx.monthStartDay,occurrences,templates);
 const summary=calculateMonthSummary(ym,transactions,occurrences.filter((o:any)=>isDateInPeriod(o.scheduledDate,period)),r.budget,templates,new Date(data.exportedAt),ctx.monthStartDay,{cardSettlementOutflow:cards.totalAmount,baseline:r.cycleBaseline,reserveUnmaterializedTemplates:false});
 const future=calculateFutureCommitments(ym,transactions,templates,occurrences,r.paymentCards,ctx.monthStartDay);
 const history=r.transactions.filter((t:any)=>isTransactionInPeriod(t,'spending',new Date(data.exportedAt),period)&&matchesHistoryKind(t,'regular_expense'));
 assert.equal(summarizeHistory(history,new Set(c.excludedCardSettlementTemplateIds),ym).expense,summary.confirmedVariableExpenses);
 assert.equal(future.months[0].accountFixed,summary.accountFixedOutflow,'selected period reconciles with long-range commitments');
 const ledger=r.transactions.filter((t:any)=>isDateInPeriod(t.localDate,period));
 assert.equal(summarizeHistory(ledger,new Set(c.excludedCardSettlementTemplateIds)).expense,summary.confirmedExpenses);
 if(ym==='2026-08') {assert.equal(summary.spendDaysRemaining,3);assert.equal(summary.spendPeriodStatus,'active');assert.equal(summary.spendPeriodStartDate,'2026-08-10');assert.equal(summary.spendPeriodEndDate,'2026-09-09');}
 if(ym==='2026-09') {assert.equal(summary.budgetUsagePercent,null);assert.equal(summary.configuredLimitUsagePercent,0);assert.equal(summary.spendPeriodStatus,'upcoming');assert.equal(summary.confirmedVariableExpenses,0);assert.equal(summary.daysRemaining,30);assert.equal(summary.accountFixedOutflow,4267996);}
 const expectedSpend=transactions.filter((t:any)=>t.type==='expense'&&!t.recurringTemplateId&&(!t.role||t.role==='normal')&&t.localDate>=period.startDate&&t.localDate<=period.endDate).reduce((sum:number,t:any)=>sum+Math.round(t.amount),0);
 assert.equal(transactions.some((t:any)=>t.installment),false,'snapshot oracle expects no installments');
 assert.equal(summary.confirmedVariableExpenses,expectedSpend,'independent date-only snapshot total');
 const septemberCards=transactions.filter((t:any)=>t.type==='expense'&&t.paymentMethodType==='card'&&r.paymentCards.some((card:any)=>card.id===t.cardId&&card.cardType==='credit')&&(!t.role||t.role==='normal')&&t.localDate>='2026-09-01'&&t.localDate<='2026-09-30');
 const october=calculateMonthlyCardSettlementSummary('2026-10',septemberCards,r.paymentCards.map((card:any)=>({...card,monthlyPaymentAmounts:{}})),ctx.monthStartDay);
 assert.equal(october.totalAmount,septemberCards.reduce((sum:number,t:any)=>sum+Math.round(t.amount),0));
 assert.ok(october.cards.every(card=>card.paymentDate==='2026-10-10'&&card.usageStartDate==='2026-09-01'&&card.usageEndDate==='2026-09-30'));
 return {yearMonth:ym,summary,future,history:summarizeHistory(ledger,new Set(c.excludedCardSettlementTemplateIds))};
});
for(const month of outputs[0].future.months) {
 const other=outputs[1].future.months.find((m:any)=>m.yearMonth===month.yearMonth);
 if(other) assert.deepEqual(month,other,'future projection must not depend on selected month');
}
fs.writeFileSync('artifacts/diagnostic-fixes-verified.json',JSON.stringify(outputs,null,2));
console.log('PASS: both input snapshots, all overlapping future periods, consumption history, settlement exclusions, monthly override, payday cycle boundaries, calendar card billing, zero capacity.');
console.log(JSON.stringify(outputs.map(x=>({yearMonth:x.yearMonth,accountFixed:x.summary.accountFixedOutflow,spending:x.summary.confirmedVariableExpenses,range:[x.summary.spendPeriodStartDate,x.summary.spendPeriodEndDate],status:x.summary.spendPeriodStatus,november:x.future.months.find(m=>m.yearMonth==='2026-11'),history:x.history})),null,2));
