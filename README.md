# dsh-plugin-task-notify

> Long-task audio reminder for DeepSeek Harness — a short "beep" when a sub-agent finishes, a clear "ding" when the whole turn is done and you should come back. Pure browser-side; works with any AI provider.

DSH（DeepSeek Harness）长任务完成提醒：**你发出消息不响；子任务（子代理）完成响一声"嘟"；整轮任务跑完、该回来操作了，响一声"叮"**（附带可选标题闪动 / TTS 播报）。纯浏览器端做提醒，和你用哪家 AI 模型无关。

## Features / 特性

- **Beep on sub-task / 嘟（子任务完成）**: listens for sub-agent tool calls (`subagent`, `subagent_fork`, etc.) settling; plays a short beep per completion, with an automatic merge window for rapid consecutive ones.
- **Ding on turn end / 叮（整轮完成）**: starts a timer when the turn begins; if the turn runs past a configurable threshold (default 5 min), plays a rising two-tone ding when the agent returns idle — the signal to come back. Short turns stay silent.
- **Multi-session / 多会话全局**: monitors all sessions by default; configurable to current session only.
- **Self-contained audio / 声音自包含**: Web Audio API synthesis, no external assets; optional TTS via `speechSynthesis` (off by default) with customizable template — use `{time}` as a placeholder for the actual duration.
- **Two-half structure / 两个半结构**: Host half registers the settings namespace; Client half runs the browser reminder.

## Install / 安装

### From the plugin market / 从插件市场安装

```bash
dsh plugin add dsh-plugin-task-notify
```

Restart `dsh web` and the settings card appears under **Settings → Plugins**.

### Manual install / 手动安装

1. Build (or use the pre-built `lib/` artifacts):
   ```bash
   pnpm install && pnpm build
   ```
   > The `lib/` directory ships pre-built; only rebuild after modifying `src/`.
2. Copy the whole package into the DSH profile:
   ```
   <dsh-home>/profiles/web/node_modules/dsh-plugin-task-notify/
   ```
3. Add a `cordis.patch.yml` entry to the profile (the `inject: [settings]` line is required):
   ```yaml
   - insert:
       - id: task-notify
         name: dsh-plugin-task-notify
         inject: [settings]
         config:
           enabled: true
           thresholdMinutes: 5
   ```
4. Restart DSH. The settings card appears under **Settings → Plugins**.

> ⚠️ **The `inject: [settings]` line is critical.** Without it the cordis loader never waits for the settings service, so the host half's `apply()` runs but the namespace never registers — and the settings card silently does not appear. See [Troubleshooting](#troubleshooting--排坑) below.

## Configuration / 配置项

| Field | Meaning | Default |
| --- | --- | --- |
| `enabled` | Master switch | `true` |
| `thresholdMinutes` | Turn-end ding threshold (minutes) | `5` |
| `subReminderEnabled` | Sub-task beep switch | `true` |
| `mergeMs` | Consecutive sub-task merge window (ms) | `500` |
| `masterVolume` | Ding volume, 0..1 | `0.6` |
| `subVolume` | Beep volume, 0..1 | `0.5` |
| `ttsEnabled` | TTS readout (default off) | `false` |
| `ttsTemplate` | TTS template, `{time}` = actual duration | `任务完成，用时约 {time} 分钟` |
| `titleFlash` | Title-bar flash on turn end | `true` |
| `globalSessions` | Monitor all sessions | `true` |
| `batchSingleBeep` | Single beep per turn for all sub-tasks | `false` |

## Sound trigger rules / 声音触发规则

- **You send a message**: silent.
- **Sub-task completes**: a sub-agent-family tool call disappears from `runningCalls` → short beep. Merge window deduplicates rapid completions; `batchSingleBeep` makes one beep per whole turn.
- **Turn ends**: session goes from running to idle AND the timer ≥ threshold → rising two-tone ding + optional title flash + optional TTS using your custom template (with `{time}` replaced by actual duration).

## Browser notes / 浏览器注意

- Needs one user gesture (click/keypress) before audio plays — click the page or send a message first.
- TTS may be throttled in background tabs; Web Audio beeps/dings are unaffected.
- Stops when the page closes; DSH host keeps running but sound needs the browser open.

## Desktop (DSH 0.2.x) / 桌面端

0.3.0 起同一份产物同时兼容 DSH 桌面端（`0.2.0-rc.2` 实证）。桌面端与 web 的差异：

