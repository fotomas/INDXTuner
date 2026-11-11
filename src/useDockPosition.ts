/**
 * Tuning - Dock Position (X only).
 *
 * 1. Measure, like Klipper's CALIBRATE_DOCK_X: X/Y motors off, the user slides the empty head onto the tool
 *    in its dock, then: G92 to a known middle position, clear the dock in Y, home Y, G1 H4 towards the X
 *    endstop (H4 stops at the trigger and keeps counting, so the position tells how far the head went),
 *    G28 X, and a second G1 H4 from a known X at the same speed gives the X where the switch triggers.
 *    Dock X = trigger X - distance travelled. Needs `G1 H4` to behave like this (to verify on RRF 3.7).
 * 2. Fine-tune: a trial X, nudged by hand; a slow approach at reduced XY current (M913) that stops at the
 *    dock without locking; a dock/undock test with INDX_tool_x[t] set live (put back afterwards).
 *    X and Y are homed after fine-tuning moves.
 * Results become a pending edit of INDX_tool_x[t].
 */
import { computed, reactive, ref } from "vue";

import { useMachineStore } from "@/stores/machine";

import { formatValue, type Scalar } from "./model/rrfValues";
import { useIndxTuner } from "./useIndxTuner";
import { blockers, currentTool, num, park, pickUp, quick, run, toRecovery, tt } from "./useTuning";

const X_LIST = "INDX_tool_x";

const tool = ref(0);
const settings = reactive({ feed: 1200, stallCurrent: 50, approachCurrent: 40, approachSpeed: 600, clearY: 40 });
/** Measurements per tool */
const measured = ref<Record<number, number[]>>({});
const trialX = ref<number | null>(null);
const busy = ref<"" | "motors" | "measure" | "approach" | "test" | "leave">("");
const motorsOff = ref(false);
const atDock = ref(false);
const status = ref("");
const message = ref<{ type: "success" | "warning" | "error" | "info"; text: string } | null>(null);
const lastTest = ref<{ x: number; grams: number | null; ok: boolean } | null>(null);
let homexRead = false;

function axis(letter: string): any {
	const axes: any[] = (useMachineStore().model as any).move?.axes ?? [];
	return axes.find(a => a?.letter === letter) ?? null;
}

/** The X endstop: at which end, and whether it is a switch or sensorless (motor stall) */
const xEndstop = computed(() => {
	const e: any = (useMachineStore().model as any).sensors?.endstops?.[0];
	const type = String(e?.type ?? "");
	return { known: e != null, highEnd: e?.highEnd === true, sensorless: type.toLowerCase().includes("stall"), type };
});

const dockDir = computed(() => {
	const d = useIndxTuner().currentNumber("INDX_dock_dir");
	return d === null ? -1 : Math.sign(d) || -1;
});

const safeY = computed(() => num(useIndxTuner().globalValue("safeYmin")));

function dockY(t: number): number | null {
	const v = useIndxTuner().currentValue("INDX_dock_y");
	if (Array.isArray(v)) {
		return num(v[t]);
	}
	return num(v);
}

const savedX = computed(() => num((useIndxTuner().currentList(X_LIST) ?? [])[tool.value]));

const stats = computed(() => {
	const xs = measured.value[tool.value] ?? [];
	if (xs.length === 0) {
		return null;
	}
	const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
	return { xs, mean, spread: Math.max(...xs) - Math.min(...xs) };
});

const measureBlockers = computed(() => [
	...blockers({ homed: [], empty: true }),
	...(xEndstop.value.known ? [] : [tt("dockpos.noEndstop")]),
]);
const fineBlockers = computed(() => [
	...blockers({ homed: ["X", "Y", "Z"], empty: true }),
	...(safeY.value === null ? [tt("dockpos.noSafeY")] : []),
	...(dockY(tool.value) === null ? [tt("dockpos.noDockY")] : []),
]);

