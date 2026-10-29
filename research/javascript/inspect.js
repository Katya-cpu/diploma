/* Passive parsing only: the supplied script is never executed. */
'use strict';
const fs=require('fs'), acorn=require('acorn'), walk=require('acorn-walk');
const path=process.argv[2];
if(!path){console.error('Usage: node inspect.js path-to-script.js');process.exit(2)}
const source=fs.readFileSync(path==='-'?0:path,'utf8');
let tree;
try {tree=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true})}
catch(first){try{tree=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script',locations:true})}catch(e){console.error('Parse failed: '+e.message);process.exit(1)}}
const facts=[];
const property=node=>node && (node.name || node.value);
walk.simple(tree,{
  CallExpression(node){
    const callee=node.callee, name=callee.type==='Identifier'?callee.name:callee.type==='MemberExpression'?property(callee.property):'';
    if(['fetch','sendBeacon','open','send'].includes(name)) facts.push({kind:'network_call',name,line:node.loc.start.line});
    if(['eval','Function'].includes(name)) facts.push({kind:'dynamic_code_call',name,line:node.loc.start.line});
    if(['querySelector','getElementById','getElementsByName'].includes(name)) facts.push({kind:'dom_selector_call',name,line:node.loc.start.line});
  },
  AssignmentExpression(node){if(node.left.type==='MemberExpression' && ['innerHTML','outerHTML'].includes(property(node.left.property)))facts.push({kind:'html_insertion',name:property(node.left.property),line:node.loc.start.line})}
});
console.log(JSON.stringify({file:path,facts,limitations:['Это не обнаружение мошенничества: обычные сайты тоже используют эти API.','Статический AST не определяет реальное назначение и не отслеживает исполнение.','Внешние ресурсы, обфускация и динамическая подгрузка могут скрыть поведение.']},null,2));
