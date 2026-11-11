<template>
	<v-row dense class="mb-3">
		<v-col cols="12" md="7">
			<v-card variant="outlined" class="pa-2">
				<svg v-if="view" :viewBox="`0 0 ${view.w + PAD * 2} ${view.h + PAD * 2}`" width="100%" style="max-width: 620px; display: block">
					<rect :x="X(area!.xmin)" :y="Y(area!.ymax)" :width="(area!.xmax - area!.xmin) * view.k" :height="(area!.ymax - area!.ymin) * view.k" class="indx-bed" />
					<g v-for="tk in ticksX" :key="`x${tk}`">
						<line :x1="X(tk)" :x2="X(tk)" :y1="PAD + view.h" :y2="PAD + view.h + 5" class="indx-tick" />
						<text :x="X(tk)" :y="PAD + view.h + 17" text-anchor="middle" class="indx-label">{{ tk }}</text>
					</g>
					<g v-for="tk in ticksY" :key="`y${tk}`">
						<line :x1="PAD - 5" :x2="PAD" :y1="Y(tk)" :y2="Y(tk)" class="indx-tick" />
						<text :x="PAD - 8" :y="Y(tk) + 3" text-anchor="end" class="indx-label">{{ tk }}</text>
					</g>
					<rect v-if="nozzleArea" :x="X(nozzleArea.x0)" :y="Y(nozzleArea.y1)" :width="(nozzleArea.x1 - nozzleArea.x0) * view.k"
						  :height="(nozzleArea.y1 - nozzleArea.y0) * view.k" class="indx-mesh" />
					<circle v-for="(p, i) in nozzles" :key="i" :cx="X(p.x)" :cy="Y(p.y)" r="3" :class="p.inside ? 'indx-pt' : 'indx-pt-bad'">
						<title>X {{ p.x.toFixed(1) }} Y {{ p.y.toFixed(1) }}</title>
					</circle>
					<template v-if="dockY !== null">
						<line :x1="PAD" :x2="PAD + view.w" :y1="Y(dockY)" :y2="Y(dockY)" class="indx-dock" />
						<g v-for="d in docks" :key="d.t">
							<rect :x="X(d.x) - 6" :y="Y(dockY) - 5" width="12" height="10" rx="2" class="indx-dock-box" />
							<text :x="X(d.x)" :y="Y(dockY) + (dockAbove ? -9 : 16)" text-anchor="middle" class="indx-dock-label">T{{ d.t }}</text>
						</g>
					</template>
					<template v-if="home">
						<circle v-if="home.fuzz > 0" :cx="X(home.x)" :cy="Y(home.y)" :r="home.fuzz * view.k" class="indx-fuzz" />
						<line :x1="X(home.x) - 11" :x2="X(home.x) + 11" :y1="Y(home.y)" :y2="Y(home.y)" class="indx-home" />
						<line :x1="X(home.x)" :x2="X(home.x)" :y1="Y(home.y) - 11" :y2="Y(home.y) + 11" class="indx-home" />
					</template>
					<text :x="PAD + view.w / 2" :y="view.h + PAD * 2 - 4" text-anchor="middle" class="indx-label">X (mm)</text>
				</svg>
				<div v-else class="text-medium-emphasis pa-4">{{ $t("plugins.indxTuner.bed.noArea") }}</div>
			</v-card>
		</v-col>
		<v-col cols="12" md="5">
			<v-card variant="outlined" class="mb-3">
				<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.bed.legend") }}</v-card-title>
				<v-card-text>
					<div v-for="l in legend" :key="l.text" class="d-flex align-center ga-2 text-body-2 mb-1">
						<span class="indx-key" :class="l.cls" />{{ l.text }}
					</div>
					<div v-if="probes.length > 1" class="d-flex align-center flex-wrap ga-2 mt-3">
						<span class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.bed.probe") }}</span>
						<v-btn-toggle v-model="probeIndex" mandatory divided density="compact" variant="outlined" color="primary">
							<v-btn v-for="p in probes" :key="p.index" :value="p.index" size="small">{{ p.label }}</v-btn>
						</v-btn-toggle>
					</div>
					<div class="text-caption text-medium-emphasis mt-2">{{ $t("plugins.indxTuner.bed.offset", { x: offset[0], y: offset[1] }) }}</div>
					<div v-if="area" class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.bed.areaText", { x0: area.xmin, x1: area.xmax, y0: area.ymin, y1: area.ymax }) }}</div>
					<div v-if="meshText" class="text-caption text-medium-emphasis">{{ meshText }}</div>
				</v-card-text>
			</v-card>
			<v-alert v-if="tuner.mesh.value && tuner.mesh.value.total > 0" :type="tuner.mesh.value.problems.length ? 'error' : 'info'"
					 variant="tonal" density="compact" class="mb-3" icon="mdi-grid">
				{{ $t("plugins.indxTuner.mesh.summary", { nx: tuner.mesh.value.nx, ny: tuner.mesh.value.ny, total: tuner.mesh.value.total, max: tuner.mesh.value.maxTotal, row: 41 }) }}
			</v-alert>
			<v-alert v-if="outside > 0" type="warning" variant="tonal" density="compact" class="mb-3">
				{{ $t("plugins.indxTuner.bed.outside", { n: outside, probe: probeLabel }) }}
				<div v-for="f in fixes" :key="f" class="mt-1">{{ f }}</div>
			</v-alert>
			<div v-if="dockY !== null" class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.bed.dockRef", { y: dockY.toFixed(1) }) }}</div>
		</v-col>
	</v-row>
</template>

<script setup lang="ts">
/**
 * Bed Probing drawing: the print area (axis limits), the nozzle position of every mesh point for the chosen
 * probe (INDX_mesh_min/max are in probe coordinates; nozzle = probe point - G31 offset; the load cell,
 * M558 P12, unless another probe is chosen), the homez probe
 * point with its fuzz circle, and the dock line with the docks for reference. Uses the values as edited.
 */
import { computed, ref } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { useIndxTuner } from "./useIndxTuner";

const PAD = 34;
const machineStore = useMachineStore();
const tuner = useIndxTuner();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
function pair(name: string): [number, number] | null {
	const v = tuner.currentValue(name);
	return Array.isArray(v) && v.length >= 2 && num(v[0]) !== null && num(v[1]) !== null ? [v[0] as number, v[1] as number] : null;
}

const area = computed(() => {
	const axes: any[] = (machineStore.model as any).move?.axes ?? [];
	const ax = axes.find(a => a?.letter === "X"), ay = axes.find(a => a?.letter === "Y");
	if (!ax || !ay) {
		return null;
	}
	return { xmin: Number(ax.min), xmax: Number(ax.max), ymin: Number(ay.min), ymax: Number(ay.max) };
});

/** The configured probes with their X/Y offsets (G31) */
const probes = computed(() => {
	const list: any[] = (machineStore.model as any).sensors?.probes ?? [];
	return list.map((p, index) => p ? {
		index,
		type: Number(p.type),
		// M558 P12 is a load cell, P11 a scanning probe
		label: Number(p.type) === 12 ? t("bed.loadCell", { n: index }) : Number(p.type) === 11 ? t("bed.scanning", { n: index }) : t("bed.probeN", { n: index }),
		x: num(p.offsets?.[0]) ?? 0,
		y: num(p.offsets?.[1]) ?? 0,
	} : null).filter((p): p is { index: number; type: number; label: string; x: number; y: number } => p !== null);
});
const chosen = ref<number | null>(null);
const probeIndex = computed({
	// default: the load cell (M558 P12), else the first probe
	get: () => chosen.value ?? (probes.value.find(p => p.type === 12) ?? probes.value[0])?.index ?? 0,
	set: v => { chosen.value = v; },
});
const probe = computed(() => probes.value.find(p => p.index === probeIndex.value) ?? null);
const offset = computed<[number, number]>(() => [probe.value?.x ?? 0, probe.value?.y ?? 0]);
const probeLabel = computed(() => probe.value?.label ?? "");

