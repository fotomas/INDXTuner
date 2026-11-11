/**
 * Tuning - Speed, in three groups tuned separately and in any order:
 *   Travel        INDX_TC_SPEED + INDX_TC_accel (linked: one ladder; unlinked: one of them, the other held)
 *   Dock approach INDX_TC_contact_speed
 *   Latch         INDX_latch_feed
 * A ladder runs over a chosen range (from/to handles) in 5, 10 or 20 % steps of the INDX default (-50 % ... +100 %, +200 % for
 * the short approach and latch moves) with one test tool, N pickups and parks per step, and stops at the first
 * failure. The other settings stay at the level chosen here, or their current value. One step below the
 * fastest that passed is suggested. "Use for <group>" makes pending edits; the combined chosen levels can be
 * checked on every tool (2 cycles each) and then used together.
 * Values are set live while a run goes and always put back; runs are at full speed (INDX_TC_MODE 1.0) with
 * INDX_TC_check_action 1, so a failed INDX check aborts the tool change and the run opens Recovery.
 */
import { computed, reactive, ref } from "vue";

import { formatValue } from "./model/rrfValues";
import { useIndxTuner } from "./useIndxTuner";
import { blockers, median, num, park, pickUp, quick, toRecovery, tt } from "./useTuning";

export type GroupId = "travel" | "approach" | "latch";
export type UnitId = "travel" | "travelSpeed" | "travelAccel" | "approach" | "latch";

interface SpeedVar {
	name: string;
	label: string;        // i18n key under speed.*
	step: number;         // values are rounded to this
}

const VARS: Record<string, SpeedVar> = {
	INDX_TC_SPEED: { name: "INDX_TC_SPEED", label: "travel", step: 100 },
	INDX_TC_accel: { name: "INDX_TC_accel", label: "accel", step: 50 },
	INDX_TC_contact_speed: { name: "INDX_TC_contact_speed", label: "contact", step: 50 },
	INDX_latch_feed: { name: "INDX_latch_feed", label: "latchFeed", step: 50 },
};
const UNIT_VARS: Record<UnitId, string[]> = {
	travel: ["INDX_TC_SPEED", "INDX_TC_accel"],
	travelSpeed: ["INDX_TC_SPEED"],
	travelAccel: ["INDX_TC_accel"],
	approach: ["INDX_TC_contact_speed"],
	latch: ["INDX_latch_feed"],
};
const GROUP_VARS: Record<GroupId, string[]> = {
	travel: ["INDX_TC_SPEED", "INDX_TC_accel"],
	approach: ["INDX_TC_contact_speed"],
	latch: ["INDX_latch_feed"],
};
// levels are in per cent of the INDX default
const MIN_PCT = -50;
const TOP_PCT: Record<GroupId, number> = { travel: 100, approach: 200, latch: 200 };
export const STEP_CHOICES = [5, 10, 20];
const FORCE_BAND = 0.25;        // clamp force within +-25 % of the median
const LATCH_FORCE_DROP = 0.15;  // latch: clamp force no more than 15 % below the first step

export interface CycleResult {
	ok: boolean;
	reason: string;
	grams: number | null;
	seconds: number;
}

export interface LadderStep {
	k: number;
	values: Record<string, number>;
	cycles: CycleResult[];
	result: "pass" | "fail" | "notrun" | "running" | "skipped";
	reason: string;
}

export interface ToolCheck {
	tool: number;
	cycles: CycleResult[];
	result: "pass" | "fail" | "waiting" | "running";
	reason: string;
}

interface UnitState {
	steps: LadderStep[];        // run results
	startK: number;             // lowest level to test (%)
	endK: number;               // highest level to test (%)
	chosenK: number | null;
}

