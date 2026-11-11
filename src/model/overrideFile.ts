/**
 * Reads and edits INDX_variables_override.g.
 * A value equal to its default removes the line, so the file stays the short list of what differs.
 */
import { formatValue, mergeShape, parseLiteral, shapeOf, valuesEqual, type Value } from "./rrfValues";
import { sectionTitle, splitComment, type VarInfo, type VariablesFile } from "./variablesFile";

export interface OverrideEntry {
	name: string;
	line: number;
	valueText: string;
	value: Value | undefined;       // undefined: an expression the plugin cannot edit
	comment: string;
}

const SET_LINE = /^(\s*set\s+global\.)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/;
const HEADER = /^\s*;\s*-{2,}\s*(.*?)\s*-*\s*$/;
const COMMENT_COLUMN = 46;

export const NEW_FILE_HEADER = [
	"; INDX_variables_override.g - only the values that differ from the defaults in INDX_variables.g",
	"; Run from INDX_variables.g after every global is declared, so a plain \"set\" is enough here.",
	"; Written by the INDX Tuner plugin; hand edits are kept. The default is shown in each comment.",
	"",
].join("\n");

export function parseOverride(text: string): Map<string, OverrideEntry> {
	const result = new Map<string, OverrideEntry>();
	text.split(/\r?\n/).forEach((line, i) => {
		const m = SET_LINE.exec(line);
		if (m === null) {
			return;
		}
		const { value, comment } = splitComment(m[4]);
		let parsed: Value | undefined;
		try {
			parsed = parseLiteral(value);
		} catch {
			parsed = undefined;
		}
		result.set(m[2], { name: m[2], line: i, valueText: value, value: parsed, comment });   // the last one wins, as in RRF
	});
	return result;
}

/** A change to the file: a new value, or null to remove the line */
export interface OverrideChange {
	name: string;
	value: Value | null;
}

export interface OverrideEditResult {
	text: string;
	added: string[];
	changed: string[];
	removed: string[];
}

function padTo(text: string, column: number): string {
	return text.length >= column ? text + " " : text + " ".repeat(column - text.length);
}

function isHeader(line: string): boolean {
	return HEADER.test(line) && HEADER.exec(line)![1] !== "";
}

export function applyOverrideChanges(text: string, changes: OverrideChange[], vf: VariablesFile, unitOf: (name: string) => string | undefined): OverrideEditResult {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	let lines = text === "" ? NEW_FILE_HEADER.split("\n") : text.split(/\r?\n/);
	const result: OverrideEditResult = { text, added: [], changed: [], removed: [] };
	const removeNames = new Set<string>();

	for (const change of changes) {
		const info = vf.vars.get(change.name);
		const entries = parseOverride(lines.join("\n"));
		const entry = entries.get(change.name);
		const remove = change.value === null || (info?.defaultValue !== undefined && valuesEqual(change.value, info.defaultValue));

		if (remove) {
			if (entry !== undefined) {
				removeNames.add(change.name);
				result.removed.push(change.name);
			}
			continue;
		}
		const baseShape = info?.shape ?? { list: Array.isArray(change.value), float: false };
		const literal = formatValue(change.value as Value, mergeShape(baseShape, entry !== undefined ? shapeOf(entry.valueText) : undefined));

		if (entry !== undefined) {
			const m = SET_LINE.exec(lines[entry.line])!;
			const head = `${m[1]}${m[2]}${m[3]}${literal}`;
			const commentText = entry.comment.trimStart();
			const column = lines[entry.line].length - commentText.length;
			lines[entry.line] = commentText === "" ? head : padTo(head, column) + commentText;
			result.changed.push(change.name);
			continue;
		}

		const unit = unitOf(change.name);
		const comment = `; ${unit !== undefined ? unit + "; " : ""}default ${info?.defaultText ?? "?"}`;
		const newLine = padTo(`set global.${change.name} = ${literal}`, COMMENT_COLUMN) + comment;
		lines = insertLine(lines, newLine, change.name, vf);
		result.added.push(change.name);
	}

	if (removeNames.size > 0) {
		const entries = parseOverride(lines.join("\n"));
		const drop = new Set([...removeNames].map(n => entries.get(n)!.line));
		lines = lines.filter((_, i) => !drop.has(i));
	}
	result.text = lines.join(eol);
	return result;
}

/**
 * Where a new line goes: after the last override of a variable from the same section of
 * INDX_variables.g, else at the end of an override section with the same title, else in a new
 * section at the end of the file.
 */
function insertLine(lines: string[], newLine: string, name: string, vf: VariablesFile): string[] {
	const info = vf.vars.get(name);
	const section = vf.sections.find(s => s.id === info?.sectionId);
	const entries = parseOverride(lines.join("\n"));
	const out = [...lines];

	if (section !== undefined) {
		const sameSection = section.vars.map(v => entries.get(v)?.line).filter((l): l is number => l !== undefined);
		if (sameSection.length > 0) {
			out.splice(Math.max(...sameSection) + 1, 0, newLine);
			return out;
		}
		const title = section.title.toLowerCase();
		const header = out.findIndex(l => isHeader(l) && sectionTitle(HEADER.exec(l)![1]).toLowerCase() === title);
		if (header >= 0) {
			let end = header;
			for (let i = header + 1; i < out.length && !isHeader(out[i]); i++) {
				if (out[i].trim() !== "") {
					end = i;
				}
			}
			out.splice(end + 1, 0, newLine);
			return out;
		}
	}

	while (out.length > 0 && out[out.length - 1].trim() === "") {
		out.pop();
	}
	out.push("", `; --- ${section?.title ?? "Other"} ---`, newLine, "");
	return out;
}
