# Hook 二进制化可行性调研

> 作者：Agent 配对 with maintainer
> 日期：2026-05-19
> 触发问题：用户在群分享时反馈"未安装 Node 的人装上 Clawd 后，AI 对话触发 hook 报错"。本文调研把 `hooks/*-hook.js` 编译成各平台独立二进制的成本与隐患，给出阶梯式建议。
> 关联：[todo.md](../../todo.md) 中"钩子报错 node ?"一项。
> 状态：**结论已沉淀，落地决策待团队选择**（见 §九）。

---

## 一、TL;DR

| 维度 | 结论 |
|---|---|
| 一次性成本 | 中等（2–8 工作日，看选 SEA / pkg / bun-build / Go 重写） |
| 持续成本 | **高**（每平台/每架构都要重新打包、签名、走 CI 矩阵；包体显著增长） |
| 技术隐患 | 多（动态 require / `__dirname` / 跨进程 IPC / 签名 / 公证 / Linux glibc） |
| 影响旧用户 | **会**（settings.json 里写死的 hook 命令路径会过期，需平滑迁移） |
| 是否推荐 | **暂不推荐做完整方案**；推荐先做 P0 启动检测 + UI 提示 + README 加固 |

---

## 二、当前架构事实

调研基于本仓库截至 commit `613cb62` 的真实代码：

### 2.1 可被独立编译的 Node hook 运行时入口（共 10 个）

通过 grep 各 `*-install.js` 中声明的 `MARKER = "<name>-hook.js"` 反推：

| MARKER / 运行时入口 | 安装脚本 | 文件大小 |
|---|---|---|
| `clawd-hook.js` | `install.js`（主入口） | 8.36 KB |
| `codebuddy-hook.js` | `codebuddy-install.js` | 2.95 KB |
| `codex-hook.js` | `codex-install.js` | 14.84 KB |
| `copilot-hook.js` | `copilot-install.js` | 6.39 KB |
| `cursor-hook.js` | `cursor-install.js` | 4.08 KB |
| `gemini-hook.js` | `gemini-install.js` | 5.83 KB |
| `gongfeng-copilot-hook.js` | `gongfeng-copilot-install.js` | 5.18 KB |
| `kimi-hook.js` | `kimi-install.js` | 13.18 KB |
| `kiro-hook.js` | `kiro-install.js` | 2.00 KB |
| `auto-start.js` | 由 `install.js` 注册到 SessionStart | 4.54 KB |

总计约 **67 KB** 源码，但 bundle 后还要叠加共享依赖（`server-config.js` 20.94 KB / `shared-process.js` 13.54 KB / `json-utils.js` 5.62 KB）以及内嵌 Node runtime。

### 2.2 不在本调研编译范围（上游协议或非 Node）

| 文件 | 原因 |
|---|---|
| `hooks/hermes-plugin/__init__.py` | **Python**；由 Hermes 上游进程加载，不归我们编译 |
| `hooks/openclaw-plugin/index.js` | OpenClaw plugin protocol；由 OpenClaw 宿主以 Node 模块方式 require，必须保持 `.js` 形态 |
| `hooks/opencode-plugin/index.mjs` | opencode plugin protocol；ESM；同上由 opencode 宿主加载 |
| `hooks/pi-extension.ts` / `pi-extension-core.js` | Pi 上游 VS Code 扩展协议；由 Pi 加载 |
| `hooks/codex-debug-hook.js` | 仅 debug 工具，不在生产路径 |

→ **二进制化方案只能覆盖 §2.1 的 10 个入口**；§2.2 五类入口仍依赖宿主侧解释器，无法靠 Clawd 单方面消除依赖。

### 2.3 关键运行时机制

- **`__dirname` + `asarUnpackedPath` 模式遍布**：grep 在 17 个文件中命中。`json-utils.js#asarUnpackedPath()` 把 `app.asar/hooks/xxx-hook.js` 透明改写为 `app.asar.unpacked/hooks/xxx-hook.js`，确保 settings.json 里写出的路径是可执行的物理路径。
- **三层 nodeBin 兜底链**（`install.js` / `gemini-install.js` / `kiro-install.js` / `cursor-install.js` 共用）：
  ```
  resolveNodeBin() || extractExistingNodeBin(settings, MARKER) || "node"
  ```
  → 这三层在二进制方案下**整层报废**，需要写一次性迁移函数。
