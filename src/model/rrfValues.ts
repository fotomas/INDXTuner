/**
 * RRF literal values the tuner can edit: numbers, null, and lists of those.
 * No Vue or DWC imports, so this runs in plain Node for the tests.
 */

export type Scalar = number | null;
export type Value = Scalar | Scalar[];

export interface ValueShape {
	list: boolean;      // the default is a list
	float: boolean;     // the default is written with a decimal point
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function parseScalar(s: string): Scalar {
	if (s.toLowerCase() === "null") {
		return null;
	}
	if (!NUMBER.test(s)) {
		throw new Error(`"${s}" is not a number`);
	}
	return Number(s);
}

/** Parse an RRF literal. Lists may use {} or [] and may have a trailing comma: {1,} */
export function parseLiteral(text: string): Value {
	const t = text.trim();
	if (t === "") {
		throw new Error("empty value");
	}
	const m = /^[{[](.*)[}\]]$/s.exec(t);
	if (m === null) {
		return parseScalar(t);
	}
	const parts = m[1].split(",").map(s => s.trim());
	if (parts.length > 1 && parts[parts.length - 1] === "") {
		parts.pop();
	}
	if (parts.some(p => p === "")) {
		throw new Error("empty list entry");
	}
	return parts.map(parseScalar);
}

/** Parse what the user typed, given the shape of the default. A list may be typed without braces. */
export function parseInput(text: string, shape: ValueShape): Value {
	const t = text.trim();
	const braced = /^[{[]/.test(t);
	const v = parseLiteral(shape.list && !braced ? `{${t}}` : t);
	if (Array.isArray(v) && !shape.list) {
		throw new Error("expected a single value, not a list");
	}
	if (!Array.isArray(v) && shape.list) {
		return [v];
	}
	return v;
}

/** Shape of a default literal as written in INDX_variables.g */
export function shapeOf(literal: string): ValueShape {
	const t = literal.trim();
	return { list: /^[{[]/.test(t), float: /\d\.\d*/.test(t) || /^[-+]?\.\d/.test(t) };
}

/** Float if either the default or the value already in the override file is written as a float */
export function mergeShape(a: ValueShape, b: ValueShape | undefined): ValueShape {
	return b === undefined ? a : { list: a.list, float: a.float || b.float };
}

function formatScalar(n: Scalar, float: boolean): string {
	if (n === null) {
		return "null";
	}
	const r = Math.round(n * 1e6) / 1e6;
	return float && Number.isInteger(r) ? r.toFixed(1) : String(r);
}

export function formatValue(v: Value, shape: ValueShape): string {
	if (Array.isArray(v)) {
		return "{" + v.map(x => formatScalar(x, shape.float)).join(", ") + "}";
	}
	return formatScalar(v, shape.float);
}

function scalarEqual(a: Scalar, b: Scalar): boolean {
	return a === null || b === null ? a === b : Math.abs(a - b) < 1e-6;
}

export function valuesEqual(a: Value | undefined, b: Value | undefined): boolean {
	if (a === undefined || b === undefined) {
		return a === b;
	}
	if (Array.isArray(a) !== Array.isArray(b)) {
		return false;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => scalarEqual(x, b[i]));
	}
	return scalarEqual(a as Scalar, b as Scalar);
}

/** A value from the object model (M409 or machineStore.model.global), or undefined if not a literal */
export function fromModel(raw: unknown): Value | undefined {
	if (raw === null || typeof raw === "number") {
		return raw;
	}
	if (typeof raw === "boolean") {
		return raw ? 1 : 0;
	}
	if (Array.isArray(raw) && raw.every(x => x === null || typeof x === "number")) {
		return raw as Scalar[];
	}
	return undefined;
}
