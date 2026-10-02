/**
 * Desktop notifier path (DSH 桌面端 0.2.0-rc.2 客户端运行时).
 *
 * 与 web 路径的差异（由 client/index.ts 的能力探测决定走哪条）：
 *  - 0.2.0 客户端运行时没有 settingsScope 服务，也没有 settings.plugin.item
 *    槽位（设置页不再渲染该槽）→ 配置来源改为宿主半的 /task-notify/api/config
 *    路由（桌面端改配置 = 手编 profiles/desktop/cordis.patch.yml 后重启）；
 *  - 会话契约不同：retain(id) 换掉 binding(id)，轮次边界走
 *    session.eventSource 事件流（turn/start + turn/end，0.1.6-alpha.2+ 客户端
 *    契约，dsh-plugin-whale-pet 同款消费方式），不再读 getSnapshot().running；
 *  - 子代理识别 = 会话行 parentSessionId（byId 行携带；字段缺失时该特性
 *    静默降级为不响，不会误报成主任务"叮"）。
 *
 * 硬约束 3 自保：本文件对外部运行时的一切访问都是形状探测 + try/catch，
 * 任何意外形状只记日志并跳过，绝不让共享 client bundle 因本插件整体失败。
 */
import { DEFAULT_TASK_NOTIFY_CONFIG, type TaskNotifyConfig } from '../task-notify-config.ts'
import { SoundEngine, dbg, flashTitle } from './notifier.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = Record<string, any>

/** 事件时间的宽容读取：事件自带 time（ms）优先，缺失回退接收时刻。 */
function eventTime(event: Loose | undefined): number {
  const direct = event?.time
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  const nested = event?.data?.time
  if (typeof nested === 'number' && Number.isFinite(nested)) return nested
  return Date.now()
}

/** entries 行 → 内嵌事件（{type:'event', event:{seq,type,data}}）。 */
function entryEvent(item: unknown): Loose | undefined {
  const row = item as Loose | undefined
  if (!row || typeof row !== 'object' || row.type !== 'event') return undefined
  const event = row.event
  return event && typeof event === 'object' ? (event as Loose) : undefined
}

/** 当前会话 id：byId 行 retainedBy.mainView > 0（whale-pet 同款读取）。 */
function currentSessionId(byId: Loose | undefined): string | undefined {
  if (!byId || typeof byId !== 'object') return undefined
  for (const [id, row] of Object.entries(byId as Record<string, Loose>)) {
    const main = row?.retainedBy?.mainView
    if (typeof main === 'number' && main > 0) return id
  }
  return undefined
}

/** 单会话轮次追踪：eventSource 事件流 → 阈值判断 → 嘟 / 叮。 */
class DesktopTurnTracker {
  private turnStartAt: number | null = null
  private lastSeq = Number.NEGATIVE_INFINITY
  private lastBeepAt = 0
  private beepedThisTurn = false

  constructor(
    private readonly id: string,
    private readonly config: () => TaskNotifyConfig,
    private readonly engine: SoundEngine,
    private readonly isSubagent: () => boolean,
  ) {}

  /** 初次挂载：扫可见 entries 认领已开轮（只计时，不补响历史轮）。 */
  adopt(entries: unknown[] | undefined): void {
    let openStart: number | null = null
    for (const item of entries ?? []) {
      const event = entryEvent(item)
      if (!event) continue
      const seq = event.seq
      if (typeof seq === 'number' && seq > this.lastSeq) this.lastSeq = seq
      if (event.type === 'turn/start') openStart = eventTime(event)
      else if (event.type === 'turn/end') openStart = null
    }
    this.turnStartAt = openStart
    dbg('desktop adopt', this.id, { openStart, lastSeq: this.lastSeq })
  }

  /** 事件流通知：只处理 lastSeq 之后的新事件（重扫可见窗口，量小）。 */
  ingest(entries: unknown[] | undefined): void {
    for (const item of entries ?? []) {
      const event = entryEvent(item)
      if (!event) continue
      const seq = event.seq
      if (typeof seq !== 'number' || seq <= this.lastSeq) continue
      this.lastSeq = seq
      try {
        this.handleEvent(event)
      } catch (err) {
        dbg('desktop handleEvent failed', this.id, err)
      }
    }
  }

  private handleEvent(event: Loose): void {
    const cfg = this.config()
    if (cfg.enabled === false) return
    if (event.type === 'turn/start') {
      this.turnStartAt = eventTime(event)
      this.beepedThisTurn = false
      console.info('[task-notify] desktop turn start:', this.id, '（开始计时，发出不响）')
      return
    }
    if (event.type !== 'turn/end') return
    const start = this.turnStartAt
    this.turnStartAt = null
    if (start === null) return
    const durationMs = Math.max(0, Date.now() - start)
    if (this.isSubagent()) {
      if (!cfg.subReminderEnabled) return
      const now = Date.now()
      const merged = cfg.batchSingleBeep ? this.beepedThisTurn : now - this.lastBeepAt < cfg.mergeMs
      if (merged) {
        dbg('desktop sub settled merged', this.id)
        return
      }
      this.lastBeepAt = now
      this.beepedThisTurn = true
      console.info('[task-notify] desktop sub settled:', this.id, '→ 嘟')
      this.engine.sub(cfg.subVolume)
      return
    }
    const thresholdMs = cfg.thresholdMinutes * 60000
    console.info(
      '[task-notify] desktop turn end:',
      this.id,
      `dur=${Math.round(durationMs / 1000)}s`,
      `threshold=${cfg.thresholdMinutes}min`,
      durationMs >= thresholdMs ? '→ over，响叮' : '→ short，静音',
    )
    if (durationMs >= thresholdMs) {
      this.engine.master(cfg.masterVolume)
      if (cfg.titleFlash) flashTitle()
      if (cfg.ttsEnabled) {
        const template = cfg.ttsTemplate ?? DEFAULT_TASK_NOTIFY_CONFIG.ttsTemplate
        this.engine.speak(template.replace(/\{time\}/g, (durationMs / 60000).toFixed(1)))
      }
    }
  }
}