/** For sensorless homing: take the XY current and the homing feed rate from homex.g, when they can be found */
async function readHomex(): Promise<void> {
	if (homexRead) {
		return;
	}
	homexRead = true;
	try {
		const content = await useMachineStore().download({ filename: `${useIndxTuner().sysDir()}homex.g`, type: "text" }, false, false, false);
		const text = typeof content === "string" ? content : await (content as Blob).text();
		const lines = text.split(/\r?\n/).map(l => l.replace(/;.*$/, ""));
		const m913 = lines.map(l => /M913\b.*\bX(\d+)/.exec(l)).find(Boolean);
		const feed = lines.map(l => /G1\b.*\bH1\b.*\bF(\d+)/.exec(l)).find(Boolean);
		if (m913 && xEndstop.value.sensorless) {
			settings.stallCurrent = Number(m913[1]);
		}
		if (feed) {
			settings.feed = Number(feed[1]);
		}
	} catch {
		// keep the defaults
	}
}

async function switchMotorsOff(): Promise<void> {
	busy.value = "motors";
	try {
		await quick("M18 X Y");
		motorsOff.value = true;
		message.value = { type: "info", text: tt("dockpos.motorsOffDone", { tool: tool.value }) };
	} finally {
		busy.value = "";
	}
}

async function readX(): Promise<number | null> {
	const v = await useIndxTuner().readKey("move.axes[0].userPosition");
	return num(v);
}

async function measure(): Promise<void> {
	if (busy.value !== "" || measureBlockers.value.length > 0) {
		return;
	}
	const ax = axis("X"), ay = axis("Y");
	if (ax === null || ay === null) {
		return;
	}
	await readHomex();
	busy.value = "measure";
	message.value = null;
	const t = tool.value;
	const dir = xEndstop.value.highEnd ? 1 : -1;
	const xmid = (Number(ax.min) + Number(ax.max)) / 2, ymid = (Number(ay.min) + Number(ay.max)) / 2;
	const range = Number(ax.max) - Number(ax.min);
	const stall = xEndstop.value.sensorless;
	try {
		status.value = tt("dockpos.clearing");
		await quick(`G92 X${xmid.toFixed(2)} Y${ymid.toFixed(2)}`);
		await run(`G91\nG1 Y${(-dockDir.value * settings.clearY).toFixed(1)} F1500\nG90`);
		await run("G28 Y", 3000);
		if (safeY.value !== null) {
			await run(`G90\nG53 G1 Y${safeY.value} F3000`);
		}
		status.value = tt("dockpos.towardsEndstop");
		if (stall) {
			await quick(`M913 X${settings.stallCurrent} Y${settings.stallCurrent}`);
		}
		await run(`G91\nG1 H4 X${(dir * (range + 20)).toFixed(1)} F${settings.feed}\nG90`, 3000);
		const p = await readX();
		if (stall) {
			await quick("M913 X100 Y100");
		}
		if (p === null) {
			throw new Error(tt("dockpos.noPosition"));
		}
		const travelled = p - xmid;          // signed: from the dock to the trigger point
		status.value = tt("dockpos.homingX");
		await run("G28 X", 3000);
		const x0 = dir > 0 ? Number(ax.max) - 20 : Number(ax.min) + 20;
		await run(`G90\nG1 X${x0} F6000`);
		status.value = tt("dockpos.trigger");
		if (stall) {
			await quick(`M913 X${settings.stallCurrent} Y${settings.stallCurrent}`);
		}
		await run(`G91\nG1 H4 X${dir * 40} F${settings.feed}\nG90`, 3000);
		const xs = await readX();
		if (stall) {
			await quick("M913 X100 Y100");
		}
		await run(`G90\nG1 X${x0} F6000`);
		if (xs === null) {
			throw new Error(tt("dockpos.noPosition"));
		}
		const dock = Math.round((xs - travelled) * 100) / 100;
		measured.value = { ...measured.value, [t]: [...(measured.value[t] ?? []), dock] };
		trialX.value = stats.value?.mean !== undefined ? Math.round(stats.value.mean * 100) / 100 : dock;
		motorsOff.value = false;
		message.value = { type: "success", text: tt("dockpos.measuredOne", { tool: t, x: dock.toFixed(2) }) };
	} catch (e) {
		if (stall) {
			await quick("M913 X100 Y100").catch(() => undefined);
		}
		message.value = { type: "error", text: tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) }) };
	} finally {
		busy.value = "";
		status.value = "";
	}
}

