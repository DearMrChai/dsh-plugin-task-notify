/**
 * Host half of dsh-plugin-task-notify: owns the `task-notify` settings
 * namespace so the Plugins settings tab serves its card and the browser half
 * can read/write the composition defaults. No agent-plane or host-plane
 * services are provided — the whole reminder behavior lives in the browser.
 */
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { TASK_NOTIFY_NS, type TaskNotifyConfig } from './task-notify-config.ts'

export type { TaskNotifyConfig } from './task-notify-config.ts'
export { TASK_NOTIFY_NS } from './task-notify-config.ts'

/** The `task-notify` settings namespace brand (join key with the browser half). */
export const TASK_NOTIFY_SETTINGS_NS = settingsNamespace(TASK_NOTIFY_NS)

/** Cordis dependency declaration: this plugin waits until the settings service is visible. */
export const inject = ['settings']

/** JSON schema of the reminder settings (defaults are the composition base). */
export const Config: z<TaskNotifyConfig> = z.object({
  enabled: z.boolean().default(true),
  thresholdMinutes: z.number().step(1).min(1).max(120).default(5),
  subReminderEnabled: z.boolean().default(true),
  mergeMs: z.number().step(100).min(0).max(5000).default(500),
  masterVolume: z.number().step(0.1).min(0).max(1).default(0.6),
  subVolume: z.number().step(0.1).min(0).max(1).default(0.5),
  ttsEnabled: z.boolean().default(false),
  titleFlash: z.boolean().default(true),
  globalSessions: z.boolean().default(true),
  batchSingleBeep: z.boolean().default(false),
})

/**
 * Plugin body: register the settings namespace; the browser half observes the
 * resolved value live through the bound settings scope.
 */
export function apply(ctx: Context, config: TaskNotifyConfig): void {
  const { writeFileSync, appendFileSync } = require('node:fs')
  const stamp = new Date().toISOString()
  writeFileSync('D:\\workspace\\_task_notify_probe.txt', stamp + ' apply() called\nnamespace=' + TASK_NOTIFY_NS + '\n', 'utf8')
  // ac-telemetry 同款：不套 installSettingsSection 的 ctx.inject 延迟（那个 cb 在 entry
  // 无 inject 声明时永不触发），patch 行已声明 inject: [settings] 保证 apply 时 settings 可见，
  // 所以这里同步直接注册。register 是当前 fiber 的 effect，fiber dispose 时自动注销。
  try {
    ctx.settings.register(TASK_NOTIFY_SETTINGS_NS, Config, { base: config, applies: 'live' })
    appendFileSync('D:\\workspace\\_task_notify_probe.txt', stamp + ' direct register OK\n', 'utf8')
  } catch (err) {
    appendFileSync('D:\\workspace\\_task_notify_probe.txt', stamp + ' direct register FAILED: ' + String(err) + '\n', 'utf8')
  }
}