/**
 * Patches for the official INDX files: the changes INDX Tuner needs, as small edits that are found by their
 * exact text. Generated from the official INDX release and the changed files on the author's printer; applied
 * in this order to the official files, all of them together give exactly those files, and every combination
 * applies and reverts cleanly in any order (checked by test/patches).
 *
 * An edit is one of: replace an exact text (find, which must occur once) by another; insert a text before or
 * after an anchor (which must occur once); or append a text at the end of the file. A patch counts as
 * applied when every added text is in its files, so changes made by hand without the plugin are recognised
 * too. Reverting removes the added texts again (or puts the found text back).
 */

export type PatchEdit =
	| { file: string; find: string; replace: string }
	| { file: string; before: string; insert: string }
	| { file: string; after: string; insert: string }
	| { file: string; append: string };

export interface Patch {
	id: string;
	advanced?: boolean;
	/** globals the patch adds; when the official INDX_variables.g already has them, the patch is not needed */
	globals: string[];
	edits: PatchEdit[];
	/** files the patch needs that are created when missing (never overwritten) */
	newFiles?: string[];
}

export type PatchStatus = "applied" | "available" | "official" | "incompatible";

export const PATCHES: Patch[] = [
	{
		id: "latch",
		globals: ["INDX_latch_close_tool", "INDX_latch_feed"],
		edits: [
			{ file: "INDX_variables.g", before: "; --- Tool change speeds ---\n", insert: "; --- Latch ---\n; latch motor travel that locks a tool on during a pickup (INDX_TC_POST)\nif !exists(global.INDX_latch_close_e)\n  global INDX_latch_close_e = 11.0          ; mm of E\nelse\n  set global.INDX_latch_close_e = 11.0\n; close travel per tool, index = tool number; null or a missing entry = use INDX_latch_close_e.\n; The list can be any length, the override sets the full list for the printer.\nif !exists(global.INDX_latch_close_tool)\n  global INDX_latch_close_tool = {null}\nelse\n  set global.INDX_latch_close_tool = {null}\n; latch motor feed rate for the tool-change open and close moves\nif !exists(global.INDX_latch_feed)\n  global INDX_latch_feed = 1500             ; mm/min\nelse\n  set global.INDX_latch_feed = 1500\n\n" },
			{ file: "INDX_TC_POST.g", find: "; lock the tool and save the state\nM98 P\"INDX_LATCH_MOVE.g\" E11.0 F1500\n", replace: "; lock the tool and save the state; the tool's own close travel if it has one, else the default\nvar close_e = global.INDX_latch_close_e\nif var.t < #global.INDX_latch_close_tool && global.INDX_latch_close_tool[var.t] != null\n  set var.close_e = global.INDX_latch_close_tool[var.t]\nM98 P\"INDX_LATCH_MOVE.g\" E{var.close_e} F{global.INDX_latch_feed}\n" },
			{ file: "INDX_OPEN.g", find: "M98 P\"INDX_LATCH_MOVE.g\" E-11.0 F1500\n", replace: "M98 P\"INDX_LATCH_MOVE.g\" E-11.0 F{global.INDX_latch_feed}\n" },
			{ file: "INDX_CLOSE.g", find: "M98 P\"INDX_LATCH_MOVE.g\" E11.0 F1500\n", replace: "M98 P\"INDX_LATCH_MOVE.g\" E11.0 F{global.INDX_latch_feed}\n" },
			{ file: "INDX_UNLOCK_DANCE.g", find: "M98 P\"INDX_LATCH_MOVE.g\" E{var.full_open_e} F1500\n", replace: "M98 P\"INDX_LATCH_MOVE.g\" E{var.full_open_e} F{global.INDX_latch_feed}\n" },
		],
	},
	{
		id: "prime",
		globals: ["INDX_prime_e"],
		newFiles: ["INDX_Prime.g"],
		edits: [
			{ file: "INDX_variables.g", before: "; --- Tool change speeds ---\n", insert: "; --- Prime and wipe after a pickup (INDX_Prime.g), only above the cold-extrusion temperature (M302) ---\n; purge: extrude INDX_prime_e mm, then retract INDX_prime_retract mm so the nozzle does not ooze\n; on the way to the part; the retract is not given back, so keep it as short as oozing allows\nif !exists(global.INDX_prime_e)\n  global INDX_prime_e = 10.0                ; mm of E\nelse\n  set global.INDX_prime_e = 10.0\nif !exists(global.INDX_prime_feed)\n  global INDX_prime_feed = 1500             ; mm/min\nelse\n  set global.INDX_prime_feed = 1500\nif !exists(global.INDX_prime_retract)\n  global INDX_prime_retract = 2.0           ; mm of E\nelse\n  set global.INDX_prime_retract = 2.0\nif !exists(global.INDX_prime_retract_feed)\n  global INDX_prime_retract_feed = 800      ; mm/min\nelse\n  set global.INDX_prime_retract_feed = 800\nif !exists(global.INDX_prime_wipe_feed)\n  global INDX_prime_wipe_feed = 2000        ; mm/min; the wipe moves after the purge\nelse\n  set global.INDX_prime_wipe_feed = 2000\n\n" },
			{ file: "INDX_TC_POST.g", append: "\n; prime and wipe only during a print (printing or paused), not for tool changes from the console or a tuning run\nif state.status = \"processing\" || state.status = \"paused\"\n  M98 P\"INDX_Prime.g\" T{heat.heaters[1].active}\n" },
		],
	},
	{
		id: "accel",
		globals: ["INDX_TC_accel"],
		newFiles: ["INDX_TC_ACCEL.g"],
		edits: [
			{ file: "INDX_variables.g", after: "  set global.INDX_TC_slow_zone = 10\n", insert: "; X and Y acceleration during tool changes, mm/s^2. 0 = leave the config.g value alone.\n; INDX_TC_ACCEL.g raises it at the start of a change and restores it at the end; a value above\n; the M204 travel acceleration has no effect.\nif !exists(global.INDX_TC_accel)\n  global INDX_TC_accel = 0\nelse\n  set global.INDX_TC_accel = 0\n; X and Y acceleration saved while raised; -1 = not raised\nif !exists(global.INDX_TC_accel_saved)\n  global INDX_TC_accel_saved = {-1, -1}\nelse\n  set global.INDX_TC_accel_saved = {-1, -1}\n" },
			{ file: "INDX_TC_PRE.g", after: "  set var.slow_y = global.safeYmin\n\n", insert: "; tool-change acceleration (no effect if the park before this pickup already raised it)\nM98 P\"INDX_TC_ACCEL.g\" S1\n\n" },
			{ file: "INDX_TC_FREE.g", after: "  set var.slow_y = global.safeYmin\n\n", insert: "; tool-change acceleration, restored at the end of the pickup (or below, for a park only)\nM98 P\"INDX_TC_ACCEL.g\" S1\n\n" },
			{ file: "INDX_TC_FREE.g", after: "if move.motionSystems[0].nextTool < 0\n  set global.INDX_TC_restore_z = -1\n", insert: "  M98 P\"INDX_TC_ACCEL.g\" S0\n" },
			{ file: "INDX_TC_POST.g", append: "\n; back to the normal acceleration\nM98 P\"INDX_TC_ACCEL.g\" S0\n" },
		],
	},
	{
		id: "settle",
		globals: ["INDX_TC_lc_settle"],
		edits: [
			{ file: "INDX_variables.g", after: "  set global.INDX_TC_lc_samples = 4\n", insert: "; wait after the last move before a load-cell reading, so the gantry has stopped shaking\nif !exists(global.INDX_TC_lc_settle)\n  global INDX_TC_lc_settle = 300      ; ms\nelse\n  set global.INDX_TC_lc_settle = 300\n" },
			{ file: "INDX_LC_RAW.g", find: "G4 P300                          ; let the gantry settle after the last move\n", replace: "G4 P{global.INDX_TC_lc_settle}   ; let the gantry settle after the last move\n" },
		],
	},
	{
		id: "overlap",
		globals: ["INDX_TC_heat_overlap"],
		edits: [
			{ file: "INDX_variables.g", after: "  set global.INDX_TC_heat_timeout = 5\n", insert: "; 0 = wait for the pickup temperature at the dock, then go to the prime position\n; 1 = go to the prime position while the tool heats; the wait happens there, before the prime\nif !exists(global.INDX_TC_heat_overlap)\n  global INDX_TC_heat_overlap = 0\nelse\n  set global.INDX_TC_heat_overlap = 0\n" },
			{ file: "INDX_TC_POST.g", find: "\nif global.INDX_TC_pick_heat_ok = 1 && global.INDX_TC_in_active > 0\n  M116 P{var.t}\n", replace: "\n; wait for the temperature here, or (INDX_TC_heat_overlap = 1) after the prime move below\nif global.INDX_TC_heat_overlap = 0 && global.INDX_TC_pick_heat_ok = 1 && global.INDX_TC_in_active > 0\n  M116 P{var.t}\n" },
			{ file: "INDX_TC_POST.g", append: "\n; temperature wait for INDX_TC_heat_overlap = 1: a no-op if INDX_Prime already waited for it\nif global.INDX_TC_heat_overlap = 1 && global.INDX_TC_pick_heat_ok = 1 && global.INDX_TC_in_active > 0\n  M116 P{var.t}\n" },
		],
	},
	{
		id: "override",
		globals: [],
		edits: [
			{ file: "INDX_variables.g", before: "; restore the values saved by INDX_WRITE_STATE; INDX_State only at startup\n", insert: "; load override values\nM98 P\"0:/sys/INDX_variables_override.g\"\n\n; settings that depend on the override values, now that INDX_tool_x and safeYmin are final\nset global.INDX_LC_empty_ref = vector(#global.INDX_tool_x, null)\nM208 S1 Y{max(global.safeYmin, global.INDX_Y_hard_min)}\nif #global.INDX_latch_close_tool > #global.INDX_tool_x\n  echo \"INDX_variables: INDX_latch_close_tool has more entries than there are docks.\"\n\n" },
		],
	},
	{
		id: "state",
		advanced: true,
		globals: ["INDX_state_sig"],
		edits: [
			{ file: "INDX_variables.g", find: "if fileexists(\"0:/sys/indx-state.g\")\n  var live_state = global.INDX_State\n  M98 P\"0:/sys/indx-state.g\"\n  if !var.startup\n    set global.INDX_State = var.live_state\n", replace: "var live_state = global.INDX_State\nif fileexists(\"0:/sys/indx-state.g\")\n  M98 P\"0:/sys/indx-state.g\"\nif fileexists(\"0:/sys/indx-head.g\")\n  M98 P\"0:/sys/indx-head.g\"\nif !var.startup\n  set global.INDX_State = var.live_state\n" },
			{ file: "INDX_WRITE_STATE.g", find: "; INDX_WRITE_STATE - save the INDX state to 0:/sys/indx-state.g\n; No motion. INDX_variables.g runs indx-state.g at startup to restore these values.\n; Saved: INDX_LC_scale (applied with M558 K0 V), INDX_LC_calibrated, INDX_State, INDX_DEBUG.\n; INDX_LC_offset is written as a comment only, because the unloaded reading drifts with\n; temperature and calibration must measure it again with INDX_TARE.\n\nif !exists(global.INDX_LC_offset) || !exists(global.INDX_LC_scale) || !exists(global.INDX_LC_calibrated) || !exists(global.INDX_State)\n  abort \"INDX_WRITE_STATE: INDX globals missing. INDX_variables.g must run from config.g first.\"\n\nvar dbg = exists(global.INDX_DEBUG) ? global.INDX_DEBUG : 0\nvar f = \"0:/sys/indx-state.g\"\n\necho >{var.f} \"; INDX persisted state - generated by INDX_WRITE_STATE, do not edit by hand.\"\necho >>{var.f} \"; Run by INDX_variables.g to restore saved values and apply them to the probe.\"\necho >>{var.f} {\"; unloaded baseline when calibrated: \" ^ global.INDX_LC_offset ^ \" counts\"}\necho >>{var.f} {\"set global.INDX_LC_scale = \" ^ global.INDX_LC_scale}\necho >>{var.f} {\"set global.INDX_LC_calibrated = \" ^ global.INDX_LC_calibrated}\necho >>{var.f} {\"set global.INDX_State = \" ^ global.INDX_State}\necho >>{var.f} {\"set global.INDX_DEBUG = \" ^ var.dbg}\necho >>{var.f} {\"M558 K0 V\" ^ global.INDX_LC_scale}\n\nif var.dbg > 0\n  echo {\"INDX_WRITE_STATE: saved to \" ^ var.f ^ \"  (scale \" ^ global.INDX_LC_scale ^ \" g/count, state \" ^ global.INDX_State ^ \")\"}\n", replace: "; INDX_WRITE_STATE - save the INDX state to the card\n; No motion. INDX_variables.g runs both files at startup to restore these values.\n;   0:/sys/indx-head.g   set global.INDX_State = <n>. One line, written on every call: a file write\n;                        costs about 0.25 s on this card, so this is all that is written per tool change.\n;   0:/sys/indx-state.g  INDX_LC_scale (applied with M558 K0 V), INDX_LC_calibrated and INDX_DEBUG.\n;                        Rewritten only when one of them (or the offset) has changed since the last call\n;                        after a restart, so the first call after a boot rewrites it once.\n; INDX_LC_offset is written as a comment only, because the unloaded reading drifts with\n; temperature and calibration must measure it again with INDX_TARE.\n\nif !exists(global.INDX_LC_offset) || !exists(global.INDX_LC_scale) || !exists(global.INDX_LC_calibrated) || !exists(global.INDX_State)\n  abort \"INDX_WRITE_STATE: INDX globals missing. INDX_variables.g must run from config.g first.\"\n\nvar dbg = exists(global.INDX_DEBUG) ? global.INDX_DEBUG : 0\nvar f = \"0:/sys/indx-state.g\"\nvar sig = global.INDX_LC_scale ^ \"|\" ^ global.INDX_LC_calibrated ^ \"|\" ^ var.dbg ^ \"|\" ^ global.INDX_LC_offset\n\nif !exists(global.INDX_state_sig)\n  global INDX_state_sig = \"\"\n\nif global.INDX_state_sig != var.sig\n  echo >{var.f} \"; INDX persisted state - generated by INDX_WRITE_STATE, do not edit by hand.\"\n  echo >>{var.f} \"; Run by INDX_variables.g to restore saved values and apply them to the probe.\"\n  echo >>{var.f} {\"; unloaded baseline when calibrated: \" ^ global.INDX_LC_offset ^ \" counts\"}\n  echo >>{var.f} {\"set global.INDX_LC_scale = \" ^ global.INDX_LC_scale}\n  echo >>{var.f} {\"set global.INDX_LC_calibrated = \" ^ global.INDX_LC_calibrated}\n  echo >>{var.f} {\"set global.INDX_DEBUG = \" ^ var.dbg}\n  echo >>{var.f} {\"M558 K0 V\" ^ global.INDX_LC_scale}\n  set global.INDX_state_sig = var.sig\n\n; the head state changes with every tool change, so it has its own one-line file\necho >\"0:/sys/indx-head.g\" {\"set global.INDX_State = \" ^ global.INDX_State}\n\nif var.dbg > 0\n  echo {\"INDX_WRITE_STATE: saved (scale \" ^ global.INDX_LC_scale ^ \" g/count, state \" ^ global.INDX_State ^ \")\"}\n" },
		],
	},
];

/** Content of new files a patch needs (INDX_Prime.g comes from the skeleton in indxMacros.ts) */
export const PATCH_FILES: Record<string, string> = {
	"INDX_TC_ACCEL.g": "; INDX_TC_ACCEL - raise or restore the X and Y acceleration for tool-change moves\n; M98 P\"INDX_TC_ACCEL.g\" S1   raise to global.INDX_TC_accel, saving the current values\n; M98 P\"INDX_TC_ACCEL.g\" S0   restore the saved values\n; Only the per-axis acceleration (M201) is changed. M204 and the jerk settings stay as set.\n; S1 does nothing if INDX_TC_accel is 0 or the values are already raised, so a change that is\n; stopped by an error leaves the acceleration raised until the next tool change ends or until\n; M98 P\"INDX_TC_ACCEL.g\" S0 is run by hand.\n\nif !exists(param.S)\n  abort \"INDX_TC_ACCEL: parameter S (1 = raise, 0 = restore) required.\"\n\nif param.S = 1\n  if global.INDX_TC_accel > 0 && global.INDX_TC_accel_saved[0] < 0\n    set global.INDX_TC_accel_saved = {move.axes[0].acceleration, move.axes[1].acceleration}\n    M201 X{global.INDX_TC_accel} Y{global.INDX_TC_accel}\nelse\n  if global.INDX_TC_accel_saved[0] >= 0\n    M400\n    M201 X{global.INDX_TC_accel_saved[0]} Y{global.INDX_TC_accel_saved[1]}\n    set global.INDX_TC_accel_saved = {-1, -1}\n",
};