- **配置来源**：桌面端客户端运行时没有 `settingsScope` 服务、设置页也不再渲染
  `settings.plugin.item` 槽位，因此**没有设置卡**。配置走宿主半新增的
  `GET /task-notify/api/config` 路由，值来自 profile 的 patch 层 ——
  改配置 = 手编 `profiles/desktop/cordis.patch.yml`：

  ```yaml
  - id: task-notify
    config:
      enabled: true
      thresholdMinutes: 5
      masterVolume: 0.6
  ```

  （patch 对 config 是整体替换语义，要改的字段写全；改完重启桌面端。）
- **轮次边界**：不再读 `getSnapshot().running`（0.2.0 会话快照无此字段），改订阅
  每个会话的 `eventSource` 事件流（`turn/start` / `turn/end`），与
  `dsh-plugin-whale-pet` 同款客户端契约。声音触发规则与 web 一致。
- **子任务"嘟"**：以会话行的 `parentSessionId` 识别子代理会话。字段缺失时该
  特性静默降级（不误报主任务"叮"）。
- **装载**（与 `dsh-plugin-host-monitor` 桌面端同款）：profile `package.json`
  的 `link:` 依赖（junction 直连仓库）+ `dsh.profile.bundles` 登记 + 重启。
  包自带 `cordis.patch.yml`（bundle 层提供 `inject: [settings]` 与默认值）。

## Compatibility / 兼容性

- Targets DSH `0.1.0-rc.8` client contract (same baseline as `dsh-plugin-agent-workflow`).
- **DSH desktop `0.2.0-rc.2` dual-path support (0.3.0, 2026-10)**: the desktop
  client runtime dropped `settingsScope` and the plugins-tab slot, and the host
  `dsh-settings` dropped `register()`/`watch()`. The host half now capability-probes
  `ctx.settings.register` (0.1.x namespace loop on web; config comes from the
  `apply(ctx, config)` argument on desktop), serves `/task-notify/api/config`,
  and the client half soft-probes `settingsScope` (declared `inject` keeps only
  services that exist on both runtimes) to pick the web card path or the desktop
  `eventSource` notifier path.
- Uses only public session snapshots (`sessions.list`, `running`, `runningCalls`) and standard settings slots.
- **Settings card staleness fix (0.2.1, 2026-09)**: the card now receives the live bound settings scope and subscribes to it, so saved values render immediately (the slot renderer caches a one-shot `inject()` snapshot forever).
- **DSH `0.1.2-rc.1` snapshot-shape fix (2026-09)**: the client notifier previously read `snap.runningCalls` / `snap.turnTimings` as flat fields, but on `0.1.2-rc.1` `SessionSnapshot` only exposes `running` (running-call tree / turn timings moved into the chat view `views.get('chat')?.legacy`). Reading the flat field threw `TypeError: items is not iterable` inside `walk` → every `SessionTracker.adopt()` died → `trackers= 0` and the whole notifier was silent, with the error repeating on every sync. Fix: added `runningCallsOf()` / `turnTimingsOf()` adapters that read `views.get('chat')?.legacy?.runningCalls` first, fall back to the flat field, and degrade to empty on absence; `walk` now guards `Array.isArray`. On `0.1.2-rc.1` the turn-end "叮" works (it only needs `running`); the sub-agent "嘟" is a silent no-op there because the running-call tree is not reachable through `sessions` without the chat-view service.

## Troubleshooting / 排坑

**Card shows stale values right after Save** (controls look like they "did not work" even though the settings file actually updated):

The DSH slot renderer **caches each slot entry's `inject()` result per registration** (`dsh-client-ui-renderer` `cachedRootInject`, a WeakMap keyed by the entry). The settings card therefore receives whatever the `inject` closure returned on first render, forever. The 0.2.0 card was injected a one-shot `value` snapshot, so after Save (which writes via the live `scope.set`) the card fell back to the frozen snapshot and displayed the pre-save state. Fix (0.2.1): the `inject` closure hands the card the **live bound settings scope** instead of a snapshot; the card subscribes to it (`scope.subscribe` + `scope.getSnapshot().value`) and re-reads after every settled write, so Save updates the card without a reload.

**Settings card does not appear** even though the plugin shows as mounted and active in the plugin list:

The cordis loader reads `inject` from the **patch line** only, not from the plugin module's `export const inject`. If the patch line omits `inject: [settings]`, the host half's `apply()` runs but any async delay (like `installSettingsSection`) never fires — the settings namespace is never registered, and the card never appears. Fix: add `inject: [settings]` to the patch line and use synchronous `ctx.settings.register()` in `apply()`.

## License

MIT © DearMrChai
