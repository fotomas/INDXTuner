/**
 * Reads INDX_variables.g: sections, variables, defaults and help text.
 * Nothing about the INDX variables is hard-coded here, so any INDX version that declares its
 * variables as `global NAME = value` works.
 */
import { parseLiteral, shapeOf, type Value, type ValueShape } from "./rrfValues";

export interface VarInfo {
	name: string;
	sectionId: string;
	defaultText: string;            // as written in INDX_variables.g
	defaultValue: Value | undefined; // undefined: an expression, string or boolean - not editable
	shape: ValueShape;
	help: string[];                 // comment lines above the declaration, then the inline comment
	restoredBy: string | null;      // state file that sets it after the override file, if any
}

export interface Section {
	id: string;
	title: string;
	description: string;
	hidden: boolean;                // runtime state, not settings
	vars: string[];
}

export interface VariablesFile {
	sections: Section[];
	vars: Map<string, VarInfo>;
}

/** Sections whose title starts with one of these hold runtime values, not settings */
const HIDDEN_SECTIONS = ["tool change state"];

const HEADER = /^\s*;\s*-{2,}\s*(.*?)\s*-*\s*$/;
const DECLARATION = /^\s*global\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const SET = /^\s*set\s+global\.([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const KEEPS_COMMENTS = /^\s*(if\s|else\b|set\s)/;

/** Split "value   ; comment" at the first ';' outside braces and quotes */
export function splitComment(rest: string): { value: string; comment: string } {
	let depth = 0;
	let quoted = false;
	for (let i = 0; i < rest.length; i++) {
		const c = rest[i];
		if (c === '"') {
			quoted = !quoted;
		} else if (!quoted && (c === "{" || c === "[" || c === "(")) {
			depth++;
		} else if (!quoted && (c === "}" || c === "]" || c === ")")) {
			depth--;
		} else if (!quoted && depth === 0 && c === ";") {
			let start = i;
			while (start > 0 && /\s/.test(rest[start - 1])) {
				start--;
			}
			return { value: rest.substring(0, start).trim(), comment: rest.substring(start) };
		}
	}
	return { value: rest.trim(), comment: "" };
}

/** Short title of a section header: the text before " (" or ", " */
export function sectionTitle(header: string): string {
	const cut = [header.indexOf(" ("), header.indexOf(", ")].filter(i => i > 0);
	return (cut.length > 0 ? header.substring(0, Math.min(...cut)) : header).trim();
}

function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

export function parseVariablesFile(text: string): VariablesFile {
	const sections: Section[] = [];
	const vars = new Map<string, VarInfo>();
	let current: Section | null = null;
	let comments: string[] = [];

	const ensureSection = (): Section => {
		if (current === null) {
			current = { id: "general", title: "General", description: "", hidden: false, vars: [] };
			sections.push(current);
		}
		return current;
	};

	for (const line of text.split(/\r?\n/)) {
		const header = HEADER.exec(line);
		if (header !== null && header[1] !== "") {
			const full = header[1];
			const title = sectionTitle(full);
			let id = slug(title);
			while (sections.some(s => s.id === id)) {
				id += "-2";
			}
			current = {
				id, title,
				description: full.length > title.length ? full : "",
				hidden: HIDDEN_SECTIONS.some(h => title.toLowerCase().startsWith(h)),
				vars: [],
			};
			sections.push(current);
			comments = [];
			continue;
		}

		const trimmed = line.trim();
		if (trimmed === "") {
			comments = [];
			continue;
		}
		if (trimmed.startsWith(";")) {
			comments.push(trimmed.replace(/^;\s?/, ""));
			continue;
		}

		const decl = DECLARATION.exec(line);
		if (decl !== null) {
			const name = decl[1];
			if (!vars.has(name)) {
				const section = ensureSection();
				const { value, comment } = splitComment(decl[2]);
				let defaultValue: Value | undefined;
				try {
					defaultValue = parseLiteral(value);
				} catch {
					defaultValue = undefined;
				}
				const help = [...comments];
				const inline = comment.trim().replace(/^;\s?/, "");
				if (inline !== "") {
					help.push(inline);
				}
				vars.set(name, { name, sectionId: section.id, defaultText: value, defaultValue, shape: shapeOf(value), help, restoredBy: null });
				section.vars.push(name);
			}
			comments = [];
			continue;
		}

		if (!KEEPS_COMMENTS.test(line)) {
			comments = [];
		}
	}

	return { sections: sections.filter(s => s.vars.length > 0), vars };
}

/** Names a state file (indx-state.g, indx-head.g) sets with `set global.NAME = ...` */
export function namesSetIn(text: string): string[] {
	const names: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = SET.exec(line);
		if (m !== null && !names.includes(m[1])) {
			names.push(m[1]);
		}
	}
	return names;
}

/** Unit from the inline comment when it starts with one, e.g. "mm/min; travel speed" -> "mm/min" */
export function unitFromHelp(help: string[]): string | undefined {
	const last = help[help.length - 1];
	if (last === undefined) {
		return undefined;
	}
	const first = last.split(";")[0].trim();
	return /^(mm|mm\/min|mm\/s\^?2|mm of E|ms|s|g|C|°C|counts|g\/count)$/.test(first) ? first : undefined;
}
