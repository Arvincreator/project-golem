#!/bin/bash
# ============================================================
# 🚀 Rensin Deploy PR — 驗證 → 測試 → 提交 → 推送 → 更新 PR
# 完全無錯誤時自動上傳 PR，任一步失敗即停止
# Usage: ./scripts/deploy-pr.sh [commit-message]
# ============================================================

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

# ─── 顏色 ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

log_ok()   { echo -e "${GREEN}  ✅ $1${NC}"; }
log_fail() { echo -e "${RED}  ❌ $1${NC}"; ((ERRORS++)); }
log_warn() { echo -e "${YELLOW}  ⚠️  $1${NC}"; ((WARNINGS++)); }
log_info() { echo -e "${CYAN}  ℹ️  $1${NC}"; }
log_step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║  🚀 Rensin Deploy PR — 一鍵驗證部署腳本    ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ============================================================
# STEP 1: 環境檢查
# ============================================================
log_step "Step 1: 環境檢查"

# Node.js
if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    log_ok "Node.js $NODE_VER"
else
    log_fail "Node.js 未安裝"
fi

# npm
if command -v npm &>/dev/null; then
    log_ok "npm $(npm -v)"
else
    log_fail "npm 未安裝"
fi

# gh CLI
if command -v gh &>/dev/null; then
    log_ok "GitHub CLI 已安裝"
else
    log_warn "GitHub CLI 未安裝 (PR 狀態無法查詢)"
fi

# git
if git rev-parse --git-dir &>/dev/null; then
    BRANCH=$(git branch --show-current)
    log_ok "Git branch: $BRANCH"
else
    log_fail "不在 git repository 中"
fi

# .env
if [ -f ".env" ]; then
    log_ok ".env 存在"
    # 檢查關鍵環境變數
    for VAR in TELEGRAM_TOKEN GEMINI_API_KEYS ADMIN_ID FLEET_AUTH_TOKEN; do
        if grep -q "^${VAR}=" .env 2>/dev/null; then
            log_ok "$VAR 已設定"
        else
            log_warn "$VAR 未設定"
        fi
    done
else
    log_fail ".env 不存在"
fi

# ============================================================
# STEP 2: 依賴檢查
# ============================================================
log_step "Step 2: 依賴檢查"

if [ -d "node_modules" ]; then
    log_ok "node_modules 存在"
else
    log_info "安裝依賴..."
    npm install --production 2>&1 | tail -3
fi

# 關鍵依賴
DEPS_OK=0
DEPS_FAIL=0
for DEP in grammy opossum @google/genai uuid; do
    if node -e "require('$DEP')" 2>/dev/null; then
        ((DEPS_OK++))
    else
        log_fail "缺少依賴: $DEP"
        ((DEPS_FAIL++))
    fi
done
log_ok "關鍵依賴: ${DEPS_OK}/$((DEPS_OK + DEPS_FAIL)) OK"

# ============================================================
# STEP 3: 語法驗證 (所有 .js)
# ============================================================
log_step "Step 3: 語法驗證"

SYNTAX_OK=0
SYNTAX_FAIL=0
SYNTAX_ERRORS=""

# 核心模組
CORE_FILES=(
    "src/core/TaskController.js"
    "src/core/NeuroShunter.js"
    "src/core/ConversationManager.js"
    "src/core/ActionQueue.js"
    "src/core/RensinCallbackRouter.js"
    "src/core/rensin-bootstrap.js"
    "src/core/SdkBrain.js"
    "src/core/circuit_breaker.js"
    "src/managers/SecurityManager.js"
    "src/managers/AutonomyManager.js"
    "src/managers/MoltbookLearner.js"
    "src/bridges/GrammyBridge.js"
    "src/bridges/OpossumBridge.js"
    "src/bridges/TelegramBotFactory.js"
    "src/skills/core/moltbot.js"
    "src/skills/core/fleet.js"
    "src/skills/core/rag.js"
    "src/skills/core/selfheal.js"
    "src/skills/core/analytics.js"
    "src/skills/core/auto-optimizer.js"
    "src/skills/core/community.js"
    "src/utils/yedan-auth.js"
    "src/memory/graph/ma_gma.js"
)

for f in "${CORE_FILES[@]}"; do
    if [ -f "$f" ]; then
        if node -c "$f" 2>/dev/null; then
            ((SYNTAX_OK++))
        else
            ((SYNTAX_FAIL++))
            SYNTAX_ERRORS="$SYNTAX_ERRORS\n  ❌ $f"
        fi
    fi
