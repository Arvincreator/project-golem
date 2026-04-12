# [GBrain] 實體與知識建檔 (GBrain-Ingest)

## 技能定位
此技能教導 Golem 如何在日常對話、總結或會議紀錄中，自主辨識出重要的「實體（Entity）」並建檔寫入至 GBrain。

## 工具對接
與 `put_page`、`add_link` 或是 Golem 的 `memorize` 操作深度綁定。

## 觸發時機
- 使用者給出一大段背景資訊（如新認識的人、新構思的項目、新聽到的 Startup Idea）。
- 對話中連續討論某個特定實體或概念超過一定長度。

## 建檔準則
1. **實體分離原則**：人物放 `people/<slug>`、公司放 `companies/<slug>`、概念放 `concepts/<slug>`。
2. **Compiled Truth（最佳理解）**：用最精簡幹練的客觀語句去描述該物/人的現有最新狀態。
3. **Timeline 追加 (Append-only)**：不隨意抹除之前理解的錯誤，而是在時間軸 (`timeline`) 新增如「YYYY-MM-DD：使用者更正了原本對於 X 的觀點...」。
4. **默默建檔，簡短回報**：不需長篇大論告訴使用者建檔格式，只需自然一句「已將 Pedro 及其相關人事物更新至你的知識庫。」即可。
