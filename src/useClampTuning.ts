/**
 * Tuning - Tool Clamping: the latch travel that gives a tool the clamping force wanted, by a stepwise close
 * in the dock.
 *
 * The latch only moves while the head is in the dock (the dock activator switches the extruder drive to the
 * latch); outside the dock E moves extrude. The clamp is a spring preload set by the travel, and the pickup
 * force (pick_g) is read at safe Y against the empty-head reading, as INDX_TC_POST.g does.
 *
 * One docking, built from the user's own macros and INDX_TC_POST's steps:
 *  1. INDX_TC_PRE.g T<t>: approach, empty-head reading at safe Y (INDX_TC_lc_before), to the trigger line.
 *  2. T<t> P0 (E moves need the tool selected), slide into the dock with limits off.
 *  3. Close with INDX_LATCH_MOVE.g in one move to the fast-to travel (through the slack), then fine steps
 *     through the rise, reading INDX_LC_RAW.g after each step (re-read until steady). Stop when the force in
 *     the dock reaches the target / dock factor + STOP_MARGIN (25 %), when it levels off (the latch's maximum), or at a
 *     safety limit.
 *     Never reverses (a small reverse move does not release the latch).
 *  4. Finish like INDX_TC_POST: INDX_State = t, INDX_WRITE_STATE.g, peel off, safe Y, pickup force at the
 *     end travel. Dock factor = the settled pickup force / the force in the dock at the end.
 * The clamp force drops by about a third within a few seconds of a pickup and then holds (T2: 2479 g right
 * after, 1577 g after 4 s, 1595 g after a minute; T0 in the check log: 1982 g at pickup, 1237 g at the park).
 * The settled force is what holds the tool and what the park check (INDX_TC_FREE, INDX_TC_lc_min_g) sees, so
 * every pickup force here is read again after it has settled, and judged on that.
 * Then park, and search with check pickups (real pickups, at most settings.checks): the first at the travel
 * where the curve (as pickup force) reaches the target. A real pickup clamps harder than the stepwise close at
 * the same travel (one fast close compresses further), so each check that is well above the target gives the
 * curve's shift (where the curve shows that force, minus the travel checked) and the next check is at the
 * crossing minus that shift; a check below the target steps up. Ends when a check is within the target and
 * target + 8 %, or the bracket between a check below and one above is narrower than 0.03 mm.
 * The suggestion is the lowest checked travel that reached the target. "Use" makes the checked travel a pending edit of
 * INDX_latch_close_tool and logs the checked force, so Tool Docks shows it.
 */
import { computed, reactive, ref } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { tunerLogLine } from "./model/docks";
import { formatValue, type Scalar } from "./model/rrfValues";
import { useIndxTuner } from "./useIndxTuner";
import { useRecovery } from "./useRecovery";
import { num, park, pickUp, quick, run } from "./useTuning";

const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

export const LATCH_LIST = "INDX_latch_close_tool";
const DEFAULT_FACTOR = 1.0;          // pickup force / force in the dock, until measured for a tool
const ZERO_OPEN = 3;                 // before the stepwise close: open this far (mm) against the latch's open stop,
const ZERO_CURRENT = 200;            // at this motor current (mA), like the squeeze in INDX_UNLOCK_DANCE.g
const STEADY_COUNTS = 20;            // a reading is steady when its spread is below this
const STEADY_MS = 2000;              // ... re-read for at most this long
const FACTOR_KEY = "indxTuner.dockFactor";
const FACTOR_MIN = 0.4;              // stored dock factors outside this range are ignored
const FACTOR_MAX = 1.5;
const SETTLE_FIRST_MS = 3000;        // settled pickup force: first reading this long after the pickup,
const SETTLE_STEP_MS = 1000;         // ... then one a second
const SETTLE_G = 20;                 // ... until two in a row differ less than this
const SETTLE_MAX_MS = 10000;         // ... for at most this long

export interface StepPoint {
	closed: number;      // mm closed from open
	inDock: number;      // g, force in the dock against the open-latch reading
	fine: boolean;
	spread: number;
}

