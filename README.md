# 计算机小字典 0.2.0

可直接在 Chrome 加载的 Manifest V3 扩展：大规模离线英汉查询、专业义优先、划词按钮、320×320 拖动浮窗、词形与代码名称拆分。没有后端服务，也没有 AI 调用。

安装见 [安装说明.md](安装说明.md)，许可与计数见 [词库来源与许可.md](词库来源与许可.md)，验证见 [检查记录.md](检查记录.md)。

## 文件结构

- manifest.json：Chrome 扩展入口，权限仅 storage。
- content.js：网页浮窗和消息调用，不包含大词库。
- background.js：后台服务工作线程、查询消息及工具栏动作。
- engine.js：本机分片查询、LRU、词形、完整词组与名称拆分。
- data/000.json～1ff.json：512 个预生成词库分片，安装后即可离线使用。
- data/curated.json、professional.tsv、sources.json：整理版专业解释与依据。
- data/stats.json：实际计数及数据指纹。
- options.*：设置页与本机记录清除。
- licenses/ECDICT-MIT.txt：上游许可证原文，分发时必须保留。
- tools/：可重建脚本与原始编辑种子。
- tests/：测试脚本、固定样本、逐词 CSV、完整检查输出。

## 可选：开发者重建（安装用户不需要做）

需要 Python 3 和 Node.js；扩展运行本身不依赖它们。下载上游 ECDICT 的 ecdict.csv，核对《词库来源与许可.md》的 SHA-256。然后在本文件夹执行：

```text
python tools/build_curated.py
python tools/build_dictionary.py D:/你的路径/ecdict.csv
node --expose-gc tests/check.cjs
```

build_curated.py 根据专业 TSV 与保留的首版编辑种子重新生成整理版。build_dictionary.py 使用 Python 标准库 CSV 解析，保留带中文释义的有效数据，并生成分片、词形映射及计数。脚本不下载或调用 AI。

需要重现网页样本抽取时，按 tests/corpus.json 的 file、url 下载对应原始 Markdown／GitHub HTML 到一个目录，再运行 `python tools/freeze_corpus.py D:/原始测试材料目录`。页面以后更新会导致 SHA 和抽样变化；本包保留的是本次实际提取的固定词形及来源指纹，没有复制整篇测试文档。

真实浏览器集成测试使用 Node 内置 HTTP、WebSocket 和 Chrome 官方 CDP，无 npm 依赖。可设置 CHROME_PATH 指向 Chrome 可执行文件，然后运行 `node tests/chrome-integration.cjs`。脚本创建独立临时测试配置，不读取个人资料；在本地临时 HTTP 页面加载真实扩展，输出 tests/browser-results.json。Chrome 需支持 Extensions.loadUnpacked 和相应调试选项。脚本退出时关闭测试浏览器；测试配置留在运行目录 work 中供排查。

## 匹配顺序与限制

先查完整名称及专业补充，再使用词库 exchange 的实际词形记录。专业原词优先于普通复数译文；缩写复数只对明确登记的专业缩写使用规则，并在界面标明。完整词组未找到时，用末词的实际词形记录重查整个词组，最后才给拆分参考。算法不声称能准确还原所有英文词形。

哈希按 UTF-16 编码单元的 FNV-1a 取模 512，生成器和运行时一致。后台缓存上限为 12 个分片，共用同片的在途读取。大词库不注册为 web_accessible_resources，网页不直接取得分片。
