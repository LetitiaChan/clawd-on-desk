# AGENT-PROGRESS — 跨会话进度笔记

> 本文件由 `.codebuddy/rules/project-continuity.mdc` 强制约束维护。
> 每次会话启动时 Agent 会读取本文件恢复上下文；会话结束/完成重要里程碑时主动更新。
>
> **最后更新**：2026-07-15（会话：CodeBuddy CLI 权限气泡兼容——IDE + CLI 双路径 + v0.7.15 发版）
> **当前 HEAD**：`0cf4b1c` (branch: `main`，已 push；tag `v0.7.15` 已就位 → auto-tag 附注 tag 指向 `0cf4b1c`；build.yml 已 workflow_dispatch 触发打包)
> **package.json 版本**：`0.7.15`（**已 commit + tag，CI 打包中**）
> ⚠️ **构建约定**：本地不打包，所有 `electron-builder` 产出由 CI 完成。详见 `.codebuddy/rules/project-continuity.mdc`。

---

## 一、项目概要

| 维度 | 说明 |
|------|------|
| 名称 | **Clawd on Desk** |
| 定位 | 实时响应多家 AI Coding Agent 会话状态的桌面宠物 |
| 技术栈 | Electron 41 + Node.js (CommonJS) + 原生 JS/HTML/CSS；`koffi` FFI、`htmlparser2`、`electron-updater` |
| 入口 | `src/main.js`（主进程） / `launch.js`（启动脚本） |
| 构建 | `electron-builder`（Win NSIS / macOS dmg / Linux AppImage+deb，x64+arm64） |
| 包管理 | npm |
| 测试 | `node test/run-tests.js`（自研 runner，自动发现 `test/*.test.js`） |
| 许可证 | AGPL-3.0-only |
| Fork | `publish.owner = "LetitiaChan"`，CI 已配置 fork 同步 |

### 支持的 AI Agent（hooks/agents 双层架构）

Claude Code、CodeBuddy、Codex、Copilot CLI、Cursor Agent、Gemini CLI、Gongfeng Copilot、Hermes、Kimi CLI、Kiro CLI、OpenClaw、OpenCode、Pi。

---

## 二、已完成的变更（最近 10 个 commit）

| Commit | 说明 |
|--------|------|
| `0cf4b1c` | release: v0.7.15（CodeBuddy 双路径权限 + CN 识别/terminal-focus 修复 + hook 加固；固化 IDE `requires_approval` 仅 `execute_command`、删除/改文件不可拦截的 bundle 实证）（**HEAD**，tag `v0.7.15`） |
| `5ce1580` | fix(codebuddy): harden hook error handling, process detection and cleanup semantics |
| `744e811` | fix(codebuddy): add editor to server-side whitelist for terminal-tab focus |
| `2ebe2be` | docs: refresh AGENT-PROGRESS after codebuddy terminal-focus hotfix |
| `73a592b` | fix(codebuddy): enable precise terminal-tab focus in CodeBuddy IDE |
| `a5f4dea` | fix(codebuddy): route permission approval through PreToolUse.requires_approval |
| `eaeea32` | fix(codebuddy): add PermissionRequest command hook fallback + fix terminal focus in IDE |
| `dcd5ab2` | chore: remove CLAUDE.md (superseded by .codebuddy/rules) |
| `d80dae4` | docs: update AGENT-PROGRESS.md — mark rule consistency CI integration complete |
| `5185e57` | ci: add rule consistency check (npm run check:rules) to CI pipeline |

> 主线：CodeBuddy IDE 终端 tab 精确聚焦修复 + CodeBuddy 权限审批修正（PreToolUse.requires_approval）+ Gongfeng Copilot 支持 + fork 自动化发布 + ci.yml 远端兜底流水线。

---

## 三、待实施的变更

> **v0.7.15 发版预备（工作树未提交）**，包含两批 CodeBuddy 改动：
> 1. 已 commit（`744e811`、`5ce1580`）：CN build 进程名识别、terminal-focus、editor 白名单、hook error handling 等。
> 2. 本会话新增（未 commit）：CodeBuddy **IDE + CLI 权限双路径**——`codebuddy-install.js` 注册 `PermissionRequest` HTTP hook 驱动 CLI 路径、URL reconcile 到运行时端口、仅 scrub 死 command hook；`codebuddy-hook.js`/`integration-sync.js` 配套；CHANGELOG/release-v0.7.15.md 已修正过度声称。测试 `npm test` 2680 通过。
>
> 收尾待办：按规则三 commit（`package.json`+`CHANGELOG.md`+`docs/releases/release-v0.7.15.md`+源码/测试）→ push main → 显式 `git push origin v0.7.15` → 盯 CI 三平台出包 → **CLI 端真机验证气泡**。

