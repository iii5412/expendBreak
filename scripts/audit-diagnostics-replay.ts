import fs from 'node:fs';
import { calculateMonthSummary, getAccountingPeriod, isDateInPeriod, getScheduledDatesInPeriod } from '../src/utils/calculations';
import { calculateMonthlyCardSettlementSummary } from '../src/utils/cardPayments';
import { calculateFutureCommitments } from '../src/utils/futureCommitments';
import { matchesHistoryKind } from '../src/utils/history';
import assert from 'node:assert/strict';
const paths = process.argv.slice(2);
if (paths.length !== 2) throw Error('Provide August and September diagnostic JSON paths.');
const snapshots=paths.map(p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')));
const diffs=(a:any,b:any)=>Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>({key:k,exported:a[k],replayed:b[k]}));
const out:any[]=[];
for(const d of snapshots) {
 const r=d.records,c=d.classification,ym=d.context.selectedYearMonth,start=d.context.monthStartDay;
 for (const key of Object.keys(d.counts)) assert.equal(r[key].length,d.counts[key],`record count: ${key}`);
 for (const key of ['bankAccounts','paymentCards','recurringTemplates','recurringOccurrences','transactions','categories']) assert.equal(new Set(r[key].map((x:any)=>x.id)).size,r[key].length,`unique IDs: ${key}`);
 const templates=r.recurringTemplates.filter((x:any)=>c.planningTemplateIds.includes(x.id));
 const occurrences=r.recurringOccurrences.filter((x:any)=>c.planningOccurrenceIds.includes(x.id));
 const transactions=r.transactions.filter((x:any)=>c.planningTransactionIds.includes(x.id));
 const period=getAccountingPeriod(ym,start,new Date(d.exportedAt));
 const periodOccurrences=occurrences.filter((x:any)=>isDateInPeriod(x.scheduledDate,period));
 const cards=calculateMonthlyCardSettlementSummary(ym,r.transactions,r.paymentCards,start,occurrences,templates);
 const summary=calculateMonthSummary(ym,transactions,periodOccurrences,r.budget,templates,new Date(d.exportedAt),start,{cardSettlementOutflow:cards.totalAmount,baseline:r.cycleBaseline,reserveUnmaterializedTemplates:false});
 const future=calculateFutureCommitments(ym,r.transactions,templates,occurrences,r.paymentCards,start);
 const independent=calculateFutureCommitments('2026-09',r.transactions,r.recurringTemplates.filter((x:any)=>!x.archivedAt&&!c.excludedCardSettlementTemplateIds.includes(x.id)),occurrences,r.paymentCards,start);
 const completeTemplates=r.recurringTemplates.filter((x:any)=>!c.excludedCardSettlementTemplateIds.includes(x.id));
 const stableFuture=calculateFutureCommitments('2026-09',r.transactions,completeTemplates,occurrences,r.paymentCards,start);
 const excludedArchivedOccurrences=occurrences.filter((x:any)=>!r.recurringTemplates.some((t:any)=>t.id===x.templateId&&t.archivedAt));
 const withoutArchivedFuture=calculateFutureCommitments('2026-09',r.transactions,templates,excludedArchivedOccurrences,r.paymentCards,start);
 const historyTotals=Object.fromEntries(['all','regular_expense','fixed_expense','income'].map(kind=>{
   const ts=r.transactions.filter((t:any)=>isDateInPeriod(t.localDate,period)&&matchesHistoryKind(t,kind as any));
   return [kind,{count:ts.length,expense:ts.filter((t:any)=>t.type==='expense').reduce((s:number,t:any)=>s+t.amount,0),income:ts.filter((t:any)=>t.type==='income').reduce((s:number,t:any)=>s+t.amount,0)}];
 }));
 let cumulative=0;let capExceededAt:string|null=null;
 for(const t of [...transactions].filter((t:any)=>t.type==='expense'&&!t.recurringTemplateId&&t.role==='normal'&&!t.installment&&t.localDate.startsWith(ym)).sort((a:any,b:any)=>a.localDate.localeCompare(b.localDate))) {
   cumulative+=t.amount;if(capExceededAt===null&&cumulative>summary.spendableLimit)capExceededAt=t.localDate;
 }
 const archived=r.recurringTemplates.filter((x:any)=>x.archivedAt).map((t:any)=>({id:t.id,name:t.name,amount:t.defaultAmount,payment:t.paymentMethodType,archivedAt:t.archivedAt,inPlanning:c.planningTemplateIds.includes(t.id),occurrences:occurrences.filter((o:any)=>o.templateId===t.id).map((o:any)=>({id:o.id,date:o.scheduledDate,status:o.status,amount:o.actualAmount??o.expectedAmount,payment:o.paymentMethodType,card:o.cardId}))}));
 const accountItems=templates.filter((t:any)=>t.active&&!t.archivedAt&&t.type==='expense'&&t.paymentMethodType!=='card'&&!t.cardSettlementCardId).map((t:any)=>({id:t.id,name:t.name,default:t.defaultAmount,dates:getScheduledDatesInPeriod(t,period),occurrences:periodOccurrences.filter((o:any)=>o.templateId===t.id).map((o:any)=>({date:o.scheduledDate,status:o.status,amount:o.actualAmount??o.expectedAmount}))}));
 const tm=new Map(r.recurringTemplates.map((x:any)=>[x.id,x]));
 const cm=new Map(r.categories.map((x:any)=>[x.id,x]));
 const am=new Set(r.bankAccounts.map((x:any)=>x.id));
 const cardIds=new Set(r.paymentCards.map((x:any)=>x.id));
 const txm=new Map(r.transactions.map((x:any)=>[x.id,x]));
 const invalidLinks=r.transactions.filter((t:any)=>t.accountId&&!am.has(t.accountId)||t.cardId&&!cardIds.has(t.cardId)||t.recurringTemplateId&&!tm.has(t.recurringTemplateId));
 const recurrenceErrors=r.recurringOccurrences.filter((o:any)=>o.status==='posted').flatMap((o:any)=>{
   const t:any=txm.get(o.transactionId);if(!t)return [{id:o.id,error:'missing transaction'}];
   const errors=[];if(t.recurringOccurrenceKey!==o.occurrenceKey)errors.push('key');if(t.recurringTemplateId!==o.templateId)errors.push('template');if(t.amount!==(o.actualAmount??o.expectedAmount))errors.push('amount');if(t.type!==(o.typeSnapshot??(tm.get(o.templateId) as any)?.type))errors.push('type');return errors.length?[{id:o.id,errors}]:[];
 });
 assert.deepEqual(summary,d.calculations.monthSummary);
 assert.deepEqual(cards,d.calculations.cardSettlementSummary);
 assert.deepEqual(future,d.calculations.futureCommitments);
 out.push({ym,period,summaryDiffs:diffs(d.calculations.monthSummary,summary),cardsDiffs:diffs(d.calculations.cardSettlementSummary,cards),futureDiffs:diffs(d.calculations.futureCommitments,future),independentFuture:independent,stableFuture,withoutArchivedFuture,historyTotals,capExceededAt,archived,accountItems,invalidLinks,recurrenceErrors,
   templateCategoryErrors:r.recurringTemplates.filter((t:any)=>(cm.get(t.categoryId) as any)?.type!==t.type).map((t:any)=>({id:t.id,name:t.name})),
   excludedTransactions:r.transactions.filter((t:any)=>!c.planningTransactionIds.includes(t.id)).map((t:any)=>({id:t.id,date:t.localDate,amount:t.amount,name:t.merchant,role:t.role})),
   unlinkedRecurringTransactions:r.transactions.filter((t:any)=>t.recurringTemplateId&&!r.recurringOccurrences.some((o:any)=>o.transactionId===t.id)).map((t:any)=>({id:t.id,date:t.localDate,amount:t.amount,template:t.recurringTemplateId})),
 });
}
const a=snapshots[0],b=snapshots[1];
for(const key of ['bankAccounts','paymentCards','recurringTemplates','recurringOccurrences','transactions','categories']) assert.deepEqual(a.records[key],b.records[key]);
out.push({planningTemplatesOnlyAugust:a.classification.planningTemplateIds.filter((id:string)=>!b.classification.planningTemplateIds.includes(id)),planningTemplatesOnlySeptember:b.classification.planningTemplateIds.filter((id:string)=>!a.classification.planningTemplateIds.includes(id))});
fs.writeFileSync('artifacts/diagnostic-audit-replay.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out.map(x=>({ym:x.ym,period:x.period,summaryDiffs:x.summaryDiffs,cardsDiffs:x.cardsDiffs,futureDiffs:x.futureDiffs,invalidLinks:x.invalidLinks,recurrenceErrors:x.recurrenceErrors,templateCategoryErrors:x.templateCategoryErrors,excludedTransactions:x.excludedTransactions,unlinkedRecurringTransactions:x.unlinkedRecurringTransactions,planningTemplatesOnlyAugust:x.planningTemplatesOnlyAugust,planningTemplatesOnlySeptember:x.planningTemplatesOnlySeptember})),null,2));
