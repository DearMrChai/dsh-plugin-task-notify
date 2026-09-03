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