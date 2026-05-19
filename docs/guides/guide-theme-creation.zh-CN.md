# 主题创建与安装指南

安装已下载的 Clawd 主题，或创建属于你自己的桌宠主题，包含自定义角色和动画。

## 安装已下载的主题

Clawd 主题是一个顶层包含 `theme.json` 的文件夹。文件夹名即为主题 id；Clawd 中显示的名称取自 `theme.json.name`。

1. 下载、克隆或解压主题。

2. 确保文件夹结构正确：
   ```text
   pixel-cat/
     theme.json
     assets/
       idle.png
       working.gif
       ...
   ```
   如果解压后出现 `pixel-cat/pixel-cat/theme.json`，请将内层文件夹移动到主题目录中。

3. 将主题文件夹放入 Clawd 用户主题目录：
   - Windows：`%APPDATA%/clawd-on-desk/themes/pixel-cat/`
   - macOS：`~/Library/Application Support/clawd-on-desk/themes/pixel-cat/`
   - Linux：`~/.config/clawd-on-desk/themes/pixel-cat/`

4. 打开 `Settings...` -> `Theme` 并选择该主题。如果 Clawd 已经在运行且主题未出现，请重启 Clawd。

避免使用与内置主题相同的文件夹 id（`clawd`、`calico` 或 `cloudling`）。内置主题会优先于同 id 的用户主题。

## 创建新主题

1. 使用脚手架生成主题：
   ```bash
   node scripts/create-theme.js my-theme
   ```
   脚本默认写入 Clawd 用户主题目录：
   - Windows：`%APPDATA%/clawd-on-desk/themes/my-theme/`
   - macOS：`~/Library/Application Support/clawd-on-desk/themes/my-theme/`
   - Linux：`~/.config/clawd-on-desk/themes/my-theme/`
   - 不带参数也可以：会自动创建下一个可用的 `my-theme` 脚手架

2. （可选）自定义生成的元数据：
   ```bash
   node scripts/create-theme.js pixel-cat --name "Pixel Cat" --author "Your Name"
   ```

3. 编辑 `theme.json` —— 设置主题名称、作者和文件映射

4. 在 `assets/` 文件夹中创建你的素材

5. 打开 `Settings...` -> `Theme` 并选择你的主题。如果新文件夹未显示，请重启 Clawd。

6. （可选）验证：
   ```bash
   node scripts/validate-theme.js ~/.config/clawd-on-desk/themes/my-theme
   ```

如果你更喜欢手动操作，直接复制 `themes/template/` 也可以。脚手架脚本只是自动化了相同的起点，并帮你填写 `name` / `author`。

## 主题目录结构

```
my-theme/
  theme.json              ← 配置文件（必需）
  assets/
    idle-follow.svg       ← 带眼球追踪的待机动画（仅当 idle 在 eyeTracking.states 中时需要 SVG）
    thinking.gif          ← 支持任意格式：SVG、GIF、APNG、WebP、PNG、JPG、JPEG
    typing.gif
    error.gif
    happy.gif
    notification.gif
    sleeping.gif
    waking.gif
    ...                   ← 额外动画（反应、层级等）
  sounds/                 ← 可选的主题音频文件
    complete.mp3
    confirm.mp3
```

## 创作层级

### 入门：替换美术素材 + GIF 动画（数小时）

**最小可行主题取决于你的能力开关设置。**

1. 从 `themes/template/` 开始
2. 选择是否需要眼球追踪：
   - `eyeTracking.enabled: true` → `idle` 素材必须是 SVG 并包含 `#eyes-js`
   - `eyeTracking.enabled: false` → idle 也可以是 GIF / APNG / WebP / PNG / JPG / JPEG
