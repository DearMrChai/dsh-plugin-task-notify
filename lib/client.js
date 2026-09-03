window.__ModuleLoader__.load({
	id: "dsh-plugin-task-notify",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
			titleFlash: true,
			globalSessions: true,
			batchSingleBeep: false
		};
		/** 子任务家族的模型工具名（子代理类）。出现/消失用于触发“嘟”。 */
		const SUBAGENT_TOOL_NAMES = [
			"subagent",
			"subagent_fork",
			"subagent_codex",
			"subagent_claude_code"
		];
		//#endregion
		//#region src/client/notifier.ts
		function dbgEnabled() {
			if (typeof localStorage === "undefined") return false;
			try {
				return localStorage.getItem("dsh:task-notify:debug") === "1";
			} catch {
				return false;
			}
		}
		function dbg(...args) {
			if (dbgEnabled()) console.info("[task-notify]", ...args);
		}
		var SoundEngine = class {
			audio = null;
			/** Browsers gate audio on a user gesture; unlock on the first interaction. */
			prime() {
				if (typeof window === "undefined" || typeof AudioContext === "undefined") return;
				const unlock = () => {
					this.ensure();
				};
				window.addEventListener("pointerdown", unlock, { once: true });
				window.addEventListener("keydown", unlock, { once: true });
			}
			ensure() {
				if (typeof AudioContext === "undefined") return null;
				if (this.audio === null) this.audio = new AudioContext();
				if (this.audio.state === "suspended") this.audio.resume();
				return this.audio;
			}
			tone(freq, durMs, volume, type, delayMs = 0) {
				const audio = this.ensure();
				if (audio === null) return;
				const t0 = audio.currentTime + delayMs / 1e3;
				const osc = audio.createOscillator();
				const gain = audio.createGain();
				osc.type = type;
				osc.frequency.setValueAtTime(freq, t0);
				gain.gain.setValueAtTime(0, t0);
				gain.gain.linearRampToValueAtTime(volume, t0 + .008);
				gain.gain.exponentialRampToValueAtTime(1e-4, t0 + durMs / 1e3);
				osc.connect(gain);
				gain.connect(audio.destination);
				osc.start(t0);
				osc.stop(t0 + durMs / 1e3 + .05);
				osc.onended = () => {
					osc.disconnect();
					gain.disconnect();
				};
			}
			/** 子任务完成：短促"嘟"。 */
			sub(volume) {
				this.tone(620, 130, volume, "sine");
			}
			/** 整轮完成：清脆"叮"（上扬双音）。 */
			master(volume) {
				this.tone(880, 160, volume, "triangle");
				this.tone(1174.66, 300, volume, "triangle", 150);
			}
			/** 可选的 TTS 一句播报（默认关；后台标签页可能被浏览器节流）。 */
			speak(text) {
				if (typeof speechSynthesis === "undefined") return;
				speechSynthesis.cancel();
				const utter = new SpeechSynthesisUtterance(text);
				utter.lang = "zh-CN";
				speechSynthesis.speak(utter);
			}
		};
		/** 标题闪动若干轮后还原。 */
		function flashTitle(times = 3, intervalMs = 700) {
			if (typeof document === "undefined" || typeof window === "undefined") return;
			const original = document.title;
			let tick = 0;
			const timer = window.setInterval(() => {
				document.title = tick % 2 === 0 ? `● 任务完成 — ${original}` : original;
				tick += 1;
				if (tick >= times * 2) {
					window.clearInterval(timer);
					document.title = original;
				}
			}, intervalMs);
		}
		function collectSubagentIds(nodes) {
			const ids = /* @__PURE__ */ new Set();
			const walk = (items) => {
				for (const item of items) {
					const call = item;
					if (typeof call?.name === "string" && SUBAGENT_TOOL_NAMES.includes(call.name) && typeof call.callId === "string") ids.add(call.callId);
					if (Array.isArray(call?.subCalls)) walk(call.subCalls);
				}
			};
			walk(nodes);
			return ids;
		}
		var SessionTracker = class {
			id;
			config;
			engine;
			session;
			runStartAt = null;
			wasRunning = false;
			openIds = /* @__PURE__ */ new Set();
			lastBeepAt = 0;
			beepedThisTurn = false;
			constructor(id, config, engine, session) {
				this.id = id;
				this.config = config;
				this.engine = engine;
				this.session = session;
				this.adopt();
			}
			snapshot() {
				return this.session.getSnapshot();
			}
			adopt() {
				const snap = this.snapshot();
				this.wasRunning = snap.running;
				this.openIds = collectSubagentIds(snap.runningCalls);
				if (snap.running) this.runStartAt = this.openTurnStart(snap) ?? Date.now();
				dbg("adopt", this.id, {
					running: snap.running,
					openSubagents: this.openIds.size
				});
			}
			/** 当前未结束轮次的起始时间（更准）；无则回退到挂载时刻。 */
			openTurnStart(snap) {
				for (const timing of snap.turnTimings.values()) if (timing.endTime === void 0) return timing.startTime;
				return null;
			}
			minutes(durationMs) {
				return (durationMs / 6e4).toFixed(1);
			}
			handle() {
				const snap = this.snapshot();
				const cfg = this.config();
				if (!cfg.enabled) {
					this.wasRunning = snap.running;
					return;
				}
				if (snap.running && !this.wasRunning) {
					this.runStartAt = this.openTurnStart(snap) ?? Date.now();
					this.beepedThisTurn = false;
					console.info("[task-notify] turn start:", this.id, "（发出不响，开始计时）");
				} else if (!snap.running && this.wasRunning) {
					const start = this.runStartAt;
					this.runStartAt = null;
					if (start !== null) {
						const durationMs = Date.now() - start;
						const thresholdMs = cfg.thresholdMinutes * 6e4;
						console.info("[task-notify] turn end:", this.id, `dur=${Math.round(durationMs / 1e3)}s`, `threshold=${cfg.thresholdMinutes}min`, durationMs >= thresholdMs ? "→ over，响应叮" : "→ short，静音");
						if (durationMs >= thresholdMs) {
							this.engine.master(cfg.masterVolume);
							if (cfg.titleFlash) flashTitle();
							if (cfg.ttsEnabled) this.engine.speak(`任务完成，用时约 ${this.minutes(durationMs)} 分钟`);
						}
					}
				} else if (!snap.running) this.runStartAt = null;
				this.wasRunning = snap.running;
				if (cfg.subReminderEnabled) {
					const next = collectSubagentIds(snap.runningCalls);
					let settled = 0;
					for (const id of this.openIds) if (!next.has(id)) settled += 1;
					if (settled > 0) {
						const now = Date.now();
						const merged = cfg.batchSingleBeep ? this.beepedThisTurn : now - this.lastBeepAt < cfg.mergeMs;
						console.info("[task-notify] sub settled:", this.id, `n=${settled}`, merged ? "→ merged（静默）" : "→ 嘟");
						if (!merged) {
							this.engine.sub(cfg.subVolume);
							this.lastBeepAt = now;
							this.beepedThisTurn = true;
						}
					}
					this.openIds = next;
				}
			}
		};
		/**
		* Attach a tracker to every listed session (or only the current one when
		* `globalSessions` is off), re-sync when the session list moves, and keep the
		* engine primed for browser autoplay policy. All disposals ride the plugin
		* ctx through the returned cleanup function.
		*/
		function installNotifier(sessions, scope, cleanup) {
			const engine = new SoundEngine();
			engine.prime();
			let cfg = scope.getSnapshot().value ?? DEFAULT_TASK_NOTIFY_CONFIG;
			console.info("[task-notify] installNotifier:", "global=", cfg.globalSessions, "sessions=", sessions.list.getSnapshot().ids.length, "current=", sessions.list.getSnapshot().current, "cfg=", cfg);
			cleanup(() => scope.subscribe(() => {
				cfg = scope.getSnapshot().value ?? cfg;
				dbg("cfg updated", cfg);
			}));
			const trackers = /* @__PURE__ */ new Map();
			const sync = () => {
				const list = sessions.list.getSnapshot();
				const activeIds = cfg.globalSessions ? [...list.ids] : list.current !== void 0 ? [list.current] : [];
				const wanted = new Set(activeIds);
				dbg("sync sessions", "global=", cfg.globalSessions, "wanted=", [...wanted], "trackers=", trackers.size);
				for (const id of activeIds) {
					if (trackers.has(id)) continue;
					const session = sessions.binding(id)?.session;
					if (session === void 0) continue;
					const tracker = new SessionTracker(id, () => cfg, engine, session);
					cleanup(() => session.subscribe(() => tracker.handle()));
					trackers.set(id, tracker);
					console.info("[task-notify] attach tracker:", id);
				}
				for (const [id, tracker] of trackers) if (!wanted.has(id)) trackers.delete(id);
			};
			cleanup(() => sessions.list.subscribe(sync));
			sync();
		}
		//#endregion
		//#region src/client/TaskNotifyCard.tsx
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
		const T = {
			borderL2: "var(--dsw-alias-border-l2)",
			labelDimmed: "var(--dsw-alias-label-dimmed)",
			labelPrimary: "var(--dsw-alias-label-primary)",
			labelSecondary: "var(--dsw-alias-label-secondary)",
			labelTertiary: "var(--dsw-alias-label-tertiary)",
			labelError: "var(--dsw-alias-label-error)",
			bgLayer2: "var(--dsw-alias-bg-layer-2)",
			bgLayer3: "var(--dsw-alias-bg-layer-3)",
			bgModulePlatform: "var(--dsw-alias-bg-module-platform)",
			brandPrimary: "var(--dsw-alias-brand-primary)"
		};
		const s = {
			card: {
				listStyle: "none",
				border: `1px solid ${T.borderL2}`,
				borderRadius: 12,
				background: T.bgLayer3,
				transition: "border-color .16s, background .16s"
			},
			cardOpen: {
				background: T.bgLayer2,
				borderColor: T.labelDimmed
			},
			header: {
				width: "100%",
				appearance: "none",
				border: 0,
				background: "none",
				font: "inherit",
				color: "inherit",
				textAlign: "left",
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				gap: 12,
				padding: "14px 16px",
				borderRadius: 12
			},
			headText: {
				flex: 1,
				minWidth: 0,
				display: "flex",
				flexDirection: "column",
				gap: 4
			},
			name: {
				fontSize: 15,
				fontWeight: 600,
				lineHeight: 1.4,
				color: T.labelPrimary
			},
			description: {
				fontSize: 13,
				lineHeight: 1.5,
				color: T.labelTertiary
			},
			chevron: {
				flex: "none",
				color: T.labelTertiary,
				transition: "transform .16s"
			},
			chevronOpen: { transform: "rotate(180deg)" },
			body: {
				borderTop: `1px solid ${T.borderL2}`,
				margin: "0 16px",
				paddingBottom: 8
			},
			pending: {
				flex: "none",
				borderRadius: 999,
				padding: "1px 8px",
				fontSize: 11,
				lineHeight: "17px",
				fontWeight: 500,
				whiteSpace: "nowrap",
				background: T.bgModulePlatform,
				color: T.labelSecondary
			},
			footer: {
				display: "flex",
				alignItems: "center",
				justifyContent: "flex-end",
				gap: 8,
				padding: "12px 0 4px",
				borderTop: `1px solid ${T.borderL2}`
			},
			field: {
				display: "flex",
				flexDirection: "column",
				gap: 6,
				padding: "12px 0"
			},
			fieldBorder: { borderTop: `1px solid ${T.borderL2}` },
			head: {
				display: "flex",
				alignItems: "center",
				gap: 8
			},
			label: {
				flex: 1,
				minWidth: 0,
				fontSize: 13,
				fontWeight: 500,
				lineHeight: 1.5,
				color: T.labelPrimary
			},
			badges: {
				display: "inline-flex",
				alignItems: "center",
				gap: 8
			},
			badge: {
				borderRadius: 999,
				padding: "1px 8px",
				fontSize: 11,
				lineHeight: "17px",
				whiteSpace: "nowrap",
				fontWeight: 500,
				background: T.bgModulePlatform,
				color: T.labelSecondary
			},
			reset: {
				border: "none",
				background: "none",
				padding: 0,
				font: "inherit",
				fontSize: 12,
				lineHeight: 1.5,
				color: T.labelSecondary,
				cursor: "pointer"
			},
			input: {
				height: 34,
				padding: "0 12px",
				border: `1px solid ${T.borderL2}`,
				borderRadius: 8,
				background: T.bgLayer3,
				font: "inherit",
				fontSize: 13,
				lineHeight: 1.5,
				color: T.labelPrimary,
				width: "100%",
				boxSizing: "border-box"
			},
			inputInvalid: { borderColor: T.labelError },
			invalid: {
				margin: 0,
				fontSize: 12,
				lineHeight: 1.5,
				color: T.labelError
			},
			hint: {
				margin: 0,
				fontSize: 12,
				lineHeight: 1.5,
				color: T.labelTertiary
			}
		};
		/** Inline chevron-down icon (same glyph as IconChevronDownOutline14, no runtime dep). */
		function ChevronIcon({ style, open }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				style: open ? {
					...style,
					...s.chevronOpen
				} : style,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 9.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
					fill: "currentColor"
				})
			});
		}
		/** Label + control + hint field, mirroring fields.tsx's ValueField. */
		function Field(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: props.border ? {
					...s.field,
					...s.fieldBorder
				} : s.field,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: s.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							style: s.label,
							htmlFor: props.id,
							children: props.label
						}), props.overridden ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: s.badges,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: s.badge,
								children: props.overriddenLabel
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: s.reset,
								disabled: props.disabled,
								onClick: props.onReset,
								children: props.resetLabel
							})]
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: props.id,
						style: props.invalid ? {
							...s.input,
							...s.inputInvalid
						} : s.input,
						type: "text",
						...props.numeric ? { inputMode: "numeric" } : {},
						...props.invalid ? { "aria-invalid": true } : {},
						value: props.text,
						disabled: props.disabled,
						onChange: (e) => {
							props.onEdit(e.target.value);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: props.invalid ? s.invalid : s.hint,
						children: props.invalid ? props.invalidLabel : props.hint
					})
				]
			});
		}
		/** DSW-style switch used for every boolean setting (not a native checkbox). */
		function Switch(props) {
			const track = {
				width: 34,
				height: 20,
				borderRadius: 999,
				background: props.checked ? T.brandPrimary : T.bgLayer3,
				border: `1px solid ${props.checked ? T.brandPrimary : T.borderL2}`,
				position: "relative",
				cursor: props.disabled ? "default" : "pointer",
				flex: "none",
				opacity: props.disabled ? .5 : 1,
				transition: "background .16s, border-color .16s"
			};
			const thumb = {
				position: "absolute",
				top: 2,
				left: props.checked ? 16 : 2,
				width: 14,
				height: 14,
				borderRadius: "50%",
				background: props.checked ? T.bgLayer3 : T.labelSecondary,
				transition: "left .16s, background .16s"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: props.border ? {
					...s.field,
					...s.fieldBorder
				} : s.field,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: s.head,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: s.label,
						children: props.label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "switch",
						"aria-checked": props.checked,
						"aria-label": props.label,
						disabled: props.disabled,
						onClick: () => {
							props.onChange(!props.checked);
						},
						style: track,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: thumb })
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: s.hint,
					children: props.hint
				})]
			});
		}
		/** Numeric keys of the config: staged as raw text until Save. */
		const NUM_KEYS = [
			"thresholdMinutes",
			"mergeMs",
			"masterVolume",
			"subVolume"
		];
		/** Boolean keys of the config: staged directly into the draft. */
		const BOOL_KEYS = [
			"enabled",
			"subReminderEnabled",
			"ttsEnabled",
			"titleFlash",
			"globalSessions",
			"batchSingleBeep"
		];
		function parseNum(text, fallback) {
			if (text === "") return fallback;
			const n = Number(text);
			return Number.isFinite(n) ? n : fallback;
		}
		function TaskNotifyCard({ value, set }) {
			const [open, setOpen] = (0, react.useState)(false);
			const base = value ?? DEFAULT_TASK_NOTIFY_CONFIG;
			const [bools, setBools] = (0, react.useState)(null);
			const [numText, setNumText] = (0, react.useState)(() => ({
				thresholdMinutes: String(base.thresholdMinutes),
				mergeMs: String(base.mergeMs),
				masterVolume: String(base.masterVolume),
				subVolume: String(base.subVolume)
			}));
			const boolDirty = bools !== null && BOOL_KEYS.some((k) => bools[k] !== base[k]);
			const numDirty = NUM_KEYS.some((k) => numText[k] !== String(base[k]));
			const invalid = NUM_KEYS.some((k) => numText[k] !== "" && !Number.isFinite(Number(numText[k])));
			const dirty = boolDirty || numDirty;
			const toggleBool = (key, next) => {
				setBools((b) => ({
					...b ?? base,
					[key]: next
				}));
			};
			const editNum = (key, text) => {
				setNumText((t) => ({
					...t,
					[key]: text
				}));
			};
			const resetNum = (key) => {
				setNumText((t) => ({
					...t,
					[key]: String(base[key])
				}));
			};
			const onSave = () => {
				if (!dirty || invalid) return;
				for (const k of NUM_KEYS) if (numText[k] !== String(base[k])) set(k, parseNum(numText[k], base[k]));
				if (bools !== null) for (const k of BOOL_KEYS) {
					const b = bools[k];
					if (b !== base[k]) set(k, b);
				}
				setBools(null);
			};
			const onDiscard = () => {
				setBools(null);
				setNumText({
					thresholdMinutes: String(base.thresholdMinutes),
					mergeMs: String(base.mergeMs),
					masterVolume: String(base.masterVolume),
					subVolume: String(base.subVolume)
				});
			};
			const name = "任务提醒";
			const description = "长轮完成“叮”、子任务完成“嘟”：阈值、音量与提醒形式可按需配置";
			const cur = {
				...base,
				...bools ?? {},
				thresholdMinutes: parseNum(numText.thresholdMinutes, base.thresholdMinutes),
				mergeMs: parseNum(numText.mergeMs, base.mergeMs),
				masterVolume: parseNum(numText.masterVolume, base.masterVolume),
				subVolume: parseNum(numText.subVolume, base.subVolume)
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: open ? {
					...s.card,
					...s.cardOpen
				} : s.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					style: s.header,
					"aria-expanded": open,
					"aria-label": `${open ? "收起" : "展开"}：${name}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: s.headText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: s.name,
								children: name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: s.description,
								children: description
							})]
						}),
						dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: s.pending,
							children: "未保存"
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronIcon, {
							style: s.chevron,
							open
						})
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: s.body,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
							label: "启用声音提醒",
							hint: "总开关：关闭后任何声音/闪动都不触发",
							checked: cur.enabled,
							disabled: false,
							border: false,
							onChange: (v) => {
								toggleBool("enabled", v);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "task-notify-thresholdMinutes",
							label: "整轮完成提醒阈值（分钟）",
							hint: "你发出消息不响；这轮运行超过该时长、回复完成时才响“叮”。短轮不打扰。",
							text: numText.thresholdMinutes,
							invalid: numText.thresholdMinutes !== "" && !Number.isFinite(Number(numText.thresholdMinutes)),
							overridden: numText.thresholdMinutes !== String(base.thresholdMinutes),
							overriddenLabel: "已修改",
							resetLabel: "重置",
							invalidLabel: "需为数字",
							numeric: true,
							disabled: false,
							border: true,
							onEdit: (t) => {
								editNum("thresholdMinutes", t);
							},
							onReset: () => {
								resetNum("thresholdMinutes");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
							label: "子任务完成提醒（嘟）",
							hint: "子代理完成时短促一声",
							checked: cur.subReminderEnabled,
							disabled: false,
							border: true,
							onChange: (v) => {
								toggleBool("subReminderEnabled", v);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "task-notify-mergeMs",
							label: "连续子任务合并窗口（毫秒）",
							hint: "窗口内多个子任务完成只响一声“嘟”",
							text: numText.mergeMs,
							invalid: numText.mergeMs !== "" && !Number.isFinite(Number(numText.mergeMs)),
							overridden: numText.mergeMs !== String(base.mergeMs),
							overriddenLabel: "已修改",
							resetLabel: "重置",
							invalidLabel: "需为数字",
							numeric: true,
							disabled: false,
							border: true,
							onEdit: (t) => {
								editNum("mergeMs", t);
							},
							onReset: () => {
								resetNum("mergeMs");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "task-notify-masterVolume",
							label: "“叮”音量",
							hint: "整轮完成提示音量，0–1",
							text: numText.masterVolume,
							invalid: numText.masterVolume !== "" && !Number.isFinite(Number(numText.masterVolume)),
							overridden: numText.masterVolume !== String(base.masterVolume),
							overriddenLabel: "已修改",
							resetLabel: "重置",
							invalidLabel: "需为数字",
							numeric: true,
							disabled: false,
							border: true,
							onEdit: (t) => {
								editNum("masterVolume", t);
							},
							onReset: () => {
								resetNum("masterVolume");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							id: "task-notify-subVolume",
							label: "“嘟”音量",
							hint: "子任务完成提示音量，0–1",
							text: numText.subVolume,
							invalid: numText.subVolume !== "" && !Number.isFinite(Number(numText.subVolume)),
							overridden: numText.subVolume !== String(base.subVolume),
							overriddenLabel: "已修改",
							resetLabel: "重置",
							invalidLabel: "需为数字",
							numeric: true,
							disabled: false,
							border: true,
							onEdit: (t) => {
								editNum("subVolume", t);
							},
							onReset: () => {
								resetNum("subVolume");
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
							label: "TTS 语音播报",
							hint: "整轮完成时读一句“任务完成”，默认关",
							checked: cur.ttsEnabled,
							disabled: false,
							border: true,
							onChange: (v) => {
								toggleBool("ttsEnabled", v);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
							label: "标题闪动",
							hint: "整轮完成时页面标题闪“● 任务完成”",
							checked: cur.titleFlash,
							disabled: false,
							border: true,
							onChange: (v) => {
								toggleBool("titleFlash", v);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
							label: "多会话全局提醒",
							hint: "任意会话长轮结束都响；关掉只监听当前会话",
							checked: cur.globalSessions,
							disabled: false,
							border: true,
							onChange: (v) => {
								toggleBool("globalSessions", v);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
							label: "整批只响一声",
							hint: "一轮内多个子任务完成只响一声嘟",
							checked: cur.batchSingleBeep,
							disabled: false,
							border: true,
							onChange: (v) => {
								toggleBool("batchSingleBeep", v);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: s.footer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: dirty ? {
									...s.reset,
									border: `1px solid ${T.borderL2}`,
									borderRadius: 8,
									padding: "5px 14px",
									fontSize: 13,
									background: "none",
									color: T.labelSecondary
								} : {
									...s.reset,
									opacity: .4,
									cursor: "default"
								},
								disabled: !dirty,
								onClick: onDiscard,
								children: "放弃"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: dirty && !invalid ? {
									background: T.labelPrimary,
									color: T.bgLayer3,
									border: "1px solid transparent",
									borderRadius: 8,
									padding: "5px 14px",
									fontSize: 13,
									lineHeight: 1.5,
									cursor: "pointer"
								} : {
									background: T.labelPrimary,
									color: T.bgLayer3,
									border: "1px solid transparent",
									borderRadius: 8,
									padding: "5px 14px",
									fontSize: 13,
									lineHeight: 1.5,
									opacity: .4,
									cursor: "default"
								},
								disabled: !dirty || invalid,
								onClick: onSave,
								children: "保存"
							})]
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Required services: settings transport + the session registry plus slots. */
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"settingsScope",
			"sessions"
		];
		/**
		* Plugin body: watch sessions (global by default), and pair the Plugins-tab
		* card with the Host-served `task-notify` namespace.
		*/
		function apply(ctx) {
			console.info("[task-notify] apply(): bundle loaded");
			try {
				const mirror = ctx.settingsScope.describe();
				const logServed = (label) => {
					const s = mirror.getSnapshot();
					const nss = s?.view?.namespaces?.map((n) => n.ns);
					console.info("[task-notify] served namespaces (" + label + "):", nss ?? JSON.stringify(s));
				};
				logServed("initial");
				mirror.subscribe(() => logServed("updated"));
			} catch (err) {
				console.info("[task-notify] served namespaces (describe failed):", err);
			}
			const scope = ctx.settingsScope.bind({ namespace: TASK_NOTIFY_NS });
			dbg("config snapshot", scope.getSnapshot().value);
			installNotifier(ctx.get("sessions"), scope, (dispose) => ctx.effect(dispose));
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: TASK_NOTIFY_NS,
				inject: () => ({
					value: scope.getSnapshot().value ?? DEFAULT_TASK_NOTIFY_CONFIG,
					set: (field, value) => {
						scope.set(field, value);
					}
				})
			}, TaskNotifyCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map