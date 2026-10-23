// Run from any directory: node --expose-gc tests/check.cjs
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {performance}=require('perf_hooks');
const root=path.resolve(__dirname,'..');const {createEngine,bucket}=require('../engine.js');
let paths=[];
const load=async file=>{assert(/^data\/(curated|[0-9a-f]{3})\.json$/.test(file));paths.push(file);return JSON.parse(await fs.promises.readFile(path.join(root,file),'utf8'))};
const engine=createEngine(load);
function meaning(r){return [r.professional?.meaning,r.professional?.explanation,...r.general?.technical||[],r.general?.text].filter(Boolean).join('\n')}
(async()=>{
 const tests=[];const check=(name,ok)=>{assert(ok,name);tests.push(name)};
 for(const file of ['background.js','content.js','engine.js','options.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 check('MV3 and content script contains no dictionary data',manifest.manifest_version===3&&manifest.content_scripts[0].js.join(',')==='content.js');
 check('No AI / remote fetch implementation',!fs.readFileSync(path.join(root,'background.js'),'utf8').includes('https://')&&!manifest.host_permissions);
 for(const word of ['commit','COMMIT','  Commit  ','pull request','working directory','staging area','dependency injection','OOM']) {
   const r=await engine.find(word);check('professional: '+word,r.type==='entry'&&!!r.professional?.editorial);
 }
 for(const [word,lemma] of [['committed','commit'],['commits','commit'],['repositories','repository'],['issues','issue'],['pushing','push'],['pull requests','pull request'],['working directories','working directory']]) {
   const r=await engine.find(word);check('inflection '+word+' -> '+lemma,r.type==='entry'&&r.matched.toLowerCase()===lemma&&r.match.includes('词形'));
 }
 for(const [word,lemma] of [['types','type'],['operators','operator'],['statements','statement']]) {
   const r=await engine.find(word);check('computing lemma before ordinary plural: '+word,r.matched.toLowerCase()===lemma&&r.general.technical.length>0);
 }
 check('acronym plural APIs',(await engine.find('APIs')).matched.toLowerCase()==='api');
 for(const term of ['ShuffleArray','getUserName','HTTPServer','parseJSONResponse','getURLValue','my_snake_case']) {
   const r=await engine.find(term);check('identifier '+term,r.type==='identifier'&&r.parts.length>1);
 }
 const acronym=await engine.find('parseJSONResponse');check('acronym JSON kept intact',acronym.parts.some(p=>p.word==='JSON'&&p.result?.professional));
 const phrase=await engine.find('dependency injection');check('whole phrase precedes splitting',phrase.type==='entry');
 check('unknown is honest',(await engine.find('zzzznotarealwordxyzz')).type==='missing');
 check('ordinary English offline',(await engine.find('apple')).type==='entry');
 check('irregular inflection candidates',(await engine.find('children')).matched.toLowerCase()==='child'||(await engine.find('children')).lemmaCandidates?.includes('child'));
 await assert.rejects(engine.find('x'.repeat(161)));tests.push('input limit');
 // Verify every packaged entry and form lands in its computed shard. Full-file integrity, not a count claim.
 let count=0,formCount=0;
 for(let i=0;i<512;i++){
   const id=i.toString(16).padStart(3,'0'),s=JSON.parse(fs.readFileSync(path.join(root,'data',id+'.json'),'utf8'));
   for(const [key,value] of Object.entries(s.e)){assert.equal(bucket(key),id);assert(/[\u3400-\u9fff]/.test(value[1]));count++;}
   for(const key of Object.keys(s.f)){assert.equal(bucket(key),id);formCount++;}
 }
 const stats=JSON.parse(fs.readFileSync(path.join(root,'data/stats.json')));
 check('all 512 shards and entry/form counts verified',count===stats.base_entries&&formCount===stats.inflected_form_keys);
 // All loads above and below use local fs only; there is no network implementation in this harness.
 const sources=JSON.parse(fs.readFileSync(path.join(__dirname,'corpus.json'),'utf8'));
 const coverage=[];const csv=['source,term,type,matched,professional,meaning'];let total=0,hits=0;
 const rows=[];
 for(const s of sources){
   const record={url:s.url,sha256:s.sha256,total:s.words.length,hits:0,misses:[],splitOnly:[],professionalHits:0};
   for(const word of s.words){
     const r=await engine.find(word),hit=r.type==='entry';record.hits+=hit;total++;hits+=hit;
     const professional=hit&&(!!r.professional?.editorial||!!r.general?.technical.length);
     record.professionalHits+=professional;
     if(!hit)record.misses.push(word);if(['parts','identifier'].includes(r.type))record.splitOnly.push(word);
     rows.push({source:s.url,term:word,type:r.type,matched:r.matched||'',professional,meaning:hit?meaning(r).slice(0,500):''});
   }
   record.rate=record.hits/record.total;record.special=[];
   for(const term of s.special||[]){const r=await engine.find(term);record.special.push({term,type:r.type,matched:r.matched,professional:r.type==='entry'&&(!!r.professional?.editorial||!!r.general?.technical.length),meaning:r.type==='entry'?meaning(r):''});}
   coverage.push(record);
 }
 for(const row of rows)csv.push(Object.values(row).map(x=>'"'+String(x).replaceAll('"','""')+'"').join(','));
 fs.writeFileSync(path.join(__dirname,'coverage.csv'),'\ufeff'+csv.join('\n'));
 const terms=[...new Set(sources.flatMap(s=>s.words))];
 const percentile=(a,p)=>a.toSorted((a,b)=>a-b)[Math.floor((a.length-1)*p)];
 const cold=[];const warm=[];
 for(const term of terms.slice(0,80)){const e=createEngine(load),start=performance.now();await e.find(term);cold.push(performance.now()-start);}
 const bench=createEngine(load);let time=performance.now();await bench.find('commit');const first=performance.now()-time;
 for(let i=0;i<100;i++){time=performance.now();await bench.find('commit');warm.push(performance.now()-time);}
 if(global.gc)global.gc();const memBefore=process.memoryUsage().heapUsed;const bounded=createEngine(load);
 for(const term of terms)await bounded.find(term);
 if(global.gc)global.gc();const heapDelta=process.memoryUsage().heapUsed-memBefore;
 check('bounded LRU retains at most 12 shards',bounded.resident()<=12&&bounded.metrics.maxResident<=12);
 const concurrency=createEngine(load);const before=paths.length;await Promise.all(Array.from({length:20},()=>concurrency.find('commit')));
 check('concurrent requests share one in-flight shard load',paths.length-before===2);
 // Failed reads are retriable on a later explicit query, without automatic retry loops.
 let fail=true,attempts=0;
 const broken=createEngine(async file=>{attempts++;if(fail)throw Error('read failed');return load(file)});
 await assert.rejects(broken.find('commit'));check('no automatic retry',attempts===1);
 fail=false;check('manual retry recovers',(await broken.find('commit')).type==='entry');
 const semantic=[];
 for(const c of JSON.parse(fs.readFileSync(path.join(__dirname,'semantic-cases.json')))){
   assert(sources[c.source].words.includes(c.term),'Semantic case must be in frozen corpus: '+c.term);
   const r=await engine.find(c.term);semantic.push({...c,url:sources[c.source].url,type:r.type,matched:r.matched,text:r.type==='entry'?meaning(r):''});
 }
 const output={date:'2026-10-15',runtime:process.version,tests,coverage,semantic,total,hits,rate:hits/total,unique_word_count:terms.length,performance:{unit:'ms',scope:'Node local fs+JSON+engine; OS disk cache may be warm; not browser end-to-end',firstCommit:first,cold80_p50:percentile(cold,.5),cold80_p95:percentile(cold,.95),repeat100_p50:percentile(warm,.5),repeat100_p95:percentile(warm,.95),heap_delta_bytes:heapDelta,resident_shards:bounded.resident(),max_resident_shards:bounded.metrics.maxResident}};
 fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(output,null,2));
 console.log(JSON.stringify({...output,semantic:undefined,coverage:coverage.map(x=>({...x,special:x.special.map(({meaning,...r})=>r)}))},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
