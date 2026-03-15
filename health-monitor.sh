#!/bin/bash
# rendan v10.0 health monitor — runs every 5 min via cron
LOG="/opt/nexus/rendan/logs/health-monitor.log"
TS=$(date '+%Y-%m-%d %H:%M:%S')
mkdir -p /opt/nexus/rendan/logs

# 1. Service alive?
if ! systemctl --user is-active rendan >/dev/null 2>&1; then
    echo "[$TS] CRITICAL: rendan DOWN — restarting" >> "$LOG"
    systemctl --user restart rendan
    exit 1
fi

# 2. API responsive?
STATS=$(curl -sf --max-time 5 http://localhost:3000/api/stats 2>/dev/null)
if [ -z "$STATS" ]; then
    echo "[$TS] ERROR: /api/stats no response" >> "$LOG"
    exit 1
fi

# 3. Extract metrics via python
METRICS=$(echo "$STATS" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    m=d.get('memory',{})
    print(d.get('uptime',0))
    print(m.get('rss',0))
    print(m.get('heapUsed',0))
    print(d.get('cpu',0))
    print(d.get('skills',{}).get('loaded',0))
    print(d.get('golems',{}).get('active',0))
    print(d.get('rag',{}).get('available',False))
except:
    print('0\n0\n0\n0\n0\n0\nFalse')
" 2>/dev/null)

UPTIME=$(echo "$METRICS" | sed -n '1p')
RSS=$(echo "$METRICS" | sed -n '2p')
HEAP=$(echo "$METRICS" | sed -n '3p')
CPU=$(echo "$METRICS" | sed -n '4p')
SKILLS=$(echo "$METRICS" | sed -n '5p')
GOLEMS=$(echo "$METRICS" | sed -n '6p')
RAG=$(echo "$METRICS" | sed -n '7p')

# 4. Check crashes (current service instance only)
CRASHES=$(journalctl --user -u rendan --since '5 min ago' --no-pager 2>/dev/null | grep -c 'CRITICAL\|Uncaught\|FATAL')
CRASHES=${CRASHES:-0}

# 5. Determine status
STATUS="OK"
RSS_INT=${RSS%.*}
if [ "${RSS_INT:-0}" -gt 300 ]; then
    STATUS="WARN:RSS_HIGH"
fi
if [ "$CRASHES" -gt 0 ]; then
    STATUS="WARN:CRASHES=$CRASHES"
fi

echo "[$TS] $STATUS: up=${UPTIME}s rss=${RSS}MB heap=${HEAP}MB cpu=${CPU}% skills=${SKILLS} golems=${GOLEMS} rag=${RAG}" >> "$LOG"

# 6. Rotate if > 1MB
LOGSIZE=$(stat -c%s "$LOG" 2>/dev/null || echo 0)
if [ "$LOGSIZE" -gt 1048576 ]; then
    mv "$LOG" "${LOG}.old"
fi