const inside = (x: number, y: number) => area.value !== null && x >= area.value.xmin - 1e-6 && x <= area.value.xmax + 1e-6
	&& y >= area.value.ymin - 1e-6 && y <= area.value.ymax + 1e-6;

/** Mesh points as RRF lays them out (min + i * spacing), moved to where the nozzle goes */
const nozzles = computed(() => {
	const mn = pair("INDX_mesh_min"), mx = pair("INDX_mesh_max");
	const sp = num(tuner.currentValue("INDX_mesh_spacing"));
	const m = tuner.mesh.value;
	if (mn === null || mx === null || sp === null || sp <= 0 || m === null || m.total <= 0 || m.total > 2000) {
		return [];
	}
	const out: { x: number; y: number; inside: boolean }[] = [];
	for (let j = 0; j < m.ny; j++) {
		for (let i = 0; i < m.nx; i++) {
			const x = mn[0] + i * sp - offset.value[0], y = mn[1] + j * sp - offset.value[1];
			out.push({ x, y, inside: inside(x, y) });
		}
	}
	return out;
});
const nozzleArea = computed(() => {
	const mn = pair("INDX_mesh_min"), mx = pair("INDX_mesh_max");
	return mn && mx ? { x0: mn[0] - offset.value[0], x1: mx[0] - offset.value[0], y0: mn[1] - offset.value[1], y1: mx[1] - offset.value[1] } : null;
});
const meshText = computed(() => {
	const mn = pair("INDX_mesh_min"), mx = pair("INDX_mesh_max");
	return mn && mx ? t("bed.meshText", { x0: mn[0], y0: mn[1], x1: mx[0], y1: mx[1], s: tuner.currentValue("INDX_mesh_spacing") }) : "";
});
const outside = computed(() => nozzles.value.filter(p => !p.inside).length);

/** How to bring the mesh back inside the print area */
const fixes = computed(() => {
	const a = area.value, mn = pair("INDX_mesh_min"), mx = pair("INDX_mesh_max");
	if (a === null || mn === null || mx === null || outside.value === 0) {
		return [];
	}
	const out: string[] = [];
	const [ox, oy] = offset.value;
	const r = (v: number) => Math.round(v * 10) / 10;
	if (mn[0] - ox < a.xmin) out.push(t("bed.raise", { name: "INDX_mesh_min", axis: "X", v: r(a.xmin + ox) }));
	if (mn[1] - oy < a.ymin) out.push(t("bed.raise", { name: "INDX_mesh_min", axis: "Y", v: r(a.ymin + oy) }));
	if (mx[0] - ox > a.xmax) out.push(t("bed.lower", { name: "INDX_mesh_max", axis: "X", v: r(a.xmax + ox) }));
	if (mx[1] - oy > a.ymax) out.push(t("bed.lower", { name: "INDX_mesh_max", axis: "Y", v: r(a.ymax + oy) }));
	return out;
});

const home = computed(() => {
	const x = tuner.currentNumber("INDX_probe_x"), y = tuner.currentNumber("INDX_probe_y");
	return x === null || y === null ? null : { x, y, fuzz: Math.max(0, tuner.currentNumber("INDX_LC_probe_fuzz") ?? 0) };
});

const dockY = computed(() => {
	const v = tuner.currentValue("INDX_dock_y");
	return Array.isArray(v) ? num(v[0]) : num(v);
});
const docks = computed(() => (tuner.currentList("INDX_tool_x") ?? [])
	.map((x, t) => ({ t, x: num(x) }))
	.filter((d): d is { t: number; x: number } => d.x !== null));
const dockAbove = computed(() => area.value !== null && dockY.value !== null && dockY.value > (area.value.ymin + area.value.ymax) / 2);

