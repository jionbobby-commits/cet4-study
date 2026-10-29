# 英语四级离线备考平台（CET-4）

一套完全本地运行的 CET-4 备考 Web 应用：背单词、听写、听力、口语、模拟卷、打卡与学习统计。
后端只用 Python 标准库和 SQLite，前端原生 HTML/CSS/JS；内置离线语音引擎，断网也能朗读和做听力。

> **重要说明**：仓库内的听写、听力、口语、模拟卷均为**项目原创示例材料**，不是 CET-4 官方真题，也不包含商业题库或官方听力音频。
> 词表来自本项目作者的开源仓库 <code>cet4-dictation</code>（MIT）。

## 功能

- **背单词**：2089 个 CET-4 词条，含词性、中文释义和例句；四档自评（忘记 / 模糊 / 认识 / 太简单）驱动间隔复习；支持拼写模式、收藏、错词、已学和全部。
- **听写训练**：30 个英文句子，逐句播放、输入、逐词 diff 对比正确率，附中文翻译和提示。
- **听力精听**：4 篇原创对话/短文，每篇 3 题；支持常速/慢速、再听一遍、逐题解析和听力原文。
- **口语练习**：10 个朗读/话题/问答任务；浏览器录音、回放、自评星级和笔记，录音只保存在本机。
- **模拟卷**：1 套 50 分原创模拟卷（听力 10 + 阅读 10 + 写作 15 + 翻译 15），计时、答题卡、交卷、客观题自动判分、写作/翻译自评与范文。
- **打卡与统计**：连续打卡、今日任务、最近 28 天练习量、词汇记忆状态、听写/听力/口语正确率、最近模拟卷。
- **离线 TTS**：内置 espeak-ng、pcaudiolib、libsonic，无需联网、无需系统安装语音包。
- **数据持久化**：SQLite 单文件数据库；关闭浏览器、重启电脑后学习记录仍在。
- **中文界面 / 响应式**：桌面和手机浏览器均可使用，支持深浅主题、键盘快捷键。
- **题库导入**：支持导入有合法使用权限的单词、听写、听力、模拟卷 JSON/CSV。

## 快速开始

### 环境

- Linux x86_64（内置语音二进制为 Linux x86_64 / glibc）
- Python 3.10 或更高版本
- 可选：Chrome / Chromium / Edge，用于独立应用窗口和桌面启动器
- 可选：FFmpeg，用于把多角色听力对话拼接成一个音频；没有 FFmpeg 时只播放第一段
- 可选：<code>curl</code>、<code>ss</code>，用于启动器健康检查和进程识别

不需要 <code>pip install</code>，不需要 Node.js，不需要联网。

### 启动

~~~bash
git clone https://github.com/jionbobby-commits/cet4-study.git
cd cet4-study
python3 server.py --port 8766
~~~

浏览器打开 <http://127.0.0.1:8766>。
首次启动会在 <code>data/cet4.db</code> 自动建库并播种 2089 个单词、30 句听写、4 篇听力、10 个口语任务和 1 套模拟卷。

也可以使用启动器：

~~~bash
./bin/cet4-study open      # 启动服务并打开 Chrome 独立窗口
./bin/cet4-study browser   # 启动服务并用默认浏览器打开
./bin/cet4-study status    # 查看状态
./bin/cet4-study stop      # 停止本项目服务
~~~

换端口：

~~~bash
CET4_PORT=9001 ./bin/cet4-study open
~~~

启动器根据脚本自身位置定位项目，不依赖固定安装路径。

### 桌面启动器

~~~bash
./install-desktop.sh
~~~

只写入当前用户的 <code>~/.local/share/applications</code> 和 <code>~/.local/share/icons</code>，不需要 sudo。
安装后可在 DMS / GNOME / KDE 应用启动器中搜索「英语四级备考」。

### 验证离线语音

~~~bash
./scripts/verify-tts.sh
~~~

## 目录结构

~~~text
cet4-study/
├── server.py                 # 标准库 HTTP 服务 + SQLite + TTS/导入/判分
├── bin/cet4-study            # 启动器：open/browser/start/stop/status/url
├── install-desktop.sh        # 当前用户桌面入口
├── seed/
│   ├── words.json            # 2089 个 CET-4 词条
│   ├── dictations.json       # 30 句听写
│   ├── listening.json        # 4 篇听力
│   ├── speaking.json         # 10 个口语任务
│   └── paper_mock.json       # 1 套 50 分模拟卷
├── vendor/usr/               # 内置 espeak-ng 运行时（约 35 MB）
├── web/                      # 无构建步骤的前端
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── assets/
├── scripts/verify-tts.sh
├── docs/README.md            # 详细使用、导入格式、备份、排障
├── data/                     # 运行时生成，已被 .gitignore 忽略
├── LICENSE                   # 代码 MIT
├── THIRD_PARTY_NOTICES.md    # 语音引擎与词表许可
└── LICENSES/
~~~

