const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const root=path.resolve(__dirname,'..');fs.mkdirSync('work',{recursive:true});
const chrome=process.env.CHROME_PATH || 'C:\\Users\\Z2006\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
class CDP {
 constructor(ws){this.ws=ws;this.next=0;this.pending=new Map();this.events=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);this.pending.delete(m.id);if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result);}else this.events.push(m)});}
 static async connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});return new CDP(ws)}
 async send(method,params={},sessionId){const id=++this.next;return new Promise((resolve,reject)=>{const t=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout '+method))},15000);this.pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v)},reject:e=>{clearTimeout(t);reject(e)}});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
 async eval(expression,sessionId){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
}
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><title>Offline dictionary local integration test</title><p id="sample">commit</p><p>getUserName dependency injection OOM</p>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const profile=path.resolve('work/chrome-extension-test-'+Date.now());fs.mkdirSync(profile,{recursive:true});
 const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--enable-unsafe-extension-debugging','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
 let log='';child.stderr.on('data',x=>log+=x.toString());
 let browser;
 try {
   let lines;
   for(let i=0;i<100;i++){try{lines=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n');break}catch{}await delay(100);}
   if(!lines)throw Error('No DevToolsActivePort '+log.slice(-1500));
   browser=await CDP.connect('ws://127.0.0.1:'+lines[0]+lines[1]);
   const version=await browser.send('Browser.getVersion');console.log('Browser',version.product);
   console.log('Load unpacked',JSON.stringify(await browser.send('Extensions.loadUnpacked',{path:root})));
   const {targetId}=await browser.send('Target.createTarget',{url:'http://127.0.0.1:'+port});
   const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
   await browser.send('Runtime.enable',{},sessionId);await browser.send('DOM.enable',{},sessionId);await browser.send('Network.enable',{},sessionId);
   await delay(1800);
   const targets=await browser.send('Target.getTargets');console.log('Targets',JSON.stringify(targets.targetInfos.map(x=>({type:x.type,url:x.url}))));
   fs.writeFileSync('work/cdp-targets.json',JSON.stringify(targets,null,2));
   const doc=await browser.send('DOM.getDocument',{depth:-1,pierce:true},sessionId);
   fs.writeFileSync('work/cdp-dom.json',JSON.stringify(doc,null,2));
   const worker=targets.targetInfos.find(t=>t.type==='service_worker'&&t.url.endsWith('/background.js'));
   if(!worker)throw Error('No loaded extension worker. This Chrome build may ignore --load-extension.');
   const {sessionId:workerId}=await browser.send('Target.attachToTarget',{targetId:worker.targetId,flatten:true});
   await browser.send('Runtime.enable',{},workerId);await browser.send('Network.enable',{},workerId);
   const extensionId=worker.url.split('/')[2];
   console.log('Extension ID',extensionId);
   const result=await browser.eval(`engine.find('dependency injection')`,workerId);console.log('Real worker lookup',JSON.stringify(result));
   fs.writeFileSync('work/cdp-boot.json',JSON.stringify({version,result,extensionId,sessionId,workerId},null,2));
   const checks=[];const assert=(name,value)=>{if(!value)throw Error(name);checks.push(name);console.log('PASS',name)};
   async function panelRun(body,sid=sessionId) {
     const tree=await browser.send('DOM.getDocument',{depth:-1,pierce:true},sid);
     let shadow;
     function visit(node){for(const s of node.shadowRoots||[]){if(s.children?.some(c=>c.attributes?.includes('trigger')))shadow=s;visit(s);}for(const c of node.children||[])visit(c);}
     visit(tree.root);if(!shadow)throw Error('Extension shadow root missing');
     const {object}=await browser.send('DOM.resolveNode',{nodeId:shadow.nodeId},sid);
     const r=await browser.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:`function(){${body}}`,awaitPromise:true,returnByValue:true},sid);
     if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;
   }
   const text=()=>panelRun(`return this.getElementById('result').textContent`);
   async function waitText(needle){for(let i=0;i<60;i++){const t=await text();if(t.includes(needle))return t;await delay(25);}throw Error('Missing result '+needle+': '+await text())}
   async function query(term){await panelRun(`this.getElementById('query').value=${JSON.stringify(term)};this.getElementById('search').dispatchEvent(new Event('submit',{cancelable:true}));`);}
   assert('real content script injected; panel initially closed',await panelRun(`return this.getElementById('panel').hidden`));
   const initialLoads=await browser.eval('engine.metrics.loads',workerId);
   await browser.eval(`const r=document.createRange();r.selectNodeContents(document.getElementById('sample'));getSelection().removeAllRanges();getSelection().addRange(r);document.getElementById('sample').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));`,sessionId);
   await delay(50);
   assert('selection only displays button',await panelRun(`return !this.getElementById('trigger').hidden && this.getElementById('panel').hidden`));
   assert('selection does not query dictionary',await browser.eval('engine.metrics.loads',workerId)===initialLoads);
   await panelRun(`this.getElementById('trigger').click()`);await waitText('提交');
   assert('real message lookup, 320x320 window',await panelRun(`const p=this.getElementById('panel');return !p.hidden&&p.offsetWidth===320&&p.offsetHeight===320`));
   assert('ordinary senses and examples folded',await panelRun(`return [...this.querySelectorAll('#result details')].every(x=>!x.open)`));
   assert('real chrome.storage contains current term',await browser.eval(`chrome.storage.local.get('dictionaryState').then(x=>x.dictionaryState.current==='commit')`,workerId));
   await query('issues');assert('inflection in actual UI',(await waitText('issue')).includes('词形匹配'));
   await query('working directories');assert('whole phrase morphology in UI',(await waitText('工作目录')).includes('working directory'));
   await query('parseJSONResponse');assert('identifier and acronym label in UI',(await waitText('按名称推测')).includes('JSON'));
   await query('dependency injection');await waitText('依赖注入');
   await panelRun(`this.getElementById('aiTab').click();this.getElementById('dictTab').click()`);
   assert('tab switching retains result',(await text()).includes('依赖注入'));
   await query('<img src=x onerror=alert(1)>');await waitText('未收录');
   assert('query safely rendered as text',await panelRun(`return !this.querySelector('#result img')`));
   // Browser simulated offline; packaged chrome-extension files remain available.
   const offline={offline:true,latency:0,downloadThroughput:0,uploadThroughput:0};
   await browser.send('Network.emulateNetworkConditions',offline,workerId);
   await browser.send('Network.emulateNetworkConditions',offline,sessionId);
   await browser.eval('engine.clearCache()',workerId);
   await query('apple');await waitText('英汉释义');assert('cold shard query works under simulated offline',(await text()).includes('apple'));
   await query('OOM');await waitText('内存不足');assert('abbreviation offline',(await text()).includes('OOM'));
   const timing=await browser.eval(`(async()=>{const times=[];for(const word of ['algorithm','memory','repository','queue','transaction','virtual memory','pointer','cache','commit','HTTP']){const s=performance.now();await engine.find(word);times.push(performance.now()-s);}return times})()`,workerId);
   // Simulate reversed response order inside this isolated test worker.
   await browser.eval(`globalThis.savedFind=engine.find;engine.find=async word=>{if(word==='commit')await new Promise(r=>setTimeout(r,160));return savedFind(word)}`,workerId);
   await query('commit');await query('pointer');await waitText('指针');await delay(200);
   assert('late result cannot overwrite newer query',(await text()).includes('pointer')&&!(await text()).includes('git commit'));
   await browser.eval('engine.find=savedFind',workerId);
   // Actual pointer input exercises pointer capture and persistence.
   const bounds=await panelRun(`const b=this.querySelector('header').getBoundingClientRect();return {x:b.x+25,y:b.y+15}`);
   await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.x,y:bounds.y,button:'left',clickCount:1},sessionId);
   await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:45,y:45,button:'left',buttons:1},sessionId);
   await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:45,y:45,button:'left',clickCount:1},sessionId);
   assert('real drag moves window',await panelRun(`const b=this.getElementById('panel').getBoundingClientRect();return Math.abs(b.x-20)<2&&Math.abs(b.y-30)<2`));
   await panelRun(`this.getElementById('close').click()`);assert('close button',await panelRun(`return this.getElementById('panel').hidden`));
   const tabs=await browser.send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});
   const tabTarget=tabs.targetInfos.find(t=>t.url.includes('127.0.0.1:'+port));
   if(!tabTarget)throw Error('Missing tab target '+JSON.stringify(tabs));
   await browser.send('Extensions.triggerAction',{id:extensionId,targetId:tabTarget.targetId});
   await delay(80);assert('real toolbar action opens window',await panelRun(`return !this.getElementById('panel').hidden`));
   const clip=await panelRun(`const b=this.getElementById('panel').getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,scale:1}`);
   const screenshot=await browser.send('Page.captureScreenshot',{format:'png',clip},sessionId);
   fs.writeFileSync(path.join(root,'tests/preview.png'),Buffer.from(screenshot.data,'base64'));
   // Refresh page after restoring page connectivity; worker remains offline.
   await browser.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},sessionId);
   await browser.send('Page.reload',{},sessionId);await delay(350);await waitText('指针');
   assert('real persisted state restores after reload',(await text()).includes('pointer'));
   await panelRun(`this.getElementById('settings').click()`);await delay(200);
   const settingsTarget=(await browser.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/options.html`);
   assert('settings page opens from window',!!settingsTarget);
   const {sessionId:settingsId}=await browser.send('Target.attachToTarget',{targetId:settingsTarget.targetId,flatten:true});
   assert('settings displays real packaged counts',await browser.eval(`document.getElementById('counts').textContent.includes('767,516')`,settingsId));
   await browser.eval(`document.getElementById('clear').click()`,settingsId);await delay(80);
   assert('settings clears real storage',await browser.eval(`chrome.storage.local.get('dictionaryState').then(x=>!x.dictionaryState)`,workerId));
   assert('settings confirms clearing',await browser.eval(`document.getElementById('status').textContent.includes('已清除')`,settingsId));
   const extensionRequests=browser.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.sessionId===workerId).map(e=>e.params.request.url);
   assert('dictionary worker uses only packaged resources',extensionRequests.length>0&&extensionRequests.every(x=>x.startsWith(`chrome-extension://${extensionId}/data/`)));
   assert('no AI request observed',extensionRequests.every(x=>!x.includes('deepseek')));
   assert('bounded cache in real worker',await browser.eval('engine.resident()<=12',workerId));
   const pageDataRequests=browser.events.filter(e=>e.method==='Network.requestWillBeSent'&&e.sessionId===sessionId&&/chrome-extension:\/\/.*\/data\//.test(e.params.request.url));
   assert('page never loads dictionary shards directly',pageDataRequests.length===0);
   fs.writeFileSync(path.join(root,'tests/browser-results.json'),JSON.stringify({date:'2026-10-15',browser:version.product,mode:'actual unpacked MV3 extension in isolated headless Chrome profile',checks,offline:'CDP emulated offline in page and worker; cold dictionary shard read verified; physical network not unplugged',workerRequests:extensionRequests,engineTimesMs:timing,cache:await browser.eval('({resident:engine.resident(),metrics:engine.metrics})',workerId)},null,2));
 } catch(error){console.error(error.stack);process.exitCode=1;}
 finally{if(browser){try{await browser.send('Browser.close')}catch{}browser.ws.close();}else child.kill();server.close();}
})();
