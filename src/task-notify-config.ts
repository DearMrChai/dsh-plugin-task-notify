/**
 * Shared settings shape for both halves of the plugin. The Host half owns the
 * schema + persistence (settings namespace `task-notify`); the browser half
 * reads the resolved value through its bound settings scope. Both halves
 * spell the namespace literal so no cross-half value import is needed.
 */

export const TASK_NOTIFY_NS = 'task-notify'

/** 长任务完成提醒的全部可配置项。 */
export interface TaskNotifyConfig {
  /** 总开关：关闭后任何声音/闪动都不触发。 */
  enabled: boolean
  /** 主任务提醒阈值（分钟）：单轮从开始到结束超过它才响“叮”。 */
  thresholdMinutes: number
  /** 子任务“嘟”提醒开关。 */
  subReminderEnabled: boolean
  /** 连续子任务合并窗口（毫秒）：窗口内多个子任务完成只响一声“嘟”。 */
  mergeMs: number
  /** “叮”（整轮完成）音量，0..1。 */
  masterVolume: number
  /** “嘟”（子任务完成）音量，0..1。 */
  subVolume: number
  /** TTS 播报开关（默认关）：开的话整轮完成时读一句“任务完成，用时 X 分钟”。 */
  ttsEnabled: boolean
  /** TTS 播报模板：{time} 会被替换为实际用时（如 "3.5 分钟"）。 */
  ttsTemplate: string
  /** 标题栏闪动开关：整轮完成时页面标题闪“● 任务完成”。 */
  titleFlash: boolean
  /** 多会话全局提醒：任何会话的整轮完成都响（默认开）；关掉只监听当前会话。 */
  globalSessions: boolean
  /** 整批只响一声：一轮中所有子任务完成只响一声“嘟”（默认关，逐声计）。 */
  batchSingleBeep: boolean
}

/** 默认值（与新装的用户一致；已有用户文档不受影响）。 */
export const DEFAULT_TASK_NOTIFY_CONFIG: TaskNotifyConfig = {
  enabled: true,
  thresholdMinutes: 5,
  subReminderEnabled: true,
  mergeMs: 500,
  masterVolume: 0.6,
  subVolume: 0.5,
  ttsEnabled: false,
  ttsTemplate: '任务完成，用时约 {time} 分钟',
  titleFlash: true,
  globalSessions: true,
  batchSingleBeep: false,
}

/** 子任务家族的模型工具名（子代理类）。出现/消失用于触发“嘟”。 */
export const SUBAGENT_TOOL_NAMES: readonly string[] = [
  'subagent',
  'subagent_fork',
  'subagent_codex',
  'subagent_claude_code',
]

/**
 * 0.3.1 起 Config 字段标了 `.volatile()`（0.2.0 SettingsForms 出表单的前提）。
 * 运行时按 schemastery 语义把 volatile 字段解析成“引用”对象
 * （`{ get(): value, [writeSymbol](v) }`，cosmokit createVolatile 形态），
 * 不是普通值。跨端消费配置前统一解包：
 *  - 0.2.0 host：apply(ctx, config) 里字段即引用，须 `.get()`；
 *  - 0.1.x web：旧 dsh-settings register 时同样按 schema resolve，字段也可能
 *    是引用 —— 兜底解包，保证两代运行时行为一致。
 * 非引用值（含 0.1.x 全部普通值）原样返回，纯函数无副作用。
 */
export type VolatileLike = { get: () => unknown }

/** 拆一个可能 volatile 的字段值：引用对象 → `.get()`，其余原样。 */
export function unwrapVolatile<T>(value: T | VolatileLike | undefined): T | undefined {
  if (value !== null && typeof value === 'object' && typeof (value as VolatileLike).get === 'function') {
    try {
      return (value as VolatileLike).get() as T
    } catch {
      return value as T
    }
  }
  return value as T | undefined
}

/**
 * 默认值 + 用户层浅合并后逐字段解包，得到纯数据配置视图。
 * host 路由序列化 / client 通知器 / 设置卡都以此为准。
 */
export function resolvePlainConfig(config: TaskNotifyConfig | VolatileLike | null | undefined): TaskNotifyConfig {
  const raw = { ...DEFAULT_TASK_NOTIFY_CONFIG, ...(config as Partial<TaskNotifyConfig> ?? {}) }
  const out = {} as Record<keyof TaskNotifyConfig, unknown>
  for (const key of Object.keys(raw) as Array<keyof TaskNotifyConfig>) {
    out[key] = unwrapVolatile(raw[key]) ?? DEFAULT_TASK_NOTIFY_CONFIG[key]
  }
  return out as unknown as TaskNotifyConfig
}