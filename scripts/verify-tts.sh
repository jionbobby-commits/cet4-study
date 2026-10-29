#!/usr/bin/env bash
# 验证内置 espeak-ng 语音引擎可运行（不需要启动服务）。
set -euo pipefail

SELF="$(readlink -f "$0")"
APP_DIR="$(cd "$(dirname "$SELF")/.." && pwd)"
VENDOR="$APP_DIR/vendor/usr"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -x "$VENDOR/bin/espeak-ng" ] || [ ! -d "$VENDOR/share/espeak-ng-data" ]; then
  echo "缺少内置语音引擎：$VENDOR" >&2
  exit 1
fi

export LD_LIBRARY_PATH="$VENDOR/lib"
export ESPEAK_DATA_PATH="$VENDOR/share/espeak-ng-data"
"$VENDOR/bin/espeak-ng" -v en-us -s 160 -w "$TMP/test.wav" "Hello, this is an offline text to speech test."
test -s "$TMP/test.wav"
echo "TTS OK: $(du -h "$TMP/test.wav" | cut -f1) WAV"
if command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg: $(ffmpeg -version 2>/dev/null | head -n1)"
else
  echo "ffmpeg: 未安装（多角色听力对话将只播放第一段，可安装 ffmpeg 改善）"
fi
