(() => {
  if (globalThis.__computerDictionaryInstalled) return;
  globalThis.__computerDictionaryInstalled = true;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  document.documentElement.append(host);
  const root = host.attachShadow({mode: 'closed'});
  root.innerHTML = `<style>
    *{box-sizing:border-box} [hidden]{display:none!important}p{white-space:pre-line}summary{overflow-wrap:anywhere}
    button,input{font:inherit} button{cursor:pointer;border:1px solid #d6dfeb;border-radius:6px;background:#fff;color:#263449;padding:5px 8px}button:hover{background:#edf3ff}button:focus-visible,input:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
    #trigger{position:fixed;pointer-events:auto;background:#245bd7;color:#fff;box-shadow:0 3px 12px #0003;font:13px system-ui;padding:6px 10px}
    #panel{position:fixed;width:320px;height:320px;max-width:100vw;max-height:100dvh;pointer-events:auto;display:flex;flex-direction:column;background:#fff;color:#243247;border:1px solid #d6dfeb;border-radius:12px;box-shadow:0 8px 32px #15294433;font:13px/1.6 system-ui,-apple-system,'Microsoft YaHei',sans-serif;overflow:hidden}
    header{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#f0f5ff;cursor:move;touch-action:none;flex-shrink:0}header strong{flex:1}header button{padding:1px 6px}nav{display:flex;gap:6px;padding:7px 10px;border-bottom:1px solid #edf0f5}nav button{flex:1;padding:3px}nav button[aria-selected=true]{color:#194fc1;background:#eaf0ff;border-color:#91b0ed}
    section{flex:1;min-height:0;overflow:auto;padding:10px;overscroll-behavior:contain}form{display:flex;gap:5px}input{min-width:0;flex:1;width:100%;border:1px solid #bbc8da;border-radius:6px;padding:6px;color:#243247;background:#fff}h3{font-size:15px;margin:10px 0 4px;overflow-wrap:anywhere}p{margin:6px 0;overflow-wrap:anywhere}.muted{color:#65738a;font-size:12px}.badge{color:#8b5700;background:#fff5d9;border-radius:4px;padding:3px 6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6fa;padding:7px;border-radius:6px;font:12px/1.6 Consolas,monospace;margin:6px 0}details{margin:8px 0;color:#54647a}summary{cursor:pointer}#history{margin-top:9px;display:flex;gap:4px;flex-wrap:wrap}#history button{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;padding:2px 6px}#aiTerm{padding:6px;background:#f4f6fa;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}
  </style>
  <button id="trigger" hidden title="查询选中文字">查词</button>
  <aside id="panel" hidden aria-label="计算机小字典">
    <header><strong>计算机小字典</strong><button id="settings" title="打开设置" aria-label="打开设置">⚙</button><button id="close" title="关闭（Esc）" aria-label="关闭">×</button></header>
    <nav role="tablist"><button id="dictTab" role="tab" aria-selected="true">查词</button><button id="aiTab" role="tab" aria-selected="false">AI · 待接入</button></nav>
    <section id="dictView" role="tabpanel"><form id="search"><input id="query" maxlength="160" placeholder="单词、词组、代码名称" aria-label="查询内容" autocomplete="off"><button type="submit">查询</button></form><div id="result"><p class="muted">选中网页文字后点击“查词”，或在这里输入。</p><p class="muted">试试 commit、pointer、ShuffleArray。</p></div><div id="history" aria-label="最近查询"></div></section>
    <section id="aiView" role="tabpanel" hidden><p class="badge">AI 尚未接入</p><p>当前查询词：</p><div id="aiTerm">尚未查询</div><p>本阶段优先完善离线词库。未收录内容会如实提示，不会自动请求 AI。</p><p class="muted">本版不上传选中文字或页面内容，不收集 API Key。切换回查词会保留结果。</p></section>
  </aside>`;
  const $ = id => root.getElementById(id);
  const panel = $('panel'), trigger = $('trigger'), input = $('query');
  let selected = '', current = '', history = [], position = null, dragging = null, querySequence = 0;
  const clamp = (n, min, max) => Math.max(min, Math.min(n, Math.max(min, max)));
  function place(x, y) {
    position = {x: clamp(x, 0, innerWidth - panel.offsetWidth), y: clamp(y, 0, innerHeight - panel.offsetHeight)};
    panel.style.left = position.x + 'px'; panel.style.top = position.y + 'px';
  }
  function open() {
    panel.hidden = false; trigger.hidden = true;
    place(position?.x ?? innerWidth - 340, position?.y ?? 80);
  }
  function tab(ai) {
    $('dictView').hidden = ai; $('aiView').hidden = !ai;
    $('dictTab').setAttribute('aria-selected', String(!ai)); $('aiTab').setAttribute('aria-selected', String(ai));
  }
  function add(parent, tag, value, className) {
    const el = document.createElement(tag); el.textContent = value;
    if (className) el.className = className; parent.append(el); return el;
  }
  function renderHistory() {
    $('history').replaceChildren();
    for (const word of history) {const b = add($('history'), 'button', word); b.title = word; b.onclick = () => query(word);}
  }
  function save() {
    chrome.storage.local.set({dictionaryState: {current, history, position}}).catch(() => {});
  }
  function detail(parent, title, text) {
    const box = add(parent, 'details', ''); add(box, 'summary', title); add(box, 'p', text); return box;
  }
  function sourceLink(parent, name, url) {
    const a = add(parent, 'a', name); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.color = '#245bd7';
  }
  function renderEntry(parent, data, compact = false) {
    const professional = data.professional, general = data.general;
    add(parent, 'p', `${data.match} → ${data.matched}`, 'muted');
    if (professional) {
      add(parent, 'p', professional.editorial ? '计算机释义 · 整理版' : '名称组成参考', 'badge');
      add(parent, 'p', professional.meaning);
      if (!compact) {
        add(parent, 'p', professional.explanation);
        if (professional.example) detail(parent, '查看例子', professional.example);
        if (professional.related) detail(parent, '相关知识', professional.related);
        const source = detail(parent, '释义依据', '中文解释为本扩展整理，依据：');
        sourceLink(source, professional.source, professional.sourceUrl);
        for (const extra of professional.extraSources || []) {add(source, 'p', '补充依据：'); sourceLink(source, extra.name, extra.url);}
      }
      if (general && !compact) detail(parent, '普通／其他义（ECDICT 原文）', general.text);
    } else if (general?.technical?.length) {
      add(parent, 'p', '计算机义 · ECDICT 原标注', 'badge');
      add(parent, 'p', general.technical.join('\n'));
      if (!compact) {
        detail(parent, '普通／其他义（ECDICT 原文）', general.text);
        const source = detail(parent, '来源说明', '沿用原词库的 [计] 标签，可能含旧译和多义；没有额外编造例子。');
        sourceLink(source, 'ECDICT · MIT', general.sourceUrl);
      }
    } else if (general) {
      add(parent, 'p', '英汉释义 · 未标为计算机专义', 'muted');
      const lines = general.text.split('\n').filter(Boolean);
      add(parent, 'p', lines.slice(0, compact ? 1 : 2).join('\n').slice(0, compact ? 100 : 300));
      if (!compact) {
        detail(parent, '全部释义（ECDICT 原文）', general.text);
        const source = detail(parent, '词库来源', '基础词库按上游 MIT 许可随扩展分发。');
        sourceLink(source, 'ECDICT', general.sourceUrl);
      }
    }
    if (!compact && data.lemmaCandidates?.length) {
      const box = detail(parent, '词库词形候选（可能多义）', '点击查看候选原词：');
      for (const word of data.lemmaCandidates) {const b = add(box, 'button', word); b.onclick = () => query(word);}
    }
    if (!compact && data.alternatives?.length) detail(parent, '其他可能原词', data.alternatives.join('、'));
  }
  async function query(value, persist = true) {
    const term = value.trim().slice(0, 160); if (!term) {input.focus(); return;}
    const sequence = ++querySequence;
    current = term; input.value = term; $('aiTerm').textContent = term;
    const result = $('result'); result.replaceChildren();
    if (persist) {history = [term, ...history.filter(w => w !== term)].slice(0, 8); save();}
    renderHistory(); $('dictView').scrollTop = 0;
    add(result, 'p', '正在读取本机词库…', 'muted');
    try {
      const response = await chrome.runtime.sendMessage({type:'dictionary:lookup', term});
      if (sequence !== querySequence) return;
      if (!response?.ok) throw Error(response?.error || '未收到后台查询结果，请刷新网页后重试。');
      const data = response.result; result.replaceChildren(); add(result, 'h3', term);
      if (data.type === 'entry') renderEntry(result, data);
      else if (data.type === 'identifier' || data.type === 'parts') {
        add(result, 'p', data.type === 'identifier' ? '按名称推测 · 非实际功能' : '完整词组未收录 · 以下仅逐词解释', 'badge');
        add(result, 'p', data.parts.map(p => p.word).join(' + '));
        for (const p of data.parts) {
          const box = detail(result, p.word + '：' + (p.result?.professional?.meaning || p.result?.general?.technical?.[0] || p.result?.general?.text?.split('\n')[0] || '未收录'), '');
          if (p.result) renderEntry(box, p.result); else add(box, 'p', '这个组成部分暂未收录。');
        }
        add(result, 'p', '拆分只解释名称组成；实际功能需查看代码实现与调用处。', 'muted');
      } else {add(result, 'p', '离线词库暂未收录这个词。'); add(result, 'p', '请检查拼写；不会自动调用 AI。', 'muted');}
      const ai = add(result, 'button', 'AI 尚未接入'); ai.onclick = () => tab(true);
    } catch (error) {
      if (sequence !== querySequence) return;
      result.replaceChildren(); add(result, 'p', '查询未完成', 'badge');
      add(result, 'p', error.message || '请刷新网页后重试。');
      const retry = add(result, 'button', '重新查询'); retry.onclick = () => query(term, false);
    }
  }
  $('search').onsubmit = e => {e.preventDefault(); query(input.value);};
  $('dictTab').onclick = () => tab(false); $('aiTab').onclick = () => tab(true);
  $('close').onclick = () => {panel.hidden = true; save();};
  $('settings').onclick = () => chrome.runtime.sendMessage({type:'dictionary:settings'});
  trigger.onpointerdown = e => e.preventDefault();
  trigger.onclick = () => {open(); tab(false); query(selected);};
  function inspectSelection() {
    const active = document.activeElement;
    if (active && (['INPUT','TEXTAREA'].includes(active.tagName) || active.isContentEditable)) {trigger.hidden = true; return;}
    const sel = window.getSelection(); const value = sel?.toString().trim();
    if (!value || value.length > 160 || !sel.rangeCount) {trigger.hidden = true; return;}
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    selected = value; trigger.hidden = false;
    trigger.style.left = clamp(rect.right + 5, 4, innerWidth - 70) + 'px';
    trigger.style.top = clamp(rect.bottom + 5, 4, innerHeight - 36) + 'px';
  }
  document.addEventListener('mouseup', e => {if (e.target !== host) setTimeout(inspectSelection, 0);});
  document.addEventListener('keyup', e => {if (e.target !== host && e.shiftKey) inspectSelection();});
  document.addEventListener('keydown', e => {if (e.key === 'Escape') {panel.hidden = true; trigger.hidden = true;}});
  window.addEventListener('scroll', () => {trigger.hidden = true;}, {passive:true});
  window.addEventListener('resize', () => {trigger.hidden = true; if (!panel.hidden && position) place(position.x, position.y);});
  const header = root.querySelector('header');
  header.onpointerdown = e => {
    if (e.target.closest('button') || e.button !== 0) return;
    dragging = {x:e.clientX - position.x, y:e.clientY - position.y}; header.setPointerCapture(e.pointerId); e.preventDefault();
  };
  header.onpointermove = e => {if (dragging) place(e.clientX-dragging.x, e.clientY-dragging.y);};
  header.onpointerup = header.onpointercancel = () => {if (dragging) {dragging = null; save();}};
  chrome.runtime.onMessage.addListener(message => {if (message.type === 'dictionary:open') {open(); input.focus();}});
  chrome.storage.local.get('dictionaryState').then(data => {
    const state = data.dictionaryState;
    if (!state || current) return;
    history = Array.isArray(state.history) ? state.history.filter(x => typeof x === 'string').map(x => x.slice(0,160)).slice(0,8) : [];
    if (Number.isFinite(state.position?.x) && Number.isFinite(state.position?.y)) position = state.position;
    if (typeof state.current === 'string') query(state.current, false); else renderHistory();
  }).catch(() => {});
})();
