<!-- ═══════════════════════════════════════════════════════════════════════
  Release Notes Template — clawd-on-desk
  ═══════════════════════════════════════════════════════════════════════
  使用方法：
    1. 复制本文件为 release-v<x.y.z>.md（与 package.json 版本号一致）
    2. 按下方各章节指引填写
    3. 与 package.json + CHANGELOG.md 一起作为同一个 release commit 提交
       （参见 .codebuddy/rules/project-continuity.mdc §三-3）
    4. CI (build.yml) 会自动将本文件内容作为 GitHub Release body

  注意事项：
    - 语言：英文（与 CHANGELOG.md §Conventions 保持一致）
    - 桶分类：与 CHANGELOG.md 的 Added/Fixed/Changed/... 对应
    - 本文件必须在 push tag 前存在，否则 draft Release 会缺少 body
    - 占位符 {VERSION} 替换为实际版本号（不含 v 前缀）
    - 删除所有 <!-- 注释 --> 和 ⬇️ 指引文字后再提交
═══════════════════════════════════════════════════════════════════════ -->

## v{VERSION}

> Fork release. Continuation of the v0.7.x line on `LetitiaChan/clawd-on-desk`.
<!-- ⬇️ 如果本版本跳过了某个 tag，在此说明原因（参考 v0.7.12 对 v0.7.11 的处理） -->

---

### New Features
<!-- ⬇️ 对应 CHANGELOG.md 的 Added 桶
     格式：**功能名称（粗体）** — 一段话描述用户可感知的变化
     示例：- **Gongfeng Copilot wizard — auto-detect Bash** — The wizard now...
     无新功能时写 "- None in this release." -->

- 

---

### Bug Fixes
<!-- ⬇️ 对应 CHANGELOG.md 的 Fixed 桶
     格式：**问题简述（粗体）** 修复描述
     示例：- **Linux deb build `Macro file is not defined` error.** Changed `${file}` to `$file`.
     无修复时写 "- None in this release." -->

- 

---

### Internal / Refactor
<!-- ⬇️ 对应 CHANGELOG.md 的 Changed / Internal 桶
     记录不影响用户但影响开发者/维护者的改动
     格式：**模块/文件名（粗体）** — 改动描述
     示例：- **`ci.yml` CHANGELOG enforcement** — `npm run check:changelog` as final CI step.
     无内部改动时可省略本章节 -->

- 

---

### Release & Packaging
<!-- ⬇️ 描述 CI/CD、打包链路、tag 策略的变化
     如无变化写：- **CI build pipeline unchanged** — ...（简述当前流程）
     必须包含的信息：
       - build.yml 是否有结构性改动
       - 是否有跳过的 tag（标注 [SKIPPED — tag orphaned]）
       - sidecar 二进制是否有升级 -->

- **CI build pipeline** — <!-- unchanged / refactored / ... -->

---

### Test Results
<!-- ⬇️ 必填。粘贴 `npm test` 和 `npm run check:syntax` 的实际输出摘要
     格式严格如下（数字替换为实际值）：
     如有 verify:sidecars 也一并列出 -->

- `npm test` — **X passed / 0 failed / Y skipped** (Z total, N suites, T s)
- `npm run check:syntax` — M files, K require entries ✅
<!-- 可选：
- `npm run verify:sidecars` — ✅ -->

---

### Known Limitations
<!-- ⬇️ 列出本版本已知但未修复的问题/限制
     格式：**限制标题（粗体）** — 描述 + 影响 + 规避方式（如有）
     无已知限制时写 "- None identified." -->

- 

---

<!-- ═══════════════════════════════════════════════════════════════════════
  自检清单（提交前逐项确认，确认后删除本注释块）：

  □ 文件名为 release-v<x.y.z>.md，版本号与 package.json 一致
  □ 标题 ## v{VERSION} 中的版本号已替换
  □ 所有 <!-- 注释 --> 已删除
  □ New Features / Bug Fixes 内容与 CHANGELOG.md [x.y.z] 段一致
  □ Test Results 数字来自本次 `npm test` 实际运行
  □ 如有跳过的 tag，已在顶部 blockquote 和 Release & Packaging 中说明
  □ 本文件已加入 release commit（与 package.json + CHANGELOG.md 同一 commit）
  □ `Test-Path docs/releases/release-v<x.y.z>.md` 确认文件存在
═══════════════════════════════════════════════════════════════════════ -->
