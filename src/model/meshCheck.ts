/**
 * Mesh size check, the way RepRapFirmware 3.7 checks M557 (GridDefinition in Grid.cpp):
 * points per axis = floor(range / spacing) + 1, at most MaxAxis0GridPoints (41) in an X row and
 * MaxGridProbePoints in total: 961 on SAME70 boards (MB6HC, MB6XD), 441 on the others.
 */

export const MIN_SPACING = 0.1;    // GridDefinition::MinSpacing
export const MIN_RANGE = 1.0;      // GridDefinition::MinRange
export const MAX_ROW_POINTS = 41;  // MaxAxis0GridPoints

export function maxGridPoints(boardShortName: string | undefined): number {
	return boardShortName !== undefined && /^MB6(HC|XD)/i.test(boardShortName) ? 961 : 441;
}

export type MeshProblem =
	| { key: "invalid" }
	| { key: "spacingTooSmall"; min: number }
	| { key: "rangeTooSmall"; axis: "X" | "Y" }
	| { key: "tooManyPoints"; suggest: number }
	| { key: "rowTooLong"; suggest: number };

export interface MeshResult {
	nx: number;
	ny: number;
	total: number;
	maxTotal: number;
	problems: MeshProblem[];
}

function pair(v: unknown): [number, number] | null {
	if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") {
		return [v[0], v[1]];
	}
	return null;
}

/** spacing may be one number for both axes or a pair */
export function checkMesh(minV: unknown, maxV: unknown, spacingV: unknown, maxTotal: number): MeshResult {
	const min = pair(minV), max = pair(maxV);
	const sp = typeof spacingV === "number" ? [spacingV, spacingV] as [number, number] : pair(spacingV);
	if (min === null || max === null || sp === null) {
		return { nx: 0, ny: 0, total: 0, maxTotal, problems: [{ key: "invalid" }] };
	}

	const rx = max[0] - min[0], ry = max[1] - min[1];
	const problems: MeshProblem[] = [];
	if (sp[0] < MIN_SPACING || sp[1] < MIN_SPACING) {
		problems.push({ key: "spacingTooSmall", min: MIN_SPACING });
	}
	if (rx < MIN_RANGE) {
		problems.push({ key: "rangeTooSmall", axis: "X" });
	}
	if (ry < MIN_RANGE) {
		problems.push({ key: "rangeTooSmall", axis: "Y" });
	}
	if (problems.length > 0) {
		return { nx: 0, ny: 0, total: 0, maxTotal, problems };
	}

	const nx = Math.floor(rx / sp[0]) + 1;
	const ny = Math.floor(ry / sp[1]) + 1;
	const total = nx * ny;
	if (nx > MAX_ROW_POINTS || total > maxTotal) {
		// RRF's own suggestion: the spacing at which the area fits, and at least range / 40 for an X row
		const range = rx + ry, area = rx * ry;
		const minSpacing = (range + Math.sqrt(range * range + 4 * (maxTotal - 1) * area)) / (2 * (maxTotal - 1));
		const minXSpacing = rx / (MAX_ROW_POINTS - 1);
		const suggest = Math.ceil(Math.max(minSpacing, minXSpacing) * 10) / 10;
		problems.push(total > maxTotal ? { key: "tooManyPoints", suggest } : { key: "rowTooLong", suggest });
	}
	return { nx, ny, total, maxTotal, problems };
}