function clearMeasurements(): void {
	measured.value = { ...measured.value, [tool.value]: [] };
}

/**
 * A move at the reduced approach current. Current down, the moves, M400 and current back up go to the printer
 * as one block, so full current is back as soon as the moves end, whatever happens in the browser; it is sent
 * again afterwards as a safeguard.
 */
async function softMove(moves: string): Promise<void> {
	const a = settings.approachCurrent;
	try {
		await run(`M913 X${a} Y${a}\n${moves}\nM400\nM913 X100 Y100`);
	} finally {
		await quick("M913 X100 Y100").catch(() => undefined);
	}
}

/**
 * Change the trial X. At the dock the head follows: it backs out of the dock by INDX_peel_distance, moves to
 * the new X and slides in again, still at the approach current and speed, so X never moves while the pins
 * are engaged.
 */
async function nudge(d: number): Promise<void> {
	const base = trialX.value ?? savedX.value;
	if (base === null || busy.value !== "") {
		return;
	}
	const x = Math.round((base + d) * 100) / 100;
	trialX.value = x;
	const y = dockY(tool.value);
	if (!atDock.value || y === null) {
		return;
	}
	const g = useIndxTuner();
	const dir = num(g.globalValue("INDX_dock_dir")) ?? -1;
	const peel = num(g.globalValue("INDX_peel_distance")) ?? 10;
	busy.value = "approach";
	try {
		status.value = tt("dockpos.approaching", { x: x.toFixed(2) });
		await softMove(`G90\nG53 G1 Y${y - dir * peel} F${settings.approachSpeed}\nG53 G1 X${x} F${settings.approachSpeed}\nG53 G1 Y${y} F${settings.approachSpeed}`);
		message.value = { type: "info", text: tt("dockpos.atDock") };
	} catch (e) {
		message.value = { type: "error", text: tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) }) };
	} finally {
		busy.value = "";
		status.value = "";
	}
}

/** M564 S1 was on before the approach: put it back when leaving */
let limitsWereOn = false;

/** To the dock at reduced current and speed, without locking */
async function approach(): Promise<void> {
	const x = trialX.value, y = dockY(tool.value), sy = safeY.value;
	if (busy.value !== "" || fineBlockers.value.length > 0 || x === null || y === null || sy === null) {
		return;
	}
	busy.value = "approach";
	message.value = null;
	try {
		status.value = tt("dockpos.approaching", { x: x.toFixed(2) });
		await run(`G90\nG53 G1 Y${sy} F6000\nG53 G1 X${x} F6000`);
		// the dock line is outside the axis limits (M208 S1 Y = safeYmin): limits off, as the tool-change macros do
		limitsWereOn = (useMachineStore().model as any).move?.limitAxes !== false;
		await quick("M564 S0");
		await softMove(`G53 G1 Y${y} F${settings.approachSpeed}`);
		atDock.value = true;
		message.value = { type: "info", text: tt("dockpos.atDock") };
	} catch (e) {
		message.value = { type: "error", text: tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) }) };
	} finally {
		busy.value = "";
		status.value = "";
	}
}

/**
 * Out of the dock after an approach: back to safe Y at the approach speed, full XY current (already back after
 * each move, sent again as a safeguard), the axis limits as they were, and X and Y homed (a reduced-current
 * move may have lost steps). The reduced current is used only during the moves into the dock.
 */