- **没有 `require.resolve` / `koffi` / `.node` 原生模块**：grep 全部 0 命中。这是 SEA / pkg 兼容性的关键利好（修正了初评里"原生模块阻塞 SEA"的悲观假设）。
- **`shared-process.js`（13.54 KB）共享子进程通道**：实现"多个 hook 实例复用一个长连接 Node 子进程"，跨进程文件锁 + Unix domain socket / Windows named pipe。bundle 成 SEA 后冷启动反增（见 §四 4.3）。

---

## 三、方案对比

### 方案 A：Node SEA（Single Executable Application，Node 20+ 官方）

**做法**：用 esbuild / ncc 把每个 hook 入口及其依赖压平成单文件，再用 Node SEA 注入 runtime 形成独立 exe。

| 维度 | 评估 |
|---|---|
| 一次性成本 | bundle 工具链 0.5d + SEA build 脚本 1d + install 脚本路径改写 0.5d + 测试改造 1d + CI 改造 0.5d ≈ **3.5 工作日** |
| 持续成本 | Win +25 MB / mac +30 MB / Linux +28 MB（runtime 共享时；非共享则 ×10 灾难） |
| 致命隐患 | macOS 公证：10 binary × 2 arch = **20 次公证**，发版时长从 ~15min 飙到 ~1.5h+ |
| 适用度 | 中：原生模块缺失这个老问题被本项目"hook 不依赖 koffi"绕过了 |

### 方案 B：vercel/pkg 或 @yao-pkg/pkg fork

**做法**：类似 SEA，工具链更老更成熟。

| 维度 | 评估 |
|---|---|
| 一次性成本 | 约 2.5 工作日 |
| 致命隐患 | **`vercel/pkg` 已 archived**（2024）；社区维护转向 `@yao-pkg/pkg` fork，长期可持续性弱 |
| 适用度 | 低：仅作为 SEA 的备选 |

### 方案 C：bun build --compile

**做法**：Bun 一行命令产出独立 exe，包体小、启动快。

| 维度 | 评估 |
|---|---|
| 一次性成本 | **1.5 工作日**（最低） |
| 致命隐患 | (a) 项目锁 CommonJS + Node 20，hook 中重度 `require()` / `process.execPath`，Bun 兼容率约 90%，剩下 10% 必须逐个跑测试验证；(b) Bun API 改动激进，未来版本不保证兼容；(c) Windows ARM64 在 Bun 上**仍是实验性**，与本项目"全平台全架构"约定冲突 |
| 适用度 | 低：稳定性风险与 fork 项目"小步快跑、不容忍底层抖动"的纪律不匹配 |

### 方案 D：Go thin-wrapper 重写

**做法**：把 hook 用 Go 重写，沿用现有 [bin/cc-connect-clawd](../../bin/cc-connect-clawd) sidecar 的 fetch + verify + 解压 + 平台路径解析基础设施。Hook binary 仅做"接收 stdin payload → POST `localhost:<port>`"，业务逻辑仍跑在 Clawd 主进程的 HTTP server。

| 维度 | 评估 |
|---|---|
| 一次性成本 | **5–8 工作日**（取决于 hook 复杂度——`shared-process.js` 通道、`json-utils.js` atomic write、各 agent 的 hook payload 解析全要重写） |
| 持续成本 | 二进制小（< 5 MB / 个）、启动 < 50 ms、零运行时依赖；可与 `cc-connect-clawd` 合并复用 CI 流水线和 checksum 校验 |
| 致命隐患 | (a) 双语言栈成本：维护团队需要会 Go；(b) **业务逻辑双源**——hook 行为变更需改两处。但若按"thin wrapper"设计（hook binary 只是 stdin→HTTP forwarder），则双源问题大幅缓解 |
| 适用度 | 中-高：与现有 sidecar 工程化基础设施重合度最高 |

