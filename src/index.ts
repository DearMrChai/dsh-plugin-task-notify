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
 *  - 配置路由 GET/POST /task-notify/api/config（双端）：
 *      GET  → 桌面端 client 的配置来源（0.3.0 行为）+ base/revision（0.3.1）；
 *      POST → 0.2.0 设置页的写入口：本插件是第三方包，不带官方 companion
 *             设置页，卡片的保存动作走此路由 → settings.update（SettingsForms）
 *             → configEditor 写回 profile cordis.patch.yml → 热重载 entry。
 *
 * 0.3.1 桌面端设置界面（asar 源码实证）：
 *  - 0.2.0 的 SettingsForms 只为 Config schema 中 .volatile() 字段生成表单
 *    （volatileForm：字段无 volatile 元数据 → 无表单 → 设置页不出现本插件）；
 *  - volatile 字段 resolve 后是引用对象（{get()}），host 消费一律
 *    resolvePlainConfig 解包（01.x web 的 register 也按 schema resolve，同样兜底）。
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
import {
  DEFAULT_TASK_NOTIFY_CONFIG,
  TASK_NOTIFY_NS,
  resolvePlainConfig,
  type TaskNotifyConfig,
} from './task-notify-config.ts'

export type { TaskNotifyConfig } from './task-notify-config.ts'
export { TASK_NOTIFY_NS } from './task-notify-config.ts'

/** The `task-notify` settings namespace brand (join key with the browser half). */
export const TASK_NOTIFY_SETTINGS_NS: SettingsNamespace = TASK_NOTIFY_NS as SettingsNamespace

/** Cordis dependency declaration: this plugin waits until the settings service is visible.
 *  0.1.x = 旧 Settings 服务；0.2.0 = SettingsForms（同名 'settings'）——inject 行两代都命中。 */
export const inject = ['settings']

/**
 * .volatile() 版本门：桌面端 0.2.0-rc.2 内置 schemastery 3.18.4 有该方法，
 * web 0.1.x 内置 3.18.2 没有 —— Config 构造发生在模块求值期，无条件调用会在
 * 旧运行时抛 TypeError 炸掉整个插件 bundle（硬约束 3）。能力探测：支持才标，
 * 不支持则原样返回（0.1.x web 的自定义设置卡不依赖 volatile 元数据，不受影响）。
 */
function volatileIfSupported<T>(schema: T): T {
  const candidate = schema as { volatile?: unknown }
  if (typeof candidate.volatile === 'function') {
    return (candidate as { volatile: () => T }).volatile()
  }
  return schema
}

/**
 * JSON schema of the reminder settings（defaults are the composition base）。
 * 0.3.1：11 个字段全标 .volatile()（经版本门）—— 0.2.0 SettingsForms 出表单的
 * 唯一前提（validateVolatileSchema 要求 fixed object path，顶层平铺字段天然满足）；
 * 0.1.x web 端 register 忽略该元数据（值消费已解包，行为不变）。
 */
export const Config: z<TaskNotifyConfig> = z.object({
  enabled: volatileIfSupported(z.boolean().default(true)),
  thresholdMinutes: volatileIfSupported(z.number().step(1).min(1).max(120).default(5)),
  subReminderEnabled: volatileIfSupported(z.boolean().default(true)),
  mergeMs: volatileIfSupported(z.number().step(100).min(0).max(5000).default(500)),
  masterVolume: volatileIfSupported(z.number().step(0.1).min(0).max(1).default(0.6)),
  subVolume: volatileIfSupported(z.number().step(0.1).min(0).max(1).default(0.5)),
  ttsEnabled: volatileIfSupported(z.boolean().default(false)),
  ttsTemplate: volatileIfSupported(z.string().default('任务完成，用时约 {time} 分钟')),
  titleFlash: volatileIfSupported(z.boolean().default(true)),
  globalSessions: volatileIfSupported(z.boolean().default(true)),
  batchSingleBeep: volatileIfSupported(z.boolean().default(false)),
})

/** patch/namespace 之上的完整配置视图（缺省字段回退默认值 + volatile 引用解包）。 */
function resolveConfig(config: TaskNotifyConfig | undefined): TaskNotifyConfig {
  return resolvePlainConfig(config)
}

/** 宿主半 ctx 的宽松视图：跨 0.1/0.2 的服务差异全部按能力探测处理。 */
interface HostContextLike {
  settings?: {
    register?: (...args: unknown[]) => unknown
    /** 0.1.x Settings.update(ns, patch) / 0.2.0 SettingsForms.update(ns, patch, revision) */
    update?: (ns: string, patch: unknown, expectedRevision?: number) => unknown
    describe?: (options?: unknown) => unknown[] | undefined
  }
  get?: (name: string) => unknown
  on?: (event: string, listener: () => void) => (() => void) | undefined
  effect?: (thunk: () => () => void) => unknown
  logger?: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void }
}

