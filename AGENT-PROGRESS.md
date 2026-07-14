# AGENT-PROGRESS — 跨会话进度笔记

> 本文件由 `.codebuddy/rules/project-continuity.mdc` 强制约束维护。
> 每次会话启动时 Agent 会读取本文件恢复上下文；会话结束/完成重要里程碑时主动更新。
>
> **最后更新**：2026-05-20 10:26（commit `483d61c`：fix(updater): publish releases immediately so update check works；ci.yml run 26137489988 ✅）
> **当前 HEAD**：`483d61c` (branch: `main`，已 push，ci.yml ✅)
> **package.json 版本**：`0.7.14`（已发版；后续改动进 `[Unreleased]`）
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
| `483d61c` | fix(updater): publish releases immediately so update check works（**HEAD**） |
| `ae4f496` | release: v0.7.14 |
| `163f5c3` | fix(node): show real Node.js path in CLI summary |
| `b3932cb` | test+docs: Node.js install guide tests (10 cases) |
| `25c89bf` | feat(node): install guidance in wizard and doctor |
| `b2fb860` | feat(doctor): Node.js availability detection |
| `5a75aa0` | release: v0.7.13 |
| `d34c510` | fix(ci): macOS test failure + Linux deb build error |
| `17aa09b` | --sync-upstream daily |
| `be4d67c` | fix(gongfeng): packaged exe wizard 误报 + diagnostics 诊断面板 |

> 主线：Gongfeng Copilot 支持 + fork 自动化发布 + ci.yml 远端兜底流水线。

---

## 三、待实施的变更

> 当前本地工作树干净（除 .gitignore 排除的本文件）。无未提交改动。

---

## 四、已积累的规格 / 规则

- `.codebuddy/rules/project-continuity.mdc` — 跨会话上下文恢复 + Bug 修复 / 发布 / 其它场景处置
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
├── .github/workflows/      # CI workflows
├── package.json
├── launch.js               # 启动入口
└── AGENT-PROGRESS.md       # 本文件
```

---

## 六、已知问题与注意事项

1. **`.gitignore` 排除了 `AGENT-PROGRESS.md` 与 `.codebuddy/`**（第 105/106 行）。本文件仅本地生效，不在远端。
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

---

## 七、下次会话建议

1. **🟡 治理**
   - `.gitignore` 双源问题：是否豁免本文件与 `.codebuddy/` 进库？
   - 评审记录沉淀、release-template.md 模板。

2. **🟠 P1 待办**
   - build.yml matrix 化（合并三 job 重复定义）。
   - 规则一致性自动校验。

3. **🟢 长期**
   - 规则演进（ESLint / OpenSpec / 双市场发布等按需扩展）。

---

> 维护提示：完成重要工作后，更新「已完成的变更」「待实施的变更」「已知问题」「下次会话建议」，并刷新顶部元数据。
