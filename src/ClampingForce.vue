<template>
	<div>
		<v-alert v-if="!hasLatchList" type="info" variant="tonal" density="compact" class="mb-3">
			{{ $t("plugins.indxTuner.patch.needs", { patch: $t("plugins.indxTuner.patch.p.latch.title") }) }}
			<template #append><v-btn size="small" variant="outlined" color="primary" @click="askPatches">{{ $t("plugins.indxTuner.patch.open") }}</v-btn></template>
		</v-alert>

		<!-- Tool selection and the chosen tool -->
		<ToolPicker v-model="ct.tool.value" :disabled="ct.running.value">
			<span class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.force") }}</span> <b class="indx-mono">{{ toolForce }}</b>
			&nbsp; <span class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.travel") }}</span> <b class="indx-mono">{{ toolTravel.text }} mm</b>
			<span v-if="toolTravel.isDefault" class="text-medium-emphasis"> ({{ $t("plugins.indxTuner.clamp.default") }})</span>
		</ToolPicker>

		<v-tabs v-model="ct.tab.value" density="compact" color="primary" class="mb-3">
			<v-tab value="settings">{{ $t("plugins.indxTuner.clamp.tabSettings") }}</v-tab>
			<v-tab value="result">{{ $t("plugins.indxTuner.clamp.tabResult") }}</v-tab>
		</v-tabs>

		<v-window v-model="ct.tab.value">
			<!-- Settings -->
			<v-window-item value="settings">
				<v-row dense>
					<v-col cols="12" md="7">
						<v-card variant="outlined">
							<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.clamp.stepTitle") }}</v-card-title>
							<v-card-text>
								<v-row dense>
									<v-col cols="6" sm="4"><v-text-field v-model.number="ct.settings.target" type="number" step="50" :label="$t('plugins.indxTuner.clamp.target')" suffix="g" density="compact" variant="outlined" hide-details /></v-col>
									<v-col cols="6" sm="4"><v-text-field v-model.number="ct.settings.fastTo" type="number" step="0.5" :label="$t('plugins.indxTuner.clamp.fastTo')" suffix="mm" density="compact" variant="outlined" hide-details /></v-col>
									<v-col cols="6" sm="4"><v-text-field v-model.number="ct.settings.fineStep" type="number" step="0.01" :label="$t('plugins.indxTuner.clamp.fineStep')" suffix="mm" density="compact" variant="outlined" hide-details /></v-col>
									<v-col cols="6" sm="4"><v-text-field v-model.number="ct.settings.samples" type="number" :label="$t('plugins.indxTuner.clamp.samples')" density="compact" variant="outlined" hide-details /></v-col>
									<v-col cols="6" sm="4"><v-text-field v-model.number="ct.settings.checks" type="number" :label="$t('plugins.indxTuner.clamp.checks')" density="compact" variant="outlined" hide-details /></v-col>
									<v-col cols="6" sm="4"><v-text-field v-model.number="ct.settings.maxTravel" type="number" step="0.5" :label="$t('plugins.indxTuner.clamp.maxTravel')" suffix="mm" density="compact" variant="outlined" hide-details /></v-col>
									<v-col cols="6" sm="4"><v-text-field v-model.number="ct.settings.maxInDock" type="number" step="100" :label="$t('plugins.indxTuner.clamp.maxInDock')" suffix="g" density="compact" variant="outlined" hide-details /></v-col>
								</v-row>
								<v-alert type="info" variant="tonal" density="compact" class="mt-3">
									{{ factor === null
										? $t("plugins.indxTuner.clamp.factorFirst", { tool: ct.tool.value, g: Math.round(ct.stopInDock.value) })
										: $t("plugins.indxTuner.clamp.factorKnown", { tool: ct.tool.value, f: factor.toFixed(2), g: Math.round(ct.stopInDock.value) }) }}
								</v-alert>
								<ol class="text-caption text-medium-emphasis mt-2 pl-4">
									<li v-for="i in 3" :key="i">{{ $t(`plugins.indxTuner.clamp.stepExplain[${i - 1}]`) }}</li>
								</ol>
							</v-card-text>
						</v-card>
					</v-col>
					<v-col cols="12" md="5">
						<v-card variant="outlined">
							<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.speed.run") }}</v-card-title>
							<v-card-text>
								<div v-if="blockers.length === 0" class="text-success mb-1">✔ {{ $t("plugins.indxTuner.clamp.ready") }}</div>
								<div v-for="b in blockers" :key="b" class="text-error mb-1">✖ {{ b }}</div>
								<v-btn v-if="currentTool >= 0" size="small" variant="outlined" color="primary" class="mb-2" :disabled="ct.running.value" @click="park">
									{{ $t("plugins.indxTuner.clamp.park", { tool: currentTool }) }}
								</v-btn>
								<div class="mt-3">
									<v-btn color="primary" prepend-icon="mdi-play" :disabled="blockers.length > 0 || ct.running.value" @click="confirmOpen = true">
										{{ $t("plugins.indxTuner.clamp.stepStart", { n: 1 + Math.max(1, ct.settings.checks) }) }}
									</v-btn>
								</div>
								<div class="text-caption text-medium-emphasis mt-2">{{ $t("plugins.indxTuner.clamp.watch") }}</div>
							</v-card-text>
						</v-card>
						<LoadCellCard class="mt-3" :disabled="ct.running.value" />
					</v-col>
				</v-row>
			</v-window-item>

			<!-- Result -->
			<v-window-item value="result">
				<v-alert v-if="ct.message.value" :type="ct.message.value.type" variant="tonal" density="compact" class="mb-3">{{ ct.message.value.text }}</v-alert>
				<div v-if="ct.running.value" class="d-flex align-center ga-3 mb-3">
					<v-progress-circular indeterminate size="20" width="2" color="primary" />
					<span>{{ ct.status.value }}</span>
					<v-spacer />
					<v-btn color="error" variant="tonal" prepend-icon="mdi-stop" :disabled="stopping" @click="stop">{{ $t("plugins.indxTuner.clamp.stop") }}</v-btn>
				</div>
				<div v-if="ct.points.value.length === 0 && !ct.running.value" class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.noResult") }}</div>

				<v-row v-if="ct.points.value.length > 0" dense>
					<v-col cols="12" md="7">
						<v-card variant="outlined">
							<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.clamp.chartTitle") }}</v-card-title>
							<v-card-text>
								<svg viewBox="0 0 590 300" width="100%" style="max-width: 640px">
									<g v-for="g in gridG" :key="`g${g}`">
										<line :x1="X0" :x2="X1" :y1="Y(g)" :y2="Y(g)" class="indx-grid" />
										<text :x="X0 - 8" :y="Y(g) + 4" text-anchor="end" class="indx-axis">{{ g }}</text>
									</g>
									<text v-for="e in ticks" :key="`e${e}`" :x="X(e)" :y="Y1 + 18" text-anchor="middle" class="indx-axis">{{ e }}</text>
									<rect v-if="ct.slackEnd.value !== null" :x="X0" :y="Y0" :width="X(ct.slackEnd.value) - X0" :height="Y1 - Y0" class="indx-slack" />
									<line :x1="X0" :x2="X1" :y1="Y(ct.settings.target)" :y2="Y(ct.settings.target)" class="indx-target" />
									<text :x="X0 + 6" :y="Y(ct.settings.target) - 5" class="indx-axis-strong">{{ $t("plugins.indxTuner.clamp.targetLine", { g: ct.settings.target }) }}</text>
									<polyline :points="inDockLine" class="indx-indock" />
									<circle v-for="(p, i) in ct.points.value" :key="i" :cx="X(p.closed)" :cy="Y(p.inDock)" :r="1.8" class="indx-indock-dot" />
									<polyline :points="pickLine" class="indx-pick" />
									<line v-if="ct.crossing.value !== null" :x1="X(ct.crossing.value)" :x2="X(ct.crossing.value)" :y1="Y0" :y2="Y1" class="indx-suggest" />
									<path v-if="ct.endResult.value" :d="diamond(ct.endResult.value.closed, ct.endResult.value.pick)" class="indx-real" />
									<path v-for="(c, i) in ct.checks.value" :key="`c${i}`" :d="diamond(c.travel, c.grams)" :class="c.ok ? 'indx-real' : 'indx-real-bad'" />
									<text :x="(X0 + X1) / 2" :y="Y1 + 36" text-anchor="middle" class="indx-axis">{{ $t("plugins.indxTuner.clamp.closedAxis") }}</text>
								</svg>
								<div class="d-flex flex-wrap ga-4 text-caption mt-1">
									<span><span class="indx-key indx-key--indock" /> {{ $t("plugins.indxTuner.clamp.keyInDock") }}</span>
									<span><span class="indx-key indx-key--pick" /> {{ $t("plugins.indxTuner.clamp.keyPick", { f: shownFactor }) }}</span>
									<span class="text-no-wrap"><span class="text-success">◆</span> {{ $t("plugins.indxTuner.clamp.keyReal") }}</span>
								</div>
							</v-card-text>
						</v-card>
					</v-col>
					<v-col cols="12" md="5">
						<v-card variant="outlined">
							<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.clamp.resultFor", { tool: ct.resultTool.value }) }}</v-card-title>
							<v-card-text>
								<v-table density="compact">
									<tbody>
										<tr v-if="ct.slackEnd.value !== null"><td class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.rSlack") }}</td><td class="text-right indx-mono">{{ mm(ct.slackEnd.value) }} mm</td></tr>
										<tr v-if="ct.crossing.value !== null"><td class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.rCrossing", { g: ct.settings.target }) }}</td><td class="text-right indx-mono"><b>{{ mm(ct.crossing.value) }} mm</b></td></tr>
										<template v-if="ct.endResult.value">
											<tr><td class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.rEnd") }}</td>
												<td class="text-right indx-mono">{{ $t("plugins.indxTuner.clamp.rEndValue", { mm: mm(ct.endResult.value.closed), g: Math.round(ct.endResult.value.inDock) }) }}</td></tr>
											<tr><td class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.rPick") }}</td><td class="text-right indx-mono">{{ Math.round(ct.endResult.value.pick) }} g <span class="text-medium-emphasis">({{ $t("plugins.indxTuner.clamp.rPickFirst") }} {{ Math.round(ct.endResult.value.pickFirst) }} g)</span></td></tr>
											<tr><td class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.rFactor") }}</td>
												<td class="text-right indx-mono">{{ ct.endResult.value.factor.toFixed(2) }}<span v-if="ct.endResult.value.previous !== null" class="text-medium-emphasis"> ({{ $t("plugins.indxTuner.clamp.was", { f: ct.endResult.value.previous.toFixed(2) }) }})</span></td></tr>
										</template>
										<tr v-for="(c, i) in ct.checks.value" :key="`r${i}`">
											<td class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.rCheck", { mm: mm(c.travel) }) }}</td>
											<td class="text-right indx-mono" :class="c.ok ? 'text-success' : 'text-warning'"><span class="text-medium-emphasis">{{ Math.round(c.first) }} →</span> {{ Math.round(c.grams) }} g {{ c.ok ? "✔" : "✖" }}</td>
										</tr>
										<tr v-if="ct.stepSeconds.value !== null"><td class="text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.rSteps") }}</td>
											<td class="text-right indx-mono">{{ ct.points.value.length }} · {{ ct.stepSeconds.value.toFixed(2) }} s</td></tr>
									</tbody>
								</v-table>
								<template v-if="ct.suggestion.value">
									<div class="d-flex align-end ga-4 my-3">
										<div><div class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.now") }}</div><div class="text-h5 indx-mono">{{ resultTravelNow }}</div></div>
										<div class="text-h5 text-medium-emphasis">→</div>
										<div><div class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.suggested") }}</div>
											<div class="text-h5 indx-mono text-primary">{{ mm(ct.suggestion.value.value) }} mm</div>
											<div class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.checked", { f: ct.suggestion.value.force, g: ct.settings.target }) }}</div></div>
									</div>
									<v-btn color="primary" :disabled="ct.running.value || !hasLatchList" @click="use">{{ $t("plugins.indxTuner.clamp.use", { v: mm(ct.suggestion.value.value), tool: ct.resultTool.value }) }}</v-btn>
									<div v-if="useError" class="text-error text-caption mt-1">{{ useError }}</div>
									<div v-else-if="used" class="text-success text-caption mt-1">{{ $t("plugins.indxTuner.clamp.used") }}</div>
								</template>
							</v-card-text>
						</v-card>
					</v-col>
				</v-row>
			</v-window-item>
		</v-window>

		<div class="text-subtitle-2 mt-4 mb-1">{{ $t("plugins.indxTuner.clamp.latchSettings") }}</div>
		<SettingsTable :rows="latchRows" :disabled="ct.running.value" />

		<v-dialog v-model="confirmOpen" max-width="540">
			<v-card>
				<v-card-title>{{ $t("plugins.indxTuner.clamp.confirmTitle", { tool: ct.tool.value }) }}</v-card-title>
				<v-card-text>{{ $t("plugins.indxTuner.clamp.stepConfirm", { tool: ct.tool.value, g: Math.round(ct.stopInDock.value), mm: ct.settings.maxTravel }) }}</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="confirmOpen = false">{{ $t("plugins.indxTuner.save.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="start">{{ $t("plugins.indxTuner.recovery.go") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { formatValue } from "./model/rrfValues";
import LoadCellCard from "./LoadCellCard.vue";
import { patchRequest } from "./usePatches";
import SettingsTable from "./SettingsTable.vue";
import ToolPicker from "./ToolPicker.vue";
import { LATCH_LIST, useClampTuning } from "./useClampTuning";
import { useIndxTuner } from "./useIndxTuner";

/** A "Patches…" button: the page switches to INDX Files, which opens the patch dialog */
const askPatches = () => { patchRequest.value = true; };
const machineStore = useMachineStore();
const tuner = useIndxTuner();
const ct = useClampTuning();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const currentTool = computed(() => Number((machineStore.model.state as any).currentTool ?? -1));
const hasLatchList = computed(() => tuner.rowFor(LATCH_LIST)?.info != null);
/** The latch settings (INDX_variables.g "Latch" section); the per-tool travel list is set by "Use" */
const latchRows = computed(() => tuner.rowsOfSection("latch", [LATCH_LIST]));
const factor = computed(() => ct.factorOf(ct.tool.value));
const shownFactor = computed(() => (ct.endResult.value?.factor ?? factor.value ?? 0.6).toFixed(2));

const blockers = computed(() => [
	...(hasLatchList.value ? [] : [t("clamp.noLatchList")]),
	...tuner.measureBlockers.value,
]);

function travelOf(tool: number): { text: string; isDefault: boolean } {
	const own = (tuner.currentList(LATCH_LIST) ?? [])[tool] ?? null;
	const def = tuner.currentNumber("INDX_latch_close_e");
	if (own !== null) {
		return { text: formatValue(own, { list: false, float: true }), isDefault: false };
	}
	return { text: def !== null ? formatValue(def, { list: false, float: true }) : "?", isDefault: true };
}

const toolTravel = computed(() => travelOf(ct.tool.value));
const toolForce = computed(() => {
	const r = tuner.clampLog.value.get(ct.tool.value);
	return r ? `${Math.round(r.grams)} g` : "—";
});
const resultTravelNow = computed(() => ct.resultTool.value === null ? "" : `${travelOf(ct.resultTool.value).text} mm`);
const mm = (v: number) => v.toFixed(3).replace(/0{1,2}$/, "");

// ---- chart: force against latch closed, the in-dock readings and the same as pickup force
const X0 = 60, X1 = 560, Y0 = 20, Y1 = 250;
/** From the fast-to travel (the first reading) to just past the last reading or check */
const eMin = computed(() => Math.floor(Math.min(ct.settings.fastTo, ...ct.points.value.map(p => p.closed))));
const eMax = computed(() => Math.max(eMin.value + 1, ...ct.points.value.map(p => p.closed), ...ct.checks.value.map(c => c.travel)) + 0.25);
const gMax = computed(() => {
	const top = Math.max(ct.settings.target * 1.3, ...ct.points.value.map(p => p.inDock), ...ct.checks.value.map(c => c.grams), ct.endResult.value?.pick ?? 0);
	return Math.ceil(top / 1000) * 1000;
});
const X = (e: number) => X0 + (e - eMin.value) / (eMax.value - eMin.value) * (X1 - X0);
const Y = (g: number) => Y1 - Math.min(g, gMax.value) / gMax.value * (Y1 - Y0);
const gridG = computed(() => Array.from({ length: gMax.value / 1000 + 1 }, (_, i) => i * 1000));
const ticks = computed(() => {
	const step = eMax.value - eMin.value > 4 ? 1 : 0.5;
	const out: number[] = [];
	for (let e = eMin.value; e <= eMax.value + 1e-6; e += step) {
		out.push(Math.round(e * 10) / 10);
	}
	return out;
});
const inDockLine = computed(() => ct.points.value.map(p => `${X(p.closed)},${Y(p.inDock)}`).join(" "));
const pickLine = computed(() => ct.curve.value.filter((_, i) => ct.points.value[i]?.fine).map(p => `${X(p.closed)},${Y(p.pick)}`).join(" "));
const diamond = (e: number, g: number) => `M${X(e)} ${Y(g) - 7} l7 7 l-7 7 l-7 -7 z`;

// ---- actions
const confirmOpen = ref(false);
const stopping = ref(false);
const used = ref(false);
const useError = ref<string | null>(null);

function start(): void {
	confirmOpen.value = false;
	used.value = false;
	useError.value = null;
	stopping.value = false;
	void ct.start();
}

function stop(): void {
	stopping.value = true;
	ct.stop();
}

function use(): void {
	useError.value = ct.useSuggestion();
	used.value = useError.value === null;
}

async function park(): Promise<void> {
	await machineStore.sendCode("T-1", false, true, true);
}

onMounted(() => {
	// the target defaults to the locking force the load cell is calibrated to
	const lf = tuner.currentNumber("INDX_LC_locking_force");
	if (lf !== null && ct.points.value.length === 0) {
		ct.settings.target = lf;
	}
	if (!tuner.docks.value.numbers.includes(ct.tool.value) && tuner.docks.value.numbers.length > 0) {
		ct.tool.value = tuner.docks.value.numbers[0];
	}
});
</script>

<style scoped>
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
.indx-grid {
	stroke: rgba(var(--v-theme-on-surface), 0.1);
}
.indx-axis {
	font-size: 11px;
	fill: rgba(var(--v-theme-on-surface), 0.6);
}
.indx-axis-strong {
	font-size: 11px;
	fill: rgb(var(--v-theme-on-surface));
}
.indx-slack {
	fill: rgba(var(--v-theme-on-surface), 0.04);
}
.indx-target {
	stroke: rgb(var(--v-theme-on-surface));
	stroke-dasharray: 4 3;
}
.indx-indock {
	fill: none;
	stroke: rgba(var(--v-theme-on-surface), 0.45);
	stroke-width: 1.5;
}
.indx-indock-dot {
	fill: rgba(var(--v-theme-on-surface), 0.5);
}
.indx-pick {
	fill: none;
	stroke: rgb(var(--v-theme-primary));
	stroke-width: 2;
}
.indx-suggest {
	stroke: rgb(var(--v-theme-primary));
	stroke-width: 1.5;
	stroke-dasharray: 5 3;
}
.indx-real {
	fill: rgb(var(--v-theme-success));
}
.indx-real-bad {
	fill: rgb(var(--v-theme-warning));
}
.indx-key {
	display: inline-block;
	width: 14px;
	vertical-align: middle;
}
.indx-key--indock {
	border-top: 2px solid rgba(var(--v-theme-on-surface), 0.45);
}
.indx-key--pick {
	border-top: 2px solid rgb(var(--v-theme-primary));
}
</style>