3. 使用 [Piskel](https://www.piskelapp.com/)（免费，浏览器端）或 [Aseprite](https://www.aseprite.org/)（付费，像素美术专业工具）为其他状态创建简单帧动画（4-12 帧）
4. 导出为 APNG / WebP / GIF，或使用单帧 PNG / JPG / JPEG 作为静态姿势
5. 更新 `theme.json` 指向你的文件

**推荐的角色美术工作流：**
- AI 图像生成（Midjourney、Stable Diffusion）→ 透明 PNG
- 或在任何像素美术编辑器中手绘
- 使用 [remove.bg](https://www.remove.bg/) 或 `rembg`（Python CLI）去除背景

### 中级：完整动画集（1-2 天）

包含入门级全部内容，加上：
- 自定义工作层级（typing → juggling → building）
- 点击反应（左/右戳、双击挣扎）
- 待机随机动画（阅读、四处张望）
- 入睡序列（打哈欠 → 倒下 → 入睡）
- Mini 模式支持（8 个额外的迷你动画）

### 高级：完整 SVG + CSS 动画（无限可能）

跳过模板，直接将所有动画编写为 SVG + CSS `@keyframes`：
- 无限缩放（任何缩放级别都不会像素化）
- CSS 动画控制（时间、缓动、迭代）
- SVG 滤镜效果（模糊、发光、投影）
- 参考仓库中的 `assets/svg/clawd-*.svg` 作为示例

### 外部主题运行时限制

外部主题被视为不可信输入。用户主题中的 SVG 文件在渲染前会进行消毒处理：

- `<script>`、事件处理属性（如 `onclick`）、`javascript:` URL、外部资源 URL、绝对路径和路径穿越引用会被移除
- `<style>` 中的 CSS 动画是允许的，但 `@import` 和不安全的 `url(...)` 引用会被移除
- `url(#local-id)` 片段引用（用于滤镜、遮罩、渐变和标记）是允许的

不要构建依赖 SVG 文件内 JavaScript 的用户主题。内置 Cloudling 主题使用 `trustedRuntime.scriptedSvgFiles`，但该能力仅对从 Clawd 的打包/仓库 `themes/` 目录加载的主题生效。如果外部主题声明了 `trustedRuntime`，Clawd 会忽略它。

## theme.json 参考

### 必需字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | `1` | 必须为 `1` |
| `name` | string | 显示名称 |
| `version` | string | 语义化版本（如 `"1.0.0"`） |
| `viewBox` | object | `{ x, y, width, height }` — SVG 单位的逻辑画布 |
| `states` | object | 将状态名映射到文件数组或 `{ files, fallbackTo }` 对象（见下文） |

### 常用元数据

这些字段是可选的，但通常很有用：

| 字段 | 类型 | 说明 |
|------|------|------|
| `author` | string | 主题作者的显示名称 |
| `description` | string | 向用户展示的简短描述 |
| `license` | string | 仅作为显示元数据的自由文本。仅用于你拥有的素材；它本身不会覆盖打包美术品的实际版权。 |

### 必需状态

当前验证器/运行时基线要求这些核心状态：

| 状态 | 触发时机 | 备注 |
|------|----------|------|
| `idle` | 无 agent 活动 | 必须有真实文件。仅当 idle 列在 `eyeTracking.states` 中时必须是 SVG |
| `thinking` | 用户提交提示 | 必须有真实文件 |
| `working` | Agent 使用工具 | 必须有真实文件。单会话回退的基础工作文件 |
| `sleeping` | 入睡序列之后 | 必须存在，可以是真实文件或 `fallbackTo` |
| `waking` | 鼠标唤醒 | 仅当 `sleepSequence.mode` 为 `full` 时必需 |

### 其他常用状态

这些是常见的可选状态，当你想为这些事件提供不同的视觉效果时可以添加：

| 状态 | 触发时机 | 备注 |
|------|----------|------|
| `yawning` | 入睡序列开始 | |
| `dozing` | 打哈欠之后 | 仅当 `dozing` 列在 `eyeTracking.states` 中时使用 SVG |
| `collapsing` | 正在入睡 | |
| `error` | 工具失败 | |
| `attention` | 任务完成 | |
| `notification` | 权限 / 提醒 | |
| `sweeping` | 上下文压缩 | |
| `carrying` | 工作树创建 | |
| `juggling` | 子代理活跃 | 如果你想要不同的杂耍视觉效果，声明此状态和/或 `jugglingTiers` |

### 可选更新视觉效果

主题可以可选地声明更新器特有的视觉效果，而不引入新的运行时状态：

```json
"updateVisuals": {
  "checking": "checking-special.svg"
}
```

- `updateVisuals.checking` 是可选的
- 存在时，它会覆盖更新 `checking` 期间使用的视觉效果
- 省略时，更新检查回退到主题的 `thinking` 状态
- 发现新版本时，更新器使用主题的 `notification` 状态
- 下载 / 成功 / 错误仍使用正常的 `carrying` / `attention` / `error` 状态绑定

主题也可以声明一个可选的稳定更新器锚点，如果不想让更新气泡跟随每个状态的点击区域：

```json
"updateBubbleAnchorBox": { "x": -4, "y": -3, "width": 23, "height": 20 }
```

- `updateBubbleAnchorBox` 是可选的
- 使用与点击区域和 `layout.contentBox` 相同的 viewBox 坐标系
- 存在时，更新气泡在所有更新器阶段都锚定到此区域
- 省略时，更新器回退到 `layout.marginBox`，然后 `layout.contentBox`，然后当前点击区域
- 这主要用于不提供完整 `layout` 块但仍想要稳定更新气泡间距的第三方主题

如果 `sleepSequence.mode` 为 `full`（默认值），`yawning`、`dozing`、`collapsing` 和 `waking` 也需要真实文件。如果 `sleepSequence.mode` 为 `direct`，这些额外的入睡序列文件是可选的，桌宠可以直接进入 `sleeping`。

### 眼球追踪

眼球追踪让角色跟随用户的光标。它要求 idle SVG 包含特定的元素 ID。

```json
"eyeTracking": {
  "enabled": true,
  "states": ["idle"],
  "ids": {
    "eyes": "eyes-js",
    "body": "body-js",
    "shadow": "shadow-js"
  }
}
```

**工作原理：**
- `#eyes-js` — 接收 `translate(dx, dy)` 来跟随光标（最大 3px）
- `#body-js` — 接收较小的位移实现微妙的身体倾斜（可选）
- `#shadow-js` — 接收位移 + scaleX 实现阴影朝光标方向拉伸（可选）

**禁用眼球追踪：** 设置 `"enabled": false`。所有状态都可以使用任意格式（SVG、GIF、APNG、WebP、PNG、JPG、JPEG）。你的 idle 动画将直接循环播放，不会跟随光标。

高级 SVG 主题可以使用 `eyeTracking.trackingLayers` 代替旧的单一 `ids` 映射，当不同的角色图层需要不同的光标跟随强度时。参见 `themes/calico/theme.json` 中的工作示例。

### 能力开关

现有的 schema 字段是唯一的运行时真相。它们已经充当主题的能力开关：

| 字段 | 当前含义 |
|------|----------|
| `eyeTracking.enabled` | 全局眼球追踪开/关。`false` 时，状态不需要为了光标追踪而使用 SVG。 |
| `eyeTracking.states` | 按状态的眼球追踪白名单。仅列出的状态必须是 SVG 并使用对象通道。 |
| `miniMode.supported` | 为该主题启用 mini 模式。`false` 时，Mini Mode 在菜单/托盘和边缘吸附路径中被屏蔽。 |
| `idleAnimations` | 可选的 idle 随机池。省略或留空则保持 `states.idle[0]`。 |
| `reactions` | 可选的点击/拖拽反应块。省略它以完全禁用点击和拖拽反应。 |
| `workingTiers` | 可选的多会话工作覆盖。省略则回退到 `states.working[0]`。 |
| `jugglingTiers` | 可选的子代理杂耍覆盖。省略则回退到 `states.juggling[0]`（如果你提供了该状态）。 |

加载器还会从这些字段派生只读元数据（如 `idleMode`：`tracked` / `animated` / `static`），但该元数据不是第二个 schema 权威来源。

### 状态视觉回退

状态绑定接受旧版数组形式，或带有 `files` 和可选 `fallbackTo` 的对象：

```json
"states": {
  "attention": ["happy.gif"],
  "error": { "fallbackTo": "attention" },
  "carrying": { "fallbackTo": "working" },
  "sleeping": { "files": ["sleeping.gif"] }
}
```

- `files` — 状态自身的素材
- `fallbackTo` — `states` 内部的仅视觉回退目标
- 支持的 `fallbackTo` 源状态：`error`、`attention`、`notification`、`sweeping`、`carrying`、`sleeping`
- 回退**不会**跳过逻辑状态。定时器、点击区域和状态转换仍按原始状态运行。

### 入睡序列

使用 `sleepSequence.mode` 在完整入睡路径和直接入睡路径之间选择：

```json
"sleepSequence": {
  "mode": "full"
}
```

- `full` — 默认值。运行时保持 `yawning -> dozing -> collapsing -> sleeping`，且 `waking` 应有真实文件。
- `direct` — 在 `mouseSleepTimeout` 之后，运行时直接进入 `sleeping`。唤醒时，如果 `waking` 有真实文件则播放一次；否则桌宠直接返回 idle/当前显示状态。

### 工作层级

根据同时运行的 agent 会话数量展示不同动画：

```json
"workingTiers": [
  { "minSessions": 3, "file": "building.gif" },
  { "minSessions": 2, "file": "juggling.gif" },
  { "minSessions": 1, "file": "typing.gif" }
]
```

### 反应

点击和拖拽响应动画：

```json
"reactions": {
  "drag":       { "file": "react-drag.gif" },
  "clickLeft":  { "file": "react-left.gif",  "duration": 2500 },
  "clickRight": { "file": "react-right.gif", "duration": 2500 },
  "annoyed":    { "file": "react-annoyed.gif", "duration": 3500 },
  "double":     { "files": ["react-double.gif"], "duration": 3500 }
}
```

- `drag` — 拖拽时播放（无 duration，循环直到释放）
- `clickLeft` / `clickRight` — 双击反应，方向感知
- `annoyed` — 双击时 50% 概率替代方向反应
- `double` — 4 次快速点击反应，`files` 数组用于随机选择

省略整个 `reactions` 块以禁用所有点击和拖拽反应。

### 待机随机动画

在待机期间播放的随机动画：

```json
"idleAnimations": [
  { "file": "idle-look.gif", "duration": 6500 },
  { "file": "idle-reading.gif", "duration": 14000 }
]
```

省略 `idleAnimations` 或使用空数组，如果你希望 idle 停留在 `states.idle[0]` 而不使用随机池。

### 点击区域

viewBox 单位中的可点击区域。仅 `default` 点击区域是必需的：

```json
"hitBoxes": {
  "default":  { "x": -1, "y": 5, "w": 17, "h": 12 },
  "sleeping": { "x": -2, "y": 9, "w": 19, "h": 7 },
  "wide":     { "x": -3, "y": 3, "w": 21, "h": 14 }
},
"sleepingHitboxFiles": ["sleeping.gif"],
"wideHitboxFiles": ["error.gif", "notification.gif"]
```

当某个特定素材需要比共享桶更紧凑或更高的可点击区域时，使用 `fileHitBoxes`：

```json
"fileHitBoxes": {
  "working-typing.svg": { "x": -2, "y": -7, "w": 20, "h": 24 }
}
```

文件特定的点击区域适用于最终显示的文件名，会覆盖 `sleepingHitboxFiles`、`wideHitboxFiles` 和 `default`。
在变体中覆盖 `fileHitBoxes` 时，每个矩形必须包含全部四个字段（`x`、`y`、`w`、`h`）。不完整的矩形会被丢弃并显示控制台警告，同一文件的基础主题矩形将保持生效。

### Mini 模式

Mini 模式将角色隐藏在屏幕边缘。设置 `"supported": false` 或省略该块以跳过：

```json
"miniMode": {
  "supported": true,
  "offsetRatio": 0.486,
  "states": {
    "mini-idle":   ["mini-idle.svg"],
    "mini-enter":  ["mini-enter.gif"],
    "mini-peek":   ["mini-peek.gif"],
    "mini-alert":  ["mini-alert.gif"],
    "mini-happy":  ["mini-happy.gif"],
    "mini-sleep":  ["mini-sleep.gif"],
    "mini-crabwalk": ["mini-crabwalk.gif"],
    "mini-enter-sleep": ["mini-enter-sleep.gif"]
  }
}
```

如果 `miniMode.supported` 为 `true`，验证器期望上述全部 8 个 mini 状态。`mini-idle` 仅在 `mini-idle` 列在 `eyeTracking.states` 中时需要 SVG。

`mini-working` 是可选的。如果你提供了 `miniMode.states["mini-working"]`，Clawd 可以在桌宠处于 mini 模式时显示紧凑的工作动画。如果省略，working/thinking/juggling 事件不会打破 mini 模式；Clawd 保持当前 mini 视觉效果。

### 时间参数

所有值单位为毫秒。省略任何值以使用默认值：

```json
"timings": {
  "mouseIdleTimeout": 20000,
  "mouseSleepTimeout": 60000,
  "yawnDuration": 3000,
  "wakeDuration": 1500,
  "deepSleepTimeout": 600000,
  "minDisplay": {
    "attention": 4000,
    "error": 5000,
    "working": 1000
  },
  "autoReturn": {
    "attention": 4000,
    "error": 5000
  }
}
```

主题特定的 DND 入睡过渡可用于内置级别的精细度：

```json
"timings": {
  "dndSleepTransitionSvg": "idle-to-sleeping.svg",
  "dndSleepTransitionDuration": 4850
}
```

大多数第三方主题不需要这个。如果你只是想要更少的入睡素材，请使用 `sleepSequence.mode: "direct"`。

### 音效

主题可以将逻辑音效名称映射到同级 `sounds/` 目录中的文件：

```json
"sounds": {
  "complete": "complete.mp3",
  "confirm": "confirm.mp3",
  "error": "error.ogg"
}
```

- 内置逻辑名称为 `complete` 和 `confirm`
- 允许额外名称，但只有调用该音效名称的代码路径才会播放它们
- 将音效值设置为 `null` 以为该主题禁用它
- 用户在 `Settings...` -> `Animation Overrides` -> `Sounds` 中的覆盖单独存储，不会编辑主题包

### 对象缩放

相对于 viewBox 微调渲染大小。默认值适用于大多数主题：

```json
"objectScale": {
  "widthRatio": 1.9,
  "heightRatio": 1.3,
  "offsetX": -0.45,
  "offsetY": -0.25
}
```

对于混合格式主题中个别文件需要小对齐修正的情况，`objectScale.fileScales` 和 `objectScale.fileOffsets` 可以按文件名调整特定素材。参见 `themes/calico/theme.json` 中的大型 APNG 示例。

### 文件特定 ViewBox

大多数主题对所有正常模式素材使用一个根 `viewBox`。如果某个素材使用不同的逻辑画布，在 `fileViewBoxes` 中声明：

```json
"fileViewBoxes": {
  "mini-crabwalk.svg": { "x": -32, "y": -24, "width": 88, "height": 72 }
}
```

这主要用于特殊过渡素材。除非特定文件确实需要不同的坐标系，否则优先使用共享画布。

### 布局规范化

如果两个主题在窗口大小相同的情况下可见身体高度差异很大，请添加 `layout` 块。这让 Clawd 按可见身体区域和基线对齐角色，而不是按原始文件画布：

```json
"layout": {
  "contentBox": { "x": -4, "y": -3, "width": 23, "height": 20 },
  "centerX": 7.5,
  "baselineY": 17,
  "visibleHeightRatio": 0.58,
  "baselineBottomRatio": 0.05
}
```

- `contentBox` — viewBox 单位中的可见身体区域，不是整个导出画布
- `centerX` — viewBox 内的水平锚点
- `baselineY` — viewBox 内的站立基线
- `visibleHeightRatio` — 可见身体相对于窗口高度的比例
- `baselineBottomRatio` — 基线到窗口底部的距离

Mini 模式仍使用现有的 `objectScale` + 每文件偏移，所以这主要用于正常模式对齐。

## 素材指南

### 支持的格式

| 格式 | 最适用于 | 眼球追踪 | 备注 |
|------|----------|----------|------|
| SVG | 待机状态、所有动画 | 是（需要 ID） | 无限缩放，CSS 动画 |
| APNG | 帧动画 | 否 | 最佳质量，Alpha 通道 |
| GIF | 像素美术动画 | 否 | 仅二值透明 |
| WebP | 照片风格动画 | 否 | 压缩率好 |
| PNG | 静态姿势 | 否 | 适合单帧非追踪状态 |
| JPG / JPEG | 无透明的静态姿势 | 否 | 适合不透明或已合成的美术品 |

### 最小静态主题示例

如果你只有静态美术作品也没关系。使用单帧 PNG / WebP / JPG / JPEG 文件的主题现在是一等公民路径。最简单的创作配方是：

- 将 `eyeTracking.enabled` 设为 `false`
- 将 `miniMode.supported` 设为 `false`，除非你真的画了全部 8 个 mini 状态
- 为 `idle`、`thinking`、`working` 和 `sleeping` 各使用一个真实文件
- 添加 `sleepSequence.mode: "direct"`，如果你不想画 `yawning` / `dozing` / `collapsing` / `waking`
- 当一张静态图片就够了时，对中断状态使用 `fallbackTo`

示例：

```json
"eyeTracking": {
  "enabled": false,
  "states": []
},
"sleepSequence": {
  "mode": "direct"
},
"states": {
  "idle": ["idle.jpg"],
  "thinking": ["thinking.jpg"],
  "working": ["working.jpg"],
  "attention": ["happy.jpg"],
  "error": { "fallbackTo": "attention" },
  "notification": { "fallbackTo": "attention" },
  "sleeping": ["sleeping.jpg"]
},
"miniMode": {
  "supported": false
}
```

### 画布尺寸

所有素材应共享由 `viewBox` 定义的相同逻辑画布。对于光栅格式（GIF/APNG/WebP）：
- 以 viewBox 尺寸的 2x-3x 导出以获得清晰渲染
- 示例：viewBox 45x45 → 以 90x90 或 135x135 像素导出 GIF
- 保持角色在所有帧中位置一致

### SVG 眼球追踪结构

对于需要眼球追踪的 SVG，包含这些具有精确 ID 的组：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
  <!-- 底层：阴影（可选） -->
  <g id="shadow-js" style="transform-origin: 7.5px 15px">
    <ellipse cx="7.5" cy="16" rx="6" ry="1.5" fill="rgba(0,0,0,0.15)"/>
  </g>

  <!-- 中间层：角色身体（可选，启用倾斜效果） -->
  <g id="body-js">
    <!-- 你的角色身体 -->
  </g>

  <!-- 顶层：眼睛（眼球追踪必需） -->
  <g id="eyes-js">
    <!-- 你的角色眼睛 -->
  </g>
</svg>
```

## 验证

在分发主题前运行验证器：

```bash
node scripts/validate-theme.js path/to/your-theme
```

验证器检查：
- `theme.json` schema（必需字段、类型、schemaVersion）
- 素材文件存在性（所有引用的文件）
- 眼球追踪 SVG 结构（必需的 ID）
- 当 `miniMode.supported=true` 时的 mini 模式完整性
- 点击区域配置
- 声明了 `variants` 时的变体补丁结构

## 调试技巧

- **主题未出现在 Settings 中？** 检查 `theme.json` 是有效的 JSON（没有尾随逗号、没有注释 —— 请使用 `_comment` 字段代替），且包含它的文件夹直接位于用户主题目录下
- **素材未加载？** 检查文件名是否完全匹配（Linux/macOS 区分大小写）
- **眼球追踪不工作？** 验证你的 SVG 在眼睛组上有 `id="eyes-js"`，且 `eyeTracking.enabled` 为 `true`
- **角色在状态间跳跃？** 确保所有素材共享相同的画布大小和角色位置
- **动画不循环？** GIF/APNG 必须设为循环；SVG CSS `@keyframes` 需要 `infinite` 迭代
- **脚本化 SVG 动画不运行？** 外部主题的 SVG 脚本会被故意移除。请使用 CSS 动画、APNG/GIF/WebP，或如果需要可信脚本运行时则贡献一个内置主题。

## 分发

### 作为 GitHub 仓库
1. 创建一个包含你的主题文件夹结构的仓库
2. 用户克隆/下载到他们的主题目录
3. 在你的 README 中包含截图或 GIF 预览

### 作为 zip 文件
1. 压缩主题文件夹（包含 `theme.json` 的文件夹）
2. 用户解压到 `{userData}/themes/`
   - Windows：`%APPDATA%/clawd-on-desk/themes/`
   - macOS：`~/Library/Application Support/clawd-on-desk/themes/`
   - Linux：`~/.config/clawd-on-desk/themes/`

## 主题安装（用户端）

1. 下载/克隆主题到主题目录（路径见上文）
2. 在 `Settings...` -> `Theme` 中，查看能力徽章（`Tracked idle`、`Animated idle`、`Static theme`、`Mini`、`Direct sleep`、`No reactions`）以确认主题支持的功能
3. 选择主题卡片。主题以其 `theme.json` 中的 `name` 字段显示。
4. 仅在新复制的主题文件夹尚未出现时重启 Clawd。

> **安全提示：** 第三方 SVG 文件在渲染前会自动进行消毒处理 —— `<script>`、事件处理器和 `javascript:` URL 会在渲染前被移除。
