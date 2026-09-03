/**
 * Settings card for the Plugins tab, restyled to the DSH standard card
 * pattern (see packages/client/ui-settings-plugins/src/client/PluginCard.tsx
 * + fields.tsx): a collapsible card header (name + description + chevron +
 * "unsaved" badge while dirty), staged fields that only write on Save, and a
 * Discard/Save footer. Styling mirrors the standard CSS modules 1:1 through
 * DSW design tokens, inlined as CSS-in-JS because this plugin's client bundle
 * is built by tsdown without a CSS pipeline.
 *
 * Behavior vs. the earlier build (DSH standard contract): edits are staged
 * locally — booleans toggle into a draft, numeric fields keep raw text — and
 * only committed to the bound settings scope on Save; Discard drops the draft.
 */
import { useState, type CSSProperties } from 'react'
import type { TaskNotifyConfig } from '../task-notify-config.ts'
import { DEFAULT_TASK_NOTIFY_CONFIG } from '../task-notify-config.ts'

/** Props the card receives from the register's `inject` closure. */
export interface TaskNotifyCardInjected {
  /** Resolved value at registration. */
  value: TaskNotifyConfig
  /** Write one field to the namespace's user layer. */
  set: <K extends keyof TaskNotifyConfig>(field: K, value: TaskNotifyConfig[K]) => void
}

/* ---------------------------------------------------------------------------
 * DSW standard card tokens (mirror of PluginCard.module.css + fields.module.css)
 * ------------------------------------------------------------------------- */
const T = {
  borderL2: 'var(--dsw-alias-border-l2)',
  labelDimmed: 'var(--dsw-alias-label-dimmed)',
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  labelError: 'var(--dsw-alias-label-error)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgLayer3: 'var(--dsw-alias-bg-layer-3)',
  bgModulePlatform: 'var(--dsw-alias-bg-module-platform)',
  brandPrimary: 'var(--dsw-alias-brand-primary)',
}

const s: Record<string, CSSProperties> = {
  card: { listStyle: 'none', border: `1px solid ${T.borderL2}`, borderRadius: 12, background: T.bgLayer3, transition: 'border-color .16s, background .16s' },
  cardOpen: { background: T.bgLayer2, borderColor: T.labelDimmed },
  header: { width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12 },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: T.labelPrimary },
  description: { fontSize: 13, lineHeight: 1.5, color: T.labelTertiary },
  chevron: { flex: 'none', color: T.labelTertiary, transition: 'transform .16s' },
  chevronOpen: { transform: 'rotate(180deg)' },
  body: { borderTop: `1px solid ${T.borderL2}`, margin: '0 16px', paddingBottom: 8 },
  pending: { flex: 'none', borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', fontWeight: 500, whiteSpace: 'nowrap', background: T.bgModulePlatform, color: T.labelSecondary },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: `1px solid ${T.borderL2}` },
  field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
  fieldBorder: { borderTop: `1px solid ${T.borderL2}` },
  head: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: T.labelPrimary },
  badges: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px', whiteSpace: 'nowrap', fontWeight: 500, background: T.bgModulePlatform, color: T.labelSecondary },
  reset: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: T.labelSecondary, cursor: 'pointer' },
  input: { height: 34, padding: '0 12px', border: `1px solid ${T.borderL2}`, borderRadius: 8, background: T.bgLayer3, font: 'inherit', fontSize: 13, lineHeight: 1.5, color: T.labelPrimary, width: '100%', boxSizing: 'border-box' },
  inputInvalid: { borderColor: T.labelError },
  invalid: { margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelError },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: T.labelTertiary },
}

