/**
 * 桌面端设置页（DSH 0.2.0-rc.2，设置页 → 内置插件 → task-notify 标签页）。
 *
 * 与 web 设置卡（TaskNotifyCard.tsx，settings.plugin.item 槽位）的关系：
 *  0.2.0 客户端运行时没有 settingsScope 服务、设置页不再渲染 settings.plugin.item
 *  槽位（asar bundle 0 命中实证）；0.2.0 的插件配置页统一经宿主页 slot 渲染——
 *  官方插件（shell/agent-loop/subagent/web-search）注册 settings.plugins.tab /
 *  plugins.item 并配 dsh-client-ui-primitives 的 SettingsFormModel。本插件是第三方
 *  包、不引 Harness 客户端内部包（硬约束 3 自保），改为：
 *   - 宿主半 /task-notify/api/config（GET 读 / POST 写，POST 经 SettingsForms.update
 *     落 profile cordis.patch.yml + 配置层热重载，与官方页同一持久化路径）；
 *   - 本页注册 settings.plugins.tab（契约 replaceRisk: none，官方槽位），复用 web
 *     卡的设计密度（Field/Switch/T/s 自 TaskNotifyCard 导出）。
 *
 * 硬约束 3 自保：对运行时的一切访问都是形状探测 + try/catch；加载失败只降级
 * （没有设置页），绝不炸共享 client bundle。
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { TaskNotifyConfig } from '../task-notify-config.ts'
import { DEFAULT_TASK_NOTIFY_CONFIG } from '../task-notify-config.ts'
import { BOOL_KEYS, NUM_KEYS, T, Field, Switch, parseNum } from './TaskNotifyCard.tsx'

import type { BoolKey, NumKey } from './TaskNotifyCard.tsx'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = Record<string, any>

const CONFIG_API = '/task-notify/api/config'
const NS = 'dsh-plugin-task-notify.settings'

/** 本插件词典（locale 服务缺失时的兜底 = zh）。 */
const ZH: Record<string, string> = {
  title: '任务提醒',
  description: '长轮完成“叮”、子任务完成“嘟”：阈值、音量与提醒形式可按需配置。',
  loading: '正在读取配置…',
  unavailable: '配置读取失败，无法展示当前设置。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  saved: '已保存',
  saveFailed: '保存被拒绝：',
  overriddenLabel: '已修改',
  resetLabel: '重置',
  invalidNumber: '需为数字',
}

/* ---------------------------------------------------------------------------
 * 快照 store（对齐 dsh-client-store createSnapshotStore 形态，无运行时依赖）
 * ------------------------------------------------------------------------- */

function createSnapshotStore<T>(initial: T): {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
  set: (next: T) => void
} {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next) => {
      current = next
      for (const listener of [...listeners]) {
        try { listener() } catch { /* 单个订阅者失败不影响其余 */ }
      }
    },
  }
}

interface SettingsPageState {
  status: 'loading' | 'ready' | 'error'
  value?: TaskNotifyConfig
  base?: TaskNotifyConfig
  revision: number
  error: string | null
  saving: boolean
  savedAt: number | null
}

function numTextFrom(value: TaskNotifyConfig): Record<NumKey, string> {
  return {
    thresholdMinutes: String(value.thresholdMinutes),
    mergeMs: String(value.mergeMs),
    masterVolume: String(value.masterVolume),
    subVolume: String(value.subVolume),
  }
}

/* ---------------------------------------------------------------------------
 * 页面组件（数据源 = 注入的 store/actions，宿主路由收口）
 * ------------------------------------------------------------------------- */

export interface TaskNotifySettingsPageInjected {
  store: { getSnapshot: () => SettingsPageState; subscribe: (listener: () => void) => () => void }
  load: () => Promise<void>
  save: (next: TaskNotifyConfig) => Promise<void>
  discard: () => void
  /** 宿主半缺失时的空态文案（tab 已注册但读不到配置）。 */
  t?: (key: string) => string
}