/** The part of the machine drawn: print area, nozzle positions, dock line, homing point, with a margin */
const view = computed(() => {
	const a = area.value;
	if (a === null || !(a.xmax > a.xmin) || !(a.ymax > a.ymin)) {
		return null;
	}
	const xs = [a.xmin, a.xmax, ...nozzles.value.map(p => p.x), ...docks.value.map(d => d.x)];
	const ys = [a.ymin, a.ymax, ...nozzles.value.map(p => p.y), ...(dockY.value !== null ? [dockY.value] : [])];
	if (home.value) {
		xs.push(home.value.x);
		ys.push(home.value.y);
	}
	const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 12, y1 = Math.max(...ys) + 12;
	const k = 420 / Math.max(x1 - x0, y1 - y0);
	return { x0, y1, k, w: (x1 - x0) * k, h: (y1 - y0) * k };
});
const X = (x: number) => PAD + (x - view.value!.x0) * view.value!.k;
const Y = (y: number) => PAD + (view.value!.y1 - y) * view.value!.k;

function ticks(lo: number, hi: number): number[] {
	const span = hi - lo, step = span > 400 ? 100 : span > 150 ? 50 : 25;
	const out: number[] = [];
	for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) {
		out.push(v);
	}
	return out;
}
const ticksX = computed(() => area.value ? ticks(area.value.xmin, area.value.xmax) : []);
const ticksY = computed(() => area.value ? ticks(area.value.ymin, area.value.ymax) : []);

const legend = computed(() => [
	{ cls: "indx-key--bed", text: t("bed.keyArea") },
	{ cls: "indx-key--mesh", text: t("bed.keyMesh") },
	{ cls: "indx-key--pt", text: t("bed.keyPoint") },
	{ cls: "indx-key--bad", text: t("bed.keyOutside") },
	{ cls: "indx-key--home", text: t("bed.keyHome") },
	{ cls: "indx-key--dock", text: t("bed.keyDock") },
]);
</script>

<style scoped>
.indx-bed {
	fill: rgba(var(--v-theme-on-surface), 0.03);
	stroke: rgba(var(--v-theme-on-surface), 0.5);
	stroke-width: 1.5;
}
.indx-tick {
	stroke: rgba(var(--v-theme-on-surface), 0.5);
}
.indx-label {
	font-size: 10px;
	fill: rgba(var(--v-theme-on-surface), 0.6);
}
.indx-mesh {
	fill: rgba(var(--v-theme-primary), 0.08);
	stroke: rgb(var(--v-theme-primary));
	stroke-dasharray: 4 3;
}
.indx-pt {
	fill: rgb(var(--v-theme-primary));
}
.indx-pt-bad {
	fill: rgb(var(--v-theme-error));
}
.indx-dock {
	stroke: rgb(var(--v-theme-warning));
	stroke-width: 1.5;
	stroke-dasharray: 6 4;
}
.indx-dock-box {
	fill: rgb(var(--v-theme-warning));
	opacity: 0.85;
}
.indx-dock-label {
	font-size: 9px;
	fill: rgb(var(--v-theme-warning));
}
.indx-fuzz {
	fill: rgba(var(--v-theme-success), 0.15);
	stroke: rgb(var(--v-theme-success));
}
.indx-home {
	stroke: rgb(var(--v-theme-success));
	stroke-width: 2;
}
.indx-key {
	display: inline-block;
	width: 16px;
	flex: none;
}
.indx-key--bed {
	height: 10px;
	border: 1px solid rgba(var(--v-theme-on-surface), 0.5);
}
.indx-key--mesh {
	height: 10px;
	border: 1px dashed rgb(var(--v-theme-primary));
	background: rgba(var(--v-theme-primary), 0.08);
}
.indx-key--pt,
.indx-key--bad {
	width: 8px;
	height: 8px;
	margin: 0 4px;
	border-radius: 50%;
	background: rgb(var(--v-theme-primary));
}
.indx-key--bad {
	background: rgb(var(--v-theme-error));
}
.indx-key--home {
	width: 12px;
	height: 12px;
	margin: 0 2px;
	background: linear-gradient(rgb(var(--v-theme-success)), rgb(var(--v-theme-success))) center / 2px 100% no-repeat,
		linear-gradient(rgb(var(--v-theme-success)), rgb(var(--v-theme-success))) center / 100% 2px no-repeat;
}
.indx-key--dock {
	height: 0;
	border-top: 2px dashed rgb(var(--v-theme-warning));
}
</style>
