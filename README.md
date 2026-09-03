# dsh-plugin-task-notify 长任务完成语音提醒插件

DSH（DeepSeek Harness）长任务完成提醒：**你发出消息不响；子任务（子代理）完成响一声"嘟"；整轮任务跑完、该回来操作了，响一声"叮"**（附带可选标题闪动 / TTS 播报）。纯浏览器端做提醒，和你用哪家 AI 模型无关。

## 特性

- **嘟（子任务完成）**：监听会话快照中的子代理调用，每完成一个响一声短促"嘟"；连续多个完成自动合并（可配），可开"整批只响一声"。
- **叮（整轮完成）**：从你发出消息（或本轮开始）计时，运行超过阈值（默认 5 分钟、可配）并结束时响清脆上扬双音"叮"——提示你回来继续操作。短轮次不打扰。
- **多会话全局**：默认监听所有会话，哪个会话的长轮跑完都响；可关掉只监听当前会话。
- **声音自包含**：Web Audio 合成、无任何音频资源；TTS 用浏览器 `speechSynthesis`（可选、默认关）。
- **两个半结构**：Host 半注册设置项 namespace（让「设置 → 插件」出现可调整的卡片）；Client 半在浏览器里做声音提醒。

## 安装（重要！含排坑关键）

插件是**两个半**结构，Host 半和 Client 半缺一不可：

1. **构建插件**（或直接使用仓库里已构建的 `lib/` 产物）：
   ```bash
   node "D:\\开发者工具\\deepseek-harness\\node_modules\\tsdown\\dist\\run.mjs" -c tsdown.config.ts
   ```
2. **把整个包复制到 DSH 的 profile 依赖目录**：
   ```
   <dsh-home>/profiles/node_modules/dsh-plugin-task-notify/
   ```
3. **在 web profile 的 `cordis.patch.yml` 追加下面这一整段**（⚠️ **`inject: [settings]` 这一行是必须的**，见下方排坑）：
   ```yaml
   - insert:
       - id: task-notify
         name: dsh-plugin-task-notify
         inject: [settings]   # ← 必须：让 DSH 在插件启动前先等 settings 服务就绪
         config:
           enabled: true
           thresholdMinutes: 5
   ```
4. **重启 DSH**（改 `lib/` 产物不会热重载，必须重启进程）。刷新页面后，设置页 → 插件 会出现 task-notify 卡片。

### ⚠️ 排坑记录（为什么设置卡片第一次不显示）

第一次接入时，Host 半用的是 `installSettingsSection()`（settings 包的标准封装）。观察到的现象非常迷惑：

- 插件列表里显示**已挂载、已激活**
- 探针显示 `apply()` 执行了、`installSettingsSection()` 没抛错
- 但设置页的卡片**始终不出现**，`settings.describe()` 里也**没有** `task-notify` namespace

**根因**：cordis 插件加载器只认 **patch 行的 `inject` 字段**，并不读插件模块里的 `export const inject`。而 `installSettingsSection` 内部是 `ctx.inject(['settings'], cb)`——一个**异步延迟注入**。当 patch 行没有声明 `inject` 时，这个延迟回调**永远不会被触发**，namespace 从未注册；但 `apply()` 本身同步返回、不报错，所以一切状态都显示正常，只有结果缺失。

**修复**（两处）：
1. patch 行加 `inject: [settings]`——让插件在 entry 层面先等 settings 服务就绪；
2. Host 半 `apply()` 改为**同步直接注册** `ctx.settings.register(ns, Config, { base: config, applies: 'live' })`（和 ac-telemetry 用 `ctx.tools.register` 同构），不再依赖延迟注入。

> 教训：凡是需要 settings/tools 等服务的插件，**必须在 patch 行的 `inject` 里声明**，即使插件代码里用了标准封装函数也一样。

## 配置项（设置卡可调）

| 字段 | 含义 | 默认 |
| --- | --- | --- |
| `enabled` | 总开关 | `true` |
| `thresholdMinutes` | 整轮"叮"阈值（分钟） | `5` |
| `subReminderEnabled` | 子任务"嘟"开关 | `true` |
| `mergeMs` | 连续子任务合并窗口（毫秒） | `500` |
| `masterVolume` | "叮"音量 0..1 | `0.6` |
| `subVolume` | "嘟"音量 0..1 | `0.5` |
| `ttsEnabled` | TTS 播报（默认关） | `false` |
| `titleFlash` | 标题闪动 | `true` |
| `globalSessions` | 多会话全局提醒 | `true` |
| `batchSingleBeep` | 整批只响一声"嘟" | `false` |

## 声音触发规则

- **发出**（你打字/提交消息）：不响。
- **子任务完成**：子代理类工具调用（`subagent*`）从运行集合消失时响"嘟"。合并窗口内多个完成合并一声；`batchSingleBeep` 开启后一轮内只响一声。
- **整轮完成**：会话从 running 回到 idle 且本轮计时 ≥ 阈值时响"叮"（+ 可选标题闪动 + 可选 TTS "任务完成，用时约 X 分钟"）。"继续"会开启新的一轮，同样规则判定。

## 浏览器注意

- **需要页面有过交互**（点击/按键）后才能发声：首次打开页面先点一下或发一条消息，之后后台标签页也能播放（符合浏览器自动播放策略）。
- **TTS 在后台标签页会被浏览器节流**，所以默认关闭；"嘟/叮"为 Web Audio 合成音，不受影响。
- 页面关闭/浏览器退出后不响（提醒是浏览器端能力）；DSH Host 继续跑任务没问题，但声音需要页面开着。

## 分享给朋友

把整个 `dsh-plugin-task-notify` 目录（`package.json`、`lib/`、`src/`、`README.md`）打包给对方即可。对方按上面的「安装」四步做：复制目录 → 在 `cordis.patch.yml` 加**完整段落（含 `inject: [settings]`）** → 重启。

## 兼容性

- 适配 DSH `0.1.0-rc.8` 客户端契约（与 `dsh-plugin-agent-workflow` 同基线）。
- 仅使用公开会话快照（`sessions.list`、`running`、`runningCalls`）与标准设置槽位；DSH 小版本升级一般不受影响，若事件契约出现颠覆性变化，跟随仓库说明小修即可。