/** Inline chevron-down icon (same glyph as IconChevronDownOutline14, no runtime dep). */
function ChevronIcon({ style, open }: { style: CSSProperties; open: boolean }) {
  const merged: CSSProperties = open ? { ...style, ...s.chevronOpen } : style
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={merged}>
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 9.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Label + control + hint field, mirroring fields.tsx's ValueField. */
function Field(props: {
  id: string
  label: string
  hint: string
  text: string
  invalid: boolean
  overridden: boolean
  overriddenLabel: string
  resetLabel: string
  invalidLabel: string
  numeric?: boolean
  disabled: boolean
  /** Adjacent border when this field follows another field (DSH .field + .field). */
  border?: boolean
  onEdit: (text: string) => void
  onReset: () => void
}) {
  return (
    <div style={props.border ? { ...s.field, ...s.fieldBorder } : s.field}>
      <div style={s.head}>
        <label style={s.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden ? (
          <span style={s.badges}>
            <span style={s.badge}>{props.overriddenLabel}</span>
            <button type="button" style={s.reset} disabled={props.disabled} onClick={props.onReset}>{props.resetLabel}</button>
          </span>
        ) : null}
      </div>
      <input
        id={props.id}
        style={props.invalid ? { ...s.input, ...s.inputInvalid } : s.input}
        type="text"
        {...(props.numeric ? { inputMode: 'numeric' as const } : {})}
        {...(props.invalid ? { 'aria-invalid': true } : {})}
        value={props.text}
        disabled={props.disabled}
        onChange={(e) => { props.onEdit(e.target.value) }}
      />
      <p style={props.invalid ? s.invalid : s.hint}>{props.invalid ? props.invalidLabel : props.hint}</p>
    </div>
  )
}

/** DSW-style switch used for every boolean setting (not a native checkbox). */
function Switch(props: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  border: boolean
  onChange: (next: boolean) => void
}) {
  const track: CSSProperties = {
    width: 34, height: 20, borderRadius: 999,
    background: props.checked ? T.brandPrimary : T.bgLayer3,
    border: `1px solid ${props.checked ? T.brandPrimary : T.borderL2}`,
    position: 'relative', cursor: props.disabled ? 'default' : 'pointer', flex: 'none', opacity: props.disabled ? 0.5 : 1,
    transition: 'background .16s, border-color .16s',
  }
  const thumb: CSSProperties = {
    position: 'absolute', top: 2, left: props.checked ? 16 : 2, width: 14, height: 14, borderRadius: '50%',
    background: props.checked ? T.bgLayer3 : T.labelSecondary, transition: 'left .16s, background .16s',
  }
  return (
    <div style={props.border ? { ...s.field, ...s.fieldBorder } : s.field}>
      <div style={s.head}>
        <span style={s.label}>{props.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={props.checked}
          aria-label={props.label}
          disabled={props.disabled}
          onClick={() => { props.onChange(!props.checked) }}
          style={track}
        >
          <span style={thumb} />
        </button>
      </div>
      <p style={s.hint}>{props.hint}</p>
    </div>
  )
}

/** Numeric keys of the config: staged as raw text until Save. */
const NUM_KEYS = ['thresholdMinutes', 'mergeMs', 'masterVolume', 'subVolume'] as const
type NumKey = (typeof NUM_KEYS)[number]
/** Boolean keys of the config: staged directly into the draft. */
const BOOL_KEYS = ['enabled', 'subReminderEnabled', 'ttsEnabled', 'titleFlash', 'globalSessions', 'batchSingleBeep'] as const
type BoolKey = (typeof BOOL_KEYS)[number]

function parseNum(text: string, fallback: number): number {
  if (text === '') return fallback
  const n = Number(text)
  return Number.isFinite(n) ? n : fallback
}

export function TaskNotifyCard({ value, set }: TaskNotifyCardInjected) {
  const [open, setOpen] = useState(false)
  const base = value ?? DEFAULT_TASK_NOTIFY_CONFIG
  const [bools, setBools] = useState<TaskNotifyConfig | null>(null)
  const [numText, setNumText] = useState<Record<NumKey, string>>(() => ({
    thresholdMinutes: String(base.thresholdMinutes),
    mergeMs: String(base.mergeMs),
    masterVolume: String(base.masterVolume),
    subVolume: String(base.subVolume),
  }))
  const [ttsTemplateText, setTtsTemplateText] = useState(base.ttsTemplate ?? '任务完成，用时约 {time} 分钟')

  const boolDirty = bools !== null && BOOL_KEYS.some((k) => (bools as TaskNotifyConfig)[k] !== base[k])
  const numDirty = NUM_KEYS.some((k) => numText[k] !== String(base[k]))
  const ttsDirty = ttsTemplateText !== (base.ttsTemplate ?? '任务完成，用时约 {time} 分钟')
  const invalid = NUM_KEYS.some((k) => numText[k] !== '' && !Number.isFinite(Number(numText[k])))
  const dirty = boolDirty || numDirty || ttsDirty

  const toggleBool = (key: BoolKey, next: boolean): void => {
    setBools((b) => ({ ...(b ?? base), [key]: next }))
  }
  const editNum = (key: NumKey, text: string): void => {
    setNumText((t) => ({ ...t, [key]: text }))
  }
  const resetNum = (key: NumKey): void => {
    setNumText((t) => ({ ...t, [key]: String(base[key]) }))
  }

  const onSave = (): void => {
    if (!dirty || invalid) return
    for (const k of NUM_KEYS) {
      if (numText[k] !== String(base[k])) set(k, parseNum(numText[k], base[k]))
    }
    if (bools !== null) {
      for (const k of BOOL_KEYS) {
        const b = (bools as TaskNotifyConfig)[k]
        if (b !== base[k]) set(k, b)
      }
    }
    if (ttsDirty) set('ttsTemplate', ttsTemplateText)
    setBools(null)
  }
  const onDiscard = (): void => {
    setBools(null)
    setNumText({ thresholdMinutes: String(base.thresholdMinutes), mergeMs: String(base.mergeMs), masterVolume: String(base.masterVolume), subVolume: String(base.subVolume) })
    setTtsTemplateText(base.ttsTemplate ?? '任务完成，用时约 {time} 分钟')
  }

  const name = '任务提醒'
  const description = '长轮完成“叮”、子任务完成“嘟”：阈值、音量与提醒形式可按需配置'

  const cur = { ...base, ...(bools ?? {}), ttsTemplate: ttsTemplateText, thresholdMinutes: parseNum(numText.thresholdMinutes, base.thresholdMinutes), mergeMs: parseNum(numText.mergeMs, base.mergeMs), masterVolume: parseNum(numText.masterVolume, base.masterVolume), subVolume: parseNum(numText.subVolume, base.subVolume) } as TaskNotifyConfig

  return (
    <li style={open ? { ...s.card, ...s.cardOpen } : s.card}>
      <button
        type="button"
        style={s.header}
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}：${name}`}
        onClick={() => { setOpen(!open) }}
      >
        <span style={s.headText}>
          <span style={s.name}>{name}</span>
          <span style={s.description}>{description}</span>
        </span>
        {dirty ? <span style={s.pending}>未保存</span> : null}
        <ChevronIcon style={s.chevron} open={open} />
      </button>
      {open ? (
        <div style={s.body}>
          <Switch label="启用声音提醒" hint="总开关：关闭后任何声音/闪动都不触发" checked={cur.enabled} disabled={false} border={false} onChange={(v) => { toggleBool('enabled', v) }} />
          <Field
            id="task-notify-thresholdMinutes"
            label="整轮完成提醒阈值（分钟）"
            hint="你发出消息不响；这轮运行超过该时长、回复完成时才响“叮”。短轮不打扰。"
            text={numText.thresholdMinutes}
            invalid={numText.thresholdMinutes !== '' && !Number.isFinite(Number(numText.thresholdMinutes))}
            overridden={numText.thresholdMinutes !== String(base.thresholdMinutes)}
            overriddenLabel="已修改"
            resetLabel="重置"
            invalidLabel="需为数字"
            numeric
            disabled={false}
            border
            onEdit={(t) => { editNum('thresholdMinutes', t) }}
            onReset={() => { resetNum('thresholdMinutes') }}
          />
          <Switch label="子任务完成提醒（嘟）" hint="子代理完成时短促一声" checked={cur.subReminderEnabled} disabled={false} border onChange={(v) => { toggleBool('subReminderEnabled', v) }} />
          <Field
            id="task-notify-mergeMs"
            label="连续子任务合并窗口（毫秒）"
            hint="窗口内多个子任务完成只响一声“嘟”"
            text={numText.mergeMs}
            invalid={numText.mergeMs !== '' && !Number.isFinite(Number(numText.mergeMs))}
            overridden={numText.mergeMs !== String(base.mergeMs)}
            overriddenLabel="已修改"
            resetLabel="重置"
            invalidLabel="需为数字"
            numeric
            disabled={false}
            border
            onEdit={(t) => { editNum('mergeMs', t) }}
            onReset={() => { resetNum('mergeMs') }}
          />
          <Field
            id="task-notify-masterVolume"
            label="“叮”音量"
            hint="整轮完成提示音量，0–1"
            text={numText.masterVolume}
            invalid={numText.masterVolume !== '' && !Number.isFinite(Number(numText.masterVolume))}
            overridden={numText.masterVolume !== String(base.masterVolume)}
            overriddenLabel="已修改"
            resetLabel="重置"
            invalidLabel="需为数字"
            numeric
            disabled={false}
            border
            onEdit={(t) => { editNum('masterVolume', t) }}
            onReset={() => { resetNum('masterVolume') }}
          />
          <Field
            id="task-notify-subVolume"
            label="“嘟”音量"
            hint="子任务完成提示音量，0–1"
            text={numText.subVolume}
            invalid={numText.subVolume !== '' && !Number.isFinite(Number(numText.subVolume))}
            overridden={numText.subVolume !== String(base.subVolume)}
            overriddenLabel="已修改"
            resetLabel="重置"
            invalidLabel="需为数字"
            numeric
            disabled={false}
            border
            onEdit={(t) => { editNum('subVolume', t) }}
            onReset={() => { resetNum('subVolume') }}
          />
          <Switch label="TTS 语音播报" hint="整轮完成时读一句自定义模板，默认关" checked={cur.ttsEnabled} disabled={false} border onChange={(v) => { toggleBool('ttsEnabled', v) }} />
          {cur.ttsEnabled ? (
            <Field
              id="task-notify-ttsTemplate"
              label="TTS 播报模板"
              hint="用 {time} 代表实际用时，如“报告队长！用了 {time} 搞定了~”"
              text={ttsTemplateText}
              invalid={false}
              overridden={ttsDirty}
              overriddenLabel="已修改"
              resetLabel="重置"
              invalidLabel=""
              disabled={false}
              border
              onEdit={(t) => { setTtsTemplateText(t) }}
              onReset={() => { setTtsTemplateText(base.ttsTemplate ?? '任务完成，用时约 {time} 分钟') }}
            />
          ) : null}
          <Switch label="标题闪动" hint="整轮完成时页面标题闪“● 任务完成”" checked={cur.titleFlash} disabled={false} border onChange={(v) => { toggleBool('titleFlash', v) }} />
          <Switch label="多会话全局提醒" hint="任意会话长轮结束都响；关掉只监听当前会话" checked={cur.globalSessions} disabled={false} border onChange={(v) => { toggleBool('globalSessions', v) }} />
          <Switch label="整批只响一声" hint="一轮内多个子任务完成只响一声嘟" checked={cur.batchSingleBeep} disabled={false} border onChange={(v) => { toggleBool('batchSingleBeep', v) }} />
          <div style={s.footer}>
            <button type="button" style={dirty ? { ...s.reset, border: `1px solid ${T.borderL2}`, borderRadius: 8, padding: '5px 14px', fontSize: 13, background: 'none', color: T.labelSecondary } : { ...s.reset, opacity: 0.4, cursor: 'default' }} disabled={!dirty} onClick={onDiscard}>放弃</button>
            <button type="button" style={dirty && !invalid ? { background: T.labelPrimary, color: T.bgLayer3, border: '1px solid transparent', borderRadius: 8, padding: '5px 14px', fontSize: 13, lineHeight: 1.5, cursor: 'pointer' } : { background: T.labelPrimary, color: T.bgLayer3, border: '1px solid transparent', borderRadius: 8, padding: '5px 14px', fontSize: 13, lineHeight: 1.5, opacity: 0.4, cursor: 'default' }} disabled={!dirty || invalid} onClick={onSave}>保存</button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
