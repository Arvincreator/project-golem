# Project Golem v12.0 — 開發指南

## 架構概覽
- **RouterBrain**: 智能多模型路由器，fallback chain: monica-web → monica → sdk → ollama → claude, 90s 全鏈超時
- **OpenAICompatBrain**: 所有 /v1/chat/completions 相容 API 的基底類別, 指數退避+抖動重試, **v10.5: RAG 整合**
- **ClaudeBrain**: v10.5 新增 — Anthropic Claude API (繼承 OpenAICompatBrain, @anthropic-ai/sdk)
- **MonicaBrain**: Monica.im API 整合，多 API key 輪替、mutex RPM 限速
- **OllamaBrain**: 本地 Ollama fallback，GPU/CPU 混合推理, 多 GPU 支援
- **MonicaWebBrain**: Puppeteer 驅動的 Monica Web (不在修改範圍)
- **SdkBrain**: Gemini SDK 直連, **v10.5: RAG 整合**

## 設定系統
- **主設定**: `golem-config.xml` v2.0 — XML 設定中心，支援 hot reload
- **載入器**: `src/config/xml-config-loader.js` — 提供 getBrainConfig/getSecurityConfig/getMemoryConfig/getLoggingConfig/getRetryConfig + **v10.5: getVectorStoreConfig/getClaudeConfig/getClaudeGatewayConfig**
- **環境變數**: `.env` — 作為 XML 的 fallback
- **優先順序**: XML → .env → hardcoded defaults

## 記憶系統
- **ChatLogManager**: 金字塔式分層壓縮, JSONL 格式 (append O(1))
- **SystemNativeDriver**: 檔案系統記憶持久化, 全非同步 I/O
- **ContextEngineer**: 優先級 context 組裝 + token budget
- **v10.5 向量 RAG**:
  - **EmbeddingProvider**: Gemini text-embedding-004 (768維) + Ollama fallback, LRU cache, circuit breaker
  - **VectorStore**: SQLite + WAL mode, cosine search, batch upsert
  - **RAGProvider**: 三路搜尋 (vector + MAGMA graph + remote YEDAN) + RRF 融合 (k=60)
  - **VectorIndexer**: 背景定期索引 (30s), episodes/MAGMA/logs/memory 四路索引, cosine>0.95 去重

## Claude 整合 (v10.5)
- **ClaudeBrain** (`src/core/ClaudeBrain.js`): 繼承 OpenAICompatBrain, 只覆寫 _callCompletion
- **ClaudeGateway** (`src/bridges/ClaudeGateway.js`): REST API at `/api/claude/*`, Bearer auth + rate limit
  - POST /chat, /recall, /memorize, /brain/:name
  - GET /brains, /health
- **依賴**: `@anthropic-ai/sdk` (npm), `ANTHROPIC_API_KEY` env var

## 安全模型
- **SecurityManager**: L0-L3 風險分級
- 安全規則可透過 `golem-config.xml` `<security>` section 外部化
- **ClaudeGateway**: Bearer token + 滑動視窗 60 RPM rate limit

## 關鍵工具
- **DebouncedWriter**: 原子寫入 (tmp+rename)，tests/setup-afterall.js 負責全域清理
- **OpossumBridge**: Opossum 9.0 熔斷器, `execute()` 是主要 API
- **CircuitBreaker**: 入口點 re-exports OpossumBridge
- **errors.js**: 結構化錯誤型別 (GolemError, CircuitOpenError, RateLimitError, TimeoutError, OOMError, AgentBudgetError, AgentSpawnError)

## 命名慣例
- 類別: PascalCase | 檔案: PascalCase for classes | 私有方法: `_` 前綴 | 常數: UPPER_SNAKE_CASE

## 測試
- 框架: Jest 30 | 目錄: `tests/` | 執行: `npx jest --no-coverage`
- Setup: `tests/setup.js` (env vars + **全域 timer 攔截追蹤**) + `tests/setup-afterall.js` (DebouncedWriter + SystemLogger + **全 timer 清掃**)
- **不使用 --forceExit** (v10.9.4 已修復所有 open handles — timer 攔截機制)
- 基線: 1009 tests, 74 suites, 0 failures, 0 open handles