## 学习流程建议

1. 首页点「今日打卡」；
2. 「单词」每天学 20 个新词，按四档自评；第二天先做「复习」；
3. 「听写」每天 1 句，错词会显示逐词 diff；
4. 「听力」先盲听做题，再看原文和解析；
5. 「口语」录音后回放，对照范文自评；
6. 周末做「模拟卷」，写作和翻译按范文自评；
7. 「统计」查看连续天数、正确率和最近 28 天练习量。

## 词库与内容来源

### 单词

- 2089 条，来自 <https://github.com/jionbobby-commits/cet4-dictation> 的 <code>ALL_CET4_WORDS</code>。
- 字段：单词、词性、中文释义、例句；647 条有英文例句；音标字段为空。
- 许可：MIT，Copyright (c) 2026 jionbobby-commits。
- 转换后的文件：<code>seed/words.json</code>。

### 听力、听写、口语、模拟卷

- 全部为本项目原创示例材料，**不是官方真题，也不是真实考场听力音频**。
- 听力音频由内置 espeak-ng 实时合成，音色是机器朗读，不能替代官方录音。
- 模拟卷满分 50 分，其中写作 15 分、翻译 15 分为自评；不是 710 分制完整试卷。
- 这些内容随项目以 CC BY 4.0 提供（如无单独标注）。

## 导入格式

网页「导入」页面支持：

- 单词：JSON 数组或 CSV；字段 <code>word/en/单词</code>、<code>meaning/cn/释义</code>、<code>pos</code>、<code>example</code>、<code>example_cn</code>。
- 听写：JSON 数组；<code>text</code>、<code>translation</code>、<code>hint</code>。
- 听力：JSON 数组；<code>title</code>、<code>turns</code>、<code>questions</code>。
- 模拟卷：JSON；<code>title</code>、<code>sections</code>。

导入前请确认你有权使用该内容；不要导入未授权的商业题库或官方真题。
详细字段和示例见 [docs/README.md](docs/README.md)。

## 数据、备份与隐私

~~~text
data/cet4.db       # SQLite 主库（WAL）
data/tts/          # 语音合成缓存（可删除，会自动重建）
data/server.log    # 启动器日志
~~~

- 所有数据只保存在本机，服务默认绑定 <code>127.0.0.1</code>，不会上传。
- 口语录音保存在浏览器的本地存储/页面内存中并由浏览器管理；本项目不上传音频。
- 备份：停止服务后复制 <code>data/cet4.db</code>，或使用 SQLite 的 <code>.backup</code>。
- <code>data/</code> 不会进入 Git 仓库；升级代码不会覆盖数据库。

## 已知限制

- 没有 CET-4 官方真题和官方听力音频；示例材料只用于演示功能。
- 听力是机器合成语音，语调和真实考场录音有差距。
- 口语没有自动评分，只有录音回放、自评星级和范文； microphone 权限由浏览器控制。
- 手机通过局域网 <code>http://IP:8766</code> 访问时，浏览器可能因非安全上下文禁用 MediaRecorder；建议在电脑本机使用口语录音。
- 音标字段为空；词表只有中文释义和部分例句。
- 内置语音引擎是 Linux x86_64 二进制；其他平台可运行应用，但 TTS 可能不可用。
- 多角色听力对话需要 FFmpeg 拼接；没有 FFmpeg 时只播放第一段。

## AI 生成说明与致谢

本项目由 **AI 编程助手（DeepSeek）生成初版**，并由仓库所有者进行需求定义、审阅、实测和维护。
应用、示例材料、文档在交付前经过了本地接口测试、浏览器端到端测试和持久化验证；但 AI 生成内容仍可能存在错误，欢迎提交 Issue 指出。

感谢 **DeepSeek** 提供模型与工具支持。
也感谢开源项目 espeak-ng、pcaudiolib、libsonic，以及词表来源仓库 <code>cet4-dictation</code> 的作者。

## 许可

- 应用代码：MIT，见 [LICENSE](LICENSE)。
- 词表：MIT，见 [LICENSES/MIT-cet4-dictation.txt](LICENSES/MIT-cet4-dictation.txt)。
- 内置语音引擎：GPL-3.0-or-later / GPL-3.0 / Apache-2.0，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 原创示例材料：CC BY 4.0，见 [LICENSES/CC-BY-4.0.txt](LICENSES/CC-BY-4.0.txt)。

## 卸载

~~~bash
./bin/cet4-study stop
cd ..
rm -rf cet4-study
rm -f "$HOME/.local/share/applications/cet4-study.desktop"
rm -f "$HOME/.local/share/icons/hicolor/512x512/apps/cet4-study.png"
~~~

删除项目目录会同时删除 <code>data/cet4.db</code> 和口语/学习记录，请先备份。