---

## 四、已积累的规格 / 规则

- `.codebuddy/rules/project-continuity.mdc` — 跨会话上下文恢复 + Bug 修复 / 发布 / 其它场景处置
- `.review/` — 评审记录沉淀（README.md + TEMPLATE.md + review-*.md）
- `AGENTS.md` — Agents 集成总览
- `CHANGELOG.md` — Keep a Changelog 风格 + 英文
- `.github/workflows/` — build.yml / ci.yml / auto-tag.yml / sync-upstream.yml / rebase-feature-gongfeng.yml
- `.github/dependabot.yml` — npm + github-actions 周扫
- `scripts/check-syntax.js` — 一键静态校验（`npm run check:syntax`）
- `docs/` — releases / investigations / guides / plans / km / cloudling / project

---

## 五、项目目录结构要点

```
clawd-on-desk/
├── src/                    # Electron 主进程 + 渲染层
├── hooks/                  # AI Agent hook 脚本（install/uninstall + runtime）
├── agents/                 # Agent 注册中心 + 元数据
├── extensions/vscode/      # VS Code 扩展
├── themes/                 # 桌宠主题
├── assets/                 # 图标 / svg / 音效 / 截图
├── tools/                  # 辅助工具
├── scripts/                # 构建与维护脚本
├── bin/cc-connect-clawd/   # sidecar 二进制
├── build/                  # NSIS 安装脚本
├── test/                   # 自研测试
├── docs/                   # 文档分区
├── .review/                # 评审记录沉淀
├── .github/workflows/      # CI workflows
├── package.json
├── launch.js               # 启动入口
└── AGENT-PROGRESS.md       # 本文件
```

---

## 六、已知问题与注意事项

