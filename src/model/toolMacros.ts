/**
 * Check and generate the per-tool macros tfree<n>.g, tpre<n>.g and tpost<n>.g. Each one is a
 * comment and a single call of the matching INDX macro with the tool number.
 */

export type MacroKind = "tfree" | "tpre" | "tpost";
export const MACRO_KINDS: MacroKind[] = ["tfree", "tpre", "tpost"];

export const MACRO_CALLS: Record<MacroKind, string> = {
	tfree: "INDX_TC_FREE.g",
	tpre: "INDX_TC_PRE.g",
	tpost: "INDX_TC_POST.g",
};

const COMMENTS: Record<MacroKind, (n: number) => string> = {
	tfree: n => `free tool ${n}`,
	tpre: n => `approach the tool ${n} dock`,
	tpost: n => `engage and lock tool ${n}`,
};

export function macroFile(kind: MacroKind, tool: number): string {
	return `${kind}${tool}.g`;
}

export function macroTemplate(kind: MacroKind, tool: number): string {
	return `; ${kind}${tool} - ${COMMENTS[kind](tool)}\nM98 P"${MACRO_CALLS[kind]}" T${tool}\n`;
}

export type MacroStatus = "ok" | "missing" | "wrong" | "extra" | "comment";

export interface MacroCheck {
	kind: MacroKind;
	tool: number;
	file: string;
	status: MacroStatus;
	detail: string;         // the offending line, if any
}

const CALL = /^M98\s+P"(?:0:\/sys\/)?([^"]+)"\s+T(\d+)\s*$/i;
const NAMED = /\bt(free|pre|post)(\d+)\b/i;

export function checkMacro(kind: MacroKind, tool: number, text: string | null): MacroCheck {
	const file = macroFile(kind, tool);
	if (text === null) {
		return { kind, tool, file, status: "missing", detail: "" };
	}
	const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== "");
	const commands = lines.filter(l => !l.startsWith(";")).map(l => l.replace(/\s*;.*$/, ""));
	const good = commands.filter(c => {
		const m = CALL.exec(c);
		return m !== null && m[1].toLowerCase() === MACRO_CALLS[kind].toLowerCase() && Number(m[2]) === tool;
	});
	if (good.length === 0) {
		return { kind, tool, file, status: "wrong", detail: commands[0] ?? "" };
	}
	if (commands.length > 1) {
		return { kind, tool, file, status: "extra", detail: commands.find(c => !good.includes(c)) ?? "" };
	}
	for (const comment of lines.filter(l => l.startsWith(";"))) {
		const m = NAMED.exec(comment);
		if (m !== null && (`t${m[1].toLowerCase()}` !== kind || Number(m[2]) !== tool)) {
			return { kind, tool, file, status: "comment", detail: comment };
		}
	}
	return { kind, tool, file, status: "ok", detail: "" };
}

/** Tool macro files for tools that are not dock tools, e.g. tpre6.g after a tool was removed */
export function staleMacroFiles(fileNames: Iterable<string>, dockTools: number[], ignoreTools: number[]): string[] {
	const out: string[] = [];
	for (const name of fileNames) {
		const m = /^t(free|pre|post)(\d+)\.g$/i.exec(name);
		if (m !== null) {
			const n = Number(m[2]);
			if (!dockTools.includes(n) && !ignoreTools.includes(n)) {
				out.push(name);
			}
		}
	}
	return out.sort();
}
