/**
 * State and actions of the INDX Tuner page. Module-level state, so unsaved edits survive a visit to
 * another DWC page.
 */
import { computed, reactive, ref, watch } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { TUNER_LOG_HEADER, allNull, dockTools, latestPickForces, latestTunerForces, mergeReadings, resizeList, tunerLogLine, type ClampReading } from "./model/docks";
import { LIMITS, MANAGED_BY_MACROS, checkLimits } from "./model/limits";
import { checkMesh, maxGridPoints, type MeshResult } from "./model/meshCheck";
import { INDX_MACROS, hasFile, type IndxMacro } from "./model/indxMacros";
import { applyOverrideChanges, parseOverride, type OverrideChange, type OverrideEntry } from "./model/overrideFile";
import { formatValue, fromModel, mergeShape, parseInput, parseLiteral, shapeOf, valuesEqual, type Scalar, type Value, type ValueShape } from "./model/rrfValues";
import { DEFAULT_SECTION_ICON, styleFor, titleCase, type SectionView } from "./model/sections";
import { brokenCalls, callersOf, configLoadsVariables, fileStatus, isScanned } from "./model/setupCheck";
import { MACRO_KINDS, checkMacro, macroFile, macroTemplate, staleMacroFiles, type MacroCheck } from "./model/toolMacros";
import { namesSetIn, parseVariablesFile, unitFromHelp, type VarInfo, type VariablesFile } from "./model/variablesFile";

const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

export const VARIABLES = "INDX_variables.g";
export const OVERRIDE = "INDX_variables_override.g";
export const BACKUP = "INDX_variables_override.g.bak";
const STATE_FILES = ["indx-state.g", "indx-head.g"];
const CHECKS_LOG = "indx_tc_checks.csv";
/** The plugin's own log of clamp measurements; created on the first measurement */
export const TUNER_LOG = "indx-tuner-clamp.csv";

/** Variables drawn on the Tool docks page instead of the list */
export const DOCK_LIST_VARS = ["INDX_tool_x", "INDX_latch_close_tool"];
/**
 * Settings the INDX macros keep in a state file that INDX_variables.g runs after the override file, so an
 * override line would have no effect. Saving sets them live and runs the macro that writes the state file.
 */
export const LIVE_STATE_VARS: Record<string, string> = { INDX_DEBUG: "INDX_WRITE_STATE.g" };

/** Always at the top of the Overrides list, and not on a Settings page */
export const PINNED_VARS = ["INDX_DEBUG"];
const LATCH_TOOL_VAR = "INDX_latch_tool";
/** Fixed "weak clamp" level, the default W of INDX_LATCH_TEST */
export const WEAK_CLAMP_G = 800;          // (unused since the stepwise close; kept for the force colours history)
export const HIGH_CLAMP_G = 2500;        // above this a clamp is too tight (latch wear, load on dock and tool)
export const LOW_CLAMP_FRACTION = 0.75;  // below this share of INDX_LC_locking_force a clamp is weak

/** The force bands shown on Tool Docks and Tool Clamping */
export function clampBands(): { min: number; low: number; high: number; nominal: number } {
	const t = useIndxTuner();
	const nominal = t.currentNumber("INDX_LC_locking_force") ?? 1600;
	return { min: t.currentNumber("INDX_TC_lc_min_g") ?? 700, low: Math.round(nominal * LOW_CLAMP_FRACTION), high: HIGH_CLAMP_G, nominal };
}

/** Red below the INDX pickup check, amber when weak or too tight, green otherwise */
export function clampColor(g: number): string {
	const b = clampBands();
	return g < b.min ? "rgb(var(--v-theme-error))" : g < b.low || g > b.high ? "rgb(var(--v-theme-warning))" : "rgb(var(--v-theme-success))";
}

export type RowState = "default" | "override" | "pending" | "remove" | "readonly";

export interface Row {
	name: string;
	info: VarInfo | null;           // null: in the override file but not declared in INDX_variables.g
	entry: OverrideEntry | undefined;
	shape: ValueShape;
	unit: string | undefined;
	editable: boolean;
	hidden: boolean;
	readonlyReason: string;
	state: RowState;
	effective: Value | undefined;   // what the variable is after INDX_variables.g runs, without pending edits
	current: Value | undefined;     // effective with the pending edit applied
	pendingText: string | undefined;
	pendingValue: Value | null | undefined; // null = remove from the file
	error: string | undefined;
}

export interface SectionView_ {
	id: string;
	header: string;         // the title as written in INDX_variables.g
	title: string;          // the title shown
	description: string;
	icon: string;
	view: SectionView | undefined;
	rows: Row[];
	overrides: number;
	pending: number;
	problems: number;
}

export interface SaveStep {
	label: string;
	state: "waiting" | "running" | "done" | "failed";
}

export interface Problem {
	sectionId: string;
	text: string;
}

// ---------------------------------------------------------------- state

