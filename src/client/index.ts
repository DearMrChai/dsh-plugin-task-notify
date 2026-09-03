/**
 * Browser half of dsh-plugin-task-notify: installs the notifier over every
 * listed session and registers the settings card into the Plugins tab.
 * Pure client plugin — zero host services, zero external assets.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TaskNotifyConfig } from '../task-notify-config.ts'
import { DEFAULT_TASK_NOTIFY_CONFIG, TASK_NOTIFY_NS } from '../task-notify-config.ts'
import { dbg, installNotifier } from './notifier.ts'
import { TaskNotifyCard } from './TaskNotifyCard.tsx'
import type { TaskNotifyCardInjected } from './TaskNotifyCard.tsx'

export type { TaskNotifyConfig } from '../task-notify-config.ts'
export type { TaskNotifyCardInjected } from './TaskNotifyCard.tsx'

/** Required services: settings transport + the session registry plus slots. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope', 'sessions']

/**
 * Plugin body: watch sessions (global by default), and pair the Plugins-tab
 * card with the Host-served `task-notify` namespace.
 */
export function apply(ctx: ClientContext): void {
  // Unconditional line: proves the browser half actually runs.
  console.info('[task-notify] apply(): bundle loaded')
  try {
    const mirror = ctx.settingsScope.describe()
    const logServed = (label: string) => {
      const s = mirror.getSnapshot()
      const nss = s?.view?.namespaces?.map((n: { ns: string }) => n.ns)
      console.info('[task-notify] served namespaces (' + label + '):', nss ?? JSON.stringify(s))
    }
    logServed('initial')
    mirror.subscribe(() => logServed('updated'))
  } catch (err) {
    console.info('[task-notify] served namespaces (describe failed):', err)
  }
  const scope = ctx.settingsScope.bind<TaskNotifyConfig>({ namespace: TASK_NOTIFY_NS })
  dbg('config snapshot', scope.getSnapshot().value)
  const sessions = ctx.get('sessions')

  installNotifier(sessions, scope, (dispose) => ctx.effect(dispose))

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: TASK_NOTIFY_NS,
    inject: (): TaskNotifyCardInjected => ({
      // The bound scope may resolve late; fall back to shipped defaults so the
      // card never mounts with an undefined config.
      value: scope.getSnapshot().value ?? DEFAULT_TASK_NOTIFY_CONFIG,
      set: (field, value) => { void scope.set(field, value) },
    }),
  }, TaskNotifyCard))
}