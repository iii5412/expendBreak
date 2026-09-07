import fs from 'node:fs';
const paths = process.argv.slice(2);
if (paths.length !== 2) {
 throw new Error('Provide August and September diagnostic JSON paths.');
}
const snapshots = paths.map(p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')));
const sum = xs => xs.reduce((s,x) => s+x.amount,0);
const grouped = (xs,key) => Object.groupBy(xs,key);
for (const d of snapshots) {
 const r=d.records, ym=d.context.selectedYearMonth;
 const tm=new Map(r.recurringTemplates.map(x=>[x.id,x]));
 const txm=new Map(r.transactions.map(x=>[x.id,x]));
 const cm=new Map(r.categories.map(x=>[x.id,x]));
 const duplicates=(xs,key)=>Object.entries(grouped(xs,key)).filter(([,v])=>v.length>1);
 console.log(JSON.stringify({ym,exportedAt:d.exportedAt,context:d.context,counts:d.counts,budget:r.budget,baseline:r.cycleBaseline,calculations:d.calculations,
 occurrenceStates:Object.fromEntries(Object.entries(grouped(r.recurringOccurrences,x=>x.status)).map(([k,v])=>[k,v.length])),
 missingTemplates:r.recurringOccurrences.filter(x=>!tm.has(x.templateId)),
 brokenPosted:r.recurringOccurrences.filter(x=>x.status==='posted' && !txm.has(x.linkedTransactionId ?? x.transactionId)),
 duplicateOccurrences:duplicates(r.recurringOccurrences,x=>x.occurrenceKey??[x.templateId,x.dueDate].join('|')),
 categoryProblems:r.transactions.filter(x=>!cm.has(x.categoryId)||cm.get(x.categoryId).type!==x.type),
 txDuplicates:duplicates(r.transactions,x=>[x.type,x.amount,x.localDate,x.merchant,x.cardId,x.role].join('|')),
 txByMonth:Object.fromEntries(Object.entries(grouped(r.transactions,x=>[x.localDate.slice(0,7),x.type,x.role].join('/'))).map(([k,v])=>[k,{n:v.length,sum:sum(v)}])),
 templateList:r.recurringTemplates.map(x=>({id:x.id,name:x.name,type:x.type,amount:x.defaultAmount,payment:x.paymentMethodType,active:x.active,archivedAt:x.archivedAt,day:x.dayOfMonth,start:x.startDate,end:x.endDate})),
 classification:d.classification.cardSettlementCandidates},null,2));
}
for(const k of Object.keys(snapshots[0].records)) {
 const a=snapshots[0].records[k],b=snapshots[1].records[k];
 console.log('COMPARE',k,JSON.stringify(a)===JSON.stringify(b),Array.isArray(a)?{onlyAugust:a.filter(x=>!b.some(y=>y.id===x.id)).map(x=>x.id),onlySeptember:b.filter(x=>!a.some(y=>y.id===x.id)).map(x=>x.id),changed:a.filter(x=>b.some(y=>y.id===x.id && JSON.stringify(x)!==JSON.stringify(y))).map(x=>x.id)}:'');
}
