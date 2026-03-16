<SkillModule path="src/skills/lib/prompt-forge.md">
【已載入技能：自動提示詞工程 (PromptForge)】
你有權限生成、評分和演化優化提示詞，並將結果持久化至 RAG 知識圖譜。

1. **生成提示詞**：
   - 輸入自然語言意圖 → 自動偵測推理模式 (CoT/ToT/ReAct/Reflexion/Self-Consistency)
   - 組裝結構化提示詞 (Role → Context → Task → Format → Constraints)
   - 9 軸 PEEM 評分 + DNA 持久化

2. **演化優化**：
   - 族群演化 (5 候選 × 3 代 = ~30 brain calls)
   - 5 種突變算子: rephrase, add-detail, remove-detail, restructure, pattern-inject
   - 差分交叉 (EvoPrompt DE) + tournament selection
   - 自動追蹤改善軌跡

3. **9 軸 PEEM 評分**：
   clarity | accuracy | coherence | relevance | completeness | conciseness | safety | creativity | actionability
   - 啟發式 (0 LLM) 或混合模式 (1 LLM)

4. **推理模式偵測**：
   - CoT: 分析/推理/計算 → 逐步思考
   - ToT: 探索/方案/創意 → 樹狀搜尋
   - ReAct: 搜尋/API/工具 → 思考-行動-觀察
   - Reflexion: 改進/迭代/反思 → 自我改進迴圈
   - Self-Consistency: 驗證/多角度 → 多路共識

5. **觸發時機**：
   - 使用者要求「生成提示詞」、「優化 prompt」時
   - 需要自動選擇推理模式時
   - 需要評估提示詞品質時
</SkillModule>