const tool = ref(0);
const group = ref<GroupId>("travel");
const linked = ref(true);
const tuneTravel = ref<"travelSpeed" | "travelAccel">("travelSpeed");
const settings = reactive({ cycles: 3, hot: false, hotTemp: 215 });
const units = reactive<Record<UnitId, UnitState>>({
	travel: { steps: [], startK: 0, endK: TOP_PCT.travel, chosenK: null },
	travelSpeed: { steps: [], startK: 0, endK: TOP_PCT.travel, chosenK: null },
	travelAccel: { steps: [], startK: 0, endK: TOP_PCT.travel, chosenK: null },
	approach: { steps: [], startK: 0, endK: TOP_PCT.approach, chosenK: null },
	latch: { steps: [], startK: 0, endK: TOP_PCT.latch, chosenK: null },
});
/** Step size of the ladder, % of the INDX default */
const stepPct = ref(10);
/** Values chosen here, per variable (held while other groups run, checked together, used together) */
const chosenValues = reactive<Record<string, number>>({});
const checks = ref<ToolCheck[]>([]);
const checkedValues = ref<Record<string, number> | null>(null);
const running = ref<"ladder" | "check" | null>(null);
const stopRequested = ref(false);
const status = ref("");
const message = ref<{ type: "success" | "warning" | "error"; text: string } | null>(null);

function declared(name: string): boolean {
	return useIndxTuner().rowFor(name)?.info != null;
}

/** The groups this INDX version has settings for */
const groups = computed(() => Object.keys(GROUP_VARS) as GroupId[]);
/** A group none of whose settings the INDX files declare: shown, but locked until the patch that adds them */
function groupLocked(g: GroupId): boolean {
	return !GROUP_VARS[g].some(declared);
}
/** The patch that adds a group's settings (see usePatches) */
const GROUP_PATCH: Partial<Record<GroupId, string>> = { latch: "latch", travel: "accel" };

/** The ladder shown for the selected group */
const unit = computed<UnitId>(() => group.value !== "travel" ? group.value : linked.value ? "travel" : tuneTravel.value);
const unitVars = computed(() => UNIT_VARS[unit.value].filter(declared).map(n => VARS[n]));
const groupVars = computed(() => GROUP_VARS[group.value].filter(declared).map(n => VARS[n]));

function current(name: string): number | null {
	return useIndxTuner().currentNumber(name);
}

/** 100 %: the INDX default; when that is 0 or not a number (accel 0 = config.g), the current value */
function reference(name: string): number | null {
	const d = useIndxTuner().rowFor(name)?.info?.defaultValue;
	return typeof d === "number" && d > 0 ? d : current(name);
}

function valueAt(name: string, k: number): number | null {
	const ref0 = reference(name);
	return ref0 === null ? null : Math.max(VARS[name].step, Math.round(ref0 * (1 + k / 100) / VARS[name].step) * VARS[name].step);
}

/** The value a variable has during runs and checks: chosen here, else its current value */
function heldValue(name: string): number | null {
	return chosenValues[name] ?? current(name);
}

function valuesAt(u: UnitId, k: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const g of Object.values(GROUP_VARS).flat().filter(declared)) {
		const v = UNIT_VARS[u].includes(g) ? valueAt(g, k) : heldValue(g);
		if (v !== null) {
			out[g] = v;
		}
	}
	return out;
}

function groupOf(u: UnitId): GroupId {
	return u === "approach" || u === "latch" ? u : "travel";
}

/** The level nearest the current value of the unit's first variable ("Now" mark) */
const nowK = computed(() => {
	const name = UNIT_VARS[unit.value].find(declared);
	const c = name ? current(name) : null, r = name ? reference(name) : null;
	return c === null || r === null || r === 0 ? null : Math.round((c / r - 1) * 100 / stepPct.value) * stepPct.value;
});

/** The levels of the ladder at the chosen step size */
function grid(u: UnitId): number[] {
	const out: number[] = [];
	for (let k = MIN_PCT; k <= TOP_PCT[groupOf(u)]; k += stepPct.value) {
		out.push(k);
	}
	return out;
}

function snap(u: UnitId, k: number): number {
	return grid(u).reduce((a, b) => Math.abs(b - k) < Math.abs(a - k) ? b : a);
}

/** The ladder as shown: every level at the step size, plus levels already run at another step size */
const steps = computed<LadderStep[]>(() => {
	const u = unit.value, st = units[u];
	const ks = [...new Set([...grid(u), ...st.steps.map(s => s.k)])].sort((a, b) => a - b);
	return ks.map(k => {
		const run = st.steps.find(s => s.k === k);
		if (run) {
			return run;
		}
		return { k, values: valuesAt(u, k), cycles: [], result: k < st.startK || k > st.endK ? "skipped" : "notrun", reason: "" } as LadderStep;
	});
});

/** The levels a ladder run tests now */
const testLevels = computed(() => grid(unit.value).filter(k => k >= units[unit.value].startK && k <= units[unit.value].endK));

