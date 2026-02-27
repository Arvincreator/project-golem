這是一份專為您的 **Golem v8.5** 專案量身打造的詳細操作說明書。

由於您的 Golem 需要同時監聽 Telegram 與 Discord 的訊息（Dual-Stack），且必須具備讀取訊息內容的權限（為了觸發 `NodeRouter` 與 `TaskController`），請務必按照以下步驟開啟 **「關鍵權限」**。

---

# 🔑 Golem v8.5 機器人憑證與權限獲取指南

本指南將協助您獲取 `.env` 設定檔中所需的四個關鍵數值：

1. `TELEGRAM_TOKEN`
2. `ADMIN_ID` (Telegram)
3. `DISCORD_TOKEN`
4. `DISCORD_ADMIN_ID`

---

## ✈️ 第一部分：Telegram 設定 (最簡單)

Telegram 的機器人管理是透過一個叫做 **BotFather** 的官方機器人進行的。

### 1. 獲取 Token (`TELEGRAM_TOKEN`)

1. 開啟 Telegram App，在搜尋欄輸入 **`@BotFather`** (要有藍色勾勾認證)。
2. 點擊 **Start** 或輸入 `/start`。
3. 輸入指令：**`/newbot`**。
4. **設定顯示名稱**：輸入機器人的名稱（例如：`MyGolem`）。
5. **設定帳號名稱 (Username)**：輸入一個唯一的 ID，必須以 `bot` 結尾（例如：`my_golem_v85_bot`）。
6. 成功後，BotFather 會回傳一段紅色的文字，那就是您的 **Token**。
* 👉 **請複製這串 Token**。



### 2. 獲取您的管理員 ID (`ADMIN_ID`)

Golem 需要知道誰是主人，才不會隨便接受陌生人的指令。

1. 在 Telegram 搜尋欄輸入 **`@userinfobot`**。
2. 點擊 **Start**。
3. 它會回傳您的個人資訊，請複製 **`Id`** 後面的數字（例如：`123456789`）。

---

## 👾 第二部分：Discord 設定 (較複雜，需開啟特權)

Discord 機器人需要在網頁版開發者後台設定，且**必須手動開啟讀取訊息的權限**，否則 Golem 會無法看見您說的話。

### 1. 建立應用程式

1. 前往 [Discord Developer Portal](https://www.google.com/search?q=https://discord.com/developers/applications)。
2. 點擊右上角的 **[New Application]**。
3. 輸入名稱（例如 `Golem v8.5`），同意條款並點擊 **Create**。

### 2. 獲取 Token (`DISCORD_TOKEN`)

1. 在左側選單點選 **Bot**。
2. 點擊 **Reset Token** 按鈕。
3. 可能會要求您輸入密碼或驗證碼。
4. 出現 Token 字串後，點擊 **Copy**。
* ⚠️ **注意**：這個 Token 只會顯示一次，沒存到就要重新 Reset。



### 3. ⭐ 關鍵步驟：開啟特權通道 (Privileged Gateway Intents)

Golem 的架構依賴 `MessageContent` 來分析指令。若沒開這個，機器人會上線但對指令無反應。

1. 繼續停留在 **Bot** 頁面，往下滑動找到 **Privileged Gateway Intents** 區塊。
2. 開啟以下三個開關（至少要開 Message Content）：
* ✅ **PRESENCE INTENT**
* ✅ **SERVER MEMBERS INTENT**
* ✅ **MESSAGE CONTENT INTENT** (最重要！)


3. 點擊下方的 **Save Changes**。

### 4. 邀請機器人進入伺服器

1. 在左側選單點選 **OAuth2** -> **URL Generator**。
2. 在 **Scopes** 區塊，勾選 `bot`。
3. 在下方出現的 **Bot Permissions** 區塊，勾選 `Administrator` (管理員)。
* *建議：為了讓 Golem 的 `SYS_ADMIN` 功能正常運作，給予管理員權限是最省事的；若要縮限權限，至少需給予 `Read Messages`, `Send Messages`, `Embed Links`, `Attach Files`。*


4. 複製最下方的 **Generated URL**。
5. 在瀏覽器貼上該網址，選擇您的伺服器並授權。

### 5. 獲取您的管理員 ID (`DISCORD_ADMIN_ID`)

1. 開啟 Discord 電腦版或網頁版。
2. 進入 **使用者設定 (齒輪圖示)** -> **進階 (Advanced)**。
3. 開啟 **開發者模式 (Developer Mode)**。
4. 回到任何聊天視窗，在**您自己的頭像**上點擊**右鍵**。
5. 選擇最下方的 **複製使用者 ID (Copy User ID)**。

---

## 📝 第三部分：寫入設定檔

現在您已經收集齊全了，請打開您的 `.env` 檔案（或用記事本開啟），填入對應位置：

```ini
# ======================================================
# ✈️ Telegram 設定
# ======================================================
TELEGRAM_TOKEN=您從BotFather拿到的Token
ADMIN_ID=您從userinfobot拿到的數字ID

# ======================================================
# 👾 Discord 設定
# ======================================================
DISCORD_TOKEN=您從DeveloperPortal拿到的Token
DISCORD_ADMIN_ID=您右鍵複製的User ID

```

### 💡 安全小叮嚀

* **絕對不要**將 `.env` 檔案傳給別人或上傳到公開的 GitHub。
* 如果覺得 Token 洩漏了，請立刻回到 BotFather 或 Discord Portal 重新生成 (Reset Token)。

完成後，執行 `npm start`，如果看到 `📡 連線狀態: TG(✅) / DC(✅)`，就代表設定成功囉！