const added = (e: PatchEdit): string => "append" in e ? e.append : "insert" in e ? e.insert : e.replace;
const count = (text: string, part: string): number => part === "" ? 0 : text.split(part).length - 1;
const norm = (text: string): string => text.replace(/\r\n/g, "\n");

/** The files a set of patches changes */
export function patchFiles(patches: Patch[]): string[] {
	return [...new Set(patches.flatMap(p => p.edits.map(e => e.file)))];
}

/**
 * Whether a patch is in these files. `texts` maps file name to content (null when the file is missing);
 * `variables` is INDX_variables.g, used to see whether the official files already have the patch's settings.
 */
export function patchStatus(p: Patch, texts: (file: string) => string | null): PatchStatus {
	const files = p.edits.map(e => texts(e.file));
	if (files.some(f => f === null)) {
		return "incompatible";
	}
	const present = p.edits.map((e, i) => count(norm(files[i]!), added(e)) >= 1);
	if (present.every(Boolean)) {
		return "applied";
	}
	const vars = texts("INDX_variables.g");
	if (!present.some(Boolean) && vars !== null && p.globals.length > 0
		&& p.globals.every(g => new RegExp(`\\bglobal\\s+${g}\\b`).test(vars))) {
		return "official";
	}
	if (present.some(Boolean)) {
		return "incompatible";        // partly applied, or changed by hand in another way
	}
	// every anchor must be found exactly once, also after the patches before it in the same file
	return p.edits.every((e, i) => "append" in e || count(norm(files[i]!), "find" in e ? e.find : "before" in e ? e.before : e.after) === 1)
		? "available" : "incompatible";
}