function setStepPct(p: number): void {
	if (running.value !== null || !STEP_CHOICES.includes(p)) {
		return;
	}
	stepPct.value = p;
	for (const u of Object.keys(units) as UnitId[]) {
		units[u].startK = snap(u, units[u].startK);
		units[u].endK = Math.max(units[u].startK, snap(u, units[u].endK));
	}
}

function fastestPassedOf(u: UnitId): number | null {
	let best: number | null = null;
	for (const s of [...units[u].steps].sort((a, b) => a.k - b.k)) {
		if (s.result !== "pass") {
			break;
		}
		best = s.k;
	}
	return best;
}
const fastestPassed = computed(() => fastestPassedOf(unit.value));

/** Chosen level of the shown ladder (one step of margin by default; can be changed) */
const chosenK = computed({
	get: () => units[unit.value].chosenK,
	set: (k: number | null) => choose(unit.value, k),
});

function choose(u: UnitId, k: number | null): void {
	units[u].chosenK = k;
	for (const name of UNIT_VARS[u].filter(declared)) {
		if (k === null) {
			delete chosenValues[name];
		} else {
			const v = valueAt(name, k);
			if (v !== null) {
				chosenValues[name] = v;
			}
		}
	}
	checkedValues.value = null;
}

/** For the group buttons: the chosen level(s) of a group, or null */
function groupLevel(g: GroupId): string | null {
	const pct = levelText;
	if (g === "travel") {
		const l = units.travel.chosenK, s = units.travelSpeed.chosenK, a = units.travelAccel.chosenK;
		if (s !== null || a !== null) {
			return [s !== null ? `${tt("speed.travel")} ${pct(s)}` : "", a !== null ? `${tt("speed.accel")} ${pct(a)}` : ""].filter(Boolean).join(" · ");
		}
		return l === null ? null : pct(l);
	}
	const k = units[g].chosenK;
	return k === null ? null : pct(k);
}

/** Average swap time at the start level and at the chosen level */
const timeSaved = computed(() => {
	const st = units[unit.value];
	const at = (k: number | null) => {
		const s = st.steps.find(x => x.k === k);
		return s ? avgSeconds(s.cycles) : null;
	};
	const first = [...st.steps].sort((a, b) => a.k - b.k)[0];
	return { from: first ? avgSeconds(first.cycles) : null, to: at(st.chosenK) };
});

const startBlockers = computed(() => [
	...blockers({ homed: ["X", "Y", "Z"], calibrated: true, empty: true }),
	...(groups.value.length === 0 ? [tt("speed.noVars")] : []),
]);

function literal(name: string, v: number): string {
	const shape = useIndxTuner().rowFor(name)?.shape ?? { list: false, float: false };
	return formatValue(v, { list: false, float: shape.float });
}

async function setLive(values: Record<string, unknown>): Promise<void> {
	for (const [name, v] of Object.entries(values)) {
		if (typeof v === "number") {
			await quick(`set global.${name} = ${literal(name, v)}`);
		}
	}
}

/** One pickup and park of a tool with the speeds that are live now */
async function cycle(t: number): Promise<CycleResult> {
	const started = Date.now();
	const picked = await pickUp(t);
	if (picked === null) {
		return { ok: false, reason: tt("speed.reasonPick"), grams: null, seconds: (Date.now() - started) / 1000 };
	}
	const raw = num(picked.INDX_LC_raw), before = num(picked.INDX_TC_lc_before), scale = num(picked.INDX_LC_scale);
	const grams = raw !== null && before !== null && scale !== null ? Math.abs((raw - before) * scale) : null;
	const pickFail = picked.INDX_TC_pick_lc_ok === 0 ? "pick_lc" : picked.INDX_TC_pick_heat_ok === 0 ? "pick_heat" : "";
	const parked = await park();
	const seconds = (Date.now() - started) / 1000;
	if (parked === null) {
		return { ok: false, reason: tt("speed.reasonPark"), grams, seconds };
	}
	const dropFail = parked.INDX_TC_drop_lc_ok === 0 ? "drop_lc" : parked.INDX_TC_drop_temp_ok === 0 ? "drop_temp" : "";
	const reason = pickFail || dropFail;
	return { ok: reason === "", reason, grams, seconds };
}

