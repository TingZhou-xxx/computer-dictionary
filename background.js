importScripts('engine.js');
const engine = OfflineDictionary.createEngine(async path => {
  // Only fixed, packaged resource paths. No web or AI requests.
  if (!/^data\/(?:curated|[0-9a-f]{3})\.json$/.test(path)) throw Error('无效词库路径');
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw Error('本机词库文件无法读取，请检查安装文件是否完整。');
  return response.json();
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'dictionary:settings') {chrome.runtime.openOptionsPage(); return;}
  if (message.type === 'dictionary:lookup') {
    engine.find(message.term).then(result => reply({ok:true,result})).catch(error => reply({ok:false,error:error.message}));
    return true;
  }
});
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, {type: 'dictionary:open'});
  } catch {
    // Chrome internal pages and the Chrome Web Store prohibit content scripts.
    await chrome.runtime.openOptionsPage();
  }
});
