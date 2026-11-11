<template>
	<div>
		<!-- To do: only what needs doing or fixing; nothing when all is in order -->
		<v-card v-if="dash.issues.value.length > 0" variant="outlined" class="mb-4">
			<v-card-text class="py-3">
				<div v-for="i in dash.issues.value" :key="i.key" class="indx-issue" :class="`indx-issue--${i.severity}`">
					<v-icon :color="i.severity" size="22">{{ i.severity === "error" ? "mdi-alert-circle" : "mdi-alert" }}</v-icon>
					<div class="flex-grow-1">
						<div>{{ i.text }}</div>
						<div v-if="i.detail" class="text-caption text-medium-emphasis">{{ i.detail }}</div>
					</div>
					<v-btn v-if="i.go" size="small" variant="outlined" color="primary" @click="emit('go', i.go)">{{ i.goLabel }}</v-btn>
				</div>
			</v-card-text>
		</v-card>

		<!-- The docks, read only: a label column, then one column per tool -->
		<v-card variant="outlined" class="mb-4">
			<v-card-text class="indx-docks-scroll py-3">
				<div class="indx-docks" :style="{ gridTemplateColumns: `max-content repeat(${docks.length}, 84px)` }">
					<!-- tool drawings with their clamp bars -->
					<div />
					<div v-for="d in docks" :key="`h${d.tool}`" class="indx-cell">
						<div class="d-flex align-end ga-1">
							<div class="d-flex flex-column align-center">
								<div class="indx-tn" :class="{ 'text-primary': d.current }">T{{ d.tool }}</div>
								<ToolGlyph :current="d.current" :scale="1.15" />
							</div>
							<div class="indx-bar" :title="d.forceTitle">
								<div class="indx-bar-fill" :style="{ height: d.fillPct + '%', background: d.barColor }" />
								<div class="indx-bar-mark" :style="{ bottom: nominalPct + '%' }" />
								<div class="indx-bar-limit" :style="{ bottom: minPct + '%' }" />
								<div class="indx-bar-high" :style="{ bottom: highPct + '%' }" />
							</div>
						</div>
					</div>

					<div class="indx-label">{{ $t("plugins.indxTuner.docks.zLabel") }}</div>
					<div v-for="d in docks" :key="`z${d.tool}`" class="indx-v">{{ d.zText }}</div>

					<div class="indx-label">{{ $t("plugins.indxTuner.docks.xLabel") }}</div>
					<div v-for="d in docks" :key="`x${d.tool}`" class="indx-v" :class="{ 'text-error': d.xText === '' }">
						{{ d.xText === "" ? "?" : d.xText }}
					</div>

					<div class="indx-label">{{ $t("plugins.indxTuner.docks.forceLabel") }}</div>
					<div v-for="d in docks" :key="`f${d.tool}`" class="indx-v" :class="{ 'indx-grey': d.force === null }" :title="d.forceTitle">
						{{ d.force === null ? "—" : Math.round(d.force.grams) }}
					</div>

					<!-- clamping force colours -->
					<div class="indx-legend">
						<span v-for="l in legend" :key="l.key" class="indx-legend-item">
							<span class="indx-swatch" :class="l.cls" />{{ l.text }}
						</span>
					</div>
				</div>
			</v-card-text>
		</v-card>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { formatValue, type Scalar } from "./model/rrfValues";
import ToolGlyph from "./ToolGlyph.vue";
import { useDashboard } from "./useDashboard";
import { clampBands, clampColor, useIndxTuner } from "./useIndxTuner";

defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ (e: "go", view: string): void }>();
const dash = useDashboard();

const machineStore = useMachineStore();
const tuner = useIndxTuner();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const xRow = computed(() => tuner.rowFor("INDX_tool_x"));


const bands = computed(() => clampBands());
const lcMin = computed(() => bands.value.min);
const nominal = computed(() => tuner.currentNumber("INDX_LC_locking_force") ?? 1600);

const scaleMax = computed(() => {
	const forces = [...tuner.clampLog.value.values()].map(r => r.grams);
	return Math.max(bands.value.high * 1.1, nominal.value * 1.5, ...forces.map(f => f * 1.1));
});
const pct = (g: number) => Math.max(0, Math.min(100, g / scaleMax.value * 100));
const nominalPct = computed(() => pct(nominal.value));
const minPct = computed(() => pct(lcMin.value));
const highPct = computed(() => pct(bands.value.high));

const legend = computed(() => [
	{ key: "fail", cls: "indx-swatch--fail", text: t("docks.legendFail", { g: bands.value.min }) },
	{ key: "weak", cls: "indx-swatch--warn", text: t("docks.legendWeak", { g: bands.value.low }) },
	{ key: "good", cls: "indx-swatch--good", text: t("docks.legendGood", { low: bands.value.low, high: bands.value.high }) },
	{ key: "high", cls: "indx-swatch--warn", text: t("docks.legendHigh", { g: bands.value.high }) },
	{ key: "nominal", cls: "indx-swatch--line", text: t("docks.legendNominal", { g: nominal.value }) },
]);

