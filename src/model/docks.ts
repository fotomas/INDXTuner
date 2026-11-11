/** Dock tools, per-tool lists and the clamp forces logged by the pickup check */

import type { Scalar, Value } from "./rrfValues";

/** Dock tools = every tool in the object model except the latch tool; the tool number is the dock index */
export const LATCH_TOOL_NAME = "INDX latch";          // M563 S"INDX latch" in INDX_variables.g

export function dockTools(tools: unknown, latchTool: number | null): { numbers: number[]; contiguous: boolean } {
	const numbers = (Array.isArray(tools) ? tools : [])
		.filter((t: any) => t !== null && typeof t === "object" && typeof t.number === "number" && t.name !== LATCH_TOOL_NAME)
		.map((t: any) => t.number as number)
		.filter((n): n is number => n !== latchTool)
		.sort((a, b) => a - b);
	const contiguous = numbers.every((n, i) => n === i);
	return { numbers, contiguous };
}

/** A list cut or padded with null to n entries; a single value becomes a list */
export function resizeList(v: Value | undefined, n: number): Scalar[] {
	const list: Scalar[] = Array.isArray(v) ? [...v] : (v === undefined ? [] : [v]);
	return list.length >= n ? list.slice(0, n) : [...list, ...new Array<Scalar>(n - list.length).fill(null)];
}

export function allNull(v: Value | undefined): boolean {
	return Array.isArray(v) && v.every(x => x === null);
}

export interface ClampReading {
	grams: number;          // settled clamp force: head_tool before a park, or the tuner's settled reading
	time: number;           // printer uptime in seconds when it was logged (check log), 0 if unknown
	date?: number;          // wall-clock time in ms, when known
	source: "tuner" | "checks";
	ok?: boolean;           // the pickup check passed
}

/**
 * The last head_tool reading per tool from indx_tc_checks.csv (time_s,change,check,tool,before,after,delta,extra,result).
 * head_tool is read by INDX_TC_FREE before each park, when the clamp force has settled; pick_lc, read right after
 * the pickup, is about a half higher than the force that then holds the tool.
 */
export function latestPickForces(csv: string): Map<number, ClampReading> {
	const out = new Map<number, ClampReading>();
	const lines = csv.split(/\r?\n/).filter(l => l.trim() !== "");
	if (lines.length < 2) {
		return out;
	}
	const head = lines[0].split(",").map(s => s.trim());
	const col = (name: string) => head.indexOf(name);
	const iTime = col("time_s"), iCheck = col("check"), iTool = col("tool"), iDelta = col("delta");
	if (iCheck < 0 || iTool < 0 || iDelta < 0) {
		return out;
	}
	for (const line of lines.slice(1)) {
		const c = line.split(",");
		if (c[iCheck]?.trim() !== "head_tool") {
			continue;
		}
		const tool = Number(c[iTool]), grams = Math.abs(Number(c[iDelta])), time = Number(c[iTime]);
		if (Number.isInteger(tool) && Number.isFinite(grams)) {
			out.set(tool, { grams, time: Number.isFinite(time) ? time : 0, source: "checks" });   // later rows win
		}
	}
	return out;
}

// ---------------------------------------------------------------- the plugin's own measurement log

export const TUNER_LOG_HEADER = "date,tool,pick_g,ok";

export function tunerLogLine(date: Date, tool: number, grams: number, ok: boolean): string {
	return `${date.toISOString()},${tool},${grams.toFixed(1)},${ok ? 1 : 0}`;
}

/** The last measurement per tool from indx-tuner-clamp.csv */
export function latestTunerForces(csv: string): Map<number, ClampReading> {
	const out = new Map<number, ClampReading>();
	for (const line of csv.split(/\r?\n/).slice(1)) {
		const [d, t, g, ok] = line.split(",");
		const tool = Number(t), grams = Math.abs(Number(g)), date = Date.parse(d);
		if (Number.isInteger(tool) && Number.isFinite(grams) && Number.isFinite(date)) {
			out.set(tool, { grams, time: 0, date, source: "tuner", ok: ok?.trim() === "1" });
		}
	}
	return out;
}

/**
 * The newer reading per tool from both logs. A check-log row from the current boot gets a date
 * from the uptime; an older one has none and loses against any dated reading.
 */
export function mergeReadings(tuner: Map<number, ClampReading>, checks: Map<number, ClampReading>, upTime: number, now: number): Map<number, ClampReading> {
	const out = new Map<number, ClampReading>();
	for (const [tool, r] of checks) {
		const date = upTime > 0 && r.time > 0 && r.time <= upTime ? now - (upTime - r.time) * 1000 : undefined;
		out.set(tool, { ...r, date });
	}
	for (const [tool, r] of tuner) {
		const c = out.get(tool);
		if (c === undefined || c.date === undefined || (r.date ?? 0) >= c.date) {
			out.set(tool, r);
		}
	}
	return out;
}
