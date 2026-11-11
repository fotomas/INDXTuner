/**
 * Tuning - Z Offset: every tool's Z offset against T0, measured with the load cell (like CAL_Z on Klipper).
 * Each tool probes the homez probe point (INDX_probe_x/y) with G30 S-1, which reports the trigger height
 * without changing the Z datum. Saved with G10 + M500 P10, not in the override file.
 *
 * Sign: RRF moves the head to machine Z = user Z - tool offset, so a nozzle that is d lower needs an offset
 * d more negative. The reported trigger height is taken as a user coordinate (tool offset included):
 * machine trigger = reported - offset. New offset of tool t = offset(T0) - (machine(t) - machine(T0)).
 */
import { computed, reactive, ref } from "vue";

import { useMachineStore } from "@/stores/machine";

import { useIndxTuner } from "./useIndxTuner";
import { blockers, currentTool, num, park, pickUp, quick, run, toRecovery, tt } from "./useTuning";

export interface ZResult {
	tool: number;
	heights: number[];
	now: number | null;       // G10 Z when measured
}

const settings = reactive({ probes: 5, hot: false, hotTemp: 215, startZ: 5 });
const results = ref<ZResult[]>([]);
/** Tools left out of the next run (all are measured by default; T0, the reference, always is) */
const skipped = ref<number[]>([]);

const selectedTools = computed(() => [...useIndxTuner().docks.value.numbers]
	.filter(t => t === 0 || !skipped.value.includes(t)).sort((a, b) => a - b));

function setSelected(tool: number, on: boolean): void {
	if (running.value || tool === 0) {
		return;
	}
	skipped.value = on ? skipped.value.filter(t => t !== tool) : [...new Set([...skipped.value, tool])];
}

function setAll(on: boolean): void {
	if (!running.value) {
		skipped.value = on ? [] : useIndxTuner().docks.value.numbers.filter(t => t !== 0);
	}
}
const running = ref(false);
const stopRequested = ref(false);
const status = ref("");
const message = ref<{ type: "success" | "warning" | "error"; text: string } | null>(null);

function offsetOf(tool: number): number | null {
	const tools: any[] = (useMachineStore().model as any).tools ?? [];
	return num(tools.find(x => x?.number === tool)?.offsets?.[2]);
}

const startBlockers = computed(() => blockers({ homed: ["X", "Y", "Z"], calibrated: true }));

/** The rows of the table, T0 first */
const rows = computed(() => {
	const ref0 = results.value.find(r => r.tool === 0);
	const mean = (r: ZResult) => r.heights.reduce((a, b) => a + b, 0) / r.heights.length;
	const m0 = ref0 && ref0.heights.length ? mean(ref0) - (ref0.now ?? 0) : null;
	return results.value.map(r => {
		const has = r.heights.length > 0;
		const trigger = has ? mean(r) : null;
		const spread = has ? Math.max(...r.heights) - Math.min(...r.heights) : null;
		let measured: number | null = null;
		if (trigger !== null && m0 !== null && ref0) {
			measured = r.tool === 0 ? (ref0.now ?? 0) : (ref0.now ?? 0) - ((trigger - (r.now ?? 0)) - m0);
		}
		return { tool: r.tool, trigger, spread, now: r.now, measured, change: measured !== null && r.now !== null ? measured - r.now : null, n: r.heights.length };
	});
});

/** The commands "Save selected" sends: the tools measured in the last run */
const saveCodes = computed(() => {
	const codes = rows.value.filter(r => r.tool !== 0 && r.measured !== null).map(r => `G10 P${r.tool} Z${(r.measured as number).toFixed(3)}`);
	return codes.length ? [...codes, "M500 P10"] : [];
});

async function start(): Promise<void> {
	const tuner = useIndxTuner();
	if (running.value || startBlockers.value.length > 0) {
		return;
	}
	const tools = selectedTools.value;
	if (!tools.includes(0)) {
		message.value = { type: "error", text: tt("zoff.noT0") };
		return;
	}
	const px = tuner.currentNumber("INDX_probe_x") ?? 0, py = tuner.currentNumber("INDX_probe_y") ?? 0;
	running.value = true;
	stopRequested.value = false;
	message.value = null;
	results.value = tools.map(tool => ({ tool, heights: [], now: offsetOf(tool) }));
	try {
		for (const tool of tools) {
			if (stopRequested.value) {
				break;
			}
			status.value = tt("zoff.picking", { tool });
			await quick(settings.hot ? `M568 P${tool} S${settings.hotTemp} R0` : `M568 P${tool} S0 R0`);
			if (currentTool() !== tool) {
				if (await pickUp(tool) === null) {
					toRecovery(tt("tuning.pickFailed", { tool }));
					message.value = { type: "error", text: tt("tuning.pickFailed", { tool }) };
					return;
				}
			}
			if (settings.hot) {
				status.value = tt("zoff.heating", { tool });
				await run(`M116 P${tool}`);
			}
			await run(`G90\nG1 Z${settings.startZ} F600\nG1 X${px} Y${py} F6000`);
			for (let i = 1; i <= Math.max(1, settings.probes); i++) {
				if (stopRequested.value) {
					break;
				}
				status.value = tt("zoff.probing", { tool, i, n: settings.probes });
				await run("G30 S-1");
				const h = num(await tuner.readKey("sensors.probes[0].lastStopHeight"));
				await run(`G1 Z${settings.startZ} F600`);
				if (h === null) {
					throw new Error(tt("zoff.noHeight"));
				}
				const r = results.value.find(x => x.tool === tool)!;
				r.heights = [...r.heights, h];
				results.value = [...results.value];
			}
		}
		if (currentTool() >= 0) {
			status.value = tt("zoff.parking");
			if (await park() === null) {
				toRecovery(tt("tuning.parkFailed", { tool: currentTool() }));
				message.value = { type: "error", text: tt("tuning.parkFailed", { tool: currentTool() }) };
				return;
			}
		}
		message.value = stopRequested.value ? { type: "warning", text: tt("tuning.stopped") } : { type: "success", text: tt("zoff.done") };
	} catch (e) {
		const text = tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) });
		message.value = { type: "error", text };
		toRecovery(text);
	} finally {
		if (settings.hot) {
			for (const tool of tools) {
				await quick(`M568 P${tool} S0 R0`).catch(() => undefined);
			}
		}
		running.value = false;
		status.value = "";
	}
}

function stop(): void {
	stopRequested.value = true;
}

/** G10 for every measured tool, then M500 P10 */
async function saveAll(): Promise<void> {
	const codes = saveCodes.value;
	try {
		for (const code of codes) {
			await quick(code);
		}
		message.value = { type: "success", text: tt("zoff.saved", { n: codes.length - 1 }) };
		// the table now compares against the new offsets
		results.value = results.value.map(r => ({ ...r }));
	} catch (e) {
		message.value = { type: "error", text: tt("tuning.failed", { error: e instanceof Error ? e.message : String(e) }) };
	}
}

export function useZOffset() {
	return { settings, results, rows, running, status, message, startBlockers, saveCodes, skipped, selectedTools, setSelected, setAll, start, stop, saveAll };
}
