/**
 * Helpers shared by the tuning pages (Z Offset, Speed, Dock Position): running a command and waiting for
 * the printer, picking up and parking with the official tool-change macros, the start conditions, and
 * handing a failure over to the Recovery page.
 */
import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { useIndxTuner } from "./useIndxTuner";
import { useRecovery } from "./useRecovery";

export const tt = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

/** Send a command and wait until the printer has been busy and is idle again */
export async function run(code: string, startTimeout = 1500): Promise<void> {
	await useMachineStore().sendCode(code, false, true, true);
	await useIndxTuner().waitUntilIdle(startTimeout, 300000);
}

/** Send a command that does not move anything (set, M568, G10, ...) and wait for its reply */
export async function quick(code: string): Promise<string> {
	return await useMachineStore().sendCode(code, false, false);
}

export function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function median(xs: number[]): number | null {
	if (xs.length === 0) {
		return null;
	}
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function currentTool(): number {
	return Number((useMachineStore().model.state as any).currentTool ?? -1);
}

/**
 * Read the INDX globals until INDX_State is `expected` and the printer is idle, for up to `timeoutMs`.
 * A tool change runs several macros, and the printer can look idle for a moment between them, so one
 * read straight after the command is not enough. Returns the globals, or null when the state never came.
 */
export async function waitForState(expected: number, timeoutMs = 10000): Promise<Record<string, unknown> | null> {
	const tuner = useIndxTuner();
	const until = Date.now() + timeoutMs;
	for (;;) {
		const g = await tuner.readGlobals();
		if (g !== null && g.INDX_State === expected && tuner.machineStatus() === "idle") {
			return g;
		}
		if (Date.now() > until) {
			return null;
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
}

/** Pick up a tool with T<n>; the INDX globals afterwards, or null when the head does not hold that tool */
export async function pickUp(tool: number): Promise<Record<string, unknown> | null> {
	await run(`T${tool}`, 4000);
	return await waitForState(tool);
}

/** Park the tool on the head with T-1; the INDX globals afterwards, or null when the head is not empty */
export async function park(): Promise<Record<string, unknown> | null> {
	await run("T-1", 4000);
	return await waitForState(-1);
}

/** Report a failed run and open the Recovery page */
export function toRecovery(text: string): void {
	useRecovery().reason.value = text;
}

export interface Needs {
	homed?: string[];        // axes that must be homed
	calibrated?: boolean;    // INDX_LC_calibrated
	empty?: boolean;         // nothing on the head
}

/** Why a tuning run cannot start now; empty when it can */
export function blockers(needs: Needs): string[] {
	const machineStore = useMachineStore();
	const tuner = useIndxTuner();
	if (!machineStore.isConnected) {
		return [tt("measure.notConnected")];
	}
	const out: string[] = [];
	if (tuner.machineStatus() !== "idle") {
		out.push(tt("measure.notIdle"));
	}
	const homed = needs.homed ?? [];
	if (!homed.every(a => tuner.axisHomed(a))) {
		out.push(tt("tuning.notHomed", { axes: homed.join(", ") }));
	}
	if (needs.calibrated && tuner.globalValue("INDX_LC_calibrated") !== true) {
		out.push(tt("measure.notCalibrated"));
	}
	if (tuner.globalValue("INDX_State") === undefined) {
		out.push(tt("measure.noGlobals"));
	} else if (!tuner.headStateConsistent()) {
		out.push(tt("tuning.stateMismatch"));
	} else if (needs.empty && currentTool() >= 0) {
		out.push(tt("measure.notEmpty"));
	}
	return out;
}
