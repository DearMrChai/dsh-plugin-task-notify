/**
 * Host half of dsh-plugin-task-notify.
 *
 * 0.3.0 双端兼容（host-monitor 0.9.0 同坑同修）：
 *  - web 0.1.x dsh-settings：有 register/watch API → 注册 namespace
 *    （设置卡闭环；同步注册避开 installSettingsSection 延迟注入陷阱）；
 *  - 桌面端 0.2.0-rc.2 dsh-settings 重构为 SettingsForms，register 已删 ——
 *    直接调用会 TypeError → apply 抛错 → 插件整包死。能力探测：
 *    typeof register === 'function' 才注册，否则跳过（0.2.0 的 config 由
 *    apply(ctx, config) 参数给出；改配置 = 配置层热重载 → entry 重挂载）。
 *  - 新增 GET /task-notify/api/config（双端）：桌面端 client 无 settingsScope，
 *    配置经此路由下发（webServer 路由形态 = host-monitor 0.9.0 实证）。
 */
import type { Context } from '@deepseek-ai/cordis'
// NOTE: dsh-settings@0.1.2-rc.1 (bundled with DSH 0.1.2-rc.1) removed the
// runtime `settingsNamespace` export (present in 0.1.0-rc.8). It was a pure
// type-brand no-op (`return value`), so we use the raw namespace string with a
// type-only import — compatible with BOTH the rc.8 and 0.1.2-rc.1 contracts.
// A value import would crash at module-eval time and take down the whole
// plugin bundle (cordis import failure).
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_TASK_NOTIFY_CONFIG, TASK_NOTIFY_NS, type TaskNotifyConfig } from './task-notify-config.ts'

export type { TaskNotifyConfig } from './task-notify-config.ts'
export { TASK_NOTIFY_NS } from './task-notify-config.ts'

/** The `task-notify` settings namespace brand (join key with the browser half). */
export const TASK_NOTIFY_SETTINGS_NS: SettingsNamespace = TASK_NOTIFY_NS as SettingsNamespace

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
  ttsTemplate: z.string().default('任务完成，用时约 {time} 分钟'),
  titleFlash: z.boolean().default(true),
  globalSessions: z.boolean().default(true),
  batchSingleBeep: z.boolean().default(false),
})

/** patch/namespace 之上的完整配置视图（缺省字段回退默认值；字段全平，浅合并足够）。 */
function resolveConfig(config: TaskNotifyConfig | undefined): TaskNotifyConfig {
  return { ...DEFAULT_TASK_NOTIFY_CONFIG, ...(config ?? {}) }
}

/** 宿主半 ctx 的宽松视图：跨 0.1/0.2 的服务差异全部按能力探测处理。 */
interface HostContextLike {
  settings?: { register?: (...args: unknown[]) => unknown }
  get?: (name: string) => unknown
  on?: (event: string, listener: () => void) => (() => void) | undefined
  effect?: (thunk: () => () => void) => unknown
  logger?: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void }
}

type WebServerLike = {
  register: (route: {
    kind: string
    path: string
    handler: (req: unknown, res: unknown) => Promise<void> | void
  }) => () => void
}

/**
 * Plugin body：能力探测注册 settings namespace（仅 web 0.1.x），并把
 * /task-notify/api/config 挂到 webServer（双端，桌面端 client 的配置来源）。
 */
export function apply(ctx: Context, config: TaskNotifyConfig): void {
  const host = ctx as unknown as HostContextLike

  // 1) settings namespace —— 仅 web 0.1.x（桌面端 0.2.0 已删 register，探测跳过）
  try {
    const settings = host.settings
    if (settings && typeof settings.register === 'function') {
      settings.register(TASK_NOTIFY_SETTINGS_NS, Config, { base: config, applies: 'live' })
    }
  } catch (err) {
    try { host.logger?.warn?.('[task-notify] settings namespace 注册失败（不影响提醒与配置路由）:', err) } catch { /* 忽略 */ }
  }

  // 2) 配置路由（双端）—— tools/路由各自隔离：任何一处失败不连累另一处
  host.effect?.(() => {
    const disposers: Array<() => void> = []
    let installed = false
    const installRoutes = (): void => {
      if (installed) return
      const ws = host.get?.('webServer') as WebServerLike | undefined
      if (!ws || typeof ws.register !== 'function') return
      installed = true
      const send = (res: unknown, data: unknown): void => {
        const r = res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }
        r.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        r.end(JSON.stringify(data))
      }
      try {
        disposers.push(ws.register({
          kind: 'exact',
          path: '/task-notify/api/config',
          handler: async (_req: unknown, res: unknown) => {
            send(res, { ok: true, config: resolveConfig(config) })
          },
        }))
        host.logger?.info?.('[task-notify] 路由已挂载：/task-notify/api/config')
      } catch (err) {
        try { host.logger?.warn?.('[task-notify] 配置路由挂载失败（不影响其余功能）:', err) } catch { /* 忽略 */ }
      }
    }
    let off: (() => void) | undefined
    try {
      off = host.on?.('internal/service', installRoutes)
    } catch {
      /* 事件服务差异：仅失去延迟挂载时机，installRoutes 仍会立即执行一次 */
    }
    installRoutes()
    return () => {
      try { off?.() } catch { /* 忽略 */ }
      disposers.splice(0).forEach((dispose) => { try { dispose() } catch { /* 忽略 */ } })
    }
  })
}
