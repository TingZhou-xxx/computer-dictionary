"""Build packaged offline shards. Python 3, standard library only.
Usage: python tools/build_dictionary.py /absolute/path/to/ecdict.csv
No network requests. Keep licenses/ECDICT-MIT.txt with generated files.
"""
import csv,hashlib,json,pathlib,re,sys,unicodedata,collections
ROOT=pathlib.Path(__file__).resolve().parents[1]
def norm(s):
    return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s).replace('’',"'").replace('–','-').replace('—','-').strip()).lower()
def bucket(s):
    h=2166136261
    raw=s.encode('utf-16-le')
    for i in range(0,len(raw),2):h=((h ^ (raw[i]+256*raw[i+1]))*16777619)&0xffffffff
    return h%512
def dump(p,obj):p.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def main():
    source=pathlib.Path(sys.argv[1]);shards=[{'e':{},'f':{}} for _ in range(512)]
    entries={};forms=collections.defaultdict(set);raw_rows=0;excluded=0;duplicates=0
    for row in csv.DictReader(source.open(encoding='utf-8',newline='')):
        raw_rows+=1;word=row['word'].strip();key=norm(word)
        text=row['translation'].replace('\\n','\n').strip()
        if not key or not re.search('[A-Za-z]',key) or not re.search('[\u3400-\u9fff]',text):excluded+=1;continue
        technical=[line.strip() for line in text.splitlines() if '[计]' in line]
        if key in entries:
            duplicates+=1;old=entries[key]
            if text not in old[1].split('\n〔同形词补充〕\n'):old[1]+='\n〔同形词补充〕\n'+text
            old[2]=list(dict.fromkeys(old[2]+technical))
        else:entries[key]=[word,text,technical]
        for pair in row.get('exchange','').split('/'):
            kind,_,values=pair.partition(':')
            if kind not in ('s','p','d','i','3','r','t','0'):continue
            for v in values.split(','):
                other=norm(v)
                if not other or other==key:continue
                if kind=='0':forms[key].add(other)
                else:forms[other].add(key)
    for form,lemmas in forms.items():
        valid=sorted(x for x in lemmas if x in entries)
        if valid:shards[bucket(form)]['f'][form]=valid
    for key,value in entries.items():shards[bucket(key)]['e'][key]=value
    folder=ROOT/'data';folder.mkdir(exist_ok=True)
    for i,shard in enumerate(shards):dump(folder/f'{i:03x}.json',shard)
    curated=json.loads((ROOT/'data/curated.json').read_text(encoding='utf-8'))
    aliases={norm(n) for e in curated for n in e['names']}
    tech={k for k,v in entries.items() if v[2]}
    professional_aliases={norm(n) for e in curated if e.get('editorial',True) for n in e['names']}
    phrase=lambda key: bool(re.search(r'\S\s+\S',key))
    upper=set()
    for row in csv.DictReader(source.open(encoding='utf-8',newline='')):
        w=row['word'].strip();k=norm(w)
        if k in entries and re.fullmatch(r'[A-Z][A-Z0-9/+.-]{1,11}',w):upper.add(k)
    curated_upper={norm(w) for e in curated for w in e.get('abbreviations',[])}
    sizes=[(folder/f'{i:03x}.json').stat().st_size for i in range(512)]
    stats={'source':'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
      'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_bytes':source.stat().st_size,
      'build_date':'2026-10-15','raw_rows':raw_rows,'excluded_no_english_or_no_chinese':excluded,
      'case_whitespace_duplicates_merged':duplicates,'base_entries':len(entries),
      'base_computing_tagged_entries':len(tech),'curated_concepts':len(curated),'curated_lookup_keys':len(aliases),
      'editorial_professional_concepts':sum(e.get('editorial',True) for e in curated),
      'editorial_professional_keys':len(professional_aliases),
      'professional_keys_union':len(tech|professional_aliases),'all_lookup_keys_union':len(set(entries)|aliases),
      'base_phrase_keys':sum(map(phrase,entries)),'curated_phrase_keys':sum(map(phrase,aliases)),
      'phrase_keys_union':sum(map(phrase,set(entries)|aliases)),
      'base_uppercase_abbreviation_candidates':len(upper),'curated_abbreviation_keys':len(curated_upper),
      'abbreviation_keys_union_candidates':len(upper|curated_upper),
      'inflected_form_keys':sum(len(s['f']) for s in shards),
      'inflection_links':sum(sum(len(v) for v in s['f'].values()) for s in shards),
      'shard_count':512,'shard_bytes_total':sum(sizes),'shard_bytes_max':max(sizes),'shard_bytes_mean':sum(sizes)/512}
    dump(folder/'stats.json',stats);print(json.dumps(stats,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
