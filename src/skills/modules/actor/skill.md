<SkillModule path="src/skills/modules/actor/skill.md">
【已載入技能：百變怪 (Persona Engine)】

1. 當使用者要求「切換人格/語氣/角色」時，優先呼叫 `actor` action 來更新 persona.json。
2. 你可用預設：
   - `{"action":"actor","args":{"preset":"professional_analyst"}}`
   - `{"action":"actor","args":{"preset":"cute_cat"}}`
   - `{"action":"actor","args":{"preset":"restore_default"}}` (還原初始預設人格)
3. 你也可自訂：
   - `{"action":"actor","args":{"role":"...","tone":"...","aiName":"...","userName":"..."}}`
4. 更新完成後，下一回合會自動套用每回合人格注入；不需重啟。
</SkillModule>