type WebServerLike = {
  register: (route: {
    kind: string
    path: string
    handler: (req: unknown, res: unknown) => Promise<void> | void
  }) => () => void
}

/** 从 settings 服务读本插件的当前 revision（两代 describe 都含 {ns, revision, value}）。 */
function readRevision(host: HostContextLike): number {
  try {
    const settings = host.get?.('settings') ?? host.settings
    const describe = (settings as HostContextLike['settings'])?.describe
    if (typeof describe !== 'function') return 0
    const rows = describe.call(settings)
    if (!Array.isArray(rows)) return 0
    for (const row of rows) {
      const r = row as { ns?: unknown; revision?: unknown } | null
      if (r && r.ns === TASK_NOTIFY_NS && typeof r.revision === 'number') return r.revision
    }
  } catch {
    /* 服务缺失/形状变化：revision 退化为 0（写入端按无并发处理） */
  }
  return 0
}

/**
 * Plugin body：能力探测注册 settings namespace（仅 web 0.1.x），并把
 * /task-notify/api/config（GET/POST）挂到 webServer（双端）。
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
      const send = (res: unknown, code: number, data: unknown): void => {
        const r = res as { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }
        r.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        r.end(JSON.stringify(data))
      }
      const readBody = (req: unknown, limitBytes = 16384): Promise<Record<string, unknown>> =>
        new Promise((resolve, reject) => {
          const r = req as { on: (ev: string, fn: (c: unknown) => void) => void; abort?: () => void }
          const chunks: Buffer[] = []
          let size = 0
          r.on?.('data', (chunk: unknown) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
            size += buf.length
            if (size > limitBytes) {
              try { r.abort?.() } catch { /* 忽略 */ }
              reject(new Error('body too large'))
              return
            }
            chunks.push(buf)
          })
          r.on?.('end', () => {
            try {
              const text = Buffer.concat(chunks).toString('utf8')
              resolve(text === '' ? {} : (JSON.parse(text) as Record<string, unknown>))
            } catch (err) {
              reject(err)
            }
          })
          r.on?.('error', (err: unknown) => reject(err))
        })
      try {
        disposers.push(ws.register({
          kind: 'exact',
          path: '/task-notify/api/config',
          handler: async (req: unknown, res: unknown) => {
            const method = ((req as { method?: unknown })?.method ?? 'GET').toString().toUpperCase()
            if (method === 'GET' || method === 'HEAD') {
              send(res, 200, {
                ok: true,
                ns: TASK_NOTIFY_NS,
                config: resolveConfig(config),
                base: DEFAULT_TASK_NOTIFY_CONFIG,
                revision: readRevision(host),
              })
              return
            }
            if (method === 'POST' || method === 'PUT') {
              try {
                const body = await readBody(req)
                const patch = body.patch
                if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
                  send(res, 400, { ok: false, error: 'body.patch must be an object' })
                  return
                }
                const expectedRevision = typeof body.revision === 'number' ? body.revision : undefined
                // 0.1.x Settings / 0.2.0 SettingsForms 同名 update —— 能力探测，缺失/异常都不炸路由
                const settings = (host.get?.('settings') ?? host.settings) as HostContextLike['settings'] | undefined
                if (!settings || typeof settings.update !== 'function') {
                  send(res, 503, { ok: false, error: 'settings service unavailable' })
                  return
                }
                await settings.update(TASK_NOTIFY_NS, patch, expectedRevision)
                // 写成功后重新读取：0.2.0 已热重载（entry 重挂载，describe 见新值）；
                // 0.1.x register 的 live scope 同步更新。本闭包的 `config` 参数不重放，
                // 一律以 settings.describe 读回的 value 为准。
                let written: TaskNotifyConfig | undefined
                try {
                  const rows = settings.describe?.()
                  const row = (Array.isArray(rows) ? rows : []).find((r) => (r as { ns?: unknown })?.ns === TASK_NOTIFY_NS) as
                    | { value?: TaskNotifyConfig | undefined }
                    | undefined
                  written = row?.value !== undefined ? resolvePlainConfig(row.value) : undefined
                } catch {
                  /* 读回失败不阻塞：client 用响应前读到的值 */
                }
                send(res, 200, {
                  ok: true,
                  ns: TASK_NOTIFY_NS,
                  config: written ?? resolvePlainConfig(patch as TaskNotifyConfig),
                  base: DEFAULT_TASK_NOTIFY_CONFIG,
                  revision: readRevision(host),
                })
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                // 0.2.0 的 SettingsConflictError / 非 volatile 拒绝都走这里：回 409，卡上提示重试
                send(res, 409, { ok: false, error: message })
              }
              return
            }
            send(res, 405, { ok: false, error: 'method not allowed' })
          },
        }))
        host.logger?.info?.('[task-notify] 路由已挂载：/task-notify/api/config（GET/POST）')
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