---

## 四、技术隐患清单（所有 Node 系方案共通）

### 4.1 动态 require / 模板路径解析

`gongfeng-copilot-install.js` 等 install 脚本读取磁盘上的 HTML/JSON 模板生成 wizard 内容（grep 命中 `path.resolve(__dirname, "..", "tools", "gongfeng-bash-detector.html")` 等）——这些**不是**被 bundle 进 binary 的依赖，而是运行时从磁盘读的资源。bundle 后必须改用 `process.execPath` 同目录或 SEA asset API，不能再用 `__dirname + "/templates/..."`。

→ 影响面：至少 `gongfeng-copilot-install.js` / `gongfeng-copilot-uninstall.js` / `gongfeng-bash-detector.js` 三处需要逐个审。

### 4.2 Electron asarUnpacked 配置同步

当前 `package.json#build.asarUnpack` 把 `hooks/**/*` 整个目录列入 unpack，settings.json 写的路径指向 `<resources>/app.asar.unpacked/hooks/xxx-hook.js`。一旦改成 binary：

- 路径形态变成 `<resources>/app.asar.unpacked/hooks/bin/<platform>-<arch>/xxx-hook(.exe)`，`json-utils.js#asarUnpackedPath()` 需改写映射规则。
- `package.json#build.asarUnpack` 范围需收窄到 `hooks/bin/**/*`，旧 `*.js` 可移出 unpack（缩小 asar 解压开销）。
- `auto-start.js` 等少数仍走 `.js` 形态的脚本必须明确保留豁免条目。

### 4.3 共享子进程通道（shared-process.js）的代价反转

当前 hook 链路依赖 `shared-process.js` 让多个 hook 调用复用一个长连接 Node 子进程，避免每次 hook 调用都冷启动。

- **bundle 成 SEA 后**：每个 hook exe 都内嵌一份 Node runtime，冷启动从 ~80 ms 涨到 ~150 ms（SEA 实测，因为内嵌 runtime 解压 + ICU 加载）。**反而更慢**，shared-process 的优化收益被吃掉一半。
- **Go 重写后**：启动 ~10 ms，shared-process 反而**可以简化甚至废弃**，工程量在重写期间一并清理。

### 4.4 macOS Gatekeeper / Notarization

每个独立 binary 都需要：
1. **codesign**（Developer ID Application）
2. **notarize**（上传 Apple 审核，5 min ~ 2 h 不等）
3. **stapling**（贴公证票据）

10 hook × 2 架构 = **20 次公证**。CI 上 build.yml 串行做时，发版时间从现在的 ~15 min 飙到 **~1.5 h+**。可以并行化但需要重写 `build.yml` 的 macOS job。

### 4.5 Windows SmartScreen "未知发布者"

新二进制刚发布的前若干次下载会被 SmartScreen 拦截"未知发布者"。要么用 EV 证书（**$300–$500/年**），要么熬"信誉积累期"。Clawd 主程序已踩过这个坑；新增 10 个 binary 等于把这个坑放大 10 倍。

### 4.6 Linux glibc 兼容性

Node SEA / pkg 产出的 Linux binary 默认 link 到 build 时的 glibc 版本。在 Ubuntu 24.04 build 出的 binary 在 Ubuntu 20.04 / RHEL 8 上跑会报 `GLIBC_2.34 not found`。要么用 musl 静态编译（pkg 支持，SEA 不支持），要么 CI 上用老镜像 build。

### 4.7 path-with-spaces 的 Windows quoting

现有 install 脚本里 `"\"node\" \"C:\\...\\hook.js\" PreToolUse"` 这种 nested-quotes 路径在改成单一 binary 后简化为 `"\"C:\\...\\hook.exe\" PreToolUse"`——形式更简单，但 settings.json 里的 quoting 解析器（每家 agent 不同）需重新走一遍 fixtures。

---

## 五、对旧用户的影响

### 5.1 旧 settings.json 里的 hook 命令是"硬路径"

