<SkillModule path="src/skills/modules/notebooklm-studio/skill.md">
【已載入技能：NotebookLM Studio 工作流】
你負責把「來源資料 -> NotebookLM 筆記本 -> Studio 產物 -> 本地交付 -> 後續分析」串成可執行流程。

使用時機：
1. 使用者要做研究包、學習包、簡報、mind map、audio/video overview。
2. 使用者要把多來源（網址、PDF、文件、YouTube）整理進 NotebookLM。
3. 使用者要下載產物並交給 Golem 深入分析。

執行守則：
1. 僅處理使用者授權資料，不繞過付費牆、登入牆或版權限制。
2. 優先標示「官方 NotebookLM 產物」與「Golem 衍生產物」。
3. 回報時必帶：筆記本名稱、來源數量、成功/失敗項目、輸出檔路徑。

建議流程：
1. 先檢查環境與登入狀態（必要時要求使用者完成 Google 登入/MFA）。
2. 建立或重用 notebook。
3. 加入來源後，按需求生成 artifact（report, mind-map, quiz, flashcards, slide-deck, audio, video, infographic, data-table）。
4. 驗證檔案存在，再回傳路徑與摘要。

建議執行指令（本專案路徑）：
1. 環境檢查：
   `{"action":"command","parameter":"python3 tools/notebooklm-studio/scripts/validate_environment.py --json"}`
2. 啟動本地 Dashboard：
   `{"action":"command","parameter":"python3 tools/notebooklm-studio/scripts/dashboard_server.py --host 127.0.0.1 --port 8765 --profile default --out-dir ./notebooklm_outputs/dashboard"}`
3. 先規劃再執行 artifact pipeline：
   `{"action":"command","parameter":"python3 tools/notebooklm-studio/scripts/artifact_pipeline.py plan --notebook-title \\\"Research Pack\\\" --source \\\"https://example.com\\\" --artifact report --artifact mind-map --download --out-dir ./notebooklm_outputs"}`
   `{"action":"command","parameter":"python3 tools/notebooklm-studio/scripts/artifact_pipeline.py run --notebook-title \\\"Research Pack\\\" --source \\\"https://example.com\\\" --artifact report --artifact mind-map --download --out-dir ./notebooklm_outputs --status-file ./notebooklm_outputs/jobs.json"}`

Action 格式 (用於 Golem 對話):
{"action":"notebooklm-studio","task":"create_notebook_pack","title":"AI Agent Research Pack","sources":["https://example.com/a","/abs/path/report.pdf"],"artifacts":["report","mind-map","slide-deck"],"outDir":"/abs/path/notebooklm_outputs"}

連續操作範例：
{"action":"notebooklm-studio","task":"validate_environment"}
{"action":"notebooklm-studio","task":"ingest_sources","title":"AI Agent Research Pack","sources":["https://example.com/a","https://example.com/b"]}
{"action":"notebooklm-studio","task":"generate_artifacts","title":"AI Agent Research Pack","artifacts":["audio","mind-map","slide-deck"],"download":true}
{"action":"notebooklm-studio","task":"handoff_summary","title":"AI Agent Research Pack"}
</SkillModule>
