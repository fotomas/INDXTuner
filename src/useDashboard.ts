/**
 * Dashboard: what needs doing or fixing, shown only when something does. Every item links to the page
 * that fixes it. Read from the plugin's own state, the object model, and config.g / config-override.g
 * (for the Z offsets, which are saved there with M500 P10, not in the override file).
 */
import { computed, ref } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { clampBands, useIndxTuner } from "./useIndxTuner";

export interface DashIssue {
	key: string;
	severity: "error" | "warning";
	text: string;
	detail?: string;
	go?: string;            // the view that fixes it (a section id or a page id)
	goLabel?: string;
}

const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const tools = (list: number[]) => list.map(n => `T${n}`).join(", ");

/** The contents of config.g and config-override.g, read when the dashboard is shown */
const configText = ref<string | null>(null);
const overrideText = ref<string | null>(null);   // "" when the file does not exist

async function readText(file: string): Promise<string | null> {
	try {
		const content = await useMachineStore().download({ filename: `${useIndxTuner().sysDir()}${file}`, type: "text" }, false, false, false);
		return typeof content === "string" ? content : await (content as Blob).text();
	} catch {
		return null;
	}
}

async function refreshFiles(): Promise<void> {
	configText.value = await readText("config.g");
	overrideText.value = (await readText("config-override.g")) ?? "";
}

const code = (text: string) => text.split(/\r?\n/).map(l => l.replace(/;.*$/, "").trim());

/** Z offsets saved in config-override.g: tool -> Z */
function savedZ(text: string): Map<number, number> {
	const out = new Map<number, number>();
	for (const l of code(text)) {
		// tool offsets only: G10 L2 / L20 lines set workplace coordinates and also have P and Z
		const m = /^G10\b.*\bP(\d+)\b.*\bZ(-?[\d.]+)/i.exec(l);
		if (m && !/\bL\d/i.test(l)) {
			out.set(Number(m[1]), Number(m[2]));
		}
	}
	return out;
}

const issues = computed<DashIssue[]>(() => {
	const tuner = useIndxTuner();
	const model: any = useMachineStore().model;
	const out: DashIssue[] = [];
	const docks = tuner.docks.value.numbers;
	const clampPage = { go: "clamp", goLabel: t("rail.clampingForce") };
	const sectionOf = (view: string) => tuner.sections.value.find(s => s.view === view)?.id;

	// the head
	if (tuner.globalValue("INDX_State") !== undefined && !tuner.headStateConsistent()) {
		out.push({ key: "head", severity: "error", text: t("dash.headState"), go: "recovery", goLabel: t("rail.recovery") });
	}

	// load cell
	const scale = num(tuner.globalValue("INDX_LC_scale"));
	const defScale = num(tuner.rowFor("INDX_LC_scale")?.info?.defaultValue);
	if (tuner.globalValue("INDX_LC_calibrated") === false) {
		out.push({ key: "lc", severity: "error", text: t("dash.lcNot"), ...clampPage });
	} else if (scale !== null && defScale !== null && Math.abs(Math.abs(scale) - defScale) < 1e-6) {
		out.push({ key: "lc", severity: "warning", text: t("dash.lcDefault"), detail: t("dash.lcDefaultDetail", { v: defScale }), ...clampPage });
	}

	// tool numbering and setup
	if (docks.length === 0 && tuner.loadedOnce.value) {
		out.push({ key: "noTools", severity: "warning", text: t("docks.noTools") });
	} else if (!tuner.docks.value.contiguous) {
		out.push({ key: "gaps", severity: "error", text: t("docks.gaps", { last: docks.length - 1 }) });
	}
	if (tuner.dockMismatch.value) {
		out.push({ key: "mismatch", severity: "warning", text: t("docks.mismatch", tuner.dockMismatch.value), go: "overrides", goLabel: t("rail.overrides") });
	}
	if (tuner.rowFor("INDX_latch_tool")?.hidden === false) {
		out.push({ key: "latchTool", severity: "error", text: t("docks.latchCollision", { tool: tuner.latchTool.value }), go: "overrides", goLabel: t("rail.overrides") });
	}
	if (tuner.macroChecks.value.some(c => c.status !== "ok") || tuner.staleMacros.value.length > 0) {
		out.push({ key: "macros", severity: "warning", text: t("dash.macros"), go: "macros", goLabel: t("rail.toolMacros") });
	}

	// dock positions
	const xs = tuner.currentList("INDX_tool_x") ?? [];
	if (docks.length > 0 && tuner.rowFor("INDX_tool_x")?.entry === undefined) {
		out.push({ key: "dockX", severity: "warning", text: t("dash.dockXNotSet"), detail: t("dash.dockXNotSetDetail"), go: "dockpos", goLabel: t("rail.dockPosition") });
	} else {
		const missing = docks.filter(n => num(xs[n]) === null);
		if (missing.length > 0) {
			out.push({ key: "dockX", severity: "warning", text: t("dash.dockXMissing", { tools: tools(missing) }), go: "dockpos", goLabel: t("rail.dockPosition") });
		}
	}

	// clamping: forces, then latch travel per tool
	const b = clampBands();
	const forces = docks.map(n => ({ n, g: tuner.clampLog.value.get(n)?.grams ?? null }));
	for (const f of forces) {
		if (f.g === null) {
			continue;
		}
		if (f.g < b.min) {
			out.push({ key: `force${f.n}`, severity: "error", text: t("dash.forceFail", { tool: f.n, g: Math.round(f.g), min: b.min }), ...clampPage });
		} else if (f.g < b.low) {
			out.push({ key: `force${f.n}`, severity: "warning", text: t("dash.forceWeak", { tool: f.n, g: Math.round(f.g) }), detail: t("dash.forceWeakDetail", { low: b.low }), ...clampPage });
		} else if (f.g > b.high) {
			out.push({ key: `force${f.n}`, severity: "warning", text: t("dash.forceHigh", { tool: f.n, g: Math.round(f.g) }), detail: t("dash.forceHighDetail", { high: b.high }), ...clampPage });
		}
	}
	const unmeasured = forces.filter(f => f.g === null).map(f => f.n);
	if (unmeasured.length > 0 && tuner.loadedOnce.value) {
		out.push({ key: "forceNone", severity: "warning", text: t("dash.forceNone", { tools: tools(unmeasured) }), ...clampPage });
	}
	if (tuner.rowFor("INDX_latch_close_tool")?.info) {
		const lt = tuner.currentList("INDX_latch_close_tool") ?? [];
		const untuned = docks.filter(n => num(lt[n]) === null);
		if (untuned.length > 0) {
			out.push({ key: "latch", severity: "warning", text: t("dash.latchNot", { tools: tools(untuned) }),
				detail: t("dash.latchNotDetail", { v: tuner.currentNumber("INDX_latch_close_e") ?? "?" }), ...clampPage });
		}
	}

	// bed probing: mesh points the nozzle cannot reach with the load cell probe
	const outside = meshOutside(model, tuner);
	if (outside > 0) {
		out.push({ key: "mesh", severity: "warning", text: t("dash.meshOutside", { n: outside }), go: sectionOf("mesh"), goLabel: t("dash.bedProbing") });
	}

	// Z offsets: saved in config-override.g, and loaded by M501 in config.g
	if (overrideText.value !== null && docks.length > 0) {
		const saved = savedZ(overrideText.value);
		const live = new Map<number, number>();
		for (const tl of (model.tools ?? []) as any[]) {
			const z = num(tl?.offsets?.[2]);
			if (tl && z !== null) {
				live.set(Number(tl.number), z);
			}
		}
		const notSaved = docks.filter(n => !saved.has(n) || (live.has(n) && Math.abs((saved.get(n) as number) - (live.get(n) as number)) > 0.0005));
		if (notSaved.length > 0) {
			out.push({ key: "zSaved", severity: "warning", text: t("dash.zNotSaved", { tools: tools(notSaved) }), detail: t("dash.zNotSavedDetail"), go: "zoff", goLabel: t("rail.zOffset") });
		}
	}
	if (configText.value !== null && !code(configText.value).some(l => /^M501\b/i.test(l))) {
		out.push({ key: "m501", severity: "warning", text: t("dash.noM501"), detail: t("dash.noM501Detail") });
	}

	return out.sort((a, c) => (a.severity === c.severity ? 0 : a.severity === "error" ? -1 : 1));
});

/** Mesh points (laid out as RRF does) whose nozzle position, with the load cell's X/Y offset, is outside the axis limits */
function meshOutside(model: any, tuner: ReturnType<typeof useIndxTuner>): number {
	const pair = (name: string): [number, number] | null => {
		const v = tuner.currentValue(name);
		return Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null ? [v[0] as number, v[1] as number] : null;
	};
	const mn = pair("INDX_mesh_min"), sp = num(tuner.currentValue("INDX_mesh_spacing")), m = tuner.mesh.value;
	const axes: any[] = model.move?.axes ?? [];
	const ax = axes.find(a => a?.letter === "X"), ay = axes.find(a => a?.letter === "Y");
	if (mn === null || sp === null || sp <= 0 || m === null || m.total <= 0 || m.total > 2000 || !ax || !ay) {
		return 0;
	}
	const probes: any[] = model.sensors?.probes ?? [];
	const lc = probes.find(p => p && Number(p.type) === 12) ?? probes.find(Boolean);
	const ox = num(lc?.offsets?.[0]) ?? 0, oy = num(lc?.offsets?.[1]) ?? 0;
	let n = 0;
	for (let j = 0; j < m.ny; j++) {
		for (let i = 0; i < m.nx; i++) {
			const x = mn[0] + i * sp - ox, y = mn[1] + j * sp - oy;
			if (x < Number(ax.min) - 1e-6 || x > Number(ax.max) + 1e-6 || y < Number(ay.min) - 1e-6 || y > Number(ay.max) + 1e-6) {
				n++;
			}
		}
	}
	return n;
}

export function useDashboard() {
	return { issues, refreshFiles };
}
