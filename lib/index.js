import z from "@deepseek-ai/schemastery";
//#region src/task-notify-config.ts
/**
* Shared settings shape for both halves of the plugin. The Host half owns the
* schema + persistence (settings namespace `task-notify`); the browser half
* reads the resolved value through its bound settings scope. Both halves
* spell the namespace literal so no cross-half value import is needed.
*/
const TASK_NOTIFY_NS = "task-notify";
/** 默认值（与新装的用户一致；已有用户文档不受影响）。 */
const DEFAULT_TASK_NOTIFY_CONFIG = {
	enabled: true,
	thresholdMinutes: 5,
	subReminderEnabled: true,
	mergeMs: 500,
	masterVolume: .6,
	subVolume: .5,
	ttsEnabled: false,
	ttsTemplate: "任务完成，用时约 {time} 分钟",
	titleFlash: true,
	globalSessions: true,
	batchSingleBeep: false
};
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
/** patch/namespace 之上的完整配置视图（缺省字段回退默认值；字段全平，浅合并足够）。 */
function resolveConfig(config) {
	return {
		...DEFAULT_TASK_NOTIFY_CONFIG,
		...config ?? {}
	};
}
/**
* Plugin body：能力探测注册 settings namespace（仅 web 0.1.x），并把
* /task-notify/api/config 挂到 webServer（双端，桌面端 client 的配置来源）。
*/
function apply(ctx, config) {
	const host = ctx;
	try {
		const settings = host.settings;
		if (settings && typeof settings.register === "function") settings.register(TASK_NOTIFY_SETTINGS_NS, Config, {
			base: config,
			applies: "live"
		});
	} catch (err) {
		try {
			host.logger?.warn?.("[task-notify] settings namespace 注册失败（不影响提醒与配置路由）:", err);
		} catch {}
	}
	host.effect?.(() => {
		const disposers = [];
		let installed = false;
		const installRoutes = () => {
			if (installed) return;
			const ws = host.get?.("webServer");
			if (!ws || typeof ws.register !== "function") return;
			installed = true;
			const send = (res, data) => {
				const r = res;
				r.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store"
				});
				r.end(JSON.stringify(data));
			};
			try {
				disposers.push(ws.register({
					kind: "exact",
					path: "/task-notify/api/config",
					handler: async (_req, res) => {
						send(res, {
							ok: true,
							config: resolveConfig(config)
						});
					}
				}));
				host.logger?.info?.("[task-notify] 路由已挂载：/task-notify/api/config");
			} catch (err) {
				try {
					host.logger?.warn?.("[task-notify] 配置路由挂载失败（不影响其余功能）:", err);
				} catch {}
			}
		};
		let off;
		try {
			off = host.on?.("internal/service", installRoutes);
		} catch {}
		installRoutes();
		return () => {
			try {
				off?.();
			} catch {}
			disposers.splice(0).forEach((dispose) => {
				try {
					dispose();
				} catch {}
			});
		};
	});
}
//#endregion
export { Config, TASK_NOTIFY_NS, TASK_NOTIFY_SETTINGS_NS, apply, inject };
