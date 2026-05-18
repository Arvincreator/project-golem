// src/config/commands.js
/**
 * 共有指令設定檔 (Shared Commands Configuration)
 * 這個檔案統一管理 Golem 的可用指令，供 Telegram Bot 與 Web Dashboard 雙邊同步使用。
 * 注意：部分包含特殊字元或大寫的指令（如 /@Gmail）將會在載入至 Telegram 時被過濾掉，但會顯示在 Web UI 提示。
 */
module.exports = [
    { command: '/help', description: '顯示 Golem 指令說明與主要功能選單。' },
    { command: '/menu', description: '顯示 Golem 指令選單，等同於 /help。' },
    { command: '/指令', description: '顯示 Golem 指令說明與主要功能選單。' },
    { command: '/功能', description: '顯示 Golem 指令說明與主要功能選單。' },
    { command: '/sos', description: '輕量級急救：清除「網頁元素快取」，強迫 DOM Doctor 重新掃描並修復。' },
    { command: '/new', description: '物理重生：強制重新整理底層瀏覽器，開啟一個全新的對話視窗。' },
    { command: '/new_memory', description: '徹底轉生：物理清空底層資料庫 (DB) 並重置對話，完全忘記過去細節。' },
    {
        command: '/model', 
        description: '模型切換：切換 Gemini 的大腦模型 (fast/thinking/pro)。',
        options: [
            { name: 'fast', description: '回答速度快 (效能優先)' },
            { name: 'thinking', description: '具備深度思考 (邏輯優先)' },
            { name: 'pro', description: '進階程式碼與數學能力 (專業優先)' }
        ]
    },
    { 
        command: '/enable_silent', 
        description: '開啟完全靜默模式：暫時關閉感知，且不會記錄任何對話。',
        options: [{ name: '@username', description: '請輸入目標 Bot ID' }]
    },
    { 
        command: '/disable_silent', 
        description: '解除靜默模式。',
        options: [{ name: '@username', description: '請輸入目標 Bot ID' }]
    },
    { 
        command: '/enable_observer', 
        description: '進入觀察者模式：同步所有對話上下文，但預設不發言。',
        options: [{ name: '@username', description: '請輸入目標 Bot ID' }]
    },
    { 
        command: '/disable_observer',
        description: '解除觀察者模式。',
        options: [{ name: '@username', description: '請輸入目標 Bot ID' }]
    },
    {
        command: '/learn',
        description: '讓 Golem 學習新技能（輸入需求描述，自動生成可執行技能）。',
        options: [
            { name: '建立一個股票查詢技能', description: '範例：學習即時查股價與新聞摘要' },
            { name: '建立一個每日報告技能', description: '範例：學習產出固定格式日報' },
            { name: '建立一個資料清理技能', description: '範例：學習清洗與格式化輸入資料' }
        ]
    },
    {
        command: '/install',
        description: '安裝本機技能或 MCP 工具，並自動同步 capability/example/vector 索引。',
        options: [
            { name: 'skill <path>', description: '由本機技能資料夾安裝（需包含 manifest.json）' },
            { name: 'skill-gh <url>', description: '由 GitHub repo/tree URL 安裝技能' },
            { name: 'mcp-file <path>', description: '由本機 MCP JSON 設定檔安裝/更新' },
            { name: 'mcp-json <json>', description: '貼上單行 JSON 安裝/更新 MCP 設定' },
            { name: 'mcp-url <url>', description: '由 HTTPS JSON URL 安裝/更新 MCP 設定' }
        ]
    },
    { command: '/donate', description: '顯示贊助連結，支持 Project Golem 持續開發。' },
    { command: '/support', description: '顯示贊助連結，等同於 /donate。' },
    { command: '/update', description: '觸發系統更新確認流程，會要求管理員確認後才執行。' },
    { command: '/reset', description: '觸發系統重置/更新確認流程，會要求管理員確認後才執行。' },
    { command: '/callme', description: '設定 Golem 對你的稱呼，例如：/callme Arvin。' },
    { command: '/skills', description: '列出目前已安裝、已同步到索引的 Golem 系統能力。' },
    { command: '/export', description: '匯出指定使用者技能為 GOLEM_SKILL 膠囊，方便搬移或分享。' },
    {
        command: '/wiki',
        description: '管理 Golem 的 Wiki 知識庫：儲存、列出、讀取、搜尋或刪除長期知識頁面。',
        options: [
            { name: 'save <主題>', description: '將目前對話或知識整理成 wiki 頁面' },
            { name: 'list', description: '列出所有 wiki 頁面' },
            { name: 'read <路徑>', description: '讀取指定 wiki 頁面' },
            { name: 'search <關鍵字>', description: '搜尋相關 wiki 頁面' },
            { name: 'lint', description: '檢查知識庫健康狀態' },
            { name: 'log', description: '查看 wiki 更新日誌' }
        ]
    },
    { command: '/compress', description: '手動壓縮目前會話記憶，節省長對話上下文空間。' },
    {
        command: '/project',
        description: '讀取專案資料夾並分段注入上下文，可掃描、注入或執行專案分析任務。',
        options: [
            { name: 'scan <path>', description: '掃描專案可讀檔案與預估注入範圍' },
            { name: 'inject <path>', description: '分段注入專案上下文' },
            { name: 'run <path> | <task>', description: '讀取專案後執行指定任務' }
        ]
    },
    { command: '/search', description: '搜尋最近的歷史對話記錄，例如：/search memory bug --days 60。' },
    {
        command: '/toolset',
        description: '查看或切換場景化工具集，控制目前啟用的工具能力。',
        options: [
            { name: 'list', description: '列出可用工具場景' },
            { name: 'status', description: '查看目前啟用場景與工具' },
            { name: '<scene>', description: '切換到指定工具場景' }
        ]
    },
    {
        command: '/profile',
        description: '查看或分析使用者模型，讓 Golem 更理解你的偏好與工作方式。',
        options: [
            { name: 'show', description: '查看目前使用者模型' },
            { name: 'analyze', description: '分析最近對話並更新使用者模型' }
        ]
    },
    {
        command: '/api',
        description: '管理 OpenAI-Compatible API 伺服器，讓其他工具連接 Golem。',
        options: [
            { name: 'start', description: '啟動 API 伺服器' },
            { name: 'stop', description: '關閉 API 伺服器' },
            { name: 'status', description: '查看 API 伺服器狀態' }
        ]
    },
    {
        command: '/feedback',
        description: '記錄回覆品質回饋，作為未來 Golem 認知微調資料。',
        options: [
            { name: 'good', description: '標記為優良對話樣本' },
            { name: 'bad', description: '標記為需要改進的樣本' }
        ]
    },
    {
        command: '/stocks',
        description: '建立即時股市分析上下文，輸出市場概況、新聞脈絡、技術重點與風險提醒。',
        options: [
            { name: 'TSM NVDA 2330', description: '可接股票代號或公司名稱' }
        ]
    },
    { command: '/stock', description: '股市分析指令別名，等同於 /stocks。' },
    { command: '/stockboard', description: '開啟股市看板式分析上下文，等同於 /stocks。' },
    { command: '/stock-dashboard', description: '開啟股市 dashboard 分析上下文，等同於 /stocks。' },
    {
        command: '/rpg',
        description: 'Golem 原生文字 RPG 模式控制（啟動/關閉/狀態/會員等級）。',
        options: [
            { name: 'start', description: '啟動目前聊天室的 RPG 模式' },
            { name: 'stop', description: '關閉目前聊天室的 RPG 模式' },
            { name: 'status', description: '查看 RPG 狀態與你的會員回合數' },
            { name: 'bind', description: '產生手機綁定碼，將 Telegram/Discord 會員等級連動到 Dashboard 帳號' },
            { name: 'tier <userId> <tier>', description: '管理員設定會員等級（visitor/general/sponsor）' }
        ]
    },
    { command: '/patch', description: '執行自我反思與代碼優化。' },
    { command: '/dashboard', description: '顯示控制台連線網址：包含本地 (Local) 與遠端 (Remote) 存取網址。' },
    {
        command: '/level',
        description: '切換自動化安全等級（0-4，與 Dashboard 安全與指令同步）。',
        options: [
            { name: '0', description: 'Lockdown：最保守（只允許最低風險）' },
            { name: '1', description: 'Guided：保守確認' },
            { name: '2', description: 'Balanced：平衡模式（推薦）' },
            { name: '3', description: 'Autopilot：高自動化' },
            { name: '4', description: 'Silent：最高自動化且隱藏中間訊息' }
        ]
    },
    { command: '/@Gmail', description: '讀取、搜尋您的個人電子郵件。' },
    { command: '/@Google Calendar', description: '讀取或管理 Google Calendar 行程。' },
    { command: '/@Google 雲端硬碟', description: '搜尋您的 Google Drive 檔案 (文件、PDF、圖片等)。' },
    { command: '/@Google 文件', description: '讀取或搜尋特定的 Google Docs。' },
    { command: '/@Google Keep', description: '讀取您的個人筆記。' },
    { command: '/@Google Tasks', description: '讀取或管理您的待辦事項。' },
    { command: '/@YouTube', description: '搜尋 YouTube 影片資料。' },
    { command: '/@YouTube Music', description: '搜尋或處理 YouTube Music 音樂相關資料。' },
    { command: '/@Google Maps', description: '查詢地圖、地點資訊。' },
    { command: '/@Google 航班', description: '查詢航班資訊。' },
    { command: '/@Google 飯店', description: '查詢飯店住宿資訊。' },
    { command: '/@Workspace', description: '讓 AI 自行推斷要使用哪個辦公軟體。' },
    { command: '/@Spotify', description: '搜尋或處理 Spotify 音樂與播放清單資料。' },
    { command: '/@Google Home', description: '讀取或管理 Google Home / 智慧家庭相關資訊。' },
    { command: '/@SynthID', description: '使用 SynthID 相關能力檢查或處理內容來源標記。' }
];