/** Run tool-change cycles with the live values put back afterwards, whatever happens */
async function withLiveValues(tools: number[], body: () => Promise<void>): Promise<void> {
	const tuner = useIndxTuner();
	const names = Object.keys(VARS).filter(declared);
	const original: Record<string, unknown> = Object.fromEntries(names.map(n => [n, tuner.globalValue(n)]));
	const action = tuner.globalValue("INDX_TC_check_action");
	const mode = tuner.globalValue("INDX_TC_MODE");
	stopRequested.value = false;
	message.value = null;
	try {
		await quick("set global.INDX_TC_check_action = 1");
		// tuned at full speed: INDX_TC_MODE scales INDX_TC_SPEED down for Normal and Quiet
		if (typeof mode === "number") {
			await quick("set global.INDX_TC_MODE = 1.0");
		}
		for (const t of tools) {
			await quick(settings.hot ? `M568 P${t} S${settings.hotTemp} R0` : `M568 P${t} S0 R0`);
		}
		await body();
	} catch (e) {
		const text = tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) });
		message.value = { type: "error", text };
		toRecovery(text);
	} finally {
		try {
			await setLive(original);
			if (typeof action === "number") {
				await quick(`set global.INDX_TC_check_action = ${action}`);
			}
			if (typeof mode === "number") {
				await quick(`set global.INDX_TC_MODE = ${formatValue(mode, { list: false, float: true })}`);
			}
			if (settings.hot) {
				for (const t of tools) {
					await quick(`M568 P${t} S0 R0`);
				}
			}
		} catch {
			// reported above
		}
		running.value = null;
		status.value = "";
	}
}

function forcesOk(all: (number | null)[]): boolean {
	const gs = all.filter((g): g is number => g !== null);
	const m = median(gs);
	return m === null || gs.every(g => Math.abs(g - m) <= FORCE_BAND * m);
}

function levelText(k: number): string {
	return k === 0 ? tt("speed.default") : `${k > 0 ? "+" : "−"}${Math.abs(k)} %`;
}

/** Set the range to test (from the rail handles); the two ends cannot cross */
function setRange(which: "start" | "end", k: number): void {
	const st = units[unit.value];
	if (running.value !== null) {
		return;
	}
	if (which === "start") {
		st.startK = Math.min(k, st.endK);
	} else {
		st.endK = Math.max(k, st.startK);
	}
}

async function startLadder(): Promise<void> {
	if (running.value !== null || startBlockers.value.length > 0) {
		return;
	}
	const t = tool.value, u = unit.value, st = units[u], levels = testLevels.value;
	running.value = "ladder";
	st.steps = [];
	choose(u, null);
	checks.value = [];
	await withLiveValues([t], async () => {
		const forces: (number | null)[] = [];
		let firstMedian: number | null = null;
		for (const k of levels) {
			if (stopRequested.value) {
				break;
			}
			const step: LadderStep = { k, values: valuesAt(u, k), cycles: [], result: "running", reason: "" };
			st.steps = [...st.steps, step];
			await setLive(step.values);
			for (let c = 1; c <= Math.max(1, settings.cycles) && !stopRequested.value; c++) {
				status.value = tt("speed.runningStep", { step: levelText(k), c, n: settings.cycles, tool: t });
				const r = await cycle(t);
				step.cycles = [...step.cycles, r];
				forces.push(r.grams);
				st.steps = [...st.steps];
				if (!r.ok) {
					step.result = "fail";
					step.reason = r.reason;
					break;
				}
			}
			if (step.result === "running") {
				const gs = step.cycles.map(c => c.grams).filter((g): g is number => g !== null);
				const m = median(gs);
				if (!forcesOk(forces)) {
					step.result = "fail";
					step.reason = tt("speed.reasonForce");
				} else if (u === "latch" && firstMedian !== null && m !== null && m < firstMedian * (1 - LATCH_FORCE_DROP)) {
					step.result = "fail";
					step.reason = tt("speed.reasonLatch");
				}
				if (firstMedian === null) {
					firstMedian = m;
				}
			}
			if (step.result === "fail") {
				st.steps = [...st.steps];
				const text = tt("speed.failedAt", { step: levelText(k), reason: step.reason, tool: t });
				message.value = { type: "warning", text };
				// a failed pickup or park leaves the head in doubt; a force criterion does not
				if (step.reason === tt("speed.reasonPick") || step.reason === tt("speed.reasonPark") || /_/.test(step.reason)) {
					toRecovery(text);
				}
				break;
			}
			step.result = stopRequested.value ? "notrun" : "pass";
			st.steps = [...st.steps];
		}
		if (stopRequested.value) {
			message.value = { type: "warning", text: tt("tuning.stopped") };
		} else if (message.value === null) {
			message.value = { type: "success", text: tt("speed.ladderDone") };
		}
		const best = fastestPassedOf(u);
		choose(u, best === null ? null : Math.max(st.startK, best - stepPct.value));
	});
}