function fmt(v: Scalar | undefined, float: boolean): string {
	return v === null || v === undefined ? "" : formatValue(v, { list: false, float });
}

function age(date: number | undefined): string {
	if (date === undefined) {
		return t("docks.forceOld");
	}
	const min = Math.max(0, Math.round((Date.now() - date) / 60000));
	return min < 120 ? t("docks.forceAgo", { min }) : min < 48 * 60 ? t("docks.forceHours", { h: Math.round(min / 60) }) : t("docks.forceDays", { d: Math.round(min / 1440) });
}

/** Z offset of a tool from the object model (G10), or "—" */
function zOffset(tool: number): string {
	const tools: any[] = (machineStore.model as any).tools ?? [];
	const z = tools.find(x => x?.number === tool)?.offsets?.[2];
	return typeof z === "number" ? (z >= 0 ? "+" : "") + z.toFixed(3) : "—";
}

const docks = computed(() => {
	const xs = tuner.currentList("INDX_tool_x") ?? [];
	const xFloat = xRow.value?.shape.float ?? true;
	const currentTool = Number((machineStore.model.state as any).currentTool ?? -1);
	const n = Math.max(xs.length, tuner.dockCount.value ?? 0);

	return Array.from({ length: n }, (_, tool) => {
		const force = tuner.clampLog.value.get(tool) ?? null;
		const g = force?.grams ?? 0;
		return {
			tool,
			current: tool === currentTool,
			xText: fmt(xs[tool], xFloat),
			zText: zOffset(tool),
			force,
			forceTitle: force === null ? t("docks.noForce")
				: `${t("docks.forceTitle", { source: t(force.source === "tuner" ? "docks.sourceTuner" : "docks.sourceChecks") })}, ${age(force.date)}`,
			fillPct: force === null ? 0 : pct(g),
			barColor: force === null ? "transparent"
				: clampColor(g),
		};
	});
});

// the Z offset and M501 checks read config.g and config-override.g: when shown, and after every reload
onMounted(() => { void dash.refreshFiles(); });
watch(() => tuner.loading.value, l => { if (!l) { void dash.refreshFiles(); } });
</script>

<style scoped>
.indx-issue {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 7px 10px;
	border-radius: 4px;
	margin-bottom: 6px;
}
.indx-issue:last-child {
	margin-bottom: 0;
}
.indx-issue--warning {
	background: rgba(var(--v-theme-warning), 0.1);
}
.indx-issue--error {
	background: rgba(var(--v-theme-error), 0.1);
}
.indx-docks-scroll {
	overflow-x: auto;
}
.indx-docks {
	display: grid;
	column-gap: 14px;
	row-gap: 0;
	align-items: center;
}
.indx-cell {
	display: flex;
	justify-content: center;
}
.indx-tn {
	font-size: 0.9375rem;
	font-weight: 600;
	margin-bottom: 2px;
}
.indx-label {
	font-size: 0.875rem;
	opacity: 0.65;
	white-space: nowrap;
	text-align: right;
	padding-right: 4px;
}
.indx-v {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	font-size: 0.9375rem;
	text-align: center;
	padding: 3px 0;
}
.indx-legend {
	grid-column: 1 / -1;
	contain: inline-size;   /* spans the grid without widening the label column */
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	margin-top: 12px;
	font-size: 0.8125rem;
}
.indx-legend-item {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	white-space: nowrap;
}
.indx-swatch {
	display: inline-block;
	width: 12px;
	height: 12px;
	border-radius: 3px;
}
.indx-swatch--fail {
	background: rgb(var(--v-theme-error));
}
.indx-swatch--warn {
	background: rgb(var(--v-theme-warning));
}
.indx-swatch--good {
	background: rgb(var(--v-theme-success));
}
.indx-swatch--line {
	height: 2px;
	border-radius: 0;
	background: rgb(var(--v-theme-on-surface));
}
.indx-grey {
	opacity: 0.45;
}
.indx-bar {
	position: relative;
	width: 12px;
	height: 120px;
	border-radius: 3px;
	background: rgba(var(--v-theme-on-surface), 0.08);
	overflow: hidden;
}
.indx-bar-fill {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	transition: height 0.3s;
}
.indx-bar-mark,
.indx-bar-limit,
.indx-bar-high {
	position: absolute;
	left: 0;
	right: 0;
	height: 2px;
}
.indx-bar-mark {
	background: rgb(var(--v-theme-on-surface));
}
.indx-bar-limit {
	background: rgb(var(--v-theme-error));
	opacity: 0.7;
}
.indx-bar-high {
	background: rgb(var(--v-theme-warning));
	opacity: 0.8;
}
</style>