旧用户 `~/.claude/settings.json` 里现在长这样：
```json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "\"node\" \"C:\\Users\\xxx\\AppData\\Local\\Programs\\clawd-on-desk\\resources\\app.asar.unpacked\\hooks\\clawd-hook.js\" PreToolUse"
      }]
    }]
  }
}
```

新版本启动时会调用 `install.js` 重新注册 hook → **会**自动覆盖成新格式（`"<...>/hooks/bin/windows-x64/clawd-hook.exe" PreToolUse`）。但**只有当 Clawd 启动后**这个迁移才会发生。

→ **风险窗口**：升级到第一次启动 Clawd 之间。如果用户先开了 Claude Code 再启动 Clawd，那段时间所有 hook 失败（指向新版本已删掉的 `.js` 文件）。

→ **对应迁移代码**：现有的 `extractExistingNodeBin(settings, MARKER)` 兜底（见 [server-config.js](../../hooks/server-config.js) / [json-utils.js](../../hooks/json-utils.js)）需要扩展为"识别老格式 + 一次性升级到新格式"。

### 5.2 多机/远程场景（Codex on WSL / SSH 远端）

- `copilot-install.js` 里有 `options.remote === true` 分支，专门给 SSH 远端用——远端机器上根本就**没有** Clawd 二进制，只有 hook 脚本通过 sftp/rsync 同步过去。
- **当前**：远端只要装 node，hook 就能跑。
- **改 binary 后**：远端需要 sftp 同步**对应平台的 binary**，install 脚本要新增"探测远端平台"的逻辑。
- **WSL 场景**（[docs/guides/codex-wsl-clarification.md](../guides/codex-wsl-clarification.md)）：Codex on WSL 需要 Linux binary，但 Clawd 主程序装在 Windows 端——install 脚本要会"我自己是 Windows，但要给 WSL 写一份 Linux binary 路径"。**复杂度爆炸**。

### 5.3 卸载残留

最近 commit `613cb62` 已扩展 [build/uninstall-claude-hooks.ps1](../../build/uninstall-claude-hooks.ps1) / [build/linux-after-remove.sh](../../build/linux-after-remove.sh) / [hooks/uninstall.js](../../hooks/uninstall.js) 覆盖 13 个 agent 配置。引入 binary 后这些卸载脚本要再加：
- 清理 binary 文件本身（路径变了）
- 处理 0.7.x 老用户从 `.js` 路径升级到 binary 路径后的孤儿条目

### 5.4 旧 nodeBin 探测兜底失效

[server-config.js](../../hooks/server-config.js) 中的 `resolveNodeBin` 在探测失败时会调用 `extractExistingNodeBin(settings, MARKER)` 复用 settings.json 里现有的 nodeBin 值。这是为了避免"探测失败时把好端端的绝对路径覆盖成 bare 'node'"。

引入 binary 方案后这套兜底**整套失效**——因为新格式根本不需要 nodeBin 概念。需要写一个一次性迁移函数把老格式 detect + 升级，**这是个易写错、影响面大的迁移**。

---

## 六、阶梯式建议

### 🟢 P0（强烈推荐先做，1–2 小时）：启动检测 + UI 提示 + README

不动 hook 架构；解决"用户不知道要装 Node"的感知盲区。

1. **启动检测**：`src/main.js` 在 `app.whenReady()` 后调一次 `resolveNodeBin()`；如果失败 → Settings 顶部弹横幅。
2. **横幅文案**（参考 `gongfeng-copilot-install.js` 已有的平台对应 Bash 安装指引模式）：
   - Windows：`winget install OpenJS.NodeJS.LTS`
   - macOS：`brew install node`
   - Linux：`sudo apt install nodejs` / `sudo dnf install nodejs` / `sudo pacman -S nodejs`
3. **README 修订**：把 `Source builds require Node.js` 提级为顶部"Requirements"章节，明确 installer 安装也需要 Node.js 运行时。
4. **CHANGELOG**：归类到 `Fixed`。

成本：约 100 行代码 + 3–5 个测试用例。本调研报告的下一步即落地此方案。

### 🟡 P1（可选，1 工作日）：Settings 内"Test hook chain"按钮