/** The values the final check runs with: everything chosen here, the rest as it is */
const combined = computed(() => {
	const out: Record<string, number> = {};
	for (const name of Object.keys(VARS).filter(declared)) {
		const v = heldValue(name);
		if (v !== null) {
			out[name] = v;
		}
	}
	return out;
});
const hasChosen = computed(() => Object.keys(chosenValues).length > 0);

async function startCheck(): Promise<void> {
	const tuner = useIndxTuner();
	if (running.value !== null || !hasChosen.value || startBlockers.value.length > 0) {
		return;
	}
	const tools = [...tuner.docks.value.numbers];
	const values = { ...combined.value };
	running.value = "check";
	checkedValues.value = null;
	checks.value = tools.map(t => ({ tool: t, cycles: [], result: "waiting", reason: "" }));
	await withLiveValues(tools, async () => {
		await setLive(values);
		for (const tc of checks.value) {
			if (stopRequested.value) {
				break;
			}
			tc.result = "running";
			checks.value = [...checks.value];
			for (let c = 1; c <= 2 && !stopRequested.value; c++) {
				status.value = tt("speed.runningCheck", { tool: tc.tool, c, n: 2 });
				const r = await cycle(tc.tool);
				tc.cycles = [...tc.cycles, r];
				if (!r.ok) {
					tc.result = "fail";
					tc.reason = r.reason;
					break;
				}
			}
			if (tc.result === "running") {
				tc.result = stopRequested.value ? "waiting" : "pass";
			}
			checks.value = [...checks.value];
			if (tc.result === "fail") {
				const text = tt("speed.checkFailed", { tool: tc.tool, reason: tc.reason });
				message.value = { type: "warning", text };
				toRecovery(text);
				break;
			}
		}
		if (stopRequested.value) {
			message.value = { type: "warning", text: tt("tuning.stopped") };
		} else if (message.value === null) {
			message.value = { type: "success", text: tt("speed.checkDone") };
			checkedValues.value = values;
		}
	});
}

/** "Use all chosen levels": only for exactly the values every tool passed with */
const canUseAll = computed(() => checkedValues.value !== null
	&& Object.entries(combined.value).every(([n, v]) => checkedValues.value![n] === v)
	&& checks.value.length > 0 && checks.value.every(c => c.result === "pass"));

function applyValues(names: string[]): void {
	const tuner = useIndxTuner();
	for (const name of names) {
		const v = chosenValues[name];
		if (v !== undefined && v !== current(name)) {
			tuner.setNumber(name, v);
		}
	}
}

/** "Use for <group>": the chosen values of the shown group as pending edits */
function useGroup(): void {
	applyValues(GROUP_VARS[group.value]);
	message.value = { type: "success", text: tt("speed.used") };
}

function useAll(): void {
	if (!canUseAll.value) {
		return;
	}
	applyValues(Object.keys(VARS));
	message.value = { type: "success", text: tt("speed.used") };
	checkedValues.value = null;
}

function stop(): void {
	stopRequested.value = true;
}

const avgSeconds = (cs: CycleResult[]) => cs.length ? cs.reduce((a, c) => a + c.seconds, 0) / cs.length : null;

export function useSpeedTuning() {
	return {
		tool, group, linked, tuneTravel, settings, units, groups, groupLocked, GROUP_PATCH, declared, unit, unitVars, groupVars, steps, nowK, fastestPassed, chosenK,
		chosenValues, combined, hasChosen, checks, canUseAll, running, status, message, startBlockers, timeSaved,
		groupLevel, levelText, setRange, setStepPct, stepPct, testLevels, startLadder, startCheck, useGroup, useAll, stop, avgSeconds,
	};
}
