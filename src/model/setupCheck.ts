/**
 * Is the INDX file set installed? The files of the official INDX RRF release, the macro calls between
 * them, and whether config.g loads INDX_variables.g.
 */

/** INDX macros of the official release, in 0:/sys */
export const REQUIRED_INDX_FILES = [
	"INDX_variables.g",
	"INDX_TC_PRE.g", "INDX_TC_POST.g", "INDX_TC_FREE.g", "INDX_TC_REPORT.g",
	"INDX_LATCH_MOVE.g", "INDX_LATCH_ENGAGE.g", "INDX_OPEN.g", "INDX_CLOSE.g", "INDX_CLOSE_CAL.g",
	"INDX_UNLOCK_DANCE.g", "INDX_TOOL_CHECK.g", "INDX_WRITE_STATE.g",
	"INDX_LC_RAW.g", "INDX_TARE.g", "INDX_LC_CAL.g", "INDX_LC_CALIBRATE.g", "INDX_LC_RETARE.g",
];

/** System macros the INDX release replaces, in 0:/sys */
export const REQUIRED_SYSTEM_FILES = ["homez.g", "bed.g", "mesh.g", "pause.g", "stop.g", "resurrect-prologue.g"];

/** Shipped with the release but not needed for tool changes; INDX_TC_TEST lives in 0:/macros upstream */
export const OPTIONAL_FILES = ["INDX_LC_SPEED_SWEEP.g", "INDX_TC_TEST.g"];

export type FileKind = "indx" | "system" | "optional";

export interface FileStatus {
	file: string;
	kind: FileKind;
	present: boolean;
}

function has(names: Iterable<string>, file: string): boolean {
	const f = file.toLowerCase();
	for (const n of names) {
		if (n.toLowerCase() === f) {
			return true;
		}
	}
	return false;
}

export function fileStatus(sysNames: Set<string>, macroNames: Set<string>): FileStatus[] {
	return [
		...REQUIRED_INDX_FILES.map(file => ({ file, kind: "indx" as const, present: has(sysNames, file) })),
		...REQUIRED_SYSTEM_FILES.map(file => ({ file, kind: "system" as const, present: has(sysNames, file) })),
		...OPTIONAL_FILES.map(file => ({ file, kind: "optional" as const, present: has(sysNames, file) || has(macroNames, file) })),
	];
}

/** The files whose macro calls are checked: every INDX_*.g, the tool macros and the system macros above */
export function isScanned(name: string): boolean {
	return /^INDX_.*\.g$/i.test(name) || /^t(free|pre|post)\d+\.g$/i.test(name) || has(REQUIRED_SYSTEM_FILES, name);
}

/** The literal file names a macro calls with M98 P"..." (calls built from expressions are skipped) */
export function macroCalls(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/;.*$/, "");
		const re = /\bM98\s+P"([^"{}]+)"/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(line)) !== null) {
			out.push(m[1].trim());
		}
	}
	return out;
}

/**
 * Whether a call target exists. RRF looks for a relative name in 0:/sys, then 0:/macros.
 * Returns null for a path the plugin cannot check (another volume or a sub-directory).
 */
export function callResolves(target: string, sysNames: Set<string>, macroNames: Set<string>): boolean | null {
	let t = target.replace(/\\/g, "/");
	let where: "sys" | "macros" | "both" = "both";
	const abs = /^0:\/(sys|macros)\/(.+)$/i.exec(t);
	if (abs !== null) {
		where = abs[1].toLowerCase() as "sys" | "macros";
		t = abs[2];
	} else if (/^\d:\//.test(t) || t.startsWith("/")) {
		return null;
	}
	if (t.includes("/")) {
		return null;
	}
	return (where !== "macros" && has(sysNames, t)) || (where !== "sys" && has(macroNames, t));
}

function baseName(path: string): string {
	return path.replace(/\\/g, "/").split("/").pop()!.toLowerCase();
}

/** Files a macro checks with fileexists("...") before calling them */
function guardedFiles(text: string): Set<string> {
	const out = new Set<string>();
	const re = /fileexists\(\s*"([^"{}]+)"\s*\)/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		out.add(baseName(m[1]));
	}
	return out;
}

export interface BrokenCall {
	target: string;
	callers: string[];
}

export function brokenCalls(texts: Map<string, string>, sysNames: Set<string>, macroNames: Set<string>): BrokenCall[] {
	const broken = new Map<string, Set<string>>();
	for (const [file, text] of texts) {
		const guarded = guardedFiles(text);
		for (const target of macroCalls(text)) {
			if (guarded.has(baseName(target))) {
				continue;       // only called when it exists, e.g. indx-state.g written at runtime
			}
			if (callResolves(target, sysNames, macroNames) === false) {
				const key = target.replace(/^0:\/sys\//i, "");
				if (!broken.has(key)) {
					broken.set(key, new Set());
				}
				broken.get(key)!.add(file);
			}
		}
	}
	return [...broken.entries()].map(([target, callers]) => ({ target, callers: [...callers].sort() })).sort((a, b) => a.target.localeCompare(b.target));
}

/** Files that call a given macro */
export function callersOf(texts: Map<string, string>, file: string): string[] {
	const f = file.toLowerCase();
	const out: string[] = [];
	for (const [name, text] of texts) {
		if (macroCalls(text).some(c => c.replace(/^0:\/sys\//i, "").toLowerCase() === f)) {
			out.push(name);
		}
	}
	return out.sort();
}

/** config.g runs INDX_variables.g */
export function configLoadsVariables(configText: string): boolean {
	return macroCalls(configText).some(c => /(^|\/)INDX_variables\.g$/i.test(c));
}