const vf = ref<VariablesFile | null>(null);
const overrideText = ref<string>("");
const overrideExists = ref(false);
const restored = ref(new Map<string, string>());       // variable -> state file that sets it
const sysFiles = ref(new Set<string>());
const macroDirFiles = ref(new Set<string>());
const macroTexts = ref(new Map<string, string>());     // scanned macro file name -> content (INDX_*.g, tool and system macros)
const configText = ref<string | null>(null);
const checksReadings = ref(new Map<number, ClampReading>());
const tunerReadings = ref(new Map<number, ClampReading>());
const tunerLogText = ref<string | null>(null);
const loading = ref(false);
const loadError = ref("");
const missingVariables = ref(false);
const loadedOnce = ref(false);

interface Pending { text: string; value: Value | null | undefined; error: string | undefined }
const pending = reactive(new Map<string, Pending>());

const saving = ref(false);
const saveSteps = ref<SaveStep[]>([]);
const saveResult = ref<{ type: "success" | "warning" | "error"; text: string; details: string[] } | null>(null);
const macroBusy = ref(false);
const macroResult = ref<{ type: "success" | "error"; text: string } | null>(null);

// ---------------------------------------------------------------- helpers

function sysDir(): string {
	const dir = String((useMachineStore().model as any).directories?.system ?? "0:/sys/");
	return dir.endsWith("/") ? dir : dir + "/";
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function downloadText(filename: string): Promise<string> {
	const content = await useMachineStore().download({ filename, type: "text" }, false, false, false);
	return typeof content === "string" ? content : await (content as Blob).text();
}

async function uploadText(filename: string, text: string): Promise<void> {
	await useMachineStore().upload({ filename, content: new Blob([text], { type: "text/plain" }) }, false, false, true);
}

function machineStatus(): string {
	return String((useMachineStore().model.state as any).status ?? "");
}

function upTime(): number {
	return Number((useMachineStore().model.state as any).upTime ?? 0);
}

/** Wait until the machine has been busy and is idle again (an echo from a macro already resolves sendCode) */
function waitUntilIdle(startTimeoutMs = 4000, maxMs = 120000): Promise<void> {
	return new Promise(resolve => {
		const started = Date.now();
		let seenBusy = false;
		const timer = setInterval(() => {
			const idle = machineStatus() === "idle";
			seenBusy ||= !idle;
			const elapsed = Date.now() - started;
			if ((seenBusy && idle) || (!seenBusy && elapsed > startTimeoutMs) || elapsed > maxMs || !useMachineStore().isConnected) {
				clearInterval(timer);
				resolve();
			}
		}, 250);
	});
}

function unitOf(name: string): string | undefined {
	const info = vf.value?.vars.get(name);
	return LIMITS[name]?.unit ?? (info ? unitFromHelp(info.help) : undefined);
}

// ---------------------------------------------------------------- loading

async function load(): Promise<void> {
	const machineStore = useMachineStore();
	if (!machineStore.isConnected || loading.value) {
		return;
	}
	loading.value = true;
	loadError.value = "";
	addedNames.value = [];
	try {
		const dir = sysDir();
		const names = new Set((await machineStore.getFileList(dir)).filter((f: any) => !f.isDirectory).map((f: any) => String(f.name)));
		sysFiles.value = names;

		missingVariables.value = !names.has(VARIABLES);
		vf.value = missingVariables.value ? null : parseVariablesFile(await downloadText(dir + VARIABLES));

		overrideExists.value = names.has(OVERRIDE);
		overrideText.value = overrideExists.value ? await downloadText(dir + OVERRIDE) : "";

		const r = new Map<string, string>();
		for (const file of STATE_FILES) {
			if (names.has(file)) {
				for (const n of namesSetIn(await downloadText(dir + file))) {
					r.set(n, file);
				}
			}
		}
		restored.value = r;

		await loadMacros(names);
		checksReadings.value = names.has(CHECKS_LOG) ? latestPickForces(await downloadText(dir + CHECKS_LOG)) : new Map();
		tunerLogText.value = names.has(TUNER_LOG) ? await downloadText(dir + TUNER_LOG) : null;
		tunerReadings.value = tunerLogText.value !== null ? latestTunerForces(tunerLogText.value) : new Map();

		// drop pending edits that no longer apply
		for (const name of [...pending.keys()]) {
			if (rowFor(name) === null) {
				pending.delete(name);
			}
		}
		loadedOnce.value = true;
	} catch (e) {
		loadError.value = errorText(e);
	} finally {
		loading.value = false;
	}
}

function macrosDir(): string {
	const dir = String((useMachineStore().model as any).directories?.macros ?? "0:/macros/");
	return dir.endsWith("/") ? dir : dir + "/";
}

/** Read the macros the setup check looks at, config.g and the macros directory listing */
async function loadMacros(names: Set<string>): Promise<void> {
	const machineStore = useMachineStore();
	const dir = sysDir();
	const texts = new Map<string, string>();
	for (const name of names) {
		if (isScanned(name)) {
			texts.set(name, await downloadText(dir + name));
		}
	}
	macroTexts.value = texts;
	configText.value = hasFile(names, "config.g") ? await downloadText(dir + "config.g") : null;
	try {
		macroDirFiles.value = new Set((await machineStore.getFileList(macrosDir())).filter((f: any) => !f.isDirectory).map((f: any) => String(f.name)));
	} catch {
		macroDirFiles.value = new Set();
	}
}

// ---------------------------------------------------------------- rows

const entries = computed(() => parseOverride(overrideText.value));

function pendingCurrent(name: string, effective: Value | undefined, def: Value | undefined): Value | undefined {
	const p = pending.get(name);
	if (p === undefined || p.error !== undefined || p.value === undefined) {
		return effective;
	}
	return p.value === null ? def : p.value;
}

/** A variable's value after the pending edits, without building the whole row */
function currentValue(name: string): Value | undefined {
	const info = vf.value?.vars.get(name);
	const entry = entries.value.get(name);
	const effective = entry !== undefined ? entry.value : info?.defaultValue;
	return pendingCurrent(name, effective, info?.defaultValue);
}

function currentNumber(name: string): number | null {
	const v = currentValue(name);
	return typeof v === "number" ? v : null;
}

// the heaterless latch tool is not a dock: from the file, else the live global
const latchTool = computed(() => {
	const fromFile = currentNumber(LATCH_TOOL_VAR);
	const live = globalValue(LATCH_TOOL_VAR);
	return fromFile ?? (typeof live === "number" ? live : null);
});

const docks = computed(() => dockTools((useMachineStore().model as any).tools, latchTool.value));

function rowFor(name: string): Row | null {
	const info = vf.value?.vars.get(name) ?? null;
	const entry = entries.value.get(name);
	if (info === null && entry === undefined) {
		return null;
	}

	const restoredBy = restored.value.get(name);
	let readonlyReason = "";
	if (info === null) {
		readonlyReason = t("row.notInVariables");
	} else if (restoredBy !== undefined) {
		readonlyReason = t("row.restored", { file: restoredBy });
	} else if (MANAGED_BY_MACROS.includes(name)) {
		readonlyReason = t("row.managed");
	} else if (info.defaultValue === undefined || (entry !== undefined && entry.value === undefined)) {
		readonlyReason = t("row.expression");
	}
	const editable = readonlyReason === "" && !missingVariables.value;

	// not settings: expressions and strings nobody has overridden; the latch tool unless it collides
	let hidden = info !== null && info.defaultValue === undefined && entry === undefined;
	if (name === LATCH_TOOL_VAR) {
		hidden = !latchCollision.value;
	}

	const shape = mergeShape(info?.shape ?? shapeOf(entry?.valueText ?? ""), entry !== undefined ? shapeOf(entry.valueText) : undefined);
	const effective = entry !== undefined ? entry.value : info?.defaultValue;
	const p = pending.get(name);

	let state: RowState = entry !== undefined ? "override" : "default";
	if (!editable && info !== null) {
		state = "readonly";
	}
	if (p !== undefined && p.error === undefined) {
		state = p.value === null ? "remove" : "pending";
	}

	return {
		name, info, entry, shape, unit: unitOf(name), editable, hidden, readonlyReason, state, effective,
		current: pendingCurrent(name, effective, info?.defaultValue),
		pendingText: p?.text, pendingValue: p?.value, error: p?.error,
	};
}

/** The latch tool collides when its number is a dock (or any other tool's) number */
const latchCollision = computed(() => {
	const lt = latchTool.value;
	return lt !== null && lt < Math.max(docks.value.numbers.length, (currentList("INDX_tool_x") ?? []).length);
});

function currentList(name: string): Scalar[] | null {
	const v = currentValue(name);
	return Array.isArray(v) ? v : null;
}

// ---------------------------------------------------------------- dock lists and checks

/** The dock count the printer has, when it can be trusted (tool numbers 0..n-1) */
const dockCount = computed(() => docks.value.contiguous ? docks.value.numbers.length : null);

/** Docks listed in INDX_tool_x (file + pending) vs tools on the printer */
const dockMismatch = computed(() => {
	const n = dockCount.value;
	const listed = (currentList("INDX_tool_x") ?? []).length;
	const fileListed = (Array.isArray(rowFor("INDX_tool_x")?.effective) ? (rowFor("INDX_tool_x")!.effective as Scalar[]).length : 0);
	return n === null || n === 0 || fileListed === n ? null : { tools: n, listed: fileListed, updated: listed === n };
});

/** Bring the dock lists to the printer's tool count, as pending edits */
function syncDockLists(): void {
	const n = dockCount.value;
	if (n === null || n === 0 || missingVariables.value) {
		return;
	}
	for (const name of DOCK_LIST_VARS) {
		const row = rowFor(name);
		if (row === null || !row.editable) {
			continue;
		}
		const list = currentList(name) ?? [];
		if (list.length !== n) {
			setPendingValue(name, resizeList(row.current, n));
		}
	}
}

watch([dockCount, () => vf.value, () => overrideText.value], () => {
	if (loadedOnce.value && !saving.value) {
		syncDockLists();
	}
});

const meshMax = computed(() => maxGridPoints((useMachineStore().model as any).boards?.[0]?.shortName));

const mesh = computed<MeshResult | null>(() => {
	if (!vf.value?.vars.has("INDX_mesh_min") || !vf.value.vars.has("INDX_mesh_max") || !vf.value.vars.has("INDX_mesh_spacing")) {
		return null;
	}
	return checkMesh(currentValue("INDX_mesh_min"), currentValue("INDX_mesh_max"), currentValue("INDX_mesh_spacing"), meshMax.value);
});

function sectionIdOf(name: string): string {
	const info = vf.value?.vars.get(name);
	if (info === undefined) {
		return "";
	}
	const s = vf.value!.sections.find(x => x.id === info.sectionId);
	const target = s !== undefined ? styleFor(s.title)?.mergeInto : undefined;
	if (target !== undefined) {
		return vf.value!.sections.find(x => x.title.toLowerCase().startsWith(target))?.id ?? info.sectionId;
	}
	return info.sectionId;
}

/** Problems that block a save, with the section they belong to */
const problems = computed<Problem[]>(() => {
	const out: Problem[] = [];
	const xs = currentList("INDX_tool_x");
	if (xs !== null) {
		xs.forEach((x, i) => {
			if (x === null) {
				out.push({ sectionId: sectionIdOf("INDX_tool_x"), text: t("docks.xMissing", { tool: i }) });
			}
		});
	}
	if (mesh.value !== null) {
		for (const p of mesh.value.problems) {
			out.push({ sectionId: sectionIdOf("INDX_mesh_spacing"), text: t(`mesh.${p.key}`, p as any) });
		}
	}
	return out;
});

// ---------------------------------------------------------------- sections

const sections = computed<SectionView_[]>(() => {
	const all = (vf.value?.sections ?? []).filter(s => !s.hidden);
	const merged = new Map<string, string[]>();      // target section id -> extra variables
	const shown = all.filter(s => {
		if (styleFor(s.title)?.inMenu === false) {
			return false;
		}
		const target = styleFor(s.title)?.mergeInto;
		const into = target !== undefined ? all.find(x => x !== s && x.title.toLowerCase().startsWith(target)) : undefined;
		if (into !== undefined) {
			merged.set(into.id, [...(merged.get(into.id) ?? []), ...s.vars]);
			return false;
		}
		return true;
	});

	return shown.map(s => {
		const style = styleFor(s.title);
		const rows = [...s.vars, ...(merged.get(s.id) ?? []), ...(style?.extraVars ?? []).filter(n => vf.value?.vars.has(n))]
			.map(rowFor)
			.filter((r): r is Row => r !== null && !r.hidden && !PINNED_VARS.includes(r.name));
		return {
			id: s.id,
			header: s.title,
			title: titleCase(style?.title ?? s.title),
			description: s.description,
			icon: style?.icon ?? DEFAULT_SECTION_ICON,
			view: style?.view,
			rows,
			overrides: rows.filter(r => r.entry !== undefined).length,
			pending: rows.filter(r => r.state === "pending" || r.state === "remove").length,
			problems: problems.value.filter(p => p.sectionId === s.id).length,
		};
	});
});

/** The settings of the INDX_variables.g sections whose header starts with `match`, for the tuning pages */
function rowsOfSection(match: string, except: string[] = []): Row[] {
	return (vf.value?.sections ?? [])
		.filter(s => s.title.toLowerCase().startsWith(match))
		.flatMap(s => s.vars)
		.filter(n => !except.includes(n))
		.map(rowFor)
		.filter((r): r is Row => r !== null && !r.hidden);
}

/** Settings added on the Overrides page with "Add setting", shown there until the files are read again */
const addedNames = ref<string[]>([]);

/** Everything the override file sets, in file order, then unsaved changes and added settings */
const overrideRows = computed(() => {
	const names = PINNED_VARS.filter(n => vf.value?.vars.has(n) || entries.value.has(n));
	for (const n of [...entries.value.values()].sort((a, b) => a.line - b.line).map(e => e.name)) {
		if (!names.includes(n)) {
			names.push(n);
		}
	}
	for (const n of [...pending.keys(), ...addedNames.value]) {
		if (!names.includes(n)) {
			names.push(n);
		}
	}
	return names.map(rowFor).filter((r): r is Row => r !== null);
});

/** Settings "Add setting" offers: editable, not in the list yet, in INDX_variables.g order */
const addableRows = computed(() => {
	const listed = new Set(overrideRows.value.map(r => r.name));
	const out: { name: string; section: string; help: string }[] = [];
	for (const s of vf.value?.sections ?? []) {
		if (s.hidden) {
			continue;
		}
		const title = titleCase(styleFor(s.title)?.title ?? s.title);
		for (const n of s.vars) {
			const r = rowFor(n);
			if (r !== null && !r.hidden && r.editable && !listed.has(n)) {
				out.push({ name: n, section: title, help: r.info?.help.join(" ") ?? "" });
			}
		}
	}
	return out;
});

/** How many settings the override file sets */
const overrideCount = computed(() => entries.value.size);

function addSetting(name: string): void {
	if (!addedNames.value.includes(name)) {
		addedNames.value = [...addedNames.value, name];
	}
}

const changes = computed<OverrideChange[]>(() => [...pending.entries()]
	.filter(([, p]) => p.error === undefined && p.value !== undefined)
	.map(([name, p]) => ({ name, value: p.value as Value | null })));

const hasErrors = computed(() => [...pending.values()].some(p => p.error !== undefined));

/** Changes that go into the override file (not the state-file settings) */
const fileChanges = computed(() => changes.value.filter(c => LIVE_STATE_VARS[c.name] === undefined));
const preview = computed(() => vf.value === null ? null : applyOverrideChanges(overrideText.value, fileChanges.value, vf.value, unitOf));

// ---------------------------------------------------------------- editing

/** Take a parsed value as the pending edit, after the limit check */
function setPendingValue(name: string, value: Value, text?: string): void {
	const row = rowFor(name);
	if (row !== null && LIVE_STATE_VARS[name] !== undefined) {
		// compared with the live value, the one the state file holds
		if (valuesEqual(value, globalValue(name) as Value)) {
			pending.delete(name);
		} else {
			pending.set(name, { text: text ?? formatValue(value, row.shape), value, error: undefined });
		}
		return;
	}
	if (row === null || !row.editable) {
		return;
	}
	const shown = text ?? formatValue(value, row.shape);
	const limitError = checkLimits(value, LIMITS[name], row.shape.list);
	if (limitError !== null) {
		pending.set(name, { text: shown, value: undefined, error: limitError });
		return;
	}
	const def = row.info?.defaultValue;
	// a list of nothing but null means "use the defaults", whatever its length
	const isDefault = def !== undefined && (valuesEqual(value, def) || (allNull(value) && allNull(def)));
	if ((valuesEqual(value, row.effective) || (isDefault && row.entry === undefined)) && !(isDefault && row.entry !== undefined)) {
		pending.delete(name);       // no change
		return;
	}
	pending.set(name, { text: shown, value: isDefault ? null : value, error: undefined });
}

function setValue(name: string, text: string): void {
	const row = rowFor(name);
	if (row === null || !row.editable) {
		return;
	}
	if (text.trim() === "") {
		pending.delete(name);
		return;
	}
	let value: Value;
	try {
		value = parseInput(text, row.shape);
	} catch (e) {
		const msg = row.shape.list ? t("errors.listExpected", { example: "{1, 2.5, null}" }) : errorText(e);
		pending.set(name, { text, value: undefined, error: msg });
		return;
	}
	setPendingValue(name, value, text);
}

/** Choice buttons (options) set a number directly */
function setNumber(name: string, value: number): void {
	setPendingValue(name, value);
}

/** One entry of a per-tool list; "" = null (the default for latch travel) */
function setElement(name: string, index: number, text: string): string | null {
	const n = Math.max(dockCount.value ?? 0, index + 1);
	const list = resizeList(currentValue(name), n);
	let x: Scalar = null;
	if (text.trim() !== "") {
		try {
			const v = parseLiteral(text);
			if (Array.isArray(v)) {
				return t("errors.single");
			}
			x = v;
		} catch (e) {
			return errorText(e);
		}
	}
	const error = x === null ? null : checkLimits(x, LIMITS[name], true);
	if (error !== null) {
		return error;
	}
	list[index] = x;
	setPendingValue(name, list);
	return null;
}

function toDefault(name: string): void {
	const row = rowFor(name);
	// an existing override line can always be removed, even for a read-only or unknown variable
	if (row === null || (!row.editable && row.entry === undefined)) {
		return;
	}
	if (row.entry === undefined) {
		pending.delete(name);
	} else {
		pending.set(name, { text: row.info?.defaultValue !== undefined && row.info.defaultValue !== null ? formatValue(row.info.defaultValue, row.shape) : "", value: null, error: undefined });
	}
}

function undo(name: string): void {
	pending.delete(name);
	if (DOCK_LIST_VARS.includes(name)) {
		syncDockLists();        // the tool count still applies
	}
}

function discardAll(): void {
	pending.clear();
	saveResult.value = null;
	syncDockLists();
}

function display(v: Value | undefined, row: Row): string {
	if (v === undefined) {
		return row.entry?.valueText ?? row.info?.defaultText ?? "";
	}
	const options = LIMITS[row.name]?.options;
	if (options !== undefined && typeof v === "number") {
		const o = options.find(x => valuesEqual(x.value, v));
		if (o !== undefined) {
			return `${o.title} (${formatValue(v, row.shape)})`;
		}
	}
	return formatValue(v, row.shape);
}

// ---------------------------------------------------------------- tool macros

const macroChecks = computed<MacroCheck[]>(() => {
	const out: MacroCheck[] = [];
	for (const tool of docks.value.numbers) {
		for (const kind of MACRO_KINDS) {
			const file = macroFile(kind, tool);
			out.push(checkMacro(kind, tool, macroTexts.value.has(file) ? macroTexts.value.get(file)! : null));
		}
	}
	return out;
});

const staleMacros = computed(() => staleMacroFiles(macroTexts.value.keys(), docks.value.numbers, latchTool.value !== null ? [latchTool.value] : []));

// ---------------------------------------------------------------- INDX files (setup check)

/** Required and optional files of the INDX release */
const setupFiles = computed(() => fileStatus(sysFiles.value, macroDirFiles.value));

/** Macro calls to files that do not exist */
const broken = computed(() => brokenCalls(macroTexts.value, sysFiles.value, macroDirFiles.value));

/** Generated macros (e.g. INDX_Prime.g) are only offered when another macro calls them */
const indxMacros = computed(() => INDX_MACROS
	.map(m => ({ ...m, present: hasFile(sysFiles.value, m.file), callers: callersOf(macroTexts.value, m.file) }))
	.filter(m => m.callers.length > 0));

const missingIndxMacros = computed(() => indxMacros.value.filter(m => !m.present));

function globalValue(name: string): unknown {
	const g: any = (useMachineStore().model as any).global;
	return g instanceof Map ? g.get(name) : g?.[name];
}

/** config.g runs INDX_variables.g, and the INDX globals exist on the printer */
const loadedChecks = computed(() => ({
	config: configText.value === null ? null : configLoadsVariables(configText.value),
	globals: globalValue("INDX_tool_x") !== undefined && globalValue("INDX_State") !== undefined,
}));

const setupProblems = computed(() => setupFiles.value.filter(f => f.kind !== "optional" && !f.present).length
	+ broken.value.length + (loadedChecks.value.config === false ? 1 : 0) + (loadedChecks.value.globals ? 0 : 1));

const macroProblems = computed(() => macroChecks.value.filter(c => c.status !== "ok").length + staleMacros.value.length + setupProblems.value);

/** The missing generated macros a settings section relies on, e.g. INDX_Prime.g for Prime & Wipe */
function missingMacrosFor(header: string): Array<{ file: string; callers: string }> {
	const h = header.toLowerCase();
	return missingIndxMacros.value.filter(m => h.startsWith(m.sectionMatch)).map(m => ({ file: m.file, callers: m.callers.join(", ") }));
}

/** Write the skeleton of a missing INDX macro; never overwrites an existing file */
async function generateIndxMacro(macro: IndxMacro): Promise<void> {
	const machineStore = useMachineStore();
	if (!machineStore.isConnected || macroBusy.value) {
		return;
	}
	macroBusy.value = true;
	macroResult.value = null;
	const dir = sysDir();
	try {
		let names = new Set((await machineStore.getFileList(dir)).filter((f: any) => !f.isDirectory).map((f: any) => String(f.name)));
		if (hasFile(names, macro.file)) {
			sysFiles.value = names;
			macroResult.value = { type: "error", text: t("macros.exists", { file: macro.file }) };
			return;
		}
		await uploadText(dir + macro.file, macro.template);
		names = new Set((await machineStore.getFileList(dir)).filter((f: any) => !f.isDirectory).map((f: any) => String(f.name)));
		sysFiles.value = names;
		await loadMacros(names);
		macroResult.value = { type: "success", text: t("macros.generated", { file: macro.file }) };
	} catch (e) {
		macroResult.value = { type: "error", text: t("macros.fixFailed", { error: errorText(e) }) };
	} finally {
		macroBusy.value = false;
	}
}

/** Write the standard content to these tool macro files */
async function fixMacros(checks: MacroCheck[]): Promise<void> {
	const machineStore = useMachineStore();
	if (!machineStore.isConnected || macroBusy.value) {
		return;
	}
	macroBusy.value = true;
	macroResult.value = null;
	const dir = sysDir();
	try {
		for (const c of checks) {
			await uploadText(dir + c.file, macroTemplate(c.kind, c.tool));
		}
		const names = new Set((await machineStore.getFileList(dir)).filter((f: any) => !f.isDirectory).map((f: any) => String(f.name)));
		sysFiles.value = names;
		await loadMacros(names);
		macroResult.value = { type: "success", text: t("macros.fixed", { n: checks.length }) };
	} catch (e) {
		macroResult.value = { type: "error", text: t("macros.fixFailed", { error: errorText(e) }) };
	} finally {
		macroBusy.value = false;
	}
}

// ---------------------------------------------------------------- clamp force readings and measuring

/** Per tool, the newer of the plugin's own measurement and the last pickup in the check log */
const clampLog = computed(() => mergeReadings(tunerReadings.value, checksReadings.value, upTime(), Date.now()));

const measuring = ref<number | null>(null);         // tool being measured
const measureQueue = ref<number[]>([]);
const measureStop = ref(false);
const measureResult = ref<{ type: "success" | "warning" | "error"; text: string } | null>(null);

function axisHomed(letter: string): boolean {
	const axes: any[] = (useMachineStore().model as any).move?.axes ?? [];
	return axes.some(a => a?.letter === letter && a.homed === true);
}

/** Why measuring cannot start now; empty when it can */
const measureBlockers = computed<string[]>(() => {
	if (!useMachineStore().isConnected) {
		return [t("measure.notConnected")];
	}
	const out: string[] = [];
	if (machineStatus() !== "idle") {
		out.push(t("measure.notIdle"));
	}
	if (!["X", "Y", "Z"].every(axisHomed)) {
		out.push(t("measure.notHomed"));
	}
	if (globalValue("INDX_LC_calibrated") !== true) {
		out.push(t("measure.notCalibrated"));
	}
	const state = globalValue("INDX_State");
	const tool = Number((useMachineStore().model.state as any).currentTool ?? -1);
	if (state !== -1 || tool !== -1) {
		out.push(t("measure.notEmpty"));
	}
	if (globalValue("INDX_LC_raw") === undefined || globalValue("INDX_TC_lc_before") === undefined) {
		out.push(t("measure.noGlobals"));
	}
	return out;
});

async function appendTunerLog(line: string): Promise<void> {
	const text = (tunerLogText.value ?? TUNER_LOG_HEADER).replace(/\s*$/, "") + "\n" + line + "\n";
	await uploadText(sysDir() + TUNER_LOG, text);
	tunerLogText.value = text;
	tunerReadings.value = latestTunerForces(text);
}

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Pick up and park each tool in turn, cold, and log the clamping force the pickup measured
 * (pick_g = (INDX_LC_raw - INDX_TC_lc_before) * INDX_LC_scale, as INDX_TC_POST does).
 * Uses only the official INDX macros and globals.
 */
async function measure(tools: number[]): Promise<void> {
	const machineStore = useMachineStore();
	if (measuring.value !== null || tools.length === 0 || measureBlockers.value.length > 0) {
		return;
	}
	measureStop.value = false;
	measureResult.value = null;
	measureQueue.value = [...tools];
	const done: string[] = [];
	try {
		for (const tool of tools) {
			if (measureStop.value) {
				break;
			}
			measuring.value = tool;
			measureQueue.value = measureQueue.value.filter(x => x !== tool);

			// cold: no print temperature for this tool
			await machineStore.sendCode(`M568 P${tool} S0 R0`, false, false);

			// pickup; INDX_TC_POST measures the clamp force
			await machineStore.sendCode(`T${tool}`, false, true, true);
			await waitUntilIdle(4000, 180000);
			const picked = await readGlobals();
			if (picked === null || picked.INDX_State !== tool) {
				measureResult.value = { type: "error", text: t("measure.pickFailed", { tool }) };
				return;
			}
			const raw = num(picked.INDX_LC_raw), before = num(picked.INDX_TC_lc_before), scale = num(picked.INDX_LC_scale);
			const grams = raw !== null && before !== null && scale !== null ? Math.abs((raw - before) * scale) : null;
			const ok = picked.INDX_TC_pick_lc_ok === 1;

			// park again
			await machineStore.sendCode("T-1", false, true, true);
			await waitUntilIdle(4000, 180000);
			const parked = await readGlobals();

			if (grams !== null) {
				await appendTunerLog(tunerLogLine(new Date(), tool, grams, ok));
				done.push(`T${tool} ${Math.round(grams)} g`);
			}
			if (parked === null || parked.INDX_State !== -1) {
				measureResult.value = { type: "error", text: t("measure.parkFailed", { tool }) };
				return;
			}
		}
		measureResult.value = measureStop.value
			? { type: "warning", text: t("measure.stopped", { list: done.join(", ") || "-" }) }
			: { type: "success", text: t("measure.done", { list: done.join(", ") }) };
	} catch (e) {
		measureResult.value = { type: "error", text: t("measure.failed", { error: errorText(e) }) };
	} finally {
		measuring.value = null;
		measureQueue.value = [];
	}
}

function stopMeasure(): void {
	measureStop.value = true;
}

// ---------------------------------------------------------------- saving

const canSave = computed(() => useMachineStore().isConnected && !missingVariables.value && !saving.value
	&& changes.value.length > 0 && !hasErrors.value && problems.value.length === 0 && machineStatus() === "idle");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * One object model value, e.g. "sensors.probes[0].lastStopHeight", read from DWC's own copy of the object
 * model after a short wait for its next update. No M409: its large replies would end up in the console
 * (a reply can be attributed to another pending command) and flood it.
 */
async function readKey(key: string): Promise<unknown> {
	await sleep(600);
	let v: any = useMachineStore().model;
	for (const part of key.replace(/\[(\d+)\]/g, ".$1").split(".")) {
		if (v === null || v === undefined) {
			return null;
		}
		v = v instanceof Map ? v.get(part) : v[part];
	}
	return v ?? null;
}

/** The head state the macros keep (INDX_State) agrees with the selected tool */
function headStateConsistent(): boolean {
	const state = globalValue("INDX_State");
	const tool = Number((useMachineStore().model.state as any).currentTool ?? -1);
	return state === tool || (state === -1 && tool < 0);
}

/** The INDX globals from DWC's object model (no M409, see readKey), after a short wait for its next update */
async function readGlobals(): Promise<Record<string, unknown> | null> {
	await sleep(400);
	const g: any = (useMachineStore().model as any).global;
	if (g instanceof Map) {
		return Object.fromEntries(g.entries());
	}
	return g && typeof g === "object" ? g : null;
}

async function save(): Promise<void> {
	if (!canSave.value || preview.value === null || vf.value === null) {
		return;
	}
	const machineStore = useMachineStore();
	const dir = sysDir();
	const result = preview.value;
	const saved = changes.value.map(c => ({
		name: c.name,
		expected: c.value === null ? vf.value!.vars.get(c.name)?.defaultValue : c.value,
	}));

	saving.value = true;
	saveResult.value = null;
	saveSteps.value = ["stepCheck", "stepBackup", "stepWrite", "stepReload", "stepVerify"].map(k => ({ label: t(`save.${k}`), state: "waiting" as const }));
	let step = 0;
	const begin = (i: number) => { step = i; saveSteps.value[i].state = "running"; };
	const end = (i: number) => { saveSteps.value[i].state = "done"; };

	try {
		begin(0);
		const names = new Set((await machineStore.getFileList(dir)).map((f: any) => String(f.name)));
		const current = names.has(OVERRIDE) ? await downloadText(dir + OVERRIDE) : "";
		if (current !== overrideText.value) {
			saveSteps.value[0].state = "failed";
			saveResult.value = { type: "warning", text: t("save.changedElsewhere"), details: [] };
			await load();
			return;
		}
		end(0);

		begin(1);
		if (names.has(OVERRIDE)) {
			await uploadText(dir + BACKUP, current);
		}
		end(1);

		begin(2);
		await uploadText(dir + OVERRIDE, result.text);
		end(2);

		begin(3);
		// state-file settings: set live and saved to their state file first, so the reload restores them
		for (const c of changes.value.filter(x => LIVE_STATE_VARS[x.name] !== undefined && x.value !== null)) {
			await machineStore.sendCode(`set global.${c.name} = ${formatValue(c.value as Value, rowFor(c.name)?.shape ?? { list: false, float: false })}`, false, false);
			await machineStore.sendCode(`M98 P"${dir}${LIVE_STATE_VARS[c.name]}"`, false, false);
		}
		await machineStore.sendCode(`M98 P"${dir}${VARIABLES}"`, false, true, true);
		await waitUntilIdle();
		end(3);

		begin(4);
		const globals = await readGlobals();
		pending.clear();
		await load();
		if (globals === null) {
			end(4);
			saveResult.value = { type: "success", text: t("save.verifyUnknown"), details: [] };
			return;
		}
		const wrong: string[] = [];
		for (const s of saved) {
			const actual = fromModel(globals[s.name]);
			const row = rowFor(s.name);
			const same = valuesEqual(actual, s.expected) || (allNull(actual) && allNull(s.expected));
			if (s.expected !== undefined && !same && row !== null) {
				wrong.push(t("save.expected", { name: s.name, expected: display(s.expected, row), actual: actual === undefined ? "?" : display(actual, row) }));
			}
		}
		saveSteps.value[4].state = wrong.length > 0 ? "failed" : "done";
		saveResult.value = wrong.length > 0
			? { type: "warning", text: t("save.verifyFailed"), details: wrong }
			: { type: "success", text: t("save.done"), details: [] };
	} catch (e) {
		saveSteps.value[step].state = "failed";
		saveResult.value = { type: "error", text: t("save.failed", { error: errorText(e) }), details: [] };
	} finally {
		saving.value = false;
	}
}

// ---------------------------------------------------------------- public API

export function useIndxTuner() {
	return {
		// state
		vf, overrideText, overrideExists, loading, loadError, missingVariables, loadedOnce,
		sections, overrideRows, overrideCount, addableRows, addSetting, rowsOfSection, changes, hasErrors, preview, pending, problems,
		saving, saveSteps, saveResult, canSave,
		docks, dockCount, dockMismatch, latchTool, mesh, meshMax, clampLog,
		macroChecks, staleMacros, macroProblems, macroBusy, macroResult, macroTexts, indxMacros, missingIndxMacros,
		setupFiles, broken, loadedChecks, setupProblems,
		measuring, measureQueue, measureStop, measureResult, measureBlockers,
		// actions
		load, setValue, setNumber, setElement, toDefault, undo, discardAll, save, fixMacros, generateIndxMacro, missingMacrosFor,
		measure, stopMeasure,
		rowFor, currentValue, currentNumber, currentList, display, machineStatus, sysDir, upTime,
		readGlobals, readKey, waitUntilIdle, globalValue, appendTunerLog, axisHomed, headStateConsistent,
	};
}
