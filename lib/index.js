import { createRequire } from "node:module";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
//#region \0rolldown/runtime.js
var __require = /* @__PURE__ */ createRequire(import.meta.url);
//#endregion
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
const TASK_NOTIFY_SETTINGS_NS = settingsNamespace(TASK_NOTIFY_NS);
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
	titleFlash: z.boolean().default(true),
	globalSessions: z.boolean().default(true),
	batchSingleBeep: z.boolean().default(false)
});
/**
* Plugin body: register the settings namespace; the browser half observes the
* resolved value live through the bound settings scope.
*/
function apply(ctx, config) {
	const { writeFileSync, appendFileSync } = __require("node:fs");
	const stamp = (/* @__PURE__ */ new Date()).toISOString();
	writeFileSync("D:\\workspace\\_task_notify_probe.txt", stamp + " apply() called\nnamespace=task-notify\n", "utf8");
	try {
		ctx.settings.register(TASK_NOTIFY_SETTINGS_NS, Config, {
			base: config,
			applies: "live"
		});
		appendFileSync("D:\\workspace\\_task_notify_probe.txt", stamp + " direct register OK\n", "utf8");
	} catch (err) {
		appendFileSync("D:\\workspace\\_task_notify_probe.txt", stamp + " direct register FAILED: " + String(err) + "\n", "utf8");
	}
}
//#endregion
export { Config, TASK_NOTIFY_NS, TASK_NOTIFY_SETTINGS_NS, apply, inject };
