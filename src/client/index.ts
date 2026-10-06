/**
 * Browser half of dsh-plugin-task-notify.
 *
 * 0.3.0 双路径（能力探测决定，官方口径：prefer ctx.get with an undefined
 * check; use inject only for hard dependencies）：
 *  - web 0.1.x（settingsScope 服务存在）：活订阅 scope + Plugins 设置卡 +
 *    快照轮询 —— 0.2.1 行为原样保留；
 *  - 桌面端 0.2.0-rc.2（客户端运行时无 settingsScope，settings.plugin.item
 *    槽位已不渲染）：配置走宿主半 /task-notify/api/config 路由，轮次边界走
 *    会话 eventSource 事件流（见 ./desktop.ts）。
 *
 * inject 只声明双端都存在的服务：settingsScope 从硬依赖降级为软探测 ——
 * 桌面端运行时没有该服务，硬声明会让插件客户端模块装载失败（host-monitor
 * 0.9.0 同坑同修）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TaskNotifyConfig } from '../task-notify-config.ts'
import { TASK_NOTIFY_NS, DEFAULT_TASK_NOTIFY_CONFIG } from '../task-notify-config.ts'
import { dbg, installNotifier } from './notifier.ts'
import { installDesktopNotifier, type DesktopConfigBus } from './desktop.ts'
import { installDesktopSettingsPage } from './desktop-settings.tsx'
import { TaskNotifyCard } from './TaskNotifyCard.tsx'
import type { TaskNotifyCardInjected } from './TaskNotifyCard.tsx'

export type { TaskNotifyConfig } from '../task-notify-config.ts'
export type { TaskNotifyCardInjected } from './TaskNotifyCard.tsx'

/** Required services: 双端都存在的集合；settingsScope 见 probeSettingsScope。 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions']

/** settingsScope 服务面（describe/bind），与 web 0.1.x 的 ctx.settingsScope 同构。 */
type SettingsScopeService = NonNullable<ClientContext['settingsScope']>

/**
 * settingsScope 软探测：先 ctx.get（0.2.0 官方口供），再属性访问（0.1.x 注入
 * 形态）。两端都拿不到 → null（桌面路径）。
 */
function probeSettingsScope(ctx: ClientContext): SettingsScopeService | null {
  try {
    const getter = (ctx as unknown as { get?: (name: string) => unknown }).get
    if (typeof getter === 'function') {
      const viaGet = getter.call(ctx, 'settingsScope') as SettingsScopeService | undefined
      if (viaGet) return viaGet
    }
  } catch {
    /* 桌面端：无此服务 */
  }
  try {
    const viaProp = ctx.settingsScope
    if (viaProp) return viaProp
  } catch {
    /* 桌面端：ctx 代理拒绝未注入属性 */
  }
  return null
}

/**
 * Plugin body：探测 settingsScope → web 路径（活订阅 + 设置卡）或桌面路径
 * （HTTP 配置 + eventSource 事件流）。
 */
export function apply(ctx: ClientContext): void {
  // Unconditional line: proves the browser half actually runs.
  console.info('[task-notify] apply(): bundle loaded')
  const settingsScope = probeSettingsScope(ctx)
  if (settingsScope !== null) {
    applyWeb(ctx, settingsScope)
    return
  }
  console.info('[task-notify] desktop runtime detected（无 settingsScope）→ 桌面通知器 + 设置页')
  // 0.3.1 配置总线：通知器与设置页共享同一份活配置——设置页保存成功即回灌，
  // 免重启即时生效（0.3.0 时代手编 yml 必须重启）。
  const bus: DesktopConfigBus = {
    cfg: { ...DEFAULT_TASK_NOTIFY_CONFIG },
    applyConfig: (next) => {
      bus.cfg = { ...DEFAULT_TASK_NOTIFY_CONFIG, ...next }
    },
    refreshConfig: async () => {},
  }
  try {
    installDesktopNotifier(ctx as unknown as Record<string, any>, bus)
  } catch (err) {
    console.info('[task-notify] desktop notifier install failed:', err)
  }
  try {
    installDesktopSettingsPage(ctx as unknown as Record<string, any>, (cfg) => { bus.applyConfig(cfg) })
  } catch (err) {
    console.info('[task-notify] desktop settings page install failed（提醒不受影响）:', err)
  }
}

/** web 0.1.x 路径 —— 0.2.1 行为原样保留（活订阅 + 设置卡）。 */
function applyWeb(ctx: ClientContext, settingsScope: SettingsScopeService): void {
  try {
    const mirror = settingsScope.describe()
    const logServed = (label: string): void => {
      const s = mirror.getSnapshot()
      const nss = s?.view?.namespaces?.map((n: { ns: string }) => n.ns)
      console.info('[task-notify] served namespaces (' + label + '):', nss ?? JSON.stringify(s))
    }
    logServed('initial')
    mirror.subscribe(() => logServed('updated'))
  } catch (err) {
    console.info('[task-notify] served namespaces (describe failed):', err)
  }
  // Hand the card the LIVE bound scope, not a one-shot snapshot: the slot
  // renderer caches an inject() result per registration, so a plain `value`
  // would freeze at first render and the card would fall back to the stale
  // value right after Save. The card subscribes through it.
  const scope = settingsScope.bind<TaskNotifyConfig>({ namespace: TASK_NOTIFY_NS })
  dbg('config snapshot', scope.getSnapshot().value)

  // `ctx.sessions` rides the runtime's Context module-augmentation (non-undefined
  // `ISessions`), so no `ctx.get` undefined-narrowing is needed. Each cleanup
  // is a bare disposer; ctx.effect wants a thunk that RETURNS a disposer.
  installNotifier(ctx.sessions, scope, (dispose) => ctx.effect(() => dispose))

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: TASK_NOTIFY_NS,
    inject: (): TaskNotifyCardInjected => ({
      scope,
      set: (field, value) => { void scope.set(field, value) },
    }),
  }, TaskNotifyCard))
}
