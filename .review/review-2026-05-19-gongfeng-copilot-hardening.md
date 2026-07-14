# 评审记录：Gongfeng Copilot 集成加固

## 元数据

| 字段 | 值 |
|------|-----|
| **日期** | 2026-05-19 |
| **触发原因** | Gongfeng Copilot 功能上线前全面评审 |
| **涉及模块** | `agents/gongfeng-copilot.js`, `hooks/gongfeng-copilot-hook.js`, `hooks/gongfeng-copilot-install.js`, `hooks/gongfeng-copilot-uninstall.js`, `hooks/uninstall.js`, `build/uninstall-claude-hooks.ps1`, `build/linux-after-remove.sh`, `src/main.js` |
| **评审人** | Agent (CodeBuddy) |
| **关联 commit** | `ac5bfda`, `521dc74`, `be4d67c` |

---

## 发现的问题

### P0（阻断性 / 数据丢失 / 安全）

| # | 问题描述 | 影响范围 | 修复 commit |
|---|----------|----------|-------------|
| P0-1 | `agents/gongfeng-copilot.js` 的 `eventMap.afterAgentResponse` 映射为 `idle`，导致纯文本流式输出阶段桌宠无反应 | 用户体验：桌宠在 Agent 回复时静止不动 | `521dc74` |
| P0-2 | 卸载脚本未清理 `~/.gongfeng-copilot/hooks/clawd` 本地 stub 目录，卸载后残留文件 | 卸载完整性：残留文件可能干扰后续安装 | `ac5bfda` |
| P0-3 | `build/uninstall-claude-hooks.ps1` 和 `build/linux-after-remove.sh` 的 marker 列表缺少 `gongfeng-copilot-hook.js` | 系统卸载：NSIS/deb 卸载时不会清理 Gongfeng Copilot hook | `ac5bfda` |

### P1（功能缺陷 / 用户可感知）

| # | 问题描述 | 影响范围 | 修复 commit |
|---|----------|----------|-------------|
| P1-5 | `gongfeng-copilot-hook.js` 缺少硬超时保护，可能产生僵尸进程 | 系统资源：hook 进程挂起不退出 | `ac5bfda` |
| P1-6 | hook 的 stderr 诊断日志无条件输出，污染插件 UI | 用户体验：IDE 输出面板出现无关日志 | `ac5bfda` |
| P1-7 | `checkExistingClawdHooks` 和 `collectClawdHooks` 优先读 `hooks-cache.json` 而非 `hooks.json`，可能读到过期数据 | 安装/卸载准确性：操作基于过期缓存 | `ac5bfda` |

### P2（代码质量 / 可维护性）

| # | 问题描述 | 影响范围 | 修复 commit |
|---|----------|----------|-------------|
| P2-8 | `src/main.js` 的全局崩溃守卫（`uncaughtException` / `unhandledRejection`）注册位置过晚，无法覆盖早期初始化阶段的异常 | 稳定性：早期崩溃无法被捕获和记录 | `ac5bfda` |

---

## 修复方案

### P0-1: afterAgentResponse 映射错误

- **方案**：将 `eventMap.afterAgentResponse` 从 `idle` 改为 `thinking`，与 hook 运行时的 `HOOK_TO_STATE` 映射保持一致
- **改动文件**：`agents/gongfeng-copilot.js`
- **commit**：`521dc74`

### P0-2: 卸载残留 stub 目录

- **方案**：`hooks/gongfeng-copilot-uninstall.js` 新增 `removeLocalStubDir()` 导出函数 + `LOCAL_STUB_DIR` 常量；`hooks/uninstall.js` 的 `uninstallAllAgents` 调用该函数
- **改动文件**：`hooks/gongfeng-copilot-uninstall.js`, `hooks/uninstall.js`
- **commit**：`ac5bfda`

### P0-3: 系统卸载脚本 marker 缺失

- **方案**：在 `build/uninstall-claude-hooks.ps1` 的 `ClawdCommandMarkers` 和 `build/linux-after-remove.sh` 的 `CLAWD_MARKERS` 中追加 `gongfeng-copilot-hook.js`；同时补充 `~/.gongfeng-copilot/hooks/clawd` 的递归删除逻辑
- **改动文件**：`build/uninstall-claude-hooks.ps1`, `build/linux-after-remove.sh`
- **commit**：`ac5bfda`

### P1-5: hook 缺少硬超时

- **方案**：声明 `HOOK_HARD_TIMEOUT_MS` 常量，使用 `setTimeout(...).unref()` 设置硬超时，超时后强制退出进程
- **改动文件**：`hooks/gongfeng-copilot-hook.js`
- **commit**：`ac5bfda`

### P1-6: stderr 日志无条件输出

- **方案**：所有 stderr 诊断日志改为受 `CLAWD_HOOK_DEBUG` 环境变量控制，默认不输出
- **改动文件**：`hooks/gongfeng-copilot-hook.js`
- **commit**：`ac5bfda`

### P1-7: hooks.json 优先级错误

- **方案**：`checkExistingClawdHooks`（install）和 `collectClawdHooks`（uninstall）改为优先读 `hooks.json`，仅当其不存在时才 fallback 到 `hooks-cache.json`；返回值增加 `source` 字段标识数据来源
- **改动文件**：`hooks/gongfeng-copilot-install.js`, `hooks/gongfeng-copilot-uninstall.js`
- **commit**：`ac5bfda`

### P2-8: 崩溃守卫注册过晚

- **方案**：将 `process.on("uncaughtException")` 和 `process.on("unhandledRejection")` 的注册移到 `app.commandLine.appendSwitch` 之前，确保覆盖最早期的初始化阶段
- **改动文件**：`src/main.js`
- **commit**：`ac5bfda`

---

## 验证方式

| 问题 | 验证手段 | 结果 |
|------|----------|------|
| P0-1 | `test/code-review-hardening-2026-05-19.test.js` — 断言 `eventMap.afterAgentResponse === "thinking"` | ✅ |
| P0-2 | 同上 — `removeLocalStubDir` 导出检查 + 实际删除/不存在两种场景 | ✅ |
| P0-3 | 同上 — 读取 ps1/sh 文件内容断言包含 marker + 删除逻辑 | ✅ |
| P1-5 | 同上 — 断言 hook 源码含 `HOOK_HARD_TIMEOUT_MS` + `setTimeout` + `unref` | ✅ |
| P1-6 | 同上 — 断言 hook 源码含 `CLAWD_HOOK_DEBUG` 环境变量守卫 | ✅ |
| P1-7 | 同上 — 模拟 `hooks.json` / `hooks-cache.json` 优先级场景 | ✅ |
| P2-8 | 同上 — 断言 `uncaughtException` handler 在 `appendSwitch` 之前 | ✅ |

### 回归测试文件

- `test/code-review-hardening-2026-05-19.test.js` — 覆盖全部 P0/P1/P2 问题的结构性不变式断言

---

## 沉淀的经验

| 经验 | 沉淀位置 | 条目编号 |
|------|----------|----------|
| 不变式测试区分结构性 vs 内容性：结构可锁死，内容只锁到领域语义级 | AGENT-PROGRESS.md §六 | #15 |
| 探测类代码三原则：多重冗余 + 永不静默吞错 + 诊断面板 | AGENT-PROGRESS.md §六 | #16 |

---

## 后续待办

- [x] 所有问题已通过回归测试覆盖
- [x] 经验已沉淀到 AGENT-PROGRESS.md §六
- [x] 评审记录正式沉淀到 `.review/` 目录（本文件）