export function TaskNotifySettingsPage(props: TaskNotifySettingsPageInjected) {
  const t = props.t ?? ((key: string) => ZH[key] ?? key)
  const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const base: TaskNotifyConfig = state.value ?? DEFAULT_TASK_NOTIFY_CONFIG

  // 草稿（与 web 卡同款暂存模型：布尔直接进草稿，数字保留原文直到保存）
  const [bools, setBools] = useState<TaskNotifyConfig | null>(null)
  const [numText, setNumText] = useState<Record<NumKey, string>>(() => numTextFrom(base))
  const [ttsText, setTtsText] = useState(base.ttsTemplate ?? DEFAULT_TASK_NOTIFY_CONFIG.ttsTemplate)
  // 提交值变化（保存成功 / 冲突后重读）→ 草稿重置
  const committedKey = `${state.status}:${state.revision}`
  useEffect(() => {
    setBools(null)
    setNumText(numTextFrom(base))
    setTtsText(base.ttsTemplate ?? DEFAULT_TASK_NOTIFY_CONFIG.ttsTemplate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedKey])

  const boolDirty = bools !== null && BOOL_KEYS.some((k) => (bools as TaskNotifyConfig)[k] !== base[k])
  const numDirty = NUM_KEYS.some((k) => numText[k] !== String(base[k]))
  const ttsDirty = ttsText !== (base.ttsTemplate ?? DEFAULT_TASK_NOTIFY_CONFIG.ttsTemplate)
  const invalid = NUM_KEYS.some((k) => numText[k] !== '' && !Number.isFinite(Number(numText[k])))
  const dirty = boolDirty || numDirty || ttsDirty
  const disabled = state.status !== 'ready' || state.saving

  const toggleBool = (key: BoolKey, next: boolean): void => {
    setBools((b) => ({ ...(b ?? base), [key]: next }))
  }
  const editNum = (key: NumKey, text: string): void => {
    setNumText((n) => ({ ...n, [key]: text }))
  }
  const resetNum = (key: NumKey): void => {
    setNumText((n) => ({ ...n, [key]: String(base[key]) }))
  }
  const onSave = (): void => {
    if (!dirty || invalid || disabled) return
    const cur = {
      ...base,
      ...(bools ?? {}),
      ttsTemplate: ttsText,
      thresholdMinutes: parseNum(numText.thresholdMinutes, base.thresholdMinutes),
      mergeMs: parseNum(numText.mergeMs, base.mergeMs),
      masterVolume: parseNum(numText.masterVolume, base.masterVolume),
      subVolume: parseNum(numText.subVolume, base.subVolume),
    } as TaskNotifyConfig
    void props.save(cur)
  }
  const onDiscard = (): void => {
    setBools(null)
    setNumText(numTextFrom(base))
    setTtsText(base.ttsTemplate ?? DEFAULT_TASK_NOTIFY_CONFIG.ttsTemplate)
    props.discard()
  }

  const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760, color: T.labelPrimary }
  const headingStyle: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 600 }
  const introStyle: CSSProperties = { color: T.labelTertiary, margin: 0, fontSize: 13 }
  const errorStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: T.labelError }
  const noteStyle: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelSecondary }
  const footerStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }
  const discardBtn: CSSProperties = {
    border: `1px solid ${T.borderL2}`, borderRadius: 8, padding: '5px 14px',
    fontSize: 13, background: 'none', color: T.labelSecondary,
    cursor: disabled ? 'default' : 'pointer', opacity: dirty && !disabled ? 1 : 0.4,
  }
  const saveBtn: CSSProperties = {
    background: T.labelPrimary, color: T.bgLayer3, border: '1px solid transparent',
    borderRadius: 8, padding: '5px 14px', fontSize: 13, lineHeight: 1.5,
    cursor: dirty && !invalid && !disabled ? 'pointer' : 'default',
    opacity: dirty && !invalid && !disabled ? 1 : 0.4,
  }

  if (state.status === 'loading') {
    return <div style={sectionStyle}><p style={introStyle}>{t('loading')}</p></div>
  }
  if (state.status === 'error') {
    return (
      <div style={sectionStyle}>
        <p style={headingStyle}>{t('title')}</p>
        <p style={errorStyle}>{t('unavailable')} {state.error ?? ''}</p>
        <div style={footerStyle}>
          <button type="button" style={saveBtn} onClick={() => { void props.load() }}>{t('save')}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={sectionStyle}>
      <p style={headingStyle}>{t('title')}</p>
      <p style={introStyle}>{t('description')}</p>
      <Switch label="启用声音提醒" hint="总开关：关闭后任何声音/闪动都不触发" checked={base.enabled} disabled={disabled} border={false} onChange={(v) => { toggleBool('enabled', v) }} />
      <Field
        id="task-notify-desktop-thresholdMinutes"
        label="整轮完成提醒阈值（分钟）"
        hint="你发出消息不响；这轮运行超过该时长、回复完成时才响“叮”。短轮不打扰。"
        text={numText.thresholdMinutes}
        invalid={numText.thresholdMinutes !== '' && !Number.isFinite(Number(numText.thresholdMinutes))}
        overridden={numText.thresholdMinutes !== String(base.thresholdMinutes)}
        overriddenLabel={t('overriddenLabel')}
        resetLabel={t('resetLabel')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        border
        onEdit={(text) => { editNum('thresholdMinutes', text) }}
        onReset={() => { resetNum('thresholdMinutes') }}
      />
      <Switch label="子任务完成提醒（嘟）" hint="子代理完成时短促一声" checked={base.subReminderEnabled} disabled={disabled} border onChange={(v) => { toggleBool('subReminderEnabled', v) }} />
      <Field
        id="task-notify-desktop-mergeMs"
        label="连续子任务合并窗口（毫秒）"
        hint="窗口内多个子任务完成只响一声“嘟”"
        text={numText.mergeMs}
        invalid={numText.mergeMs !== '' && !Number.isFinite(Number(numText.mergeMs))}
        overridden={numText.mergeMs !== String(base.mergeMs)}
        overriddenLabel={t('overriddenLabel')}
        resetLabel={t('resetLabel')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        border
        onEdit={(text) => { editNum('mergeMs', text) }}
        onReset={() => { resetNum('mergeMs') }}
      />
      <Field
        id="task-notify-desktop-masterVolume"
        label="“叮”音量"
        hint="整轮完成提示音量，0–1"
        text={numText.masterVolume}
        invalid={numText.masterVolume !== '' && !Number.isFinite(Number(numText.masterVolume))}
        overridden={numText.masterVolume !== String(base.masterVolume)}
        overriddenLabel={t('overriddenLabel')}
        resetLabel={t('resetLabel')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        border
        onEdit={(text) => { editNum('masterVolume', text) }}
        onReset={() => { resetNum('masterVolume') }}
      />
      <Field
        id="task-notify-desktop-subVolume"
        label="“嘟”音量"
        hint="子任务完成提示音量，0–1"
        text={numText.subVolume}
        invalid={numText.subVolume !== '' && !Number.isFinite(Number(numText.subVolume))}
        overridden={numText.subVolume !== String(base.subVolume)}
        overriddenLabel={t('overriddenLabel')}
        resetLabel={t('resetLabel')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        border
        onEdit={(text) => { editNum('subVolume', text) }}
        onReset={() => { resetNum('subVolume') }}
      />
      <Switch label="TTS 语音播报" hint="整轮完成时读一句自定义模板，默认关" checked={base.ttsEnabled} disabled={disabled} border onChange={(v) => { toggleBool('ttsEnabled', v) }} />
      {base.ttsEnabled ? (
        <Field
          id="task-notify-desktop-ttsTemplate"
          label="TTS 播报模板"
          hint="用 {time} 代表实际用时，如“报告队长！用了 {time} 搞定了~”"
          text={ttsText}
          invalid={false}
          overridden={ttsDirty}
          overriddenLabel={t('overriddenLabel')}
          resetLabel={t('resetLabel')}
          invalidLabel=""
          disabled={disabled}
          border
          onEdit={(text) => { setTtsText(text) }}
          onReset={() => { setTtsText(base.ttsTemplate ?? DEFAULT_TASK_NOTIFY_CONFIG.ttsTemplate) }}
        />
      ) : null}
      <Switch label="标题闪动" hint="整轮完成时页面标题闪“● 任务完成”" checked={base.titleFlash} disabled={disabled} border onChange={(v) => { toggleBool('titleFlash', v) }} />
      <Switch label="多会话全局提醒" hint="任意会话长轮结束都响；关掉只监听当前会话" checked={base.globalSessions} disabled={disabled} border onChange={(v) => { toggleBool('globalSessions', v) }} />
      <Switch label="整批只响一声" hint="一轮内多个子任务完成只响一声嘟" checked={base.batchSingleBeep} disabled={disabled} border onChange={(v) => { toggleBool('batchSingleBeep', v) }} />
      <div style={footerStyle}>
        {state.savedAt !== null && Date.now() - state.savedAt < 4000 ? <p style={noteStyle}>{t('saved')}</p> : null}
        {state.error !== null ? <p style={{ ...noteStyle, color: T.labelError }}>{t('saveFailed')}{state.error}</p> : null}
        <button type="button" style={discardBtn} disabled={!dirty || disabled} onClick={onDiscard}>{t('discard')}</button>
        <button type="button" style={saveBtn} disabled={!dirty || invalid || disabled} onClick={onSave}>
          {state.saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * 装配：locale 词典 + settings.plugins.tab 注册 + HTTP 读写
 * ------------------------------------------------------------------------- */

/**
 * 桌面端设置页装配（client/index.ts 桌面分支调用）。
 * @param ctx 浏览器插件上下文（slots/locale 已注入）。
 * @param onConfigSaved 保存成功后的配置回灌（→ 桌面通知器，免重启即时生效）。
 */
export function installDesktopSettingsPage(
  ctx: Loose,
  onConfigSaved: (cfg: TaskNotifyConfig) => void,
): void {
  const slots = ctx?.slots
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    console.info('[task-notify] desktop settings: slots 不可用 → 无设置页')
    return
  }

  // locale 词典（缺失则兜底 zh；注册失败不影响页面本体）
  let t = (key: string): string => ZH[key] ?? key
  try {
    const locale = ctx?.locale
    if (locale && typeof locale.register === 'function') {
      locale.register(NS, { zh: ZH, en: { ...ZH, title: 'Task reminder' } })
    }
    if (locale && typeof locale.bind === 'function') {
      t = locale.bind(NS)
    }
  } catch (err) {
    console.info('[task-notify] desktop settings: locale 不可用（用内置 zh 文案）:', err)
  }

  const store = createSnapshotStore<SettingsPageState>({
    status: 'loading',
    revision: 0,
    error: null,
    saving: false,
    savedAt: null,
  })

  const load = async (): Promise<void> => {
    store.set({ ...store.getSnapshot(), status: 'loading', error: null, saving: false })
    try {
      const res = await fetch(CONFIG_API, { cache: 'no-store' })
      const body = (await res.json()) as Loose
      if (!res.ok || body?.ok !== true || !body.config || typeof body.config !== 'object') {
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
      }
      store.set({
        status: 'ready',
        value: { ...DEFAULT_TASK_NOTIFY_CONFIG, ...(body.config as Partial<TaskNotifyConfig>) },
        base: body.base && typeof body.base === 'object'
          ? { ...DEFAULT_TASK_NOTIFY_CONFIG, ...(body.base as Partial<TaskNotifyConfig>) }
          : DEFAULT_TASK_NOTIFY_CONFIG,
        revision: typeof body.revision === 'number' ? body.revision : 0,
        error: null,
        saving: false,
        savedAt: null,
      })
      console.info('[task-notify] desktop settings loaded: threshold=', store.getSnapshot().value?.thresholdMinutes)
    } catch (err) {
      store.set({
        ...store.getSnapshot(),
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        saving: false,
      })
      console.info('[task-notify] desktop settings load failed:', err)
    }
  }

  const save = async (next: TaskNotifyConfig): Promise<void> => {
    const snap = store.getSnapshot()
    store.set({ ...snap, saving: true, error: null })
    try {
      const res = await fetch(CONFIG_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: next, revision: snap.revision }),
      })
      const body = (await res.json()) as Loose
      if (!res.ok || body?.ok !== true) {
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)
      }
      const value = { ...DEFAULT_TASK_NOTIFY_CONFIG, ...(body.config as Partial<TaskNotifyConfig> | undefined) }
      store.set({
        status: 'ready',
        value,
        base: body.base && typeof body.base === 'object' ? { ...DEFAULT_TASK_NOTIFY_CONFIG, ...(body.base as Partial<TaskNotifyConfig>) } : snap.base,
        revision: typeof body.revision === 'number' ? body.revision : snap.revision + 1,
        error: null,
        saving: false,
        savedAt: Date.now(),
      })
      console.info('[task-notify] desktop settings saved: threshold=', value.thresholdMinutes, 'revision=', store.getSnapshot().revision)
      onConfigSaved(value)
    } catch (err) {
      // 被拒（冲突/校验）：保留草稿，重读最新值+版本，提示重试
      store.set({
        ...store.getSnapshot(),
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      })
      void load()
    }
  }

  const discard = (): void => {
    const snap = store.getSnapshot()
    store.set({ ...snap, savedAt: null, error: null })
  }

  void load()

  try {
    // 注册随 slots 账本生命周期（tab 页首次选中时挂载组件；账本清掉即卸载）
    slots.inject('settings.plugins.tab', () => slots.register({
      name: 'settings.plugins.tab',
      id: 'task-notify',
      order: 50,
      label: () => t('title'),
      locale: NS,
      inject: () => ({ store, load, save, discard, t }),
    }, TaskNotifySettingsPage))
  } catch (err) {
    console.info('[task-notify] desktop settings tab register failed:', err)
  }
}