/** Apply patches (in the order of PATCHES) to the file texts; returns the changed files */
export function applyPatches(ids: string[], texts: (file: string) => string | null): Map<string, string> {
	const out = new Map<string, string>();
	const get = (f: string) => out.get(f) ?? norm(texts(f) ?? "");
	for (const p of PATCHES.filter(x => ids.includes(x.id))) {
		for (const e of p.edits) {
			const t = get(e.file);
			if ("append" in e) {
				out.set(e.file, t + e.append);
				continue;
			}
			const anchor = "find" in e ? e.find : "before" in e ? e.before : e.after;
			if (count(t, anchor) !== 1) {
				throw new Error(`${p.id}: ${e.file}`);
			}
			out.set(e.file, t.replace(anchor, "find" in e ? e.replace : "before" in e ? e.insert + anchor : anchor + e.insert));
		}
	}
	return out;
}

/** Take patches out of the file texts again; returns the changed files */
export function revertPatches(ids: string[], texts: (file: string) => string | null): Map<string, string> {
	const out = new Map<string, string>();
	const get = (f: string) => out.get(f) ?? norm(texts(f) ?? "");
	for (const p of [...PATCHES].reverse().filter(x => ids.includes(x.id))) {
		for (const e of p.edits) {
			const t = get(e.file), a = added(e);
			if (count(t, a) !== 1) {
				throw new Error(`${p.id}: ${e.file}`);
			}
			out.set(e.file, t.replace(a, "find" in e ? e.find : ""));
		}
	}
	return out;
}
