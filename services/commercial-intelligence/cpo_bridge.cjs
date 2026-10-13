'use strict';
// Construction's existing pure port. No server/runtime/import of dispatch modules.
const readline=require('node:readline');
const {createConstructionPort}=require('../goal-foundation/construction-port.cjs');
const port=createConstructionPort(process.env.FARQ_CONSTRUCTION_SOURCE);
const goals=new Map();
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{try{const r=JSON.parse(line);const key=JSON.stringify([r.objective,r.text]);
if(!goals.has(key)){if(goals.size>=100)goals.clear();goals.set(key,port.analyze({objective:r.objective,productText:r.text}));}
const goal=goals.get(key);
const result=r.operation==='catalog'?port.matchCatalog(goal,[{key:'request',name:r.text}],r.items):goal;
process.stdout.write(JSON.stringify({id:r.id,result})+'\n');}catch(e){process.stdout.write(JSON.stringify({error:String(e.message)})+'\n');}});
