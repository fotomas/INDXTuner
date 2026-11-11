/**
 * Recovery: bring the INDX state back in line with what is physically on the head.
 * The RRF equivalents of Klipper's MANUAL_TOOL_REMOVE / MANUAL_TOOLHEAD_RESET / MANUAL_TOOL_SEAT,
 * built only from the official INDX macros (INDX_OPEN, INDX_CLOSE, INDX_WRITE_STATE, INDX_LC_RAW).
 */
import { computed, ref } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { formatValue, type Scalar } from "./model/rrfValues";
import { useIndxTuner } from "./useIndxTuner";

const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

export type Verdict = "emptyOk" | "toolOk" | "weakTool" | "toolButEmptyState" | "emptyButToolState" | "approximate" | "unknown";

/** Below this the head counts as empty; between this and INDX_TC_lc_min_g a tool hangs on a weak clamp */
const EMPTY_G = 150;

export interface RecoveryReading {
	state: number | null;           // INDX_State
	selected: number;               // state.currentTool
	x: number | null;
	y: number | null;
	grams: number | null;           // load cell above the empty-head reference
	refTool: number | null;         // dock whose empty-head reference was used
	refExact: boolean;              // the head is at that reference position, so the reading is comparable
	minG: number;                   // INDX_TC_lc_min_g, the park check's limit
	verdict: Verdict;
}

const reading = ref<RecoveryReading | null>(null);
const busy = ref(false);
const result = ref<{ type: "success" | "error" | "info"; text: string } | null>(null);
/** Why Recovery was opened (e.g. by a failed tuning run) */
const reason = ref("");

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function run(code: string): Promise<void> {
	const tuner = useIndxTuner();
	await useMachineStore().sendCode(code, false, true, true);
	await tuner.waitUntilIdle(1500, 60000);
}

/** Read the state and the load cell (INDX_LC_RAW only dwells and reads, it does not move) */
/**
 * The head has been declared empty: when it stands where a dock's empty-head reference is taken (that dock's
 * X, safe Y), store the load cell reading as that reference, as INDX_TC_PRE does, so later readings there
 * are exact.
 */
async function storeEmptyRef(): Promise<void> {
	const tuner = useIndxTuner();
	if (tuner.globalValue("INDX_LC_calibrated") !== true) {
		return;
	}
	const axes: any[] = (useMachineStore().model as any).move?.axes ?? [];
	const x = num(axes.find(a => a?.letter === "X")?.machinePosition), y = num(axes.find(a => a?.letter === "Y")?.machinePosition);
	const xs = tuner.globalValue("INDX_tool_x"), safeY = num(tuner.globalValue("safeYmin"));
	if (x === null || y === null || safeY === null || Math.abs(y - safeY) >= 1 || !Array.isArray(xs)) {
		return;
	}
	const i = xs.findIndex(v => typeof v === "number" && Math.abs(v - x) < 1);
	if (i < 0) {
		return;
	}
	await run('M98 P"INDX_LC_RAW.g"');
	const g = await tuner.readGlobals();
	const raw = num(g?.INDX_LC_raw);
	const refs = Array.isArray(g?.INDX_LC_empty_ref) ? [...g!.INDX_LC_empty_ref as Scalar[]] : [];
	if (raw === null || i >= refs.length) {
		return;
	}
	refs[i] = raw;
	await run(`set global.INDX_LC_empty_ref = ${formatValue(refs, { list: true, float: true })}`);
}

