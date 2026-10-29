#!/usr/bin/env bash
# 为当前用户安装桌面启动器（无需 sudo）。
set -euo pipefail

SELF="$(readlink -f "$0")"
APP_DIR="$(cd "$(dirname "$SELF")" && pwd)"
DATA_HOME="$XDG_DATA_HOME"
if [ -z "$DATA_HOME" ]; then DATA_HOME="$HOME/.local/share"; fi
APPS_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
ICON_SRC="$APP_DIR/web/assets/icon-512.png"

if [ ! -x "$APP_DIR/bin/cet4-study" ]; then
  chmod +x "$APP_DIR/bin/cet4-study"
fi
mkdir -p "$APPS_DIR" "$ICON_DIR"
cp "$ICON_SRC" "$ICON_DIR/cet4-study.png"

DESKTOP="$APPS_DIR/cet4-study.desktop"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=英语四级备考
Name[zh_CN]=英语四级备考
Comment=本地离线背单词、听写、听力、口语与模拟卷
Comment[zh_CN]=本地离线背单词、听写、听力、口语与模拟卷
Exec="$APP_DIR/bin/cet4-study" open
Icon=cet4-study
Terminal=false
Categories=Education;Languages;
Keywords=CET4;英语四级;背单词;听力;
StartupNotify=true
StartupWMClass=chrome-127.0.0.1__-Default
Actions=browser;stop;

[Desktop Action browser]
Name=在浏览器中打开
Name[zh_CN]=在浏览器中打开
Exec="$APP_DIR/bin/cet4-study" browser

[Desktop Action stop]
Name=停止后台服务
Name[zh_CN]=停止后台服务
Exec="$APP_DIR/bin/cet4-study" stop
EOF

chmod 644 "$DESKTOP"
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$DESKTOP" || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true
fi

echo "已安装：$DESKTOP"
echo "应用启动器中搜索「英语四级备考」，或运行：$APP_DIR/bin/cet4-study open"