export interface CheckPickup {
	travel: number;
	grams: number;       // settled pickup force
	first: number;       // right after the pickup (INDX_TC_POST's pick_lc)
	ok: boolean;
	at: Date;
}

const tool = ref(0);
const tab = ref<"settings" | "result">("settings");
const settings = reactive({ target: 1600, fastTo: 8.0, fineStep: 0.075, samples: 2, maxTravel: 12.5, maxInDock: 4500, checks: 4 });
const CLOSE_ENOUGH = 0.08;           // a check pickup within target ... target + 8 % ends the search
const MIN_GAP = 0.03;                // mm: the search ends when the bracket is this narrow
const PLATEAU_SHARE = 0.95;          // a check at this share of the curve's maximum says nothing about the shift
const PLATEAU_JUMP = 0.2;            // mm: ... so the next check is this much lower
const PLATEAU_STEPS = 6;             // the close stops when the force rose less than PLATEAU_RISE over this many steps
const PLATEAU_RISE = 0.02;
const points = ref<StepPoint[]>([]);
const checks = ref<CheckPickup[]>([]);
const endResult = ref<{ closed: number; inDock: number; pick: number; pickFirst: number; factor: number; previous: number | null } | null>(null);
const resultTool = ref<number | null>(null);
const running = ref(false);
const stopRequested = ref(false);
const status = ref("");
const message = ref<{ type: "success" | "warning" | "error"; text: string } | null>(null);
const stepSeconds = ref<number | null>(null);

// ---------------------------------------------------------------- dock factor per tool (per browser)

function loadFactors(): Record<string, number> {
	try {
		return JSON.parse(localStorage.getItem(FACTOR_KEY) ?? "{}") as Record<string, number>;
	} catch {
		return {};
	}
}
const factors = ref<Record<string, number>>(loadFactors());
function saveFactor(tl: number, f: number): void {
	factors.value = { ...factors.value, [tl]: f };
	try {
		localStorage.setItem(FACTOR_KEY, JSON.stringify(factors.value));
	} catch {
		// remembered for this session only
	}
}
function factorOf(tl: number): number | null {
	const f = factors.value[tl];
	return typeof f === "number" && f >= FACTOR_MIN && f <= FACTOR_MAX ? f : null;
}

/** The force in the dock the close stops at */
const STOP_MARGIN = 1.25;           // the close goes this far past the target (as force in the dock)
const stopInDock = computed(() => Math.min(settings.maxInDock, settings.target / (factorOf(tool.value) ?? DEFAULT_FACTOR) * STOP_MARGIN));

// ---------------------------------------------------------------- result

/** The curve as pickup force, using the factor measured at the end of the docking */
const curve = computed(() => {
	const f = endResult.value?.factor ?? factorOf(resultTool.value ?? tool.value) ?? DEFAULT_FACTOR;
	return points.value.map(p => ({ closed: p.closed, pick: p.inDock * f }));
});

/** Where the curve, as pickup force, first reaches the target */
const crossing = computed(() => curve.value.find(p => p.pick >= settings.target)?.closed ?? null);

/** The suggestion: the lowest checked travel that reached the target */
const suggestion = computed(() => {
	const ok = checks.value.filter(c => c.ok).sort((a, b) => a.travel - b.travel)[0];
	return ok ? { value: ok.travel, force: Math.round(ok.grams), at: ok.at } : null;
});

/** Where the curve (as pickup force) first reaches g, interpolated */
function curveTravelFor(g: number): number | null {
	const c = curve.value;
	for (let i = 1; i < c.length; i++) {
		if (c[i].pick >= g) {
			const a = c[i - 1], b = c[i];
			return b.pick === a.pick ? b.closed : a.closed + (g - a.pick) / (b.pick - a.pick) * (b.closed - a.closed);
		}
	}
	return null;
}

/** Where the slack ends: the first step with a clear force (150 g in the dock) */
const slackEnd = computed(() => points.value.find(p => p.inDock >= 150)?.closed ?? null);

// ---------------------------------------------------------------- printer helpers

const r2 = (v: number) => Math.round(v * 100) / 100;

