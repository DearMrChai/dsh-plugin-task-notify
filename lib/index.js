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
/** 拆一个可能 volatile 的字段值：引用对象 → `.get()`，其余原样。 */
function unwrapVolatile(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") try {
		return value.get();
	} catch {
		return value;
	}
	return value;
}
/**
* 默认值 + 用户层浅合并后逐字段解包，得到纯数据配置视图。
* host 路由序列化 / client 通知器 / 设置卡都以此为准。
*/
function resolvePlainConfig(config) {
	const raw = {
		...DEFAULT_TASK_NOTIFY_CONFIG,
		...config ?? {}
	};
	const out = {};
	for (const key of Object.keys(raw)) out[key] = unwrapVolatile(raw[key]) ?? DEFAULT_TASK_NOTIFY_CONFIG[key];
	return out;
}
//#endregion
//#region src/index.ts
/** The `task-notify` settings namespace brand (join key with the browser half). */
const TASK_NOTIFY_SETTINGS_NS = TASK_NOTIFY_NS;
/** Cordis dependency declaration: this plugin waits until the settings service is visible.
*  0.1.x = 旧 Settings 服务；0.2.0 = SettingsForms（同名 'settings'）——inject 行两代都命中。 */
const inject = ["settings"];
/**
* .volatile() 版本门：桌面端 0.2.0-rc.2 内置 schemastery 3.18.4 有该方法，
* web 0.1.x 内置 3.18.2 没有 —— Config 构造发生在模块求值期，无条件调用会在
* 旧运行时抛 TypeError 炸掉整个插件 bundle（硬约束 3）。能力探测：支持才标，
* 不支持则原样返回（0.1.x web 的自定义设置卡不依赖 volatile 元数据，不受影响）。
*/
function volatileIfSupported(schema) {
	const candidate = schema;
	if (typeof candidate.volatile === "function") return candidate.volatile();
	return schema;
}
/**
* JSON schema of the reminder settings（defaults are the composition base）。
* 0.3.1：11 个字段全标 .volatile()（经版本门）—— 0.2.0 SettingsForms 出表单的
* 唯一前提（validateVolatileSchema 要求 fixed object path，顶层平铺字段天然满足）；
* 0.1.x web 端 register 忽略该元数据（值消费已解包，行为不变）。
*/
const Config = z.object({
	enabled: volatileIfSupported(z.boolean().default(true)),
	thresholdMinutes: volatileIfSupported(z.number().step(1).min(1).max(120).default(5)),
	subReminderEnabled: volatileIfSupported(z.boolean().default(true)),
	mergeMs: volatileIfSupported(z.number().step(100).min(0).max(5e3).default(500)),
	masterVolume: volatileIfSupported(z.number().step(.1).min(0).max(1).default(.6)),
	subVolume: volatileIfSupported(z.number().step(.1).min(0).max(1).default(.5)),
	ttsEnabled: volatileIfSupported(z.boolean().default(false)),
	ttsTemplate: volatileIfSupported(z.string().default("任务完成，用时约 {time} 分钟")),
	titleFlash: volatileIfSupported(z.boolean().default(true)),
	globalSessions: volatileIfSupported(z.boolean().default(true)),
	batchSingleBeep: volatileIfSupported(z.boolean().default(false))
});
/** patch/namespace 之上的完整配置视图（缺省字段回退默认值 + volatile 引用解包）。 */
function resolveConfig(config) {
	return resolvePlainConfig(config);
}
/** 从 settings 服务读本插件的当前 revision（两代 describe 都含 {ns, revision, value}）。 */
function readRevision(host) {
	try {
		const settings = host.get?.("settings") ?? host.settings;
		const describe = settings?.describe;
		if (typeof describe !== "function") return 0;
		const rows = describe.call(settings);
		if (!Array.isArray(rows)) return 0;
		for (const row of rows) {
			const r = row;
			if (r && r.ns === "task-notify" && typeof r.revision === "number") return r.revision;
		}
	} catch {}
	return 0;
}
/**
* Plugin body：能力探测注册 settings namespace（仅 web 0.1.x），并把
* /task-notify/api/config（GET/POST）挂到 webServer（双端）。
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
			const send = (res, code, data) => {
				const r = res;
				r.writeHead(code, {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store"
				});
				r.end(JSON.stringify(data));
			};
			const readBody = (req, limitBytes = 16384) => new Promise((resolve, reject) => {
				const r = req;
				const chunks = [];
				let size = 0;
				r.on?.("data", (chunk) => {
					const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
					size += buf.length;
					if (size > limitBytes) {
						try {
							r.abort?.();
						} catch {}
						reject(/* @__PURE__ */ new Error("body too large"));
						return;
					}
					chunks.push(buf);
				});
				r.on?.("end", () => {
					try {
						const text = Buffer.concat(chunks).toString("utf8");
						resolve(text === "" ? {} : JSON.parse(text));
					} catch (err) {
						reject(err);
					}
				});
				r.on?.("error", (err) => reject(err));
			});
			try {
				disposers.push(ws.register({
					kind: "exact",
					path: "/task-notify/api/config",
					handler: async (req, res) => {
						const method = (req?.method ?? "GET").toString().toUpperCase();
						if (method === "GET" || method === "HEAD") {
							send(res, 200, {
								ok: true,
								ns: TASK_NOTIFY_NS,
								config: resolveConfig(config),
								base: DEFAULT_TASK_NOTIFY_CONFIG,
								revision: readRevision(host)
							});
							return;
						}
						if (method === "POST" || method === "PUT") {
							try {
								const body = await readBody(req);
								const patch = body.patch;
								if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
									send(res, 400, {
										ok: false,
										error: "body.patch must be an object"
									});
									return;
								}
								const expectedRevision = typeof body.revision === "number" ? body.revision : void 0;
								const settings = host.get?.("settings") ?? host.settings;
								if (!settings || typeof settings.update !== "function") {
									send(res, 503, {
										ok: false,
										error: "settings service unavailable"
									});
									return;
								}
								await settings.update(TASK_NOTIFY_NS, patch, expectedRevision);
								let written;
								try {
									const rows = settings.describe?.();
									const row = (Array.isArray(rows) ? rows : []).find((r) => r?.ns === TASK_NOTIFY_NS);
									written = row?.value !== void 0 ? resolvePlainConfig(row.value) : void 0;
								} catch {}
								send(res, 200, {
									ok: true,
									ns: TASK_NOTIFY_NS,
									config: written ?? resolvePlainConfig(patch),
									base: DEFAULT_TASK_NOTIFY_CONFIG,
									revision: readRevision(host)
								});
							} catch (err) {
								send(res, 409, {
									ok: false,
									error: err instanceof Error ? err.message : String(err)
								});
							}
							return;
						}
						send(res, 405, {
							ok: false,
							error: "method not allowed"
						});
					}
				}));
				host.logger?.info?.("[task-notify] 路由已挂载：/task-notify/api/config（GET/POST）");
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