async function backOut(): Promise<void> {
	status.value = tt("dockpos.leaving");
	if (safeY.value !== null) {
		await run(`G90\nG53 G1 Y${safeY.value} F${settings.approachSpeed}`);
	}
	await quick("M913 X100 Y100");
	if (limitsWereOn) {
		await quick("M564 S1");
		limitsWereOn = false;
	}
	await run("G28 X Y", 3000);
	atDock.value = false;
}

/** Back to safe Y, full current, home X and Y */
async function leave(): Promise<void> {
	if (busy.value !== "") {
		return;
	}
	busy.value = "leave";
	try {
		await backOut();
		message.value = { type: "success", text: tt("dockpos.left") };
	} catch (e) {
		message.value = { type: "error", text: tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) }) };
	} finally {
		busy.value = "";
		status.value = "";
	}
}

/** Pick the tool up and park it with the trial X set live, then home X and Y */
async function dockTest(): Promise<void> {
	const tuner = useIndxTuner();
	const x = trialX.value, t = tool.value;
	if (busy.value !== "" || x === null || fineBlockers.value.length > 0) {
		return;
	}
	busy.value = "test";
	message.value = null;
	if (atDock.value) {
		// from an approach: out of the dock at full current first, the test uses the normal tool change
		try {
			await backOut();
		} catch (e) {
			message.value = { type: "error", text: tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) }) };
			busy.value = "";
			status.value = "";
			return;
		}
	}
	const live = tuner.globalValue(X_LIST);
	const original: Scalar[] = Array.isArray(live) ? [...live] as Scalar[] : [];
	const list = [...original];
	while (list.length <= t) {
		list.push(null);
	}
	list[t] = x;
	const shape = { list: true, float: true };
	try {
		await quick(`set global.${X_LIST} = ${formatValue(list, shape)}`);
		await quick(`M568 P${t} S0 R0`);
		status.value = tt("dockpos.testing", { tool: t, x: x.toFixed(2) });
		const picked = await pickUp(t);
		if (picked === null) {
			const text = tt("tuning.pickFailed", { tool: t });
			message.value = { type: "error", text };
			lastTest.value = { x, grams: null, ok: false };
			toRecovery(text);
			return;
		}
		const raw = num(picked.INDX_LC_raw), before = num(picked.INDX_TC_lc_before), scale = num(picked.INDX_LC_scale);
		const grams = raw !== null && before !== null && scale !== null ? Math.abs((raw - before) * scale) : null;
		const parked = await park();
		if (parked === null) {
			const text = tt("tuning.parkFailed", { tool: t });
			message.value = { type: "error", text };
			lastTest.value = { x, grams, ok: false };
			toRecovery(text);
			return;
		}
		const ok = picked.INDX_TC_pick_lc_ok !== 0 && parked.INDX_TC_drop_lc_ok !== 0;
		lastTest.value = { x, grams, ok };
		status.value = tt("dockpos.leaving");
		await run("G28 X Y", 3000);
		message.value = { type: ok ? "success" : "warning", text: tt(ok ? "dockpos.testOk" : "dockpos.testChecks", { x: x.toFixed(2), g: grams === null ? "?" : Math.round(grams) }) };
	} catch (e) {
		const text = tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) });
		message.value = { type: "error", text };
		toRecovery(text);
	} finally {
		await quick(`set global.${X_LIST} = ${formatValue(original, shape)}`).catch(() => undefined);
		busy.value = "";
		status.value = "";
	}
}

/** A dock X as a pending edit of INDX_tool_x[tool] */
function use(x: number): string | null {
	const err = useIndxTuner().setElement(X_LIST, tool.value, x.toFixed(2));
	message.value = err === null ? { type: "success", text: tt("dockpos.used", { x: x.toFixed(2), tool: tool.value }) } : { type: "error", text: err };
	return err;
}

export function useDockPosition() {
	return { tool, settings, measured, stats, trialX, savedX, busy, motorsOff, atDock, status, message, lastTest, xEndstop,
		measureBlockers, fineBlockers, switchMotorsOff, measure, clearMeasurements, nudge, approach, leave, dockTest, use, currentTool };
}
