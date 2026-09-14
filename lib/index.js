import z from "@deepseek-ai/schemastery";
//#region src/task-notify-config.ts
/**
* Shared settings shape for both halves of the plugin. The Host half owns the
* schema + persistence (settings namespace `task-notify`); the browser half
* reads the resolved value through its bound settings scope. Both halves
* spell the namespace literal so no cross-half value import is needed.
*/
const TASK_NOTIFY_NS = "task-notify";
//#endregion
//#region src/index.ts
/** The `task-notify` settings namespace brand (join key with the browser half). */
const TASK_NOTIFY_SETTINGS_NS = TASK_NOTIFY_NS;
/** Cordis dependency declaration: this plugin waits until the settings service is visible. */
const inject = ["settings"];
/** JSON schema of the reminder settings (defaults are the composition base). */
const Config = z.object({
	enabled: z.boolean().default(true),
	thresholdMinutes: z.number().step(1).min(1).max(120).default(5),
	subReminderEnabled: z.boolean().default(true),
	mergeMs: z.number().step(100).min(0).max(5e3).default(500),
	masterVolume: z.number().step(.1).min(0).max(1).default(.6),
	subVolume: z.number().step(.1).min(0).max(1).default(.5),
	ttsEnabled: z.boolean().default(false),
	ttsTemplate: z.string().default("任务完成，用时约 {time} 分钟"),
	titleFlash: z.boolean().default(true),
	globalSessions: z.boolean().default(true),
	batchSingleBeep: z.boolean().default(false)
});
/**
* Plugin body: register the settings namespace; the browser half observes the
* resolved value live through the bound settings scope.
*/
function apply(ctx, config) {
	ctx.settings.register(TASK_NOTIFY_SETTINGS_NS, Config, {
		base: config,
		applies: "live"
	});
}
//#endregion
export { Config, TASK_NOTIFY_NS, TASK_NOTIFY_SETTINGS_NS, apply, inject };
