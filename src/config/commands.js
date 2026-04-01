// src/config/commands.js
/**
 * 共有指令設定檔 (Shared Commands Configuration)
 * 這個檔案統一管理 Golem 的可用指令，供 Telegram Bot 與 Web Dashboard 雙邊同步使用。
 * 注意：部分包含特殊字元或大寫的指令（如 /@Gmail）將會在載入至 Telegram 時被過濾掉，但會顯示在 Web UI 提示。
 */
module.exports = [
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
        command: '/planning',
        description: '切換直聊 Planning Mode（複雜任務自動多代理）。',
        options: [
            { name: 'on', description: '開啟：複雜任務自動走多代理' },
            { name: 'off', description: '關閉：全部回到單代理路徑' },
            { name: 'status', description: '查看目前 Planning Mode 狀態' }
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
    { command: '/patch', description: '執行自我反思與代碼優化。' },
    { command: '/dashboard', description: '顯示控制台連線網址：包含本地 (Local) 與遠端 (Remote) 存取網址。' },
    { 
        command: '/level', 
        description: '熱切換安全自主等級 (0-3)。',
        options: [
            { name: '0', description: 'Level 0 (最安全，唯讀)' },
            { name: '1', description: 'Level 1 (低風險)' },
            { name: '2', description: 'Level 2 (中風險，預設)' },
            { name: '3', description: 'Level 3 (最高權限)' }
        ]
    },
    { command: '/@Gmail', description: '讀取、搜尋您的個人電子郵件。' },
    { command: '/@Google 雲端硬碟', description: '搜尋您的 Google Drive 檔案 (文件、PDF、圖片等)。' },
    { command: '/@Google 文件', description: '讀取或搜尋特定的 Google Docs。' },
    { command: '/@Google Keep', description: '讀取您的個人筆記。' },
    { command: '/@Google Tasks', description: '讀取或管理您的待辦事項。' },
    { command: '/@YouTube', description: '搜尋 YouTube 影片資料。' },
    { command: '/@Google Maps', description: '查詢地圖、地點資訊。' },
    { command: '/@Google 航班', description: '查詢航班資訊。' },
    { command: '/@Google 飯店', description: '查詢飯店住宿資訊。' },
    { command: '/@Workspace', description: '讓 AI 自行推斷要使用哪個辦公軟體。' }
];