1. **~~`.gitignore` 双源问题~~**（✅ 已解决，commit `7be2872`）。`AGENT-PROGRESS.md` 与 `.codebuddy/` 已纳入版本库。
2. **`v0.7.11` 是孤儿 tag**，不可复用。
3. **dist/ 是本地构建遗留**，安装包从 CI artifact / Release 页下载。
4. **package-lock.json（181KB）**必须随依赖变更一起 commit，`npm ci` 依赖它。
5. **测试 runner 自研**，自动发现 `test/*.test.js`，无需 manifest。
6. **fork 仓库**，`publish.owner = "LetitiaChan"`，别误推 upstream。
7. **PowerShell 5.x 不支持 `&&`**，用 `;` 或分行。commit message 含特殊字符时用 `git commit -F <file>`。
8. **测试断言反斜杠**：HTML 单 `\` = JS 字面量 `\\`，别多写。
9. **`scripts/*` 默认被 .gitignore 忽略**，新增脚本必须补 `!scripts/<file>` 豁免条目。
10. **Workflow 触发规则**：
    - 任意 push → `ci.yml`
    - push main + package.json 变更 + tag 缺失 → `auto-tag.yml` → `build.yml`
    - push tag `v*` → `build.yml`
    - `auto-tag.yml` 用 GITHUB_TOKEN push 的 tag **不会**触发 `build.yml`（GitHub 安全限制），发版必须本地显式 push tag
11. **build.yml 用 `draft: false`**，否则 `/releases/latest` API 不返回新版本，更新检查失效。
12. **`build.yml` release job 硬校验 `docs/releases/release-<tag>.md`**，缺失则 release job 红。
13. **平台相关测试必须加 skip 守卫**：含 `C:\\` 等 win32 路径字面量的用例需 `{ skip: process.platform !== 'win32' ? ... : false }`。
14. **工作流断言用语义匹配**（matrix.include 三元组 + 插值变量），不要断 plain-string 命令字面量。
15. **不变式测试区分结构性 vs 内容性**：结构可锁死，内容只锁到领域语义级。
16. **探测类代码三原则**：多重冗余 + 永不静默吞错 + 诊断面板。
17. **`.review/` 目录的 .gitignore 策略**：自动生成的 `*_record.md`（CodeBuddy 产出）继续被忽略；手动创建的 `README.md`、`TEMPLATE.md`、`review-*.md` 通过豁免规则纳入版本库。
18. **CodeBuddy 的 IDE 与 CLI 是两套不同的权限机制，共用 `~/.codebuddy/settings.json`**。
    - **IDE**（腾讯云代码助手扩展）**没有** `PermissionRequest` 事件（仅 7 个事件：SessionStart/SessionEnd/PreToolUse/PostToolUse/UserPromptSubmit/Stop/PreCompact）。权限审批由 `PreToolUse` 的 `hookSpecificOutput.permissionDecision`（`allow`/`deny`/`ask`）承担，是否需确认由输入里的 `tool_input.requires_approval`（boolean，可选）表达。
    - **实证收紧（IDE bundle 反查）**：`requires_approval` 在 IDE 本体 `resources\app\out\codebuddy\main.js` + `extensions\genie\...` 里**仅**是 `execute_command`（enum `EXECUTE_COMMAND`）一个工具的参数（schema：`execute_command:{command,requires_approval}`；工具→参数映射表里只有 `EXECUTE_COMMAND→["command","requires_approval"]`）。删除工具是 `delete_file`（enum `DELETE_FILES`，参数仅 `["filePath"]`），与 `write_to_file`/`append_to_file`/`replace_in_file` 同属 `changeFileTools`，由 IDE **自己的文件变更确认 UI（diff/approve）** 拦截，**结构上不携带 `requires_approval`**。→ 结论：`codebuddy-hook.js` 的 `wantsApproval()` 对删除/改文件类操作**永远为 false**（`tool_input` 里根本没这个字段），IDE 路径的气泡拦截**仅对 `execute_command` 一个工具可能生效**，对 delete/write/append/replace 是结构性不可达，而非概率问题。
    - **CLI**（`codebuddy` 命令 = Claude Code fork `@tencent-ai/codebuddy-code`）**有**完整的标准 Claude Code hook 集（14 个，含真 `PermissionRequest`），在需审批工具（主要 Bash）执行前 fire 阻塞式 `PermissionRequest`。bundle 反查证据：`requires_approval` 在 CLI bundle 中 0 命中；`PermissionRequest` 51 处、`type:"http"` 支持。
    - **坑（历史）**：v0.7.15 初版基于「CodeBuddy 只有 IDE、权限走 requires_approval」的假设，把 CLI 唯一能用的 `PermissionRequest` HTTP hook 主动删掉了——导致 IDE（TerminalExecutor 在 hook 前确认、`requires_approval` 几乎恒 false）和 CLI 两条路径都弹不出气泡。`PreToolUse` 若返回旧格式 `{"decision":"allow"}` 也会被 IDE 解析为 `permissionDecision=none` → `default_allow` 直接放行。
    - **规避（现方案：IDE + CLI 双路径）**：`codebuddy-hook.js` 只拦截 `requires_approval===true` 的 `PreToolUse`（IDE 路径，best-effort，且见上：**仅 `execute_command` 一个工具会带该字段**，删除/改文件类拦不到），阻塞转发 `/permission` 并把 `decision.behavior` 转成 `permissionDecision`；`codebuddy-install.js` 额外注册 `PermissionRequest` HTTP hook（→ `/permission`，镜像 Claude Code `HTTP_HOOKS`）驱动 CLI 路径，在 IDE 里是无害死配置。installer 不再删该 HTTP hook（改为把 URL reconcile 到运行时端口），只 scrub 遗留的死 *command* hook。不可达/无决策/DND/禁用一律回退。`integration-sync.js` 已把运行时端口线程化进 CodeBuddy sync。诊断锚点：IDE 日志 `...\CodeBuddy CN\logs\...\clawd-on-desk__*.log` 的 `[ToolHookExecutor] PreToolUse hook result` / `[beforeExecute] Permission decision`；CLI 端需真机跑一次危险命令确认 `PermissionRequest` 在确认前 fire、气泡能弹（端到端仍待验证）。
19. **CodeBuddy 有两套独立目录，别混用**：`~/.codebuddy/` 是 **CLI agent** 数据目录（无 `extensions/` 子目录）；`~/.codebuddycn/extensions/` 才是 **CodeBuddy CN IDE** 的用户扩展目录（VS Code fork，dataFolderName=`.codebuddycn`）。
    - **坑**：跳转终端对 CodeBuddy IDE 无效，一度以为要往 `~/.codebuddy/` 装扩展。
    - **根因**：terminal-tab 精确聚焦依赖 VS Code 扩展 `clawd.clawd-terminal-focus`，而 IDE 只读 `~/.codebuddycn/extensions/`；旧 `installTerminalFocusExtension` 的 targets 只含 `.vscode`/`.cursor`，CodeBuddy IDE 从未被下发扩展。
    - **规避**：`main.js installTerminalFocusExtension` 的 targets 已补 `~/.codebuddycn/extensions`。诊断锚点：extension-host crash log stack trace 里的 `.codebuddycn\extensions\...` 路径可确认真实扩展目录。
20. **terminal-tab 精确聚焦的 editor 值必须四处一致**：hook 上报 `detectedEditor`（"code"/"cursor"/"codebuddy"）→ `state.js` 存入 session → `focus.js normalizeEditor` 白名单 → `main.js installTerminalFocusExtension` 安装目标。
    - **坑**：`focus.js normalizeFocusRequest` 的 editor 白名单硬编码只认 `"code"`/`"cursor"`，`"codebuddy"` 被归一化为 `null`，`scheduleTerminalTabFocus` 因 `!editor` 直接 return，`/focus-tab` 从不发出。
    - **规避**：白名单已抽为模块级 `TERMINAL_TAB_FOCUS_EDITORS` Set 并暴露到 `__test`；新增受支持的 VS Code fork agent 时，必须同步更新「hook detectedEditor + focus.js Set + main.js targets」三处。
21. **`main.js EXT_VERSION` 必须与 `extensions/vscode/package.json.version` lockstep**。
    - **坑**：`EXT_VERSION` 停在 `0.1.0` 而扩展 package.json 已 bump 到 `0.1.1`，导致 commit `eaeea32` 的 `onStartupFinished` 修复从未下发给已装用户（版本号相等时 `installTerminalFocusExtension` 跳过覆盖）。
    - **规避**：本次已同步为 `0.1.1`，并新增 `test/terminal-focus-extension-install.test.js` 断言两者一致，防止再次漂移。
22. **`auto-tag.yml`（GITHUB_TOKEN 建 tag）抢跑会击穿"显式 push tag 触发 build.yml"，导致打包流水线不触发**。
    - **坑**：v0.7.15 发版时，`git push origin main` 后 `auto-tag.yml` 立刻自动创建了 `v0.7.15` 附注 tag（指向正确 release commit `0cf4b1c`）；随后开发者显式 `git push origin v0.7.15` 被 `! [rejected] (already exists)` 拒绝。更关键：`build.yml` **没有**被这个 tag 触发——`gh run list --workflow build.yml` 里最新仍是 v0.7.14。
    - **根因**：GitHub Actions 防递归机制——用默认 `GITHUB_TOKEN` 在 workflow 里创建/推送的 tag **不会**再触发其它由 `push: tags` 监听的 workflow。auto-tag 用的就是 `GITHUB_TOKEN`，所以它建的 tag 是"哑"的，规则 §三 依赖的"显式 push tag → 触发 build.yml"兜底被 auto-tag 抢跑后失效（显式 push 因 tag 已存在被拒，等于没 push）。对比 v0.7.14 的 build.yml 是 `event=push headBranch=v0.7.14` 触发的——那次 tag 是开发者本人凭证 push 的，才会级联。
    - **规避**：发版打 tag 后**必须显式核对 `gh run list --workflow build.yml` 是否出现本 tag 的运行**；若没有（被 auto-tag 抢跑），立即用 `gh workflow run build.yml --ref v<x.y.z>` 手动触发（release job 判据是 `startsWith(github.ref,'refs/tags/v')`，workflow_dispatch + `--ref v<tag>` 下 `github.ref_name=v<tag>`，会正常校验 release note 并建 Release）。切勿假设 auto-tag 会顺带把包也打了。→ 待反向修补规则 §三 step 5/6。

---

## 七、下次会话建议

1. **🟡 治理**
   - `CLAUDE.md` 已在工作树中被删除，确认是否正式 commit 移除。

2. **🟢 长期**
   - 规则演进（ESLint / OpenSpec / 双市场发布等按需扩展）。

---

> 维护提示：完成重要工作后，更新「已完成的变更」「待实施的变更」「已知问题」「下次会话建议」，并刷新顶部元数据。
