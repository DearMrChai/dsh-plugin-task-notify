/**
 * Notifier core: watches every listed session's conversation snapshot, plays a
 * short "嘟" per settled subagent-family call, and plays a clear "叮" (plus an
 * optional TTS line and a title flash) when a turn that ran past the threshold
 * completes and the agent returns idle — the moment the user should come back.
 *
 * The browser audio engine is Web Audio only (no assets), so the bundle stays
 * self-contained; TTS uses the platform `speechSynthesis` and defaults off.
 */
import type {
  ConversationSnapshot, ISessions, SessionFace, SettingsScope,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskNotifyConfig } from '../task-notify-config.ts'
import { DEFAULT_TASK_NOTIFY_CONFIG, SUBAGENT_TOOL_NAMES } from '../task-notify-config.ts'

/* ------------------------------------------------------------------ */
/* Frontend-style tracing: F12 → Console                                */
/*   localStorage.setItem('dsh:task-notify:debug','1');                */
/*   location.reload()                                                  */
/* Each `dbg()` line is gated behind that flag; apply() itself logs     */
/* one unconditional line so a missing bundle is visible at a glance.   */
/* ------------------------------------------------------------------ */

export function dbgEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try { return localStorage.getItem('dsh:task-notify:debug') === '1' } catch { return false }
}

export function dbg(...args: unknown[]): void {
  if (dbgEnabled()) console.info('[task-notify]', ...args)
}

/* ------------------------------------------------------------------ */
/* Web Audio engine (pure tones; no external assets)                   */
/* ------------------------------------------------------------------ */

class SoundEngine {
  private audio: AudioContext | null = null

  /** Browsers gate audio on a user gesture; unlock on the first interaction. */
  prime(): void {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return
    const unlock = (): void => { void this.ensure() }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
  }

  private ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null
    if (this.audio === null) this.audio = new AudioContext()
    if (this.audio.state === 'suspended') void this.audio.resume()
    return this.audio
  }

  private tone(freq: number, durMs: number, volume: number, type: OscillatorType, delayMs = 0): void {
    const audio = this.ensure()
    if (audio === null) return
    const t0 = audio.currentTime + delayMs / 1000
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000)
    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(t0)
    osc.stop(t0 + durMs / 1000 + 0.05)
    osc.onended = (): void => { osc.disconnect(); gain.disconnect() }
  }

  /** 子任务完成：短促"嘟"。 */
  sub(volume: number): void {
    this.tone(620, 130, volume, 'sine')
  }

  /** 整轮完成：清脆"叮"（上扬双音）。 */
  master(volume: number): void {
    this.tone(880, 160, volume, 'triangle')
    this.tone(1174.66, 300, volume, 'triangle', 150)
  }

  /** 可选的 TTS 一句播报（默认关；后台标签页可能被浏览器节流）。 */
  speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    speechSynthesis.speak(utter)
  }
}

/** 标题闪动若干轮后还原。 */
function flashTitle(times = 3, intervalMs = 700): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const original = document.title
  let tick = 0
  const timer = window.setInterval(() => {
    document.title = tick % 2 === 0 ? `● 任务完成 — ${original}` : original
    tick += 1
    if (tick >= times * 2) {
      window.clearInterval(timer)
      document.title = original
    }
  }, intervalMs)
}

/* ------------------------------------------------------------------ */
/* Subagent-family completion detection (diff over runningCalls)       */
/* ------------------------------------------------------------------ */

interface RunningCallLike {
  callId?: string
  name?: string
  subCalls?: readonly RunningCallLike[]
}

function collectSubagentIds(nodes: readonly unknown[]): Set<string> {
  const ids = new Set<string>()
  const walk = (items: readonly unknown[]): void => {
    for (const item of items) {
      const call = item as RunningCallLike
      if (typeof call?.name === 'string' && SUBAGENT_TOOL_NAMES.includes(call.name) && typeof call.callId === 'string') {
        ids.add(call.callId)
      }
      if (Array.isArray(call?.subCalls)) walk(call.subCalls)
    }
  }
  walk(nodes)
  return ids
}

/* ------------------------------------------------------------------ */
/* Per-session tracker                                                 */
/* ------------------------------------------------------------------ */

class SessionTracker {
  private runStartAt: number | null = null
  private wasRunning = false
  private openIds = new Set<string>()
  private lastBeepAt = 0
  private beepedThisTurn = false

  constructor(
    private readonly id: string,
    private readonly config: () => TaskNotifyConfig,
    private readonly engine: SoundEngine,
    private readonly session: SessionFace,
  ) {
    this.adopt()
  }

  private snapshot(): ConversationSnapshot {
    return this.session.getSnapshot()
  }

