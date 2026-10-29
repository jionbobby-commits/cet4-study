# 第三方组件与内容说明

本仓库的 **应用代码** 采用 MIT 许可（见 [LICENSE](LICENSE)）。  
以下组件/内容由第三方提供，按各自的许可证分发。

## 1. espeak-ng 1.52.0

- 用途：离线英文语音合成（单词发音、听写、听力对话）。
- 上游：<https://github.com/espeak-ng/espeak-ng>
- 许可证：GPL-3.0-or-later
- 本仓库位置：<code>vendor/usr/bin/espeak-ng</code>、<code>vendor/usr/lib/libespeak-ng.so.1.52.0</code>、<code>vendor/usr/share/espeak-ng-data/</code>
- 来源：Arch Linux 官方 <code>extra</code> 仓库的 <code>espeak-ng 1.52.0-1</code> 二进制包，未修改二进制文件。
- 许可证全文：[LICENSES/GPL-3.0-or-later.txt](LICENSES/GPL-3.0-or-later.txt)
- 对应源代码：请从上游仓库或 Arch Linux 源码包获取；如需书面源码副本，请提交 Issue。

## 2. pcaudiolib 1.3

- 用途：espeak-ng 的音频输出后端。
- 上游：<https://github.com/espeak-ng/pcaudiolib>
- 许可证：GPL-3.0（Arch 包元数据标注为 GPL3）
- 本仓库位置：<code>vendor/usr/lib/libpcaudio.so.0.0.1</code>
- 来源：Arch Linux 官方 <code>extra</code> 仓库的 <code>pcaudiolib 1.3-1</code> 二进制包，未修改。
- 许可证全文：[LICENSES/GPL-3.0-or-later.txt](LICENSES/GPL-3.0-or-later.txt)

## 3. libsonic 0.2.0

- 用途：espeak-ng 的语速处理依赖。
- 上游：<https://github.com/waywardgeek/sonic>
- 许可证：Apache-2.0
- 本仓库位置：<code>vendor/usr/lib/libsonic.so.0.2.0</code>
- 来源：Arch Linux 官方 <code>extra</code> 仓库的 <code>libsonic 0.2.0-2</code> 二进制包，未修改。
- 许可证全文：[LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt)

## 4. CET-4 词表

- 来源：<https://github.com/jionbobby-commits/cet4-dictation> 的 <code>js/cet4_words.js</code> 中 <code>ALL_CET4_WORDS</code>。
- 条目数：2089；字段包括单词、词性、中文释义、例句（647 条有例句），音标字段为空。
- 许可证：MIT，Copyright (c) 2026 jionbobby-commits。
- 许可证全文：[LICENSES/MIT-cet4-dictation.txt](LICENSES/MIT-cet4-dictation.txt)
- 本仓库转换后的文件：<code>seed/words.json</code>。

## 5. 原创示例内容

听写 30 句、听力 4 篇、口语 10 题、模拟卷 1 套及解析，均为本项目原创示例材料，**不是 CET-4 官方真题**，也不包含商业题库内容。  
这些内容随项目以 CC BY 4.0 提供（如无单独标注，适用此许可）：<https://creativecommons.org/licenses/by/4.0/>。

## 6. 运行环境

- Python 标准库（PSF License）
- SQLite（Public Domain）
- 可选：FFmpeg（LGPL/GPL，取决于构建选项），仅用于多角色听力对话拼接；未随仓库分发。

如果发现许可证或归属信息有误，请提交 Issue，我们会尽快更正。
