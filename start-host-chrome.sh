#!/bin/bash

# Configuration
PORT=9222
USER_DATA_DIR="/tmp/remote-profile"

# Auto-detect Chrome path based on OS
detect_chrome() {
    case "$(uname -s)" in
        Darwin)
            echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            ;;
        Linux)
            for bin in google-chrome-stable google-chrome chromium-browser chromium; do
                if command -v "$bin" &>/dev/null; then
                    echo "$bin"
                    return
                fi
            done
            echo ""
            ;;
    esac
}

CHROME_PATH="$(detect_chrome)"

if [ -z "$CHROME_PATH" ] || ([ ! -f "$CHROME_PATH" ] && ! command -v "$CHROME_PATH" &>/dev/null); then
    echo "❌ Error: Google Chrome not found."
    echo "   macOS: Expected at /Applications/Google Chrome.app/"
    echo "   Linux: Install via 'apt install google-chrome-stable' or 'chromium-browser'"
    exit 1
fi

# Check if Chrome is already running on port
if lsof -i :$PORT >/dev/null 2>&1; then
    echo "⚠️  Chrome Remote Debugging is already active on port $PORT."
    exit 0
fi

echo "🚀 Launching Chrome with Remote Debugging on port $PORT..."
echo "📂 User Data Dir: $USER_DATA_DIR (Temporary profile)"

# Launch Chrome
"$CHROME_PATH" \
  --remote-debugging-port=$PORT \
  --remote-debugging-address=0.0.0.0 \
  --remote-allow-origins=* \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir="$USER_DATA_DIR" >/dev/null 2>&1 &

CHROME_PID=$!
echo "✅ Chrome launched (PID: $CHROME_PID)"
wait $CHROME_PID
