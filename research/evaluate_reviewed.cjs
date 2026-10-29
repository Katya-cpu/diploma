/* Evaluate text-only rules on the small reviewed source index; run on another PC.
 * Source labels are not independently verified; do not execute archived HTML.
 */
const fs=require('node:fs');const {analyze}=require('../shared/analyzer.js');
const path=process.argv[2];if(!path){console.error('Usage: node research/evaluate_reviewed.cjs path/to/reviewed_samples.json');process.exit(2)}
const rows=JSON.parse(fs.readFileSync(path,'utf8'));
const result={source:'inherited source labels; not independently verified',coverage:'text excerpt and card-field count only',phish:0,legit:0,skipped:0,flagged_phish:0,flagged_legit:0,unknown:0,items:[]};
for(const row of rows){
  const label=row.source_label;if(!['phish','legit'].includes(label)){result.skipped++;continue}
  const response=analyze({text:String(row.text_excerpt||''),hasCard:Number(row.card_fields||0)>0});
  result[label]++;if(response.status==='unknown')result.unknown++;
  if(response.status==='warning'){if(label==='phish')result.flagged_phish++;else result.flagged_legit++}
  result.items.push({id:row.id,label,status:response.status,codes:response.reasons.map(x=>x.code)});
}
result.limits=['Tiny convenience sample, 7 source-labelled phishing and 2 legitimate examples in current index.',
 'Original malicious HTML was not executed; dynamic behaviour and screenshot evidence are not measured.',
 'Notice and unknown are not counted as warnings; results do not establish real-world performance.'];
console.log(JSON.stringify(result,null,2));