function failToRecovery(text: string): void {
	message.value = { type: "error", text };
	useRecovery().reason.value = text;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run a code block ending with INDX_LC_RAW.g and read the result from the object model, without printing
 * anything to the console. The block also tags INDX_LC_raw_spread with a number unique to this reading
 * (spread + tag × TAG_UNIT), so a model update from before the block is never taken for its result; the tag
 * is removed again afterwards.
 */
const TAG_UNIT = 1e6;                // spreads are far below this
let readingTag = 0;
async function readingAfter(code: string): Promise<{ raw: number; spread: number } | null> {
	const tuner = useIndxTuner();
	readingTag = readingTag % 900 + 1;
	const tag = readingTag;
	await quick(`${code}\nset global.INDX_LC_raw_spread = global.INDX_LC_raw_spread + ${tag * TAG_UNIT}`);
	const until = Date.now() + 10000;
	for (;;) {
		const raw = num(tuner.globalValue("INDX_LC_raw")), tagged = num(tuner.globalValue("INDX_LC_raw_spread"));
		if (raw !== null && tagged !== null && tagged >= tag * TAG_UNIT && tagged < (tag + 1) * TAG_UNIT) {
			const spread = tagged - tag * TAG_UNIT;
			await quick(`set global.INDX_LC_raw_spread = ${spread}`);
			return { raw, spread };
		}
		if (Date.now() > until) {
			return null;
		}
		await sleep(100);
	}
}

/** Read until steady (spread below STEADY_COUNTS), at most STEADY_MS */
async function steadyReading(first: string): Promise<{ raw: number; spread: number } | null> {
	const until = Date.now() + STEADY_MS;
	let r = await readingAfter(first);
	while (r !== null && r.spread > STEADY_COUNTS && Date.now() < until && !stopRequested.value) {
		r = await readingAfter(`M98 P"INDX_LC_RAW.g" N${settings.samples}`);
	}
	return r;
}


/** The pickup force (g against the empty-head reading `before`) once it has settled */
async function settledGrams(before: number, scale: number): Promise<number | null> {
	const until = Date.now() + SETTLE_MAX_MS;
	await sleep(SETTLE_FIRST_MS);
	let r = await readingAfter('M400\nM98 P"INDX_LC_RAW.g" N4');
	if (r === null) {
		return null;
	}
	let g = Math.abs((r.raw - before) * scale);
	while (Date.now() < until && !stopRequested.value) {
		await sleep(SETTLE_STEP_MS);
		r = await readingAfter('M98 P"INDX_LC_RAW.g" N4');
		if (r === null) {
			return g;
		}
		const next = Math.abs((r.raw - before) * scale);
		const steady = Math.abs(next - g) < SETTLE_G;
		g = next;
		if (steady) {
			break;
		}
	}
	return g;
}

// ---------------------------------------------------------------- the run

async function start(): Promise<void> {
	const tuner = useIndxTuner();
	const machineStore = useMachineStore();
	if (running.value || tuner.measureBlockers.value.length > 0) {
		return;
	}
	const tl = tool.value;
	const dockx = num((tuner.globalValue("INDX_tool_x") as unknown[] | undefined)?.[tl]);
	const docky = num(tuner.globalValue("INDX_dock_y"));
	const into = num(tuner.globalValue("INDX_dock_dir")) ?? -1;
	const trigOff = num(tuner.globalValue("INDX_trigger_offset")) ?? 5;
	const peel = num(tuner.globalValue("INDX_peel_distance")) ?? 5;
	const safeY = num(tuner.globalValue("safeYmin"));
	const cs = num(tuner.globalValue("INDX_TC_contact_speed")) ?? 1000;
	const speed = (num(tuner.globalValue("INDX_TC_SPEED")) ?? 6000) * (num(tuner.globalValue("INDX_TC_MODE")) ?? 1);
	const feed = num(tuner.globalValue("INDX_latch_feed")) ?? 1500;
	const scale = num(tuner.globalValue("INDX_LC_scale"));
	if (dockx === null || docky === null || safeY === null || scale === null) {
		message.value = { type: "error", text: t("clamp.missingGlobals") };
		return;
	}

	running.value = true;
	stopRequested.value = false;
	message.value = null;
	points.value = [];
	checks.value = [];
	endResult.value = null;
	stepSeconds.value = null;
	resultTool.value = tl;
	tab.value = "result";
	const previous = factorOf(tl);
	const live = tuner.globalValue(LATCH_LIST);
	const n = Math.max(tuner.dockCount.value ?? 0, tl + 1);
	const original: Scalar[] = Array.isArray(live) ? [...live] as Scalar[] : [];
	while (original.length < n) {
		original.push(null);
	}
	const shape = { list: true, float: true };
	let latchChanged = false;
	let onHead = false;

	try {
		// 1. approach with the user's own INDX_TC_PRE.g
		status.value = t("clamp.stepApproach", { tool: tl });
		await run(`M98 P"INDX_TC_PRE.g" T${tl}`, 3000);
		const trig = docky - into * trigOff;
		const x = num(await tuner.readKey("move.axes[0].machinePosition"));
		const y = num(await tuner.readKey("move.axes[1].machinePosition"));
		if (x === null || y === null || Math.abs(x - dockx) > 0.2 || Math.abs(y - trig) > 0.2) {
			message.value = { type: "error", text: t("clamp.stepNoApproach", { tool: tl }) };
			return;
		}
		const before = num(tuner.globalValue("INDX_TC_lc_before"));

		// 2. select without macros, slide into the dock
		status.value = t("clamp.stepSlide");
		const lim = (machineStore.model as any).move?.limitAxes !== false;
		await quick(`T${tl} P0`);
		await run(`M564 S0\nG90\nG53 G1 X${dockx} Y${docky} F${Math.min(2500, cs)}`, 1500);

		// 3. open the latch against its stop at low current, so the close starts from the same point as
		//    after a park (the unlock dance opens further than any close); then the open-latch reading
		status.value = t("clamp.stepZero");
		await run(`M98 P"INDX_LATCH_MOVE.g" E${-ZERO_OPEN} F300 C${ZERO_CURRENT}`, 1500);
		const base = await steadyReading(`M400\nM98 P"INDX_LC_RAW.g" N${settings.samples}`);
		if (base === null) {
			throw new Error(t("clamp.noReading"));
		}
		let closed = 0;
		let fine = false;
		const t0 = Date.now();
		let stopReason = "";
		while (!stopRequested.value) {
			// one move through the slack, then fine steps
			const step = fine ? settings.fineStep : Math.max(settings.fineStep, Math.min(settings.fastTo, settings.maxTravel));
			if (closed + step > settings.maxTravel + 1e-6) {
				stopReason = t("clamp.stopTravel", { mm: settings.maxTravel });
				break;
			}
			closed = r2(closed + step);
			status.value = t("clamp.stepClosing", { mm: closed.toFixed(2), g: points.value.length ? Math.round(points.value[points.value.length - 1].inDock) : 0 });
			const r = await steadyReading(`M98 P"INDX_LATCH_MOVE.g" E${step} F${feed}\nM98 P"INDX_LC_RAW.g" N${settings.samples}`);
			if (r === null) {
				throw new Error(t("clamp.noReading"));
			}
			const inDock = Math.abs((r.raw - base.raw) * scale);
			points.value = [...points.value, { closed, inDock, fine, spread: r.spread }];
			stepSeconds.value = (Date.now() - t0) / 1000 / points.value.length;
			fine = true;
			if (inDock >= stopInDock.value) {
				stopReason = t("clamp.stopForce", { g: Math.round(stopInDock.value) });
				break;
			}
			// levelled off: the latch is at its maximum, closing further adds nothing
			const recent = points.value.slice(-PLATEAU_STEPS - 1);
			if (recent.length > PLATEAU_STEPS && inDock >= 300 && inDock - recent[0].inDock < PLATEAU_RISE * inDock) {
				stopReason = t("clamp.stopPlateau", { g: Math.round(inDock) });
				break;
			}
		}

		// 4. finish like INDX_TC_POST: state, peel off, safe Y, pickup force at the end travel
		status.value = t("clamp.stepFinish");
		const restoreZ = num(tuner.globalValue("INDX_TC_restore_z"));
		const inActive = num(tuner.globalValue("INDX_TC_in_active")) ?? 0;
		// the moves run on their own, and the reading after them
		await run([
			`set global.INDX_State = ${tl}`,
			'M98 P"INDX_WRITE_STATE.g"',
			`G53 G1 X${dockx} Y${docky - into * peel} F${Math.min(3000, cs)}`,
			`G53 G1 X${dockx} Y${safeY} F${speed}`,
			"M400",
			lim ? "M564 S1" : "",
		].filter(Boolean).join("\n"), 1500);
		onHead = true;
		const endReading = await readingAfter(`M400\nM98 P"INDX_LC_RAW.g" N${Math.max(4, settings.samples)}`);
		status.value = t("clamp.settling");
		const settled = before === null ? null : await settledGrams(before, scale);
		if (restoreZ !== null && restoreZ >= 0) {
			await run(`G53 G1 Z${restoreZ} F900\nM400\nset global.INDX_TC_restore_z = -1`, 1500);
		}
		await quick(`M568 P${tl} S${inActive} R0 A0\nM98 P"INDX_TC_ACCEL.g" S0`);

		const last = points.value[points.value.length - 1];
		if (endReading !== null && settled !== null && before !== null && last) {
			const pickFirst = Math.abs((endReading.raw - before) * scale);
			const factor = last.inDock > 0 ? settled / last.inDock : DEFAULT_FACTOR;
			endResult.value = { closed: last.closed, inDock: last.inDock, pick: settled, pickFirst, factor, previous };
			// keep the factor only from a docking that finished and a believable value
			if (!stopRequested.value && factor >= FACTOR_MIN && factor <= FACTOR_MAX) {
				saveFactor(tl, Math.round(factor * 1000) / 1000);
			}
		}
		if (stopRequested.value) {
			message.value = { type: "warning", text: t("clamp.stoppedOnHead", { tool: tl }) };
			return;
		}
		// INDX_TC_FREE refuses to park a tool clamped below INDX_TC_lc_min_g, and the clamp cannot be
		// tightened outside the dock: do not try, send the user to Recovery
		const lcMin = num(tuner.globalValue("INDX_TC_lc_min_g")) ?? 700;
		if (endResult.value !== null && endResult.value.pick < lcMin * 1.1) {
			failToRecovery(t("clamp.tooWeakToPark", { tool: tl, g: Math.round(endResult.value.pick), min: lcMin }));
			return;
		}

		// park
		status.value = t("clamp.parking", { tool: tl });
		if (await park() === null) {
			failToRecovery(t("clamp.parkFailed", { tool: tl }));
			return;
		}
		onHead = false;

		// 5. search with check pickups, starting at the crossing
		const cross = crossing.value;
		if (cross === null) {
			message.value = { type: "warning", text: t("clamp.noCrossing", { g: settings.target, reason: stopReason }) };
			return;
		}
		const q = (v: number) => Math.round(v * 40) / 40;          // 0.025 mm
		let travel: number | null = q(cross);
		let lowOk: number | null = null;       // lowest travel that reached the target
		let highFail: number | null = null;    // highest travel that did not
		while (travel !== null && !stopRequested.value && checks.value.length < Math.max(1, settings.checks)) {
			const list = [...original];
			list[tl] = travel;
			latchChanged = true;
			await quick(`set global.${LATCH_LIST} = ${formatValue(list, shape)}\nM568 P${tl} S0 R0`);
			status.value = t("clamp.checking", { tool: tl, mm: travel.toFixed(3) });
			const picked = await pickUp(tl);
			if (picked === null) {
				failToRecovery(t("clamp.pickFailed", { tool: tl, travel: travel.toFixed(3) }));
				return;
			}
			onHead = true;
			const raw = num(picked.INDX_LC_raw), b = num(picked.INDX_TC_lc_before);
			const first = raw !== null && b !== null ? Math.abs((raw - b) * scale) : 0;
			status.value = t("clamp.settling");
			const grams = b === null ? 0 : (await settledGrams(b, scale)) ?? 0;
			const ok = grams >= settings.target;
			checks.value = [...checks.value, { travel, grams, first, ok, at: new Date() }];
			if (grams < lcMin * 1.1) {
				failToRecovery(t("clamp.checkTooWeak", { tool: tl, mm: travel.toFixed(3), g: Math.round(grams), min: lcMin }));
				return;
			}
			if (await park() === null) {
				failToRecovery(t("clamp.parkFailed", { tool: tl }));
				return;
			}
			onHead = false;

			// the next travel to check, or null when done
			let next: number | null;
			if (ok) {
				lowOk = lowOk === null ? travel : Math.min(lowOk, travel);
				if (grams <= settings.target * (1 + CLOSE_ENOUGH)) {
					next = null;                                   // close enough
				} else if (grams >= PLATEAU_SHARE * Math.max(...curve.value.map(p => p.pick))) {
					next = q(travel - PLATEAU_JUMP);               // on the latch's maximum: no shift to read, jump down
				} else {
					const c = curveTravelFor(grams);
					const shift = c === null ? settings.fineStep : c - travel;     // how late the curve is
					next = q(cross - shift);
					if (next >= travel) {
						next = q(travel - settings.fineStep);
					}
				}
			} else {
				highFail = highFail === null ? travel : Math.max(highFail, travel);
				next = q(travel + settings.fineStep);
			}
			// keep inside the bracket; halve it once both ends are known
			if (next !== null && lowOk !== null && highFail !== null) {
				if (lowOk - highFail <= MIN_GAP) {
					next = null;
				} else if (next >= lowOk || next <= highFail) {
					next = q((lowOk + highFail) / 2);
					if (next >= lowOk || next <= highFail) {
						next = null;
					}
				}
			}
			travel = next;
		}
		message.value = stopRequested.value ? { type: "warning", text: t("clamp.stopped") }
			: suggestion.value ? { type: "success", text: t("clamp.stepDone", { n: points.value.length, s: (stepSeconds.value ?? 0).toFixed(2), c: checks.value.length }) }
				: { type: "warning", text: t("clamp.noCheckPassed", { g: settings.target }) };
	} catch (e) {
		failToRecovery(t("clamp.failed", { error: e instanceof Error ? e.message : String(e) }));
	} finally {
		try {
			if (latchChanged) {
				await quick(`set global.${LATCH_LIST} = ${formatValue(original, shape)}`);
			}
		} catch {
			// reported above
		}
		if (onHead && message.value?.type !== "error") {
			message.value = { type: "warning", text: t("clamp.stoppedOnHead", { tool: tl }) };
		}
		running.value = false;
		status.value = "";
	}
}

function stop(): void {
	stopRequested.value = true;
}

/** Take the checked travel as a pending edit of INDX_latch_close_tool[tool], and log its force */
function useSuggestion(): string | null {
	if (suggestion.value === null || resultTool.value === null) {
		return null;
	}
	const tuner = useIndxTuner();
	const def = tuner.currentNumber("INDX_latch_close_e");
	const v = suggestion.value.value;
	// the default travel means "no value of its own": stored as null
	const text = def !== null && Math.abs(def - v) < 1e-6 ? "" : String(Math.round(v * 1000) / 1000);
	const error = tuner.setElement(LATCH_LIST, resultTool.value, text);
	if (error === null) {
		// Tool Docks shows the newest logged force: log the force checked at this travel with the time of "Use",
		// so it is newer than the check log's readings from the search (the last check may be at another travel)
		void tuner.appendTunerLog(tunerLogLine(new Date(), resultTool.value, suggestion.value.force, true));
	}
	return error;
}

export function useClampTuning() {
	return {
		tool, tab, settings, points, checks, endResult, resultTool, running, status, message, stepSeconds,
		curve, crossing, suggestion, slackEnd, stopInDock, factorOf, start, stop, useSuggestion,
	};
}