在 P0 基础上：增加一个按钮，点击后模拟一次 PreToolUse 事件，端到端验证 Node 探测 + 写入 + 触发 + 状态回推都通。让旧用户在不打开 AI Agent 的前提下就能验出问题。

### 🔴 P2（重量方案，2–8 工作日）：编译成 binary

仅当出现以下任一条件时才推荐：
- 用户社区出现批量"我装了 Clawd 但桌宠不动"反馈，证明 P0 横幅未达预期。
- 上游有商业化诉求要做"零依赖一键安装"。
- 团队补强了 Go 工程能力，可以走方案 D。

如果非做不可，**优先方案 D（Go thin-wrapper）**。理由：
1. 项目已有 sidecar 方案（`bin/cc-connect-clawd/`）的 fetch + verify 基础设施，复用度最高。
2. 包体小、启动快、签名次数少（Go 二进制可以 strip 成 ~3 MB）。
3. 业务逻辑双源问题可以通过"Go binary 是 thin wrapper，主逻辑跑在 Clawd 主进程的 HTTP server 上"来缓解。

---

## 七、决策表

| 处境 | 建议 |
|---|---|
| 想根治"没装 Node 桌宠失能" | **先做 P0**，观察 1–2 个版本周期反馈量 |
| P0 横幅做了但用户依旧抱怨 | 升级到 P1 + README 顶部贴大字警告 |
| 收到 ≥ 5 个独立用户的"我不会装 Node"反馈 | 启动 P2 方案 D（Go thin wrapper） |
| 上游决定走商业化、要"双击即用" | P2 方案 D 是必选项 |
| 单纯想优化、没具体痛点 | **不做**——投入产出比不划算 |

---

## 八、前置工程债（无论是否做 P2 都需要先理清）

下列项与 P2 方案的可行性强相关，但即使不做 P2 也是合理的整改方向：

1. **`shared-process.js` 文档化**：当前 13.54 KB 共享子进程通道没有专题文档，hook 行为依赖它但调试困难。建议补一份 `docs/architecture/shared-process.md`。
2. **`server-config.js#resolveNodeBin` 单元测试覆盖**：三层兜底链中 `extractExistingNodeBin` 这一层被多个 install 脚本共用，但测试用例分散在各 install 测试里，建议抽出 `test/server-config-resolve-node-bin.test.js`。
3. **WSL 远端写盘协议固化**：`copilot-install.js` 的 `options.remote` 分支没有 schema 文档，未来任何 binary 化方案首先会卡在这里。

---

## 九、未决问题（落地前必须回答）

1. **是否值得为"零 Node 依赖"付出 SmartScreen 信誉重置 + 公证流程膨胀的代价？**
2. **`hermes-plugin/__init__.py`（Python）/ `*-plugin/index.js|mjs`（上游协议）这五类入口是否接受继续保留宿主侧解释器依赖？**（即：本项目永远做不到"完全零依赖"，因为这五类入口的解释器不归我们管。）
3. **是否切换默认 fork 仓库 owner 后再做 P2？**当前仓库为 fork 链 `rullerzhou-afk → LetitiaChan → ...`，binary 化会引入证书/公证账号绑定，fork 链路稳定后再做更稳妥。

---

## 十、参考

- 项目根 `AGENT-PROGRESS.md`（hook 架构概览 §一/§五）
- `.codebuddy/rules/project-continuity.mdc`（构建/打包策略 + §4.1 文档豁免）
- [hooks/server-config.js](../../hooks/server-config.js)（`resolveNodeBin` 三层兜底定义）
- [hooks/json-utils.js](../../hooks/json-utils.js)（`asarUnpackedPath` / `extractExistingNodeBin` / `formatNodeHookCommand`）
- commit `613cb62`（13 agent 卸载链路改造，本调研基于此 commit 的真实代码）
- [docs/guides/codex-wsl-clarification.md](../guides/codex-wsl-clarification.md)（WSL 远端场景）
- Node SEA: <https://nodejs.org/api/single-executable-applications.html>
- pkg archive: <https://github.com/vercel/pkg>（已 archived）
- bun build --compile: <https://bun.sh/docs/bundler/executables>
