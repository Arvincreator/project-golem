#!/bin/bash
# ============================================================
# Golem Auto-Monitor — 自動監控 upstream 變化
# Usage: bash scripts/golem-monitor.sh [--check|--sync|--full]
# ============================================================

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM_REPO="Arvincreator/project-golem"
FORK_REPO="yedanyagamiai-cmd/project-golem"
STATE_FILE="$REPO_DIR/.golem-monitor-state.json"
LOG_FILE="$REPO_DIR/logs/monitor.log"

mkdir -p "$REPO_DIR/logs"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }

# --- State Management ---
init_state() {
    if [ ! -f "$STATE_FILE" ]; then
        echo '{"last_upstream_sha":"","last_check":"","issues_seen":[],"prs_seen":[]}' > "$STATE_FILE"
    fi
}

get_state() { python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('$1',''))" 2>/dev/null || echo ""; }

set_state() {
    python3 -c "
import json
with open('$STATE_FILE','r') as f: d=json.load(f)
d['$1'] = '$2'
with open('$STATE_FILE','w') as f: json.dump(d,f,indent=2)
" 2>/dev/null
}

# --- Check Upstream ---
check_upstream() {
    log "🔍 Checking upstream $UPSTREAM_REPO..."
    
    # Latest commit
    local latest_sha
    latest_sha=$(gh api "repos/$UPSTREAM_REPO/commits?per_page=1" --jq '.[0].sha' 2>/dev/null)
    local last_sha
    last_sha=$(get_state "last_upstream_sha")
    
    if [ "$latest_sha" != "$last_sha" ] && [ -n "$last_sha" ]; then
        log "🆕 New upstream commits detected! $last_sha → $latest_sha"
        
        # Show new commits
        gh api "repos/$UPSTREAM_REPO/compare/${last_sha}...${latest_sha}" \
            --jq '.commits[] | "  📝 \(.sha[0:7]) \(.commit.message | split("\n")[0])"' 2>/dev/null | tee -a "$LOG_FILE"
        
        echo "NEW_COMMITS"
        return 0
    elif [ -z "$last_sha" ]; then
        log "📋 First run, recording baseline SHA: ${latest_sha:0:7}"
        set_state "last_upstream_sha" "$latest_sha"
        echo "BASELINE"
        return 0
    else
        log "✅ No new upstream commits"
        echo "NO_CHANGES"
        return 0
    fi
}

# --- Check Issues ---
check_issues() {
    log "🎯 Checking upstream issues..."
    
    local issues
    issues=$(gh api "repos/$UPSTREAM_REPO/issues?state=open&per_page=20" \
        --jq '.[] | select(.pull_request == null) | "#\(.number) \(.title) [by \(.user.login)]"' 2>/dev/null)
    
    if [ -n "$issues" ]; then
        log "Open issues:"
        echo "$issues" | while read -r line; do log "  $line"; done
    else
        log "✅ No open issues"
    fi
    echo "$issues"
}

# --- Check PRs ---
check_prs() {
    log "🔀 Checking upstream PRs..."
    
    local prs
    prs=$(gh api "repos/$UPSTREAM_REPO/pulls?state=open&per_page=20" \
        --jq '.[] | "#\(.number) \(.title) [by \(.user.login)] \(.mergeable_state)"' 2>/dev/null)
    
    if [ -n "$prs" ]; then
        log "Open PRs:"
        echo "$prs" | while read -r line; do log "  $line"; done
    else
        log "✅ No open PRs (besides ours)"
    fi
    echo "$prs"
}

# --- Sync Fork ---
sync_fork() {
    log "🔄 Syncing fork with upstream..."
    cd "$REPO_DIR"
    
    git fetch upstream 2>/dev/null
    git checkout main 2>/dev/null
    
    local behind
    behind=$(git rev-list --count main..upstream/main 2>/dev/null || echo "0")
    
    if [ "$behind" -gt 0 ]; then
        log "📥 Fork is $behind commits behind upstream, merging..."
        git merge upstream/main --no-edit 2>&1 | tail -3 | tee -a "$LOG_FILE"
        git push origin main 2>&1 | tail -3 | tee -a "$LOG_FILE"
        
        local new_sha
        new_sha=$(git rev-parse HEAD)
        set_state "last_upstream_sha" "$new_sha"
        log "✅ Fork synced to ${new_sha:0:7}"
    else
        log "✅ Fork is up to date"
    fi
}

# --- Generate Report ---
generate_report() {
    local changes="$1"
    local issues="$2"
    local prs="$3"
    
    cat << REPORT
╔══════════════════════════════════════════════════════════════╗
║              🤖 GOLEM AUTO-MONITOR REPORT                   ║
╠══════════════════════════════════════════════════════════════╣
║ Time:     $(date -Iseconds)
║ Upstream: $UPSTREAM_REPO
║ Fork:     $FORK_REPO
╠══════════════════════════════════════════════════════════════╣
║ Changes:  $changes
║ Issues:   $(echo "$issues" | grep -c '^#' || echo 0) open
║ PRs:      $(echo "$prs" | grep -c '^#' || echo 0) open
╚══════════════════════════════════════════════════════════════╝
REPORT
}

# --- Our PR Status ---
check_our_prs() {
    log "📊 Checking our PR status..."
    gh api "repos/$UPSTREAM_REPO/pulls?state=all&per_page=20" \
        --jq '.[] | select(.user.login == "yedanyagamiai-cmd") | "#\(.number) [\(.state)] \(.title) merged=\(.merged)"' 2>/dev/null | tee -a "$LOG_FILE"
}

# --- Main ---
main() {
    init_state
    local mode="${1:---check}"
    
    case "$mode" in
        --check)
            local changes issues prs
            changes=$(check_upstream)
            issues=$(check_issues)
            prs=$(check_prs)
            generate_report "$changes" "$issues" "$prs"
            check_our_prs
            set_state "last_check" "$(date -Iseconds)"
            ;;
        --sync)
            sync_fork
            ;;
        --full)
            sync_fork
            local changes issues prs
            changes=$(check_upstream)
            issues=$(check_issues)
            prs=$(check_prs)
            generate_report "$changes" "$issues" "$prs"
            check_our_prs
            set_state "last_check" "$(date -Iseconds)"
            ;;
        --status)
            check_our_prs
            ;;
        *)
            echo "Usage: $0 [--check|--sync|--full|--status]"
            exit 1
            ;;
    esac
}

main "$@"