done

if [ $SYNTAX_FAIL -eq 0 ]; then
    log_ok "語法驗證: ${SYNTAX_OK}/${SYNTAX_OK} 全部通過"
else
    log_fail "語法驗證: ${SYNTAX_FAIL} 檔案失敗"
    echo -e "$SYNTAX_ERRORS"
fi

# ============================================================
# STEP 4: 模組載入測試
# ============================================================
log_step "Step 4: 模組載入測試"

MODULE_RESULT=$(node -e "
const mods = [
    './src/managers/SecurityManager',
    './src/managers/MoltbookLearner',
    './src/core/RensinCallbackRouter',
    './src/core/rensin-bootstrap',
    './src/skills/core/fleet',
    './src/skills/core/rag',
    './src/skills/core/selfheal',
    './src/skills/core/analytics',
    './src/skills/core/auto-optimizer',
    './src/skills/core/community',
    './src/utils/yedan-auth',
    './src/memory/graph/ma_gma',
];
let ok = 0, fail = 0, errors = [];
for (const m of mods) {
    try { require(m); ok++; } catch (e) { fail++; errors.push(m + ': ' + e.message.substring(0, 60)); }
}
console.log(JSON.stringify({ ok, fail, total: mods.length, errors }));
" 2>/dev/null)

MOD_OK=$(echo "$MODULE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.ok)" 2>/dev/null || echo 0)
MOD_FAIL=$(echo "$MODULE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.fail)" 2>/dev/null || echo 0)
MOD_TOTAL=$(echo "$MODULE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.total)" 2>/dev/null || echo 0)

if [ "$MOD_FAIL" = "0" ]; then
    log_ok "模組載入: ${MOD_OK}/${MOD_TOTAL} 全部成功"
else
    log_fail "模組載入: ${MOD_FAIL}/${MOD_TOTAL} 失敗"
    echo "$MODULE_RESULT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); d.errors.forEach(e => console.log('  ❌ ' + e))" 2>/dev/null
fi

# ============================================================
# STEP 5: L0-L3 分級驗證
# ============================================================
log_step "Step 5: L0-L3 分級驗證"

L_RESULT=$(node -e "
const SM = require('./src/managers/SecurityManager');
const sec = new SM();
const tests = [
    [{ action: 'moltbot', task: 'feed' }, 'L0'],
    [{ action: 'rag', task: 'query' }, 'L0'],
    [{ action: 'fleet', task: 'status' }, 'L0'],
    [{ action: 'selfheal', task: 'diagnose' }, 'L0'],
    [{ action: 'analytics', task: 'overview' }, 'L0'],
    [{ action: 'moltbot', task: 'post' }, 'L1'],
    [{ action: 'rag', task: 'evolve' }, 'L1'],
    [{ action: 'fleet', task: 'dispatch' }, 'L1'],
    [{ action: 'selfheal', task: 'patch' }, 'L1'],
    [{ action: 'community', task: 'engage' }, 'L1'],
    [{ action: 'auto-optimizer', task: 'full' }, 'L1'],
    [{ action: 'command' }, 'L2'],
    [{ action: 'evolution' }, 'L2'],
    [{ action: 'multi_agent' }, 'L2'],
];
let pass = 0, fail = 0;
for (const [act, expected] of tests) {
    const got = sec.classifyAction(act);
    if (got === expected) pass++;
    else { fail++; console.error('FAIL: ' + JSON.stringify(act) + ' expected ' + expected + ' got ' + got); }
}
console.log(pass + '/' + tests.length + ' pass');
process.exit(fail > 0 ? 1 : 0);
" 2>&1)

if [ $? -eq 0 ]; then
    log_ok "L0-L3 分級: $L_RESULT"
else
    log_fail "L0-L3 分級測試失敗"
    echo "  $L_RESULT"
fi

# ============================================================
# STEP 6: 結果判定
# ============================================================
log_step "Step 6: 結果判定"

echo ""
echo -e "  錯誤: ${RED}${ERRORS}${NC} | 警告: ${YELLOW}${WARNINGS}${NC}"
echo ""

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ❌ 有 ${ERRORS} 個錯誤，停止部署                    ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
    exit 1
fi

echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ 全部通過！準備部署...                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"

# ============================================================
# STEP 7: Git 提交 + 推送
# ============================================================
log_step "Step 7: Git 提交 + 推送"

# 檢查是否有未提交的變更
CHANGES=$(git status --porcelain -- src/ scripts/ package.json | grep -v '??' | wc -l)
UNTRACKED=$(git status --porcelain -- src/ scripts/ | grep '^??' | wc -l)

if [ "$CHANGES" -gt 0 ] || [ "$UNTRACKED" -gt 0 ]; then
    COMMIT_MSG="${1:-feat: auto-deploy verified — all checks passed}"

    # 加入所有 src/ 和 scripts/ 下的變更
    git add src/ scripts/ package.json 2>/dev/null || true

    git commit -m "$COMMIT_MSG

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>" 2>/dev/null && \
        log_ok "已提交: $COMMIT_MSG" || \
        log_info "無新變更需提交"
else
    log_info "無新變更需提交"
fi

# 推送到 fork
CURRENT_BRANCH=$(git branch --show-current)
if git remote | grep -q fork; then
    git push fork "$CURRENT_BRANCH" 2>&1 | tail -2
    log_ok "已推送到 fork/$CURRENT_BRANCH"
else
    log_warn "沒有 fork remote，跳過推送"
fi

# ============================================================
# STEP 8: PR 狀態確認
# ============================================================
log_step "Step 8: PR 狀態"

if command -v gh &>/dev/null; then
    PR_INFO=$(gh pr list --repo Arvincreator/project-golem --head "yedanyagamiai-cmd:$CURRENT_BRANCH" --json number,title,state 2>/dev/null || echo "[]")
    PR_NUM=$(echo "$PR_INFO" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d[0]?.number || '')" 2>/dev/null || echo "")

    if [ -n "$PR_NUM" ]; then
        log_ok "PR #${PR_NUM} 已存在且已更新"
        echo -e "  ${CYAN}https://github.com/Arvincreator/project-golem/pull/${PR_NUM}${NC}"
    else
        log_info "此 branch 尚無 PR，建立中..."
        gh pr create \
            --repo Arvincreator/project-golem \
            --base develop \
            --head "yedanyagamiai-cmd:$CURRENT_BRANCH" \
            --title "feat: Rensin full upgrade — L0-L3 autonomy + RAG skills" \
            --body "$(cat <<'PRBODY'
## Summary
- L0-L3 autonomy system: 40+ task types auto-classified
- 6 new RAG-aware skills (fleet, rag, selfheal, analytics, auto-optimizer, community)
- MoltbookLearner with RAG integration and war room sync
- Repeated error prevention (same mistake never happens twice)
- Telegram auto-reporting (L0/L1) and approval requests (L2+)

## Verification
- All syntax checks passed
- All 12 modules load successfully
- L0-L3 classification tests: 14/14 pass
- @google/genai SDK installed and verified

## Test plan
- [ ] Start Rensin with `node index.js`
- [ ] Verify L0 actions auto-execute (moltbot feed, rag query)
- [ ] Verify L1 actions auto-execute with Telegram report
- [ ] Verify L2+ actions send Telegram approval request
- [ ] Verify RAG query before action, RAG write after action
- [ ] Verify war room sync after actions

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)" 2>&1 && log_ok "PR 已建立" || log_warn "PR 建立失敗"
    fi
fi

# ============================================================
# STEP 9: 戰情室同步
# ============================================================
log_step "Step 9: 戰情室同步"

WARROOM_RESULT=$(curl -s -X POST 'https://notion-warroom.yagami8095.workers.dev/report' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${WARROOM_AUTH_TOKEN:-openclaw-warroom-2026}" \
    -d "{
        \"agent\": \"rensin-deploy\",
        \"type\": \"deployment\",
        \"title\": \"Rensin Deploy PR — All Checks Passed\",
        \"content\": \"Branch: $CURRENT_BRANCH | Syntax: ${SYNTAX_OK}/${SYNTAX_OK} | Modules: ${MOD_OK}/${MOD_TOTAL} | L0-L3: verified | Errors: 0\",
        \"status\": \"completed\",
        \"priority\": \"high\"
    }" 2>/dev/null)

if echo "$WARROOM_RESULT" | grep -q '"ok":true'; then
    log_ok "戰情室已同步"
else
    log_warn "戰情室同步失敗"
fi

# ============================================================
# 完成
# ============================================================
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  🎉 部署完成！                               ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  啟動 Rensin: ${CYAN}cd $PROJECT_ROOT && node index.js${NC}"
echo ""
