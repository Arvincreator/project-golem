# Android Automation (ADB Bridge)

Control Android devices via ADB. Requires ADB installed and a device connected (USB or WiFi).

## Setup
1. Install Android SDK Platform Tools
2. Connect device via USB and enable USB Debugging
3. Or connect via WiFi: `adb connect <device-ip>:5555`
4. Set `ADB_DEVICE=<device-id>` in .env (optional, auto-detects first device)

## Available Actions

### Basic Interaction
- `android_tap` — Tap at coordinates. Parameter: `x y` (e.g., `500 800`)
- `android_swipe` — Swipe gesture. Parameter: `x1 y1 x2 y2 [duration_ms]` (e.g., `500 1500 500 500 300`)
- `android_type` — Type text. Parameter: text to type
- `android_key` — Press key. Parameter: keycode (e.g., `KEYCODE_HOME`, `KEYCODE_BACK`, `3`, `4`)

### App Management
- `android_launch` — Launch app. Parameter: package name (e.g., `com.whatsapp`)
- `android_packages` — List installed apps. Parameter: optional filter

### Screen Capture & Analysis
- `android_screenshot` — Take screenshot. Parameter: optional save path
- `android_dump_ui` — Dump UI hierarchy as XML. Parameter: optional save path

### Device Info
- `android_info` — Get device model, brand, Android version, battery
- `android_shell` — Run shell command (with safety filter)

## Common Keycodes
| Key | Code |
|-----|------|
| Home | KEYCODE_HOME or 3 |
| Back | KEYCODE_BACK or 4 |
| Menu | KEYCODE_MENU or 82 |
| Enter | KEYCODE_ENTER or 66 |
| Volume Up | KEYCODE_VOLUME_UP or 24 |
| Volume Down | KEYCODE_VOLUME_DOWN or 25 |

## Example Workflow
To open LINE and send a message:
1. `android_launch` with `jp.naver.line.android`
2. `android_screenshot` to see the screen
3. `android_tap` on the chat target
4. `android_type` the message
5. `android_key` with `KEYCODE_ENTER` to send

## Safety
- Destructive commands (rm -rf, format, wipe, flash) are blocked
- All commands have a 15-second timeout
- Screenshot buffer limited to 10MB
