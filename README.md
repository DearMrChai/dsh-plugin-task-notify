# dsh-plugin-task-notify

> Long-task audio reminder for DeepSeek Harness — a short "beep" when a sub-agent finishes, a clear "ding" when the whole turn is done and you should come back. Pure browser-side; works with any AI provider.

DSH（DeepSeek Harness）长任务完成提醒：**你发出消息不响；子任务（子代理）完成响一声"嘟"；整轮任务跑完、该回来操作了，响一声"叮"**（附带可选标题闪动 / TTS 播报）。纯浏览器端做提醒，和你用哪家 AI 模型无关。

## Features / 特性

- **Beep on sub-task / 嘟（子任务完成）**: listens for sub-agent tool calls (`subagent`, `subagent_fork`, etc.) settling; plays a short beep per completion, with an automatic merge window for rapid consecutive ones.
- **Ding on turn end / 叮（整轮完成）**: starts a timer when the turn begins; if the turn runs past a configurable threshold (default 5 min), plays a rising two-tone ding when the agent returns idle — the signal to come back. Short turns stay silent.
- **Multi-session / 多会话全局**: monitors all sessions by default; configurable to current session only.
- **Self-contained audio / 声音自包含**: Web Audio API synthesis, no external assets; optional TTS via `speechSynthesis` (off by default).
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
| `titleFlash` | Title-bar flash on turn end | `true` |
| `globalSessions` | Monitor all sessions | `true` |
| `batchSingleBeep` | Single beep per turn for all sub-tasks | `false` |

## Sound trigger rules / 声音触发规则

- **You send a message**: silent.
- **Sub-task completes**: a sub-agent-family tool call disappears from `runningCalls` → short beep. Merge window deduplicates rapid completions; `batchSingleBeep` makes one beep per whole turn.
- **Turn ends**: session goes from running to idle AND the timer ≥ threshold → rising two-tone ding + optional title flash + optional TTS "任务完成，用时约 X 分钟".

## Browser notes / 浏览器注意

- Needs one user gesture (click/keypress) before audio plays — click the page or send a message first.
- TTS may be throttled in background tabs; Web Audio beeps/dings are unaffected.
- Stops when the page closes; DSH host keeps running but sound needs the browser open.

## Compatibility / 兼容性

- Targets DSH `0.1.0-rc.8` client contract (same baseline as `dsh-plugin-agent-workflow`).
- Uses only public session snapshots (`sessions.list`, `running`, `runningCalls`) and standard settings slots.

## Troubleshooting / 排坑

**Settings card does not appear** even though the plugin shows as mounted and active in the plugin list:

The cordis loader reads `inject` from the **patch line** only, not from the plugin module's `export const inject`. If the patch line omits `inject: [settings]`, the host half's `apply()` runs but any async delay (like `installSettingsSection`) never fires — the settings namespace is never registered, and the card never appears. Fix: add `inject: [settings]` to the patch line and use synchronous `ctx.settings.register()` in `apply()`.

## License

MIT © DearMrChai
