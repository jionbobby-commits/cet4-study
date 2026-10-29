# 英语四级离线备考平台（CET-4）

一个完全跑在本机的四级备考应用：背单词、听写、听力、口语、模拟卷、打卡统计。
无需账号、无需联网、无遥测；后端只用 Python 3 标准库，数据存在单个 SQLite 文件里。

- 前端：原生 HTML / CSS / JavaScript（无构建步骤、无 CDN）
- 后端：Python 3 标准库 ThreadingHTTPServer
- 存储：`data/cet4.db`（SQLite，WAL 模式）
- 发音：内置 espeak-ng 1.52，完全离线合成

## 项目位置

| 内容 | 路径 |
| --- | --- |
| 程序目录 | 克隆后的仓库根目录（约 35 MB，含内置语音引擎） |
| 启动器 | `./bin/cet4-study` |
| 数据库 | `data/cet4.db` |
| 日志 | `data/server.log` |
| 当前端口 | `data/server.url` |
| 桌面入口 | `~/.local/share/applications/cet4-study.desktop`（运行 `./install-desktop.sh` 生成） |
| 应用窗口配置 | `~/.local/share/cet4-study/chrome-profile`（独立 Chrome 配置，不影响日常浏览器） |

默认地址：`http://127.0.0.1:8766`

## 启动与停止

### 桌面启动（推荐）

在 DMS 应用启动器里搜索「英语四级备考」或「CET」，点击即可。
首次点击会先启动本地服务，再用 Chrome 独立窗口打开（不是普通标签页）。

### 命令行

~~~bash
./bin/cet4-study open      # 启动服务 + 独立窗口
./bin/cet4-study start     # 只启动服务
./bin/cet4-study status    # 查看运行状态
./bin/cet4-study url       # 打印地址
./bin/cet4-study browser   # 用默认浏览器打开
./bin/cet4-study stop      # 停止服务
~~~

开机不会自启；需要时常驻可以重复执行 `start`。

### 换端口

~~~bash
CET4_PORT=9000 ./bin/cet4-study start
CET4_PORT=9000 ./bin/cet4-study open
~~~

桌面图标固定使用 8766；改端口后请从命令行打开。

### 手机 / 平板访问（可选，需同一 Wi-Fi）

默认只监听 127.0.0.1（仅本机可访问），这是有意的安全默认值。
如确实要在手机上用：

~~~bash
./bin/cet4-study stop
cd cet4-study
python3 server.py --host 0.0.0.0 --port 8766
~~~

然后手机访问 `http://电脑的局域网IP:8766`。
界面已按 390px 宽度适配；局域网访问未做安全加固，请只在可信网络使用，用完 Ctrl+C 停止。

## 已实现功能

- **首页**：连续打卡、今日单词量、已掌握/总词数、今日任务进度、最近 7 天练习量、模块入口。
- **背单词（SRS）**：
  - 2089 个四级词，四档自评（忘记 / 模糊 / 认识 / 太简单）驱动复习间隔；
  - 新词、到期复习、错词、收藏、已学、全部六种队列；
  - 显示释义后可发音；拼写模式可听音写词并即时判分；
  - 收藏、错词次数、正确率全部落库。
- **听写**：30 个原创句子；正常/慢速播放；提交后逐词 diff（漏写、多写、替换分别标色），显示译文与提示。
- **听力**：4 篇原创材料（短对话/长对话），每篇 3 题；可重听；提交后逐题显示正确答案、你的答案与中文解析，并可展开听力原文。
- **口语**：10 个话题（朗读 / 主题陈述 / 问答）；浏览器录音、页面内回放、参考范文、自评星级与笔记；录音不上传、不写数据库。
- **模拟卷**：1 套 50 分原创卷（听力 5×2、阅读 5×2、写作 15、翻译 15）；倒计时、答题卡、交卷确认；客观题自动判分，写作/翻译按范文自评；保留历史成绩。
- **统计**：单词复习次数与正确率、听写/听力正确率、8 周打卡日历、最近 28 天练习量、词汇记忆状态分布、最近模拟卷。
- **导入导出**：单词（JSON/CSV）、听写、听力、模拟卷导入；词库与打卡记录可导出 JSON。
- **其他**：深浅主题（记忆在浏览器）、快捷键、响应式布局、所有记录重启不丢。