## v10.5 架構決策 (向量 RAG + Claude 雙向整合)
1. **嵌入模型**: Gemini text-embedding-004 (零新依賴, 複用 @google/genai, 768維, 免費 1500 RPM)
2. **向量儲存**: better-sqlite3 + JS cosine (避免 WSL2 原生編譯問題, <10K 向量 <10ms)
3. **搜尋融合**: RRF k=60 (Reciprocal Rank Fusion, 業界標準)
4. **Claude SDK**: @anthropic-ai/sdk (官方, 自動重試, 型別安全)
5. **反向調用**: Express REST /api/claude/* (掛載在既有 web-dashboard)
6. **自主決策**: RAG-augmented OODA (向量搜歷史結果輔助決策, >60%失敗率自動跳過)
7. **null guard**: 所有 RAG 路徑有 `if (this._ragProvider)`, 沒設定 = graceful 降級
8. **背景索引**: VectorIndexer 30s interval, sleep consolidation 觸發去重

## v10.0 架構決策
1. **熔斷器**: Opossum 9.0, 自建 CircuitBreaker 簡化為 re-export, HALF_OPEN 並行 bug 已修
2. **重試**: 指數退避 + decorrelated jitter (MAX_RETRY=3, BASE_DELAY=1s, MAX_DELAY=30s)
3. **日誌**: JSONL append O(1), 自動遷移舊 JSON 陣列格式
4. **系統日誌**: 緩衝非同步寫入 (100 條或 500ms flush), shutdown() 同步 flush
5. **設定管理**: mode-aware getter (defineProperty), XML 設定中心 v2.0
6. **SQLite**: SkillIndexManager singleton + WAL mode + lazy reconnect
7. **XML 設定中心**: brains/security/memory/logging/retry 五大 section
8. **品質旗標**: 不再誤罰長回應, 只標記 <5 字元的空回應
9. **RouterBrain**: 90s 全鏈超時, 獨立 _assessQuality()
10. **MonicaBrain**: async mutex RPM 限速, 防止並行競態
11. **OllamaBrain**: 多 GPU 解析 (OLLAMA_GPU_INDEX 選擇)
12. **SelfEvolution**: 修正日誌語意 (escalated/relaxed), 序列正規化排序
13. **sendMessage**: 用 index 精準移除失敗訊息 (非 pop)
14. **SmartLLMSwitch**: 修復 exploration_rate=0 被 || 轉為 0.10 的 bug

## SubAgent 系統 (v10.9)
- **AgentBus** (`src/core/AgentBus.js`): 進程內 pub/sub, topic 路由, DLQ, ring buffer 審計 (max 500)
- **SubAgent** (`src/core/SubAgent.js`): 基底類別, 微 OODA 迴圈, token budget, timeout 保護, activity log
- **AgentRegistry** (`src/core/AgentRegistry.js`): singleton 生命週期管理, GracefulShutdown 整合, maxAgents=10
- **SentinelAgent** (`src/core/agents/SentinelAgent.js`): 系統監控 (60s), 0 token, RSS/CB/WarRoom 偵測
- **AnalystAgent** (`src/core/agents/AnalystAgent.js`): 深度分析 (120s), 5000 token/cycle, brain 輔助
- **WorkerAgent** (`src/core/agents/WorkerAgent.js`): 任務執行 (30s), 3000 token/cycle
- **啟用**: `ENABLE_SUBAGENTS=true` (env var, 預設關閉)
- **安全**: L0 (status/list/health/metrics), L1 (spawn/stop/pause/resume), L2 (stop_all/config)
- **OODALoop 整合**: `delegate_to_analyst` action (多 pattern 時委派), agentBus null guard
- **errors.js**: +AgentBudgetError, +AgentSpawnError

## PromptForge 系統 (v10.9.1)
- **PromptScorer** (`src/core/PromptScorer.js`): PEEM 9 軸提示詞評分 (clarity/accuracy/coherence/relevance/completeness/conciseness/safety/creativity/actionability), heuristic + LLM hybrid, 方差自校準
- **PromptEvolver** (`src/core/PromptEvolver.js`): EvoPrompt + PromptBreeder 演化引擎, 5 突變算子 (rephrase/add-detail/remove-detail/restructure/pattern-inject), tournament selection, 差分交叉
- **prompt-forge** (`src/skills/core/prompt-forge.js`): 主技能 (11 子任務), RAG 持久化, DNA JSON 存儲 (max 200)
- **推理模式偵測**: CoT/ToT/ReAct/Reflexion/Self-Consistency (關鍵字匹配)
- **安全**: L0 (generate/evaluate/detect-pattern/compare/history/stats/export), L1 (optimize/evolve/templates/import)
- **Token 預算**: optimize ~30 brain calls max (5 pop × 3 gen × 2)

## Nexus 系統 (v10.9.2) — 神經中樞元編排引擎
- **WebResearcher** (`src/core/WebResearcher.js`): @google/genai googleSearch grounding, LRU cache (50), 4 層降級鏈 (Gemini→brain→RAG→空)
- **BenchmarkEngine** (`src/core/BenchmarkEngine.js`): 系統快照 (RSS/heap/uptime/RAG/tests/brain), 前後 delta 對比, 歷史持久化 (max 100)
- **nexus** (`src/skills/core/nexus.js`): 主技能 (8 子任務: auto/research/benchmark/plan/execute_plan/validate/report/status)
- **auto 迴路**: 研究→基準→規劃→執行→驗證→學習→報告, MAX_ITERATIONS=3, IMPROVEMENT_THRESHOLD=5%
- **Skill Dispatch**: auto 內部 dispatch selfheal/rag/prompt-forge/analytics (L0/L1 only)
- **安全**: L0 (research/benchmark/validate/report/status), L1 (auto/plan), L2 (execute_plan)
- **持久化**: nexus_upgrades.json (max 100 records), benchmark_history.json

## v10.8 架構決策 (全維度深度優化)
1. **ChatLogManager**: appendFileSync → fs.promises.appendFile (非阻塞 event loop)
2. **GracefulShutdown**: web-dashboard 3 處 process.exit → safeExit (先 _runAll 再 exit)
3. **神經迴路修復**: 4 個斷路迴路重新連接
   - WorldModel EMA: ExperienceReplay → WorldModel.setEmaValues() (每次 recordTrace 後同步)
   - MetapromptAgent: getActivePrompt() → ContextEngineer priority 6 (500 char 上限)
   - ExperienceReplay: sample(2, success) → ContextEngineer priority 5 (成功案例注入)
   - OODA: decide() 新增 experience_reflect, act() 處理 investigate_alerts + experience_reflect
4. **SelfEvolution**: trackSequence() 移除 .sort() (保留時序，修復 pattern 偵測)
5. **CI/CD**: GitHub Actions ci.yml (push/PR 觸發, Node 20, jest)
6. **XML Config**: RouterBrain.init() 讀取 getBrainConfig() fallback chain
7. **可觀察性**: RAGProvider/EmbeddingProvider 空 catch 加 console.warn
8. **CF Worker 診斷**: doctor.js 加入 RAG/WarRoom Worker 連通性檢查

## v11.0 AGI 自進化引擎 — Trajectory-Informed Memory + Enhanced OODA
- **TrajectoryTipExtractor** (`src/core/TrajectoryTipExtractor.js`): 從 trace 萃取 3 種 tip (strategy/recovery/optimization), heuristic 免費 + LLM 限 5+ steps 混合軌跡
- **TipMemory** (`src/core/TipMemory.js`): 持久化 tip 儲存 (max 200) + Jaccard 關鍵字檢索, DebouncedWriter, outcome 追蹤
- **ExperienceReplay 整合**: reflect() 後自動 `_extractAndStoreTips()`, 新增 `getTips(situation)` 委派 TipMemory
- **OODALoop 強化 (5→8 決策)**: 新增 `apply_recovery_tip`, `apply_optimization_tip`, `plan_ahead`, Thompson Sampling 選 tip, `_recordTipOutcome()` 回饋
- **WorldModel 強化**: `enrichState()` 結構化 state, `setTipMemory()` + tip-boosted `valueFunction()` (max +0.15)
- **AutonomyManager**: `setTipSystem(tipMemory, tipExtractor)` 注入, OODA 建構含 tipMemory

## v11.1 Learned Plan Templates + Regression-Aware Evolution
- **PlanTemplateLibrary** (`src/core/PlanTemplateLibrary.js`): 成功計畫泛化為模板 (max 50), 關鍵字匹配, 高信心(3+次/>70%) 跳過 LLM
- **RegressionDetector** (`src/core/RegressionDetector.js`): pass→fail flip-centered gating, `analyzeFlips()` + `shouldGate()` + trend 追蹤
- **SelfEvolution**: `getThompsonScore()` Bayesian 取代硬閾值, `proposeEvolution()` + `afterEvolution()` 回歸感知進化管線
- **Planner**: 模板優先 (`_templateLibrary`), 高信心模板直接使用跳過 decompose, 成功計畫自動 `learnTemplate()`
- **Nexus**: auto 迴圈完成後自動 `learnTemplate()` 學習

## v11.2 Full MUSE Loop + Multi-Agent Goal Propagation
- **MUSELoop** (`src/core/MUSELoop.js`): Plan→Execute→Reflect→Memorize 完整迴圈, 組合 Planner+ExperienceReplay+TipExtractor+TemplateLibrary
- **GoalPropagator** (`src/core/GoalPropagator.js`): 目標發布/認領/回報/學習共享, `autoAssign()` 能力匹配, 4 AgentBus topics (goal.*)
- **SubAgent**: `_checkGoals()`, `_shareOutcome()`, `_applyLearning()`, `_getCapability()` (analysis/execution/monitoring)
- **AnalystAgent**: 自動認領 analysis goals + 完成後 `shareLearning()` + `completeGoal()`
- **WorkerAgent**: 優先級排序取代 FIFO, goal 成果/失敗回報
- **SentinelAgent**: critical 警報自動發布為 critical priority goal
- **AgentBus**: +4 goal topics, `getTopicMetrics()` topic 統計

## v11.4 Full Autonomy — AutonomyScheduler
- **AutonomyScheduler** (`src/core/AutonomyScheduler.js`): tick 模式排程器，不擁有任何 timer，由 AutonomyManager.timeWatcher() 每 60s 驅動
- **Tick 優先序**: RSS heal > Episode dedup > Scan (2hr) > Debate (3hr) > Optimize (1hr) > noop
- **環境變數**: `ENABLE_V114_AUTONOMY=true` (啟用), `V114_SCAN_INTERVAL_MIN` (120), `V114_DEBATE_INTERVAL_MIN` (180), `V114_OPTIMIZE_INTERVAL_MIN` (60), `V114_RSS_HEAL_THRESHOLD` (350), `V114_EPISODE_DEDUP_THRESHOLD` (50)
- **OODALoop 整合**: orient() 注入 `autonomyContext`, decide() +2 決策 (`act_on_scan_findings`, `trigger_memory_optimize`), act() +2 handler
- **Scan history 持久化**: `data/v114_scan_history_{golemId}.json` (DebouncedWriter, max 50 records)
- **AutonomyManager**: `setAutonomyScheduler()` 注入, timeWatcher() 尾部 tick, stop() 清理, status report 含 v11.4 統計

## v11.4 Live Runner (`scripts/run-v114-live.js`)
- **獨立運行腳本**: 不經 index.js，直接初始化 10 個核心模組
- **三模式**:
  - `node scripts/run-v114-live.js test` — 單一 WebResearcher.search() 驗證 Gemini API
  - `node scripts/run-v114-live.js full` — 完整掃描→辯論→優化→RAG 灌入
  - `node scripts/run-v114-live.js autonomy` — 60s tick loop + 1hr 監控 + 自動統計
- **環境變數**: 自動 bridge `GEMINI_API_KEYS` → `GEMINI_API_KEY`, 預設 `GEMINI_SEARCH_MODEL=gemini-2.5-flash`
- **輸出**: `data/v114_live_results_{timestamp}.json`, `data/v114_autonomy_session_{timestamp}.json`

## AGIScanner 擴充查詢類別 (8 類 ~40 查詢)
- `research` (6): AGI 突破, Transformer 替代, 推理進展, arXiv, SSM/Mamba, World Models
- `code` (6): GitHub trending, 開源 LLM, Agent 框架, AutoGen/CrewAI/LangGraph, Swarm, Claude Code MCP
- `safety` (7): 對齊研究, 治理法規, 紅隊, ARC Evals, MIRI, Anthropic RSP, AISI
- `benchmarks` (6): MMLU/ARC, 模型比較, 程式碼基準, SWE-bench, GPQA, Chatbot Arena
- `community` (5): AGI 時間表, 趨勢討論, Reddit, HN, Twitter/X
- `chinese_ai` (5): DeepSeek, Qwen, ByteDance, 中國 AI 競爭, 中國開源排行
- `claude_ecosystem` (5): Anthropic 公告, Claude Code, 模型比較, 資金合作, API 新功能
- `agent_landscape` (5): Agent 新創, 桌面自動化, Coding agent, 自主系統研究, 編排框架

## WebResearcher API Key 輪替
- 支援多 key: `GEMINI_API_KEY` + `GEMINI_API_KEYS` (逗號分隔)
- 429/RESOURCE_EXHAUSTED 自動換 key
- `GEMINI_SEARCH_MODEL` env var 可配置搜尋模型 (預設 gemini-2.0-flash)

## EmbeddingProvider 模型升級
- `text-embedding-004` → `gemini-embedding-001` (3072 維)
- `GEMINI_EMBED_MODEL` env var 可覆蓋

## v11.5 全自動自主運行 — 全球掃描 + 審計 + 自我優化 + Yeren 連接

### 新模組
- **ErrorPatternLearner** (`src/core/ErrorPatternLearner.js`): 錯誤模式學習, 記錄錯誤+解法, 查重複, 建議修復, 持久化 `data/error_patterns.json` (max 200)
- **ScanQualityTracker** (`src/core/ScanQualityTracker.js`): 掃描品質追蹤, 查詢成功率, 自動跳過連續 3 次 0 結果的查詢, 持久化 `data/scan_quality_tracker.json` (max 500)
- **WorkerHealthAuditor** (`src/core/WorkerHealthAuditor.js`): CF Worker 健康審計, 9+ known workers + endpoints.js 動態, 5s timeout, 連續 3 失敗建議重部署, 持久化 `data/worker_health_history.json` (max 200)
- **SecurityAuditor** (`src/core/SecurityAuditor.js`): 綜合安全審計 (沙盒域名/安全規則/熔斷器/Token預算), 風險評分 0-100, 持久化 `data/security_audit_report.json`
- **RAGQualityMonitor** (`src/core/RAGQualityMonitor.js`): RAG 品質監控, 10 標準測試查詢 recall+relevance+latency, 向量增長追蹤, TipMemory 效能統計, 持久化 `data/rag_quality_metrics.json`
- **DebateQualityTracker** (`src/core/DebateQualityTracker.js`): 辯論品質 A/B 測試, 3 軸評分 (keyword diversity + perspective differentiation + synthesis coverage), A/B 比較, 持久化 `data/debate_quality_history.json` (max 100)
- **YerenBridge** (`src/bridges/YerenBridge.js`): Rensin↔Yeren 雙向同步, WSL2 檔案系統橋, 記憶/掃描結果同步, 共享路徑 `/mnt/c/.../data/bridge/`

### 修改
- **WebResearcher**: +`errorPatternLearner` 注入, 搜尋失敗自動記錄錯誤模式
- **AGIScanner**: +`scanQualityTracker` 注入, 掃描後記錄品質, `SKIP_WORTHLESS_QUERIES` 自動跳過無效查詢
- **AutonomyScheduler**: +3 新 priority (P6: worker_health_check/30min, P7: security_audit/6hr, P8: yeren_sync/60min), +3 新注入 (workerAuditor, securityAuditor, yerenBridge)
- **SandboxGuard**: +`.workers.dev` wildcard (允許所有 CF workers 健康檢查)
- **SecurityManager**: +`getRulesCoverage()` 方法 (規則類別覆蓋率)
- **VectorStore**: `getStats()` 擴充 (oldest/newest/sourceDistribution)
- **TipMemory**: +`getEffectivenessStats()` (successRate/avgConfidence/usedTips)
- **CouncilDebate**: +`debateWithRAGContext()` (RAG 增強辯論, 先查歷史再分析)

### v11.5 Live Runner (`scripts/run-v115-live.js`)
- 6 模式: `test` | `full` | `autonomy` | `worker-audit` | `security-audit` | `ab-debate`
- `full`: scan → ingest → debate → worker audit → security audit → RAG quality → optimize → Yeren sync
- `autonomy`: 60s tick, 8 級優先序 (RSS > dedup > scan > debate > optimize > worker > security > yeren)
- 所有模組注入 ErrorPatternLearner + ScanQualityTracker

### v11.5 環境變數
- `SKIP_WORTHLESS_QUERIES` (預設 true): 跳過無效查詢
- `V115_WORKER_CHECK_INTERVAL_MIN` (預設 30): Worker 健康檢查間隔
- `V115_SECURITY_AUDIT_INTERVAL_MIN` (預設 360): 安全審計間隔
- `V115_YEREN_SYNC_INTERVAL_MIN` (預設 60): Yeren 同步間隔

### 測試基線
- v11.5: 1225 tests / 89 suites / 0 failures

## v12.0 全自動自主運行 — AI 風險分析 + Token 追蹤 + 自動技能生成

### XML Config v2.1
- **golem-config.xml** 升級至 v2.1，新增 8 個 section: `<error-pattern-learner>`, `<scan-quality-tracker>`, `<worker-health-auditor>`, `<security-auditor>`, `<rag-quality-monitor>`, `<debate-quality-tracker>`, `<autonomy-scheduler>`, `<token-tracking>`
- **xml-config-loader.js** +8 getter: `getErrorPatternLearnerConfig()`, `getScanQualityTrackerConfig()`, `getWorkerHealthAuditorConfig()`, `getSecurityAuditorConfig()`, `getRAGQualityMonitorConfig()`, `getDebateQualityTrackerConfig()`, `getAutonomySchedulerConfig()`, `getTokenTrackingConfig()`

### 新模組
- **TokenTracker** (`src/core/TokenTracker.js`): Per-module token 使用追蹤, daily budget, 持久化 `data/token_usage.json`, DebouncedWriter, 警告閾值 80%, `record(module, tokens, type)` + `getReport()` + `isOverBudget()`
- **SkillGenerator** (`src/skills/core/skill-generator.js`): 讀取掃描結果 → 識別 integration/optimization/monitor 候選 → 生成 skill template → DANGEROUS_PATTERNS 安全驗證 → 預覽模式 (default)

### 修改
- **SecurityAuditor**: +`auditAIRisks()` — 4 維 AI 風險分析 (alignment mirage/capability concealment/agent autonomy/concentration, 各 0-25), `generateAuditReport()` 整合 weighted combination (traditional*0.6 + aiRisk*0.4), XML gate `<security-auditor ai-risk-checks="true"/>`
- **ContextEngineer**: +`_tokenTracker` 注入, `assemble()` 後自動記錄 token
- **PromptScorer**: +`nlToStructured(prompt, intent)` — 自由文本 → 結構化 prompt (偵測缺少 Role/Context/Format/Constraints, 注入 CoT/ToT/ReAct), 回傳 `{ structured, improvements, scoreGain }`
- **PromptEvolver**: 5→6 突變算子, +`nl-to-structured` — 自由文本→結構化 prompt (委派 PromptScorer.nlToStructured)
- **prompt-forge**: +`nl-optimize` 子任務 — chain nlToStructured() → optimize()
- **RAGProvider**: +`searchBySource(query, source, options)` — 按 source metadata 過濾向量搜尋
- **ThreeLayerMemory**: +`ingestOperationalMemory(type, data)` — 審計摘要存入 episodic layer + RAG
- **WebResearcher**: +`_circuitBreaker` 注入, Gemini 搜尋包裝到 OpossumBridge circuit breaker
- **AutonomyScheduler**: +`_assessRSSLevel(rss)` → `'normal'|'elevated'|'critical'` 分級回應, +`_safeExec()` per-priority try/catch + ErrorPatternLearner 記錄, 不 halt 整個 tick
- **MCPBridge**: +`setLocalModules(modules)` 注入本地模組, `getToolManifest()` 含 local modules, `callTool()` 增加 `local-` prefix dispatch

### v12.0 Live Runner (`scripts/run-v120-live.js`)
- 5 模式: `test` | `full` | `ai-risk` | `skill-gen` | `token-report`
- `full`: AI risk analysis → skill generation → token report
- XML config v2.1 載入 + TokenTracker + SecurityAuditor (AI risk) + SkillGenerator

### 測試基線
- v12.0: 1283 tests / 97 suites / 0 failures