/**
 * 桌面端通知器装配：配置拉取 + sessions.list 跟随 + 逐会话 retain 事件流。
 * 任何一步失败都只降级（少响或不响），绝不抛出到 apply 之外。
 */
export function installDesktopNotifier(ctx: Loose): void {
  const sessions = ctx?.sessions
  const list = sessions?.list
  if (!list || typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') {
    console.info('[task-notify] desktop: sessions.list 不可用 → 提醒空闲')
    return
  }
  if (typeof sessions.retain !== 'function') {
    console.info('[task-notify] desktop: sessions.retain 不可用 → 提醒空闲')
    return
  }

  const engine = new SoundEngine()
  engine.prime()

  const state = { cfg: { ...DEFAULT_TASK_NOTIFY_CONFIG } }
  let sync: () => void = () => {}

  // 配置：宿主半路由（0.2.0 无 settingsScope；桌面端改配置 = 手编 patch yml + 重启）
  const refreshConfig = async (): Promise<void> => {
    try {
      const res = await fetch('/task-notify/api/config', { cache: 'no-store' })
      const body = (await res.json()) as Loose
      if (body?.ok === true && body.config && typeof body.config === 'object') {
        state.cfg = { ...DEFAULT_TASK_NOTIFY_CONFIG, ...(body.config as Partial<TaskNotifyConfig>) }
        console.info(
          '[task-notify] desktop config loaded: threshold=',
          state.cfg.thresholdMinutes,
          'global=',
          state.cfg.globalSessions,
        )
        sync()
      }
    } catch (err) {
      console.info('[task-notify] desktop config fetch failed（沿用默认值）:', err)
    }
  }
  try {
    const connState = ctx?.connection?.state
    if (connState && typeof connState.subscribe === 'function') {
      connState.subscribe((s: unknown) => {
        if (s === 'connected') void refreshConfig()
      })
    }
  } catch {
    /* connection 服务缺失不致命：仅失去配置热刷新 */
  }
  void refreshConfig()

  const trackers = new Map<string, { dispose: () => void }>()

  /** 子代理判定：会话行 parentSessionId 存在即子代理（字段缺失 → 一律视为主会话）。 */
  const isSubagentRow = (id: string): boolean => {
    try {
      const row = list.getSnapshot()?.byId?.[id] as Loose | undefined
      return row?.parentSessionId !== undefined && row?.parentSessionId !== null
    } catch {
      return false
    }
  }

  const attach = (id: string): void => {
    if (trackers.has(id)) return
    let ref: Loose | undefined
    try {
      ref = sessions.retain(id, { source: 'task-notify' })
    } catch (err) {
      dbg('desktop retain failed', id, err)
      return
    }
    const session = ref?.binding?.session
    const source = session?.eventSource
    if (!ref || !session || !source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') {
      try {
        ref?.release?.()
      } catch {
        /* 已释放 */
      }
      dbg('desktop eventSource unavailable', id)
      return
    }
    const tracker = new DesktopTurnTracker(id, () => state.cfg, engine, () => isSubagentRow(id))
    try {
      tracker.adopt(source.getSnapshot()?.entries)
    } catch (err) {
      dbg('desktop adopt failed', id, err)
    }
    let stopEvents: () => void = () => {}
    try {
      const unsubscribe = source.subscribe(() => {
        try {
          tracker.ingest(source.getSnapshot()?.entries)
        } catch {
          /* 单次处理失败不影响后续事件 */
        }
      })
      stopEvents = typeof unsubscribe === 'function' ? unsubscribe : () => {}
    } catch (err) {
      dbg('desktop subscribe failed', id, err)
      try {
        ref.release()
      } catch {
        /* 已释放 */
      }
      return
    }
    trackers.set(id, {
      dispose: () => {
        try {
          stopEvents()
        } catch {
          /* 已停 */
        }
        try {
          ref.release()
        } catch {
          /* 已释放 */
        }
      },
    })
    console.info('[task-notify] desktop attach tracker:', id)
  }

  sync = (): void => {
    let ids: string[] = []
    let current: string | undefined
    try {
      const snap = list.getSnapshot() as Loose | undefined
      ids = Array.isArray(snap?.ids) ? (snap.ids as string[]) : []
      current = currentSessionId(snap?.byId)
    } catch (err) {
      dbg('desktop list snapshot failed', err)
      return
    }
    const activeIds = state.cfg.globalSessions ? ids : current !== undefined ? [current] : []
    const wanted = new Set<string>(activeIds)
    dbg('desktop sync sessions', 'global=', state.cfg.globalSessions, 'wanted=', [...wanted], 'trackers=', trackers.size)
    for (const id of activeIds) attach(id)
    for (const [id, entry] of trackers) {
      if (!wanted.has(id)) {
        entry.dispose()
        trackers.delete(id)
      }
    }
  }

  try {
    list.subscribe(() => sync())
  } catch (err) {
    dbg('desktop list subscribe failed', err)
  }
  sync()
}
