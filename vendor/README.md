# vendor：内置离线语音引擎（仅运行时文件）

本目录让应用在**完全离线**的情况下朗读英文单词、听写句子和听力材料，不依赖系统安装 espeak-ng。

## 内容

~~~text
vendor/usr/
├── bin/
│   ├── espeak-ng
│   ├── espeak -> espeak-ng
│   ├── speak -> espeak-ng
│   └── speak-ng -> espeak-ng
├── lib/
│   ├── libespeak-ng.so.1.52.0
│   ├── libpcaudio.so.0.0.1
│   ├── libsonic.so.0.2.0
│   └── 对应 .so / .so.1 符号链接
└── share/espeak-ng-data/       # 语音数据（约 19 MB）
~~~

已去除开发头文件、pkgconfig、man 和 vim 文件，只保留运行所需内容。

## 来源

Arch Linux 官方仓库 <code>extra</code> 的二进制包，未修改：

- <code>espeak-ng 1.52.0-1</code>
- <code>pcaudiolib 1.3-1</code>
- <code>libsonic 0.2.0-2</code>

包页面：

- <https://archlinux.org/packages/extra/x86_64/espeak-ng/>
- <https://archlinux.org/packages/extra/x86_64/pcaudiolib/>
- <https://archlinux.org/packages/extra/x86_64/libsonic/>

许可证与源码获取方式见仓库根目录的 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

## 平台限制

这些是 **Linux x86_64** 二进制，依赖 glibc、ALSA 和 libpulse 运行库。  
在其他架构或非 glibc 系统上，应用仍可运行，但语音合成可能不可用（<code>/api/health</code> 返回的 <code>tts</code> 为 false）。

## 验证

~~~bash
./scripts/verify-tts.sh
~~~

脚本会用内置引擎生成一段 WAV 到临时目录，成功后自动删除。
