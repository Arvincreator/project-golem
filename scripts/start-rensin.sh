#!/bin/bash
# ============================================================
# 🤖 Start Rensin — 驗證 → 部署 PR → 啟動
# Usage: ./scripts/start-rensin.sh [--skip-deploy] [--background]
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

SKIP_DEPLOY=false
BACKGROUND=false

for arg in "$@"; do
    case $arg in
        --skip-deploy) SKIP_DEPLOY=true ;;
        --background|-bg) BACKGROUND=true ;;
    esac
done

echo ""
echo "🤖 Rensin 啟動流程"
echo "══════════════════"

# ─── Step 1: 殺掉舊的 Rensin 進程 ───
EXISTING=$(pgrep -f "node.*index\.js" --cwd "$PROJECT_ROOT" 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
    echo "⏹  停止舊進程: PID $EXISTING"
    kill $EXISTING 2>/dev/null || true
    sleep 2
fi

# ─── Step 2: Deploy PR (驗證 + 推送) ───
if [ "$SKIP_DEPLOY" = false ]; then
    echo ""
    echo "📦 執行部署驗證..."
    if bash scripts/deploy-pr.sh; then
        echo "✅ 部署驗證通過"
    else
        echo "❌ 部署驗證失敗，停止啟動"
        exit 1
    fi
fi

# ─── Step 3: 啟動 Rensin ───
echo ""
echo "🚀 啟動 Rensin..."

if [ "$BACKGROUND" = true ]; then
    # 背景模式：nohup + log 輸出
    LOG_FILE="$PROJECT_ROOT/rensin.log"
    nohup node index.js >> "$LOG_FILE" 2>&1 &
    RENSIN_PID=$!
    echo "✅ Rensin 已在背景啟動 (PID: $RENSIN_PID)"
    echo "📝 日誌: $LOG_FILE"
    echo "📊 查看: tail -f $LOG_FILE"
    echo "⏹  停止: kill $RENSIN_PID"

    # 等 5 秒確認沒有立即崩潰
    sleep 5
    if kill -0 $RENSIN_PID 2>/dev/null; then
        echo "✅ Rensin 運行正常 (5s 健康檢查通過)"

        # 戰情室通知
        curl -s -X POST 'https://notion-warroom.yagami8095.workers.dev/report' \
            -H 'Content-Type: application/json' \
            -H "Authorization: Bearer ${WARROOM_AUTH_TOKEN:-openclaw-warroom-2026}" \
            -d "{
                \"agent\": \"rensin\",
                \"type\": \"status\",
                \"title\": \"Rensin Started\",
                \"content\": \"PID: $RENSIN_PID | Mode: background | Log: $LOG_FILE\",
                \"status\": \"running\",
                \"priority\": \"medium\"
            }" >/dev/null 2>&1 || true

    else
        echo "❌ Rensin 啟動後 5 秒內崩潰！"
        echo "最後 20 行日誌:"
        tail -20 "$LOG_FILE"
        exit 1
    fi
else
    # 前台模式：直接執行
    echo "模式: 前台 (Ctrl+C 停止)"
    echo ""
    exec node index.js
fi