async function read(): Promise<void> {
	const tuner = useIndxTuner();
	const machineStore = useMachineStore();
	if (!machineStore.isConnected || busy.value) {
		return;
	}
	busy.value = true;
	result.value = null;
	try {
		const calibrated = tuner.globalValue("INDX_LC_calibrated") === true;
		if (calibrated) {
			await run('M98 P"INDX_LC_RAW.g"');
		}
		const g = await tuner.readGlobals();
		const axes: any[] = (machineStore.model as any).move?.axes ?? [];
		const pos = (letter: string) => num(axes.find(a => a?.letter === letter)?.machinePosition);
		const x = pos("X"), y = pos("Y");
		const state = num(g?.INDX_State);
		const selected = Number((machineStore.model.state as any).currentTool ?? -1);

		// the empty-head reference of the nearest dock; readings are only comparable at that position
		let grams: number | null = null, refTool: number | null = null, refExact = false;
		const refs = Array.isArray(g?.INDX_LC_empty_ref) ? g!.INDX_LC_empty_ref as unknown[] : [];
		const xs = Array.isArray(g?.INDX_tool_x) ? g!.INDX_tool_x as unknown[] : [];
		const raw = num(g?.INDX_LC_raw), scale = num(g?.INDX_LC_scale), safeY = num(g?.safeYmin);
		if (calibrated && raw !== null && scale !== null && x !== null) {
			let best = Infinity;
			refs.forEach((r, i) => {
				const rx = num(xs[i]);
				if (num(r) !== null && rx !== null && Math.abs(rx - x) < best) {
					best = Math.abs(rx - x);
					refTool = i;
				}
			});
			if (refTool !== null) {
				grams = Math.abs((raw - (refs[refTool] as number)) * scale);
				refExact = best < 1 && safeY !== null && y !== null && Math.abs(y - safeY) < 1;
			}
		}

		const minG = num(g?.INDX_TC_lc_min_g) ?? 400;
		let verdict: Verdict = "unknown";
		if (grams !== null && state !== null) {
			const toolOn = grams >= EMPTY_G;
			if (!refExact && toolOn && grams < minG) {
				// a reference from another position is off by a few hundred grams: too close to call
				verdict = "approximate";
			} else {
				verdict = state === -1 ? (toolOn ? "toolButEmptyState" : "emptyOk")
					: !toolOn ? "emptyButToolState" : grams < minG ? "weakTool" : "toolOk";
			}
		}
		reading.value = { state, selected, x, y, grams, refTool, refExact, minG, verdict };
	} catch (e) {
		result.value = { type: "error", text: e instanceof Error ? e.message : String(e) };
	} finally {
		busy.value = false;
	}
}

async function act(kind: "remove" | "reset" | "seat", tool?: number): Promise<void> {
	if (busy.value) {
		return;
	}
	busy.value = true;
	result.value = null;
	try {
		const state = reading.value?.state ?? null;
		if (kind === "remove") {
			// INDX_OPEN refuses to run when the state already says open
			if (state === -1) {
				await run("set global.INDX_State = 99");
			}
			await run('M98 P"INDX_OPEN.g"');
		} else if (kind === "reset") {
			await run("set global.INDX_State = -1");
			await run("T-1 P0");
			await run('M98 P"INDX_WRITE_STATE.g"');
			await run("M562");             // clear heater faults left by the failed change (all heaters)
			await storeEmptyRef();
		} else if (tool !== undefined) {
			// INDX_CLOSE refuses to run when a tool is already recorded
			if (state !== -1) {
				await run("set global.INDX_State = -1");
			}
			await run('M98 P"INDX_CLOSE.g"');
			await run(`set global.INDX_State = ${tool}`);
			await run('M98 P"INDX_WRITE_STATE.g"');
			await run(`T${tool} P0`);
		}
		result.value = { type: "success", text: t(`recovery.done.${kind}`, { tool: tool ?? "" }) };
		reason.value = "";
	} catch (e) {
		result.value = { type: "error", text: e instanceof Error ? e.message : String(e) };
	} finally {
		busy.value = false;
	}
	await read();
}

async function homeXY(): Promise<void> {
	if (busy.value) {
		return;
	}
	busy.value = true;
	try {
		await run("G28 X Y");
		result.value = { type: "success", text: t("recovery.homed") };
	} catch (e) {
		result.value = { type: "error", text: e instanceof Error ? e.message : String(e) };
	} finally {
		busy.value = false;
	}
}

export function useRecovery() {
	const canAct = computed(() => useMachineStore().isConnected && !busy.value
		&& !["processing", "paused", "pausing", "resuming", "simulating"].includes(useIndxTuner().machineStatus()));
	return { reading, busy, result, reason, canAct, read, act, homeXY };
}
