#!/bin/bash
# 启动闲鱼专用 Chrome 实例（独立 profile，端口 18803）
# 用法: bash setup-chrome.sh [start|stop|status|clean]
#
# 为什么必须用独立 profile：
#   1. 不干扰日常浏览器的登录态和扩展
#   2. 登录的是闲鱼「小号」，与主号隔离
#   3. 可以安全地整目录删除重来（登录态丢了就丢小号）

set -u

PORT="${XIANYU_CDP_PORT:-18803}"
PROFILE="${XIANYU_PROFILE:-$HOME/.chrome-debug-xianyu}"

# ---------- 自动探测 Chrome 路径（macOS / Linux / Windows Git Bash） ----------
find_chrome() {
  if [ -n "${CHROME_PATH:-}" ] && [ -x "$CHROME_PATH" ]; then
    echo "$CHROME_PATH"; return 0
  fi
  local candidates=(
    # macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    # Linux
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/snap/bin/chromium"
    # Windows (Git Bash / MSYS)
    "/c/Program Files/Google/Chrome/Application/chrome.exe"
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
    "$LOCALAPPDATA/Google/Chrome/Application/chrome.exe"
    # Edge（Chromium 内核，也能用）
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    "/c/Program Files/Microsoft/Edge/Application/msedge.exe"
  )
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}

alive() { curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; }

case "${1:-status}" in
  start)
    if alive; then
      echo "✅ Chrome 已在端口 $PORT 运行"
      exit 0
    fi

    CHROME=$(find_chrome) || {
      echo "❌ 找不到 Chrome。请用环境变量指定路径，例如："
      echo "   export CHROME_PATH='/path/to/chrome'"
      exit 1
    }

    mkdir -p "$PROFILE"
    echo "使用浏览器: $CHROME"
    echo "用户目录:   $PROFILE"

    nohup "$CHROME" \
      --remote-debugging-port="$PORT" \
      --user-data-dir="$PROFILE" \
      --no-first-run \
      --no-default-browser-check \
      --disable-background-timer-throttling \
      --disable-backgrounding-occluded-windows \
      --disable-renderer-backgrounding \
      --disable-features=Translate,OptimizationHints \
      > /dev/null 2>&1 &

    # 轮询而不是死等（首次启动可能 3-5 秒）
    for _ in $(seq 1 20); do
      sleep 0.5
      if alive; then
        echo "✅ Chrome 已启动（端口 $PORT）"
        echo ""
        echo "下一步：在弹出窗口打开 https://www.goofish.com ，用【小号】扫码登录"
        exit 0
      fi
    done

    echo "❌ Chrome 启动超时。手动检查："
    echo "   curl http://127.0.0.1:$PORT/json/version"
    exit 1
    ;;

  stop)
    PID=""
    if command -v lsof > /dev/null 2>&1; then
      PID=$(lsof -ti ":$PORT" 2>/dev/null | head -1)
    elif command -v netstat > /dev/null 2>&1; then
      PID=$(netstat -ano 2>/dev/null | grep ":$PORT" | grep -i LISTENING | awk '{print $NF}' | head -1)
    fi

    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null || taskkill //PID "$PID" //F 2>/dev/null
      echo "✅ Chrome 已停止（PID $PID）"
    else
      echo "Chrome 未在运行"
    fi
    ;;

  status)
    if alive; then
      echo "✅ Chrome 运行中（端口 $PORT）"
      curl -s "http://127.0.0.1:$PORT/json/version" | head -3
    else
      echo "❌ Chrome 未运行（端口 $PORT）"
      echo "   启动: bash scripts/setup-chrome.sh start"
    fi
    ;;

  clean)
    echo "⚠️  这会删除登录态（$PROFILE），之后需要重新扫码。"
    read -r -p "确认删除？[y/N] " ans
    case "$ans" in
      [yY]*) rm -rf "$PROFILE" && echo "✅ 已清理" ;;
      *) echo "已取消" ;;
    esac
    ;;

  *)
    echo "用法: $0 [start|stop|status|clean]"
    exit 1
    ;;
esac
