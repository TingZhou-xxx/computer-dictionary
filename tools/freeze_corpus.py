import sys
BASE=__import__("pathlib").Path(sys.argv[1])
ROOT=__import__("pathlib").Path(__file__).resolve().parents[1]
import re,json,hashlib,pathlib
from html.parser import HTMLParser
class Article(HTMLParser):
    def __init__(self): super().__init__(); self.depth=0; self.bits=[]; self.skip=0
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='article' and 'markdown-body' in attrs.get('class',''): self.depth=1
        if self.depth and tag in ('script','style'): self.skip+=1
    def handle_endtag(self,tag):
        if self.depth:
            if tag in ('script','style') and self.skip: self.skip-=1
            if tag=='article': self.depth=0
    def handle_data(self,data):
        if self.depth and not self.skip:self.bits.append(data)
sources=[('github-git.html','https://github.com/git/git'),('typescript-readme.md','https://github.com/microsoft/TypeScript/blob/main/README.md'),('redis-readme.md','https://github.com/redis/redis/blob/unstable/README.md'),('mdn-guide.md','https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction')]
sources += [('fastapi-readme.md','https://github.com/fastapi/fastapi/blob/master/README.md'),('rust-ownership.md','https://github.com/rust-lang/book/blob/main/src/ch04-01-what-is-ownership.md')]
sources += [('fmt-readme.md','https://github.com/fmtlib/fmt/blob/master/README.md'),('sqlite-readme.md','https://github.com/sqlite/sqlite/blob/master/README.md')]
output=[]
for file,url in sources:
    data=(BASE/file).read_bytes();text=data.decode('utf-8')
    if file.endswith('.html'):
        p=Article();p.feed(text);text=' '.join(p.bits)
        assert len(text)>1000,'GitHub article extraction failed'
    else:
        text=re.sub(r'^---\n.*?\n---\n','',text,flags=re.S)
        text=re.sub(r'```.*?```',' ',text,flags=re.S)
        text=re.sub(r'!\[[^\]]*\]\([^)]*\)',' ',text)
        text=re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',text)
        text=re.sub(r'\{\{.*?\}\}',' ',text)
    text=re.sub(r'https?://\S+',' ',text)
    text=re.sub(r'<[^>]+>',' ',text)
    words=list(dict.fromkeys(x.lower() for x in re.findall(r"\b[A-Za-z][A-Za-z'-]{2,}\b",text)))[:160]
    # Fixed sampling independent of dictionary: first 160 distinct word tokens, length >=3.
    output.append({'file':file,'url':url,'sha256':hashlib.sha256(data).hexdigest(),'words':words})
# Multiword/identifier samples selected from source text before checking the new data.
special=[('github-git.html',['distributed version control','source code','pull requests','working tree']),('typescript-readme.md',['source code','nightly builds','TypeScript']),('redis-readme.md',['data types','client libraries','redis-cli','Redis Insight']),('mdn-guide.md',['HyperText Markup Language','World Wide Web','standard library','object-oriented','Map','JavaScript'])]
for item,(_,terms) in zip(output,special):
    source=(BASE/item['file']).read_text(encoding='utf-8')
    item['special']=[t for t in terms if t.lower() in source.lower()]
(ROOT/'tests/corpus.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
print([(x['file'],len(x['words']),x.get('special',[])) for x in output])