  private adopt(): void {
    const snap = this.snapshot()
    this.wasRunning = snap.running
    this.openIds = collectSubagentIds(snap.runningCalls)
    if (snap.running) this.runStartAt = this.openTurnStart(snap) ?? Date.now()
    dbg('adopt', this.id, { running: snap.running, openSubagents: this.openIds.size })
  }

  /** 当前未结束轮次的起始时间（更准）；无则回退到挂载时刻。 */
  private openTurnStart(snap: ConversationSnapshot): number | null {
    for (const timing of snap.turnTimings.values()) {
      if (timing.endTime === undefined) return timing.startTime
    }
    return null
  }

  private minutes(durationMs: number): string {
    return (durationMs / 60000).toFixed(1)
  }

  handle(): void {
    const snap = this.snapshot()
    const cfg = this.config()
    if (!cfg.enabled) { this.wasRunning = snap.running; return }

    /* --- 整轮完成（发出不响、回复完成才响）：running true → false --- */
    if (snap.running && !this.wasRunning) {
      this.runStartAt = this.openTurnStart(snap) ?? Date.now()
      this.beepedThisTurn = false
      console.info('[task-notify] turn start:', this.id, '（发出不响，开始计时）')
    } else if (!snap.running && this.wasRunning) {
      const start = this.runStartAt
      this.runStartAt = null
      if (start !== null) {
        const durationMs = Date.now() - start
        const thresholdMs = cfg.thresholdMinutes * 60000
        console.info('[task-notify] turn end:', this.id, `dur=${Math.round(durationMs / 1000)}s`, `threshold=${cfg.thresholdMinutes}min`, durationMs >= thresholdMs ? '→ over，响应叮' : '→ short，静音')
        if (durationMs >= thresholdMs) {
          this.engine.master(cfg.masterVolume)
          if (cfg.titleFlash) flashTitle()
          if (cfg.ttsEnabled) {
            this.engine.speak(`任务完成，用时约 ${this.minutes(durationMs)} 分钟`)
          }
        }
      }
    } else if (!snap.running) {
      this.runStartAt = null
    }
    this.wasRunning = snap.running

    /* --- 子任务完成：subagent 家族调用从 running 集合消失 → 嘟 --- */
    if (cfg.subReminderEnabled) {
      const next = collectSubagentIds(snap.runningCalls)
      let settled = 0
      for (const id of this.openIds) if (!next.has(id)) settled += 1
      if (settled > 0) {
        const now = Date.now()
        const merged = cfg.batchSingleBeep ? this.beepedThisTurn : now - this.lastBeepAt < cfg.mergeMs
        console.info('[task-notify] sub settled:', this.id, `n=${settled}`, merged ? '→ merged（静默）' : '→ 嘟')
        if (!merged) {
          this.engine.sub(cfg.subVolume)
          this.lastBeepAt = now
          this.beepedThisTurn = true
        }
      }
      this.openIds = next
    }
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                                */
/* ------------------------------------------------------------------ */

/**
 * Attach a tracker to every listed session (or only the current one when
 * `globalSessions` is off), re-sync when the session list moves, and keep the
 * engine primed for browser autoplay policy. All disposals ride the plugin
 * ctx through the returned cleanup function.
 */
export function installNotifier(
  sessions: ISessions,
  scope: SettingsScope<TaskNotifyConfig>,
  cleanup: (dispose: () => void) => void,
): void {
  const engine = new SoundEngine()
  engine.prime()

  let cfg: TaskNotifyConfig = scope.getSnapshot().value ?? DEFAULT_TASK_NOTIFY_CONFIG
  console.info('[task-notify] installNotifier:', 'global=', cfg.globalSessions, 'sessions=', sessions.list.getSnapshot().ids.length, 'current=', sessions.list.getSnapshot().current, 'cfg=', cfg)
  cleanup(() => scope.subscribe(() => {
    cfg = scope.getSnapshot().value ?? cfg
    dbg('cfg updated', cfg)
  }))

  const trackers = new Map<string, SessionTracker>()

  const sync = (): void => {
    const list = sessions.list.getSnapshot()
    const activeIds = cfg.globalSessions ? [...list.ids] : (list.current !== undefined ? [list.current] : [])
    const wanted = new Set<string>(activeIds)
    dbg('sync sessions', 'global=', cfg.globalSessions, 'wanted=', [...wanted], 'trackers=', trackers.size)
    for (const id of activeIds) {
      if (trackers.has(id)) continue
      const binding = sessions.binding(id)
      const session = binding?.session
      if (session === undefined) continue
      const tracker = new SessionTracker(id, () => cfg, engine, session)
      cleanup(() => session.subscribe(() => tracker.handle()))
      trackers.set(id, tracker)
      console.info('[task-notify] attach tracker:', id)
    }
    for (const [id, tracker] of trackers) {
      if (!wanted.has(id)) trackers.delete(id)
    }
  }

  cleanup(() => sessions.list.subscribe(sync))
  sync()
}