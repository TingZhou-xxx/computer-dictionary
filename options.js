document.getElementById('clear').onclick = async () => {
  try {
    await chrome.storage.local.remove('dictionaryState');
    document.getElementById('status').textContent = '已清除。已打开页面中的内容会保留到刷新；继续查询会生成新的记录。';
  } catch {
    document.getElementById('status').textContent = '清除失败，请重新打开设置页再试。';
  }
};
fetch(chrome.runtime.getURL('data/stats.json')).then(response => {
  if (!response.ok) throw Error('read failed');
  return response.json();
}).then(stats => {
  document.getElementById('counts').textContent = `基础有效词条 ${stats.base_entries.toLocaleString('zh-CN')} 条；其中原标注计算机义 ${stats.base_computing_tagged_entries.toLocaleString('zh-CN')} 条。另有 ${stats.editorial_professional_concepts} 个整理版专业概念（${stats.editorial_professional_keys} 个可查询名称，含别名）。词组和缩写与这些数量存在交集，不可相加。`;
}).catch(() => {
  document.getElementById('counts').textContent = '词库统计读取失败。请确认 data 文件夹完整，并重新加载扩展。';
});