快捷键：单词页 `空格` 显示释义、`1`–`4` 评价、`←`/`→` 切换；做题时 `Enter` 提交；听写页空格播放。

## 题库来源与版权

- **2089 个单词**：来自开源词表仓库 [cet4-dictation](https://github.com/jionbobby-commits/cet4-dictation) 的 `js/cet4_words.js`（MIT），含词性、中文释义和例句（647 条有例句）。音标字段为空。
- **听写 30 句、听力 4 篇、口语 10 题、模拟卷 1 套**：为本项目原创示例，**不是官方真题**，也不冒充真题。
- **发音**：内置 Arch 官方 `espeak-ng 1.52.0`（GPL-3.0）及其依赖，原样解包到 `vendor/`，未修改；只在本地合成，不访问网络。
- 真题请通过官方出版/授权渠道获取后，用下面的格式导入自用。本平台不提供、不下载任何未授权题库。

## 导入格式

打开「导入」页，选择类型，点「填入示例格式」可直接看到当前支持的字段。

### 单词（JSON 数组或 CSV）

~~~json
[
  {
    "word": "abandon",
    "pos": "v.",
    "meaning": "放弃；抛弃",
    "example": "They had to abandon the car in the snow.",
    "example_cn": "他们不得不把车丢在雪地里。"
  }
]
~~~

CSV 表头：

~~~csv
word,pos,meaning,example,example_cn
abandon,v.,放弃；抛弃,They had to abandon the car in the snow.,他们不得不把车丢在雪地里。
~~~

重复单词会更新释义/例句，计入「跳过」而不是重复新增。

### 听写（JSON）

~~~json
[
  {
    "text": "The library will close early during the holiday.",
    "translation": "假期期间图书馆会提前闭馆。",
    "hint": "校园 · 8 词"
  }
]
~~~

### 听力（JSON）

~~~json
[
  {
    "title": "短对话：借笔记",
    "level": "CET-4",
    "intro": "校园场景短对话。",
    "turns": [
      { "s": "M", "text": "Could I borrow your notes from yesterday? I missed the class." },
      { "s": "W", "text": "Sure, but I need them back before Friday." }
    ],
    "questions": [
      {
        "q": "What does the man want to borrow?",
        "options": ["A notebook", "Class notes", "A textbook", "A pen"],
        "answer": "B",
        "explanation": "男士说 borrow your notes，因此是课堂笔记。"
      }
    ],
    "translation": "男：我能借你昨天的笔记吗？我缺了一节课。女：可以，但周五前要还给我。"
  }
]
~~~

`answer` 用选项字母 A/B/C/D；有 `turns` 时页面会按角色合成对话音频。

### 模拟卷（JSON）

~~~json
[
  {
    "title": "自定义模拟卷",
    "kind": "imported",
    "duration_sec": 3600,
    "intro": "导入的练习卷。",
    "sections": [
      {
        "title": "Part I 词汇选择",
        "type": "reading",
        "intro": "选择最合适的答案。",
        "passage": "",
        "prompt": "",
        "questions": [
          {
            "stem": "He was ______ to hear the news.",
            "options": ["delighted", "delighting", "delight", "delights"],
            "answer": "A",
            "explanation": "be delighted to do 表示“很高兴做某事”。"
          }
        ]
      }
    ]
  }
]
~~~

`type` 可用 `reading` / `listening` / `writing` / `translation`。
写作、翻译这类主观 section 用 `self_score` 设定满分，交卷时按范文自评。

导入也可以直接调接口（仅本机）：

~~~bash
curl -s http://127.0.0.1:8766/api/import \
  -H 'Content-Type: application/json' \
  -d '{"kind":"words","format":"json","content":"[{\"word\":\"test\",\"meaning\":\"测试\"}]"}'
~~~

返回 `{"ok":true,"imported":1,"skipped":0,"errors":[]}`。

## 数据、备份与恢复

所有学习记录都在 `data/cet4.db`，关闭浏览器、重启电脑都不会丢。

备份（建议先停服务，保证 WAL 已落盘）：

~~~bash
cd cet4-study
./bin/cet4-study stop
cp data/cet4.db ~/cet4-backup-$(date +%F).db
./bin/cet4-study start
~~~

恢复：停服务，把备份复制回 `data/cet4.db`，并删掉 `data/cet4.db-wal`、`data/cet4.db-shm`，再启动。

重置全部进度（保留程序与内置题库）：

~~~bash
cd cet4-study
./bin/cet4-study stop
rm -f data/cet4.db data/cet4.db-wal data/cet4.db-shm
./bin/cet4-study start
~~~

数据库为空时启动会自动重新播种内置词库、听写、听力、口语与模拟卷。

## 离线发音说明

语音引擎与数据都在 `vendor/` 内，不依赖系统包，也不会联网：

- `vendor/usr/bin/espeak-ng`
- `vendor/usr/share/espeak-ng-data`
- `vendor/usr/lib`（libespeak-ng / libpcaudio / libsonic）

服务端在调用时自动设置 `LD_LIBRARY_PATH` 与 `ESPEAK_DATA_PATH`，用户无需配置。
自检：

~~~bash
curl -s -o /tmp/cet4-test.wav "http://127.0.0.1:8766/api/audio/word?word=abandon"
file /tmp/cet4-test.wav   # 应显示 WAVE audio
~~~

语速可在「导入/设置」页调整（默认 145 词/分钟）。

## 目录结构

~~~
cet4-study/
├── server.py              # 全部后端逻辑（标准库，约 1400 行）
├── bin/cet4-study         # 启动/停止/打开窗口
├── web/
│   ├── index.html
│   ├── app.js             # 前端逻辑（原生 JS，约 1300 行）
│   ├── styles.css
│   └── assets/            # icon.svg / icon-512.png
├── seed/                  # 内置词库与原创内容（JSON）
├── vendor/                # 内置 espeak-ng 及依赖
├── data/
│   ├── cet4.db            # 学习记录 + 题库
│   ├── tts/               # 合成音频缓存，可安全删除
│   ├── server.log
│   └── server.url
└── docs/README.md
~~~

## 卸载

~~~bash
./bin/cet4-study stop
cd ..
rm -rf cet4-study
rm -rf ~/.local/share/cet4-study
rm -f ~/.local/share/applications/cet4-study.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null || true
~~~

这会一起删掉学习记录。只想清空进度请参考上面的「重置全部进度」。
本项目不需要安装系统包、不修改系统服务，也不会动 Niri / DMS / 显卡驱动 / 代理配置。

## 排障

| 现象 | 处理 |
| --- | --- |
| 页面打不开 | 运行 `./bin/cet4-study status`；失败时看 `data/server.log` 末尾 |
| 端口被占用 | `CET4_PORT=9000 ./bin/cet4-study start`，再用同端口 `open` |
| 启动器 stop 提示端口被其他程序占用 | 该进程不是本应用启动的；确认后用 `kill PID`，再由启动器重启 |
| 没声音 | 先在页面点播放；确认系统音量；用上面的 curl 自检生成 wav |
| 录音没反应 | Chrome 应用窗口首次会询问麦克风权限；检查 `chrome://settings/content/microphone` |
| 中文显示异常 | 系统已装 `noto-fonts-cjk`；页面使用系统字体栈 |
| 导入 0 条但有报错 | 看返回的 `errors`；JSON 必须是数组，字段名区分大小写 |
| 数据想从头开始 | 按「重置全部进度」删除数据库后重启 |

## 已验证项（交付前实测）

- 8 个页面（首页/单词/听力/听写/口语/模拟卷/统计/导入）均能渲染，无 JS 报错。
- 打卡、单词四档评价、收藏、拼写判分、听写 diff、听力判分与解析、口语录音与自评、模拟卷计时与交卷、导入、主题切换全部走通。
- 浏览器关闭并重启服务后，答题与打卡记录仍在（SQLite 持久化）。
- 390px 手机宽度无横向溢出，导航自动换行。
- 内置语音可离线生成 WAV（`tts: true`）。

## 已知限制

- 没有官方四级真题；内置题目为原创示例，真题需自行合法导入。
- 口语没有自动评分，只有录音回放 + 自评；写作/翻译同样按范文自评。
- 单词音标为空（源词表未提供），发音靠 TTS。
- 单用户、单机；没有账号、云同步、多端同步。
- 手机访问需手动以 `--host 0.0.0.0` 启动，默认不开放局域网。
