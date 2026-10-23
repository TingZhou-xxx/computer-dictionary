/* Offline engine. Runs only in the extension service worker (or test harness). */
(() => {
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const normalize = value => String(value).normalize('NFKC').replace(/[’]/g,"'").replace(/[–—]/g,'-').trim().replace(/\s+/g,' ').toLowerCase();
  function bucket(value) {
    let h=2166136261;
    for(let i=0;i<value.length;i++) h=Math.imul(h ^ value.charCodeAt(i),16777619)>>>0;
    return (h%512).toString(16).padStart(3,'0');
  }
  function splitIdentifier(value) {
    return value.replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2').replace(/([a-z0-9])([A-Z])/g,'$1 $2').split(/[_\s-]+/).filter(Boolean);
  }
  function createEngine(load) {
    const cache=new Map(), pending=new Map();let initPromise;
    const metrics={loads:0,hits:0,maxResident:0};
    function init() {
      if(!initPromise) initPromise=load('data/curated.json').then(entries=>{
        const map=new Map();
        for(const e of entries) for(const name of e.names) map.set(normalize(name),e);
        return map;
      }).catch(e=>{initPromise=null;throw e});
      return initPromise;
    }
    async function shard(key) {
      const id=bucket(key);
      if(cache.has(id)) {const value=cache.get(id);cache.delete(id);cache.set(id,value);metrics.hits++;return value;}
      if(pending.has(id)) return pending.get(id);
      const promise=load(`data/${id}.json`).then(value=>{
        metrics.loads++;cache.set(id,value);
        while(cache.size>12)cache.delete(cache.keys().next().value);
        metrics.maxResident=Math.max(metrics.maxResident,cache.size);return value;
      }).finally(()=>pending.delete(id));
      pending.set(id,promise);return promise;
    }
    async function raw(key) {const s=await shard(key);return own(s.e,key)?s.e[key]:null;}
    async function forms(key) {const s=await shard(key);return own(s.f,key)?s.f[key]:[];}
    function general(row) {
      if(!row)return null;
      return {word:row[0],text:row[1],technical:row[2],source:'ECDICT',sourceUrl:'https://github.com/skywind3000/ECDICT'};
    }
    async function resolve(key,map) {
      const exact=await raw(key);
      if(map.has(key)) return {matched:map.get(key).names[0],match:'完整匹配',professional:map.get(key),general:general(exact)};
      const lemmas=await forms(key);
      for(const lemma of lemmas) if(map.has(lemma)) {
        return {matched:map.get(lemma).names[0],match:'词形匹配（词库记录）',professional:map.get(lemma),general:general(await raw(lemma)),alternatives:lemmas.filter(x=>x!==lemma)};
      }
      for(const lemma of lemmas) {
        const row=await raw(lemma);
        if(row?.[2]?.length && !exact?.[2]?.length) return {matched:row[0],match:'词形匹配（词库记录）',professional:null,general:general(row),alternatives:lemmas.filter(x=>x!==lemma)};
      }
      // Acronym plurals are absent in many general dictionaries (APIs vs Apis, a bee genus).
      // Only apply this rule to documented uppercase acronyms in our curated layer.
      if(key.endsWith('s')) {
        const singular=key.slice(0,-1),e=map.get(singular);
        if(e?.abbreviations?.some(n=>normalize(n)===singular))
          return {matched:e.names[0],match:'缩写复数匹配（规则）',professional:e,general:general(await raw(singular))};
      }
      if(exact) return {matched:exact[0],match:'完整匹配',professional:null,general:general(exact),lemmaCandidates:lemmas};
      for(const lemma of lemmas) {
        const row=await raw(lemma);
        if(row) return {matched:row[0],match:'词形匹配（词库记录）',professional:null,general:general(row),alternatives:lemmas.filter(x=>x!==lemma)};
      }
      return null;
    }
    async function find(value) {
      if(typeof value!=='string'||value.trim().length>160)throw Error('请输入 1～160 个字符。');
      const term=value.trim();if(!term)throw Error('请先输入查询内容。');
      const map=await init();let key=normalize(term);let cleanup='';
      if(/^`[^`]+`$/.test(key)){key=key.slice(1,-1);cleanup='去除代码引号；';}
      if(/^[\w$]+\(\)$/.test(key)){key=key.slice(0,-2);cleanup+='去除空调用括号；';}
      const exact=await resolve(key,map);
      if(exact)return {type:'entry',term,...exact,match:cleanup+exact.match};
      // For phrases, only use attested inflections for the final word, then retry the full phrase.
      const words=key.split(' ');
      if(words.length>1) {
        for(const lemma of await forms(words.at(-1))) {
          const phrase=[...words.slice(0,-1),lemma].join(' ');
          const found=await resolve(phrase,map);
          if(found)return {type:'entry',term,...found,match:'词组末词词形匹配（词库记录）'};
        }
      }
      const cleaned=term.replace(/^`|`$/g,'').replace(/\(\)$/,'');
      const isIdentifier=/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(cleaned);
      const pieces=splitIdentifier(cleaned);
      if(pieces.length>1 && pieces.length<=16) {
        const parts=[];
        for(const word of pieces) parts.push({word,result:await resolve(normalize(word),map)});
        return {type:isIdentifier?'identifier':'parts',term,parts};
      }
      return {type:'missing',term};
    }
    return {find,metrics,clearCache(){cache.clear();},resident(){return cache.size;}};
  }
  globalThis.OfflineDictionary={createEngine,normalize,bucket,splitIdentifier};
  if(typeof module!=='undefined')module.exports=globalThis.OfflineDictionary;
})();
