# .review/ — 评审记录沉淀

> 本目录用于持久化保存代码评审（Code Review）过程中发现的问题、修复决策和验证结果。
> 已在 `scripts/check-changelog.js` 和 `project-continuity.mdc` §4.1 中注册为文档豁免路径。

---

## 目录用途

将每次重要评审的结论结构化沉淀，避免评审知识散落在 commit message、测试文件注释或聊天记录中。
后续开发者/Agent 可通过本目录快速了解历史评审决策和修复闭环。

---

## 文件命名规范

```
review-YYYY-MM-DD[-<topic>].md
```

示例：
- `review-2026-05-19-gongfeng-copilot-hardening.md`
- `review-2026-07-14-ci-pat-fix.md`

---

## 记录格式

每份评审文档必须包含以下章节（详见 `TEMPLATE.md`）：

1. **元数据**：日期、评审触发原因、涉及模块
2. **发现的问题**：按优先级（P0/P1/P2）列出
3. **修复方案**：每个问题的修复 commit 和方案描述
4. **验证方式**：测试用例、CI 结果
5. **沉淀的经验**：本次评审产生的规则/坑点（引用 `AGENT-PROGRESS.md` §六 条目编号）

---

## 生命周期

| 阶段 | 说明 |
|------|------|
| **新增** | 评审完成当次会话立即创建 |
| **引用** | 对应的测试文件顶部注释引用本目录文档路径 |
| **归档** | 当所有问题已被自动化测试覆盖且连续 5 个会话未再触发时，文件保留但不再主动维护 |

---

## 与其他文件的关系

| 文件 | 关系 |
|------|------|
| `test/code-review-*.test.js` | 评审产出的回归测试，文件头注释应引用本目录对应文档 |
| `AGENT-PROGRESS.md` §六 | 评审中发现的通用坑点沉淀到那里 |
| `.codebuddy/rules/project-continuity.mdc` §五 | 踩坑经验的记录规则 |
| `docs/investigations/` | 深度排查文档（评审记录偏结论，investigation 偏过程） |
