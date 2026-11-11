<template>
	<div>
		<v-alert v-if="sp.message.value" :type="sp.message.value.type" variant="tonal" density="compact" class="mb-3">{{ sp.message.value.text }}</v-alert>

		<!-- groups -->
		<div class="d-flex flex-wrap ga-2 mb-3">
			<v-chip v-for="g in sp.groups.value" :key="g" :color="g === sp.group.value ? 'primary' : undefined" :variant="g === sp.group.value ? 'flat' : 'outlined'"
					:disabled="sp.running.value !== null" @click="sp.group.value = g">
				{{ $t(`plugins.indxTuner.speed.group.${g}`) }}
				<span class="ml-2" :class="sp.groupLevel(g) ? 'font-weight-bold' : 'text-medium-emphasis'">{{ sp.groupLevel(g) ?? $t("plugins.indxTuner.speed.notRun") }}</span>
			</v-chip>
		</div>

		<v-row dense>
			<v-col cols="12" lg="7">
				<v-alert v-if="locked" type="info" variant="tonal" density="compact" class="mb-2">
					{{ $t("plugins.indxTuner.patch.needs", { patch: $t(`plugins.indxTuner.patch.p.${sp.GROUP_PATCH[sp.group.value] ?? "latch"}.title`) }) }}
					<template #append><v-btn size="small" variant="outlined" color="primary" @click="askPatches">{{ $t("plugins.indxTuner.patch.open") }}</v-btn></template>
				</v-alert>
				<div v-else-if="sp.group.value === 'travel' && !sp.declared('INDX_TC_accel')" class="d-flex align-center ga-2 mb-2 text-caption text-medium-emphasis">
					{{ $t("plugins.indxTuner.patch.needsAccel", { patch: $t("plugins.indxTuner.patch.p.accel.title") }) }}
					<v-btn size="x-small" variant="text" color="primary" @click="askPatches">{{ $t("plugins.indxTuner.patch.open") }}</v-btn>
				</div>
				<v-card variant="outlined" :class="{ 'indx-locked': locked }">
					<v-card-title class="text-subtitle-1">
						{{ $t(`plugins.indxTuner.speed.group.${sp.group.value}`) }}: {{ sp.groupVars.value.map(v => v.name).join(", ") }}
					</v-card-title>
					<v-card-text>
						<!-- Travel: link switch -->
						<div v-if="sp.group.value === 'travel' && sp.groupVars.value.length > 1" class="d-flex align-center flex-wrap ga-3 mb-2">
							<v-switch v-model="sp.linked.value" color="primary" density="compact" hide-details :disabled="sp.running.value !== null"
									  class="indx-small-switch flex-grow-0" />
							<span class="text-body-2">{{ sp.linked.value ? $t('plugins.indxTuner.speed.linked') : $t('plugins.indxTuner.speed.unlinked') }}</span>
							<template v-if="!sp.linked.value">
								<v-btn-toggle v-model="sp.tuneTravel.value" mandatory divided density="compact" variant="outlined" color="primary" :disabled="sp.running.value !== null">
									<v-btn value="travelSpeed" size="small">{{ $t("plugins.indxTuner.speed.tuneSpeed") }}</v-btn>
									<v-btn value="travelAccel" size="small">{{ $t("plugins.indxTuner.speed.tuneAccel") }}</v-btn>
								</v-btn-toggle>
								<span class="text-caption text-medium-emphasis">{{ heldText }}</span>
							</template>
						</div>

						<!-- step size, and the range to test (handles on the rail beside the rows) -->
						<div class="d-flex flex-wrap align-center ga-2 mb-2">
							<span class="text-caption text-medium-emphasis mr-1">{{ $t("plugins.indxTuner.speed.stepSize") }}</span>
							<v-chip v-for="p in STEP_CHOICES" :key="p" size="small" :color="p === sp.stepPct.value ? 'primary' : undefined"
									:variant="p === sp.stepPct.value ? 'flat' : 'outlined'" :disabled="sp.running.value !== null" @click="sp.setStepPct(p)">{{ p }} %</v-chip>
							<span class="text-body-2 ml-3">{{ $t("plugins.indxTuner.speed.rangeText", { from: sp.levelText(startK), to: sp.levelText(endK), n: sp.testLevels.value.length }) }}</span>
						</div>
						<v-table density="compact">
							<thead>
								<tr>
									<th style="width: 34px; padding: 0" />
									<th>{{ $t("plugins.indxTuner.speed.step") }}</th>
									<th v-for="v in shownVars" :key="v.name" class="text-right" :title="v.name">{{ $t(`plugins.indxTuner.speed.${v.label}`) }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.speed.swap") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.speed.checks") }}</th>
									<th>{{ $t("plugins.indxTuner.clamp.resultCol") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="(s, i) in sp.steps.value" :key="s.k" :data-k="s.k" :class="{ 'indx-chosen': s.k === sp.chosenK.value, 'indx-skipped': s.k < startK || s.k > endK }">
									<td class="indx-rail">
										<div class="indx-rail-line" :class="{ first: i === 0, last: i === sp.steps.value.length - 1 }" />
										<div v-if="s.k >= startK && s.k <= endK && startK !== endK" class="indx-rail-fill"
											 :class="{ first: s.k === startK, last: s.k === endK }" />
										<div v-if="s.k === startK" class="indx-knob" :title="$t('plugins.indxTuner.speed.from')" @pointerdown="grab($event, 'start')" />
										<div v-if="s.k === endK && endK !== startK" class="indx-knob" :title="$t('plugins.indxTuner.speed.to')" @pointerdown="grab($event, 'end')" />
									</td>
									<td class="text-no-wrap">
										{{ sp.levelText(s.k) }}
										<v-chip v-if="s.k === sp.nowK.value" size="x-small" class="ml-1" label>{{ $t("plugins.indxTuner.speed.now") }}</v-chip>
									</td>
									<td v-for="v in shownVars" :key="v.name" class="text-right indx-mono" :class="{ 'text-medium-emphasis': !tuned(v.name) }">{{ s.values[v.name] ?? "" }}</td>
									<td class="text-right indx-mono">{{ secs(sp.avgSeconds(s.cycles)) }}</td>
									<td class="text-right indx-mono">{{ s.cycles.length ? `${s.cycles.filter(c => c.ok).length}/${s.cycles.length}` : "" }}</td>
									<td :class="resultClass(s.result)">{{ resultText(s.result, s.reason) }}</td>
								</tr>
							</tbody>
						</v-table>
						<div class="text-caption text-medium-emphasis mt-2">{{ $t(sp.group.value === "latch" ? "plugins.indxTuner.speed.explainLatch" : "plugins.indxTuner.speed.explain") }}</div>
					</v-card-text>
				</v-card>
			</v-col>

			<v-col cols="12" lg="5">
				<v-card variant="outlined" class="mb-3">
					<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.speed.run") }}</v-card-title>
					<v-card-text>
						<ToolPicker v-model="sp.tool.value" :disabled="sp.running.value !== null" :label="$t('plugins.indxTuner.speed.testWith')" no-head-mark compact />
						<div class="d-flex flex-wrap align-center ga-3">
							<v-btn-toggle v-model="sp.settings.hot" mandatory divided density="compact" variant="outlined" color="primary" :disabled="sp.running.value !== null">
								<v-btn :value="false" size="small">{{ $t("plugins.indxTuner.clamp.cold") }}</v-btn>
								<v-btn :value="true" size="small">{{ $t("plugins.indxTuner.clamp.hot") }}</v-btn>
							</v-btn-toggle>
							<v-text-field v-if="sp.settings.hot" v-model.number="sp.settings.hotTemp" type="number" :label="$t('plugins.indxTuner.clamp.hotTemp')" suffix="°C"
										  density="compact" variant="outlined" hide-details style="max-width: 120px" />
							<v-text-field v-model.number="sp.settings.cycles" type="number" :label="$t('plugins.indxTuner.speed.cycles')"
										  density="compact" variant="outlined" hide-details style="max-width: 190px" />
						</div>
						<div class="d-flex align-center ga-2 mt-3">
							<v-btn color="primary" prepend-icon="mdi-play" :disabled="locked || sp.startBlockers.value.length > 0 || sp.running.value !== null" @click="confirm = 'ladder'">
								{{ $t("plugins.indxTuner.speed.startLadder") }}
							</v-btn>
							<v-btn v-if="sp.running.value !== null" color="error" variant="tonal" prepend-icon="mdi-stop" @click="sp.stop()">{{ $t("plugins.indxTuner.clamp.stop") }}</v-btn>
						</div>
						<div v-if="sp.running.value !== null" class="d-flex align-center ga-2 mt-2">
							<v-progress-circular indeterminate size="16" width="2" color="primary" /><span class="text-body-2">{{ sp.status.value }}</span>
						</div>
						<div v-for="b in sp.startBlockers.value" :key="b" class="text-error text-body-2 mt-1">✖ {{ b }}</div>
					</v-card-text>
				</v-card>

				<v-card variant="outlined">
					<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.speed.resultFor", { group: $t(`plugins.indxTuner.speed.group.${sp.group.value}`) }) }}</v-card-title>
					<v-card-text>
						<div v-if="sp.fastestPassed.value === null" class="text-medium-emphasis">{{ $t("plugins.indxTuner.speed.noResult") }}</div>
						<template v-else>
							<div class="d-flex flex-wrap ga-6 mb-3">
								<div><div class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.speed.fastest") }}</div>
									<div class="text-h5 indx-mono">{{ sp.levelText(sp.fastestPassed.value) }}</div></div>
								<div><div class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.speed.chosen") }}</div>
									<div class="text-h5 indx-mono text-primary">{{ sp.chosenK.value === null ? "" : sp.levelText(sp.chosenK.value) }}</div>
									<div v-if="sp.timeSaved.value.from !== null && sp.timeSaved.value.to !== null" class="text-caption text-medium-emphasis">
										{{ $t("plugins.indxTuner.speed.swapFromTo", { from: sp.timeSaved.value.from.toFixed(1), to: sp.timeSaved.value.to.toFixed(1) }) }}
									</div></div>
							</div>
							<v-select v-model="sp.chosenK.value" :items="levelItems" :label="$t('plugins.indxTuner.speed.level')" density="compact" variant="outlined"
									  hide-details style="max-width: 200px" class="mb-3" :disabled="sp.running.value !== null" />
							<v-btn color="primary" :disabled="sp.chosenK.value === null || sp.running.value !== null" @click="sp.useGroup()">
								{{ $t("plugins.indxTuner.speed.useGroup", { group: $t(`plugins.indxTuner.speed.group.${sp.group.value}`) }) }}
							</v-btn>
						</template>
					</v-card-text>
				</v-card>
			</v-col>
		</v-row>

		<!-- final check -->
		<v-card variant="outlined" class="mt-3">
			<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.speed.checkTitle") }}</v-card-title>
			<v-card-text>
				<div class="d-flex flex-wrap ga-4 text-body-2 mb-2">
					<span v-for="g in sp.groups.value" :key="g">{{ $t(`plugins.indxTuner.speed.group.${g}`) }}
						<b class="indx-mono">{{ sp.groupLevel(g) ?? $t("plugins.indxTuner.speed.current") }}</b></span>
				</div>
				<v-table v-if="sp.checks.value.length" density="compact">
					<thead><tr><th>{{ $t("plugins.indxTuner.zoff.tool") }}</th><th class="text-right">{{ $t("plugins.indxTuner.speed.swap") }}</th>
						<th class="text-right">{{ $t("plugins.indxTuner.speed.checks") }}</th><th>{{ $t("plugins.indxTuner.clamp.resultCol") }}</th></tr></thead>
					<tbody>
						<tr v-for="c in sp.checks.value" :key="c.tool">
							<td>T{{ c.tool }}</td>
							<td class="text-right indx-mono">{{ secs(sp.avgSeconds(c.cycles)) }}</td>
							<td class="text-right indx-mono">{{ c.cycles.length ? `${c.cycles.filter(x => x.ok).length}/${c.cycles.length}` : "" }}</td>
							<td :class="resultClass(c.result)">{{ resultText(c.result, c.reason) }}</td>
						</tr>
					</tbody>
				</v-table>
				<div class="d-flex flex-wrap ga-2 mt-3">
					<v-btn color="primary" variant="outlined" prepend-icon="mdi-play" :disabled="!sp.hasChosen.value || sp.running.value !== null || sp.startBlockers.value.length > 0"
						   @click="confirm = 'check'">{{ $t("plugins.indxTuner.speed.startCheckAll") }}</v-btn>
					<v-btn color="primary" :disabled="!sp.canUseAll.value || sp.running.value !== null" @click="sp.useAll()">{{ $t("plugins.indxTuner.speed.useAll") }}</v-btn>
				</div>
				<div class="text-caption text-medium-emphasis mt-2">{{ $t("plugins.indxTuner.speed.useAllNote") }}</div>
			</v-card-text>
		</v-card>

		<div class="text-subtitle-2 mt-4 mb-1">{{ $t("plugins.indxTuner.speed.modeTitle") }}</div>
		<SettingsTable :rows="modeRows" :disabled="sp.running.value !== null" />

		<v-dialog :model-value="confirm !== null" max-width="540" @update:model-value="confirm = null">
			<v-card>
				<v-card-title>{{ $t(confirm === "check" ? "plugins.indxTuner.speed.confirmCheckTitle" : "plugins.indxTuner.speed.confirmLadderTitle") }}</v-card-title>
				<v-card-text>{{ confirm === "check"
					? $t("plugins.indxTuner.speed.confirmCheck")
					: $t("plugins.indxTuner.speed.confirmLadder", { tool: sp.tool.value, n: sp.settings.cycles, start: sp.levelText(startK), end: sp.levelText(endK) }) }}</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="confirm = null">{{ $t("plugins.indxTuner.save.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="go">{{ $t("plugins.indxTuner.recovery.go") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import i18n from "@/i18n";

import SettingsTable from "./SettingsTable.vue";
import ToolPicker from "./ToolPicker.vue";
import { useIndxTuner } from "./useIndxTuner";
import { STEP_CHOICES, useSpeedTuning } from "./useSpeedTuning";
import { patchRequest } from "./usePatches";

/** A "Patches…" button: the page switches to INDX Files, which opens the patch dialog */
const askPatches = () => { patchRequest.value = true; };
const tuner = useIndxTuner();
const sp = useSpeedTuning();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const confirm = ref<"ladder" | "check" | null>(null);
const modeRows = computed(() => ["INDX_TC_MODE"].map(n => tuner.rowFor(n)).filter((r): r is NonNullable<typeof r> => r !== null && !r.hidden));

const startK = computed(() => sp.units[sp.unit.value].startK);
const locked = computed(() => sp.groupLocked(sp.group.value));
const endK = computed(() => sp.units[sp.unit.value].endK);

/** Drag a rail handle: it snaps to the row under the pointer */
function grab(e: PointerEvent, which: "start" | "end"): void {
	if (sp.running.value !== null) {
		return;
	}
	// the handle is redrawn on another row as it moves, so the drag is followed on the window
	const tbody = (e.target as HTMLElement).closest("tbody");
	if (!tbody) {
		return;
	}
	e.preventDefault();
	const move = (ev: PointerEvent) => {
		let best: HTMLElement | null = null, dist = Infinity;
		for (const row of Array.from(tbody.querySelectorAll<HTMLElement>("tr[data-k]"))) {
			const r = row.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - ev.clientY);
			if (d < dist) {
				dist = d;
				best = row;
			}
		}
		if (best) {
			sp.setRange(which, Number(best.dataset.k));
		}
	};
	const up = () => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		window.removeEventListener("pointercancel", up);
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
	window.addEventListener("pointercancel", up);
}
/** Columns: every setting of the group (the one held when unlinked is shown greyed) */
const shownVars = computed(() => sp.groupVars.value);
const tuned = (name: string) => sp.unitVars.value.some(v => v.name === name);

const heldText = computed(() => {
	const held = sp.groupVars.value.find(v => !tuned(v.name));
	if (!held) {
		return "";
	}
	const v = sp.combined.value[held.name];
	return t("speed.held", { name: t(`speed.${held.label}`), value: v ?? "?" });
});

function go(): void {
	const what = confirm.value;
	confirm.value = null;
	if (what === "ladder") {
		void sp.startLadder();
	} else if (what === "check") {
		void sp.startCheck();
	}
}

const levelItems = computed(() => sp.steps.value.filter(s => s.result === "pass").map(s => ({ title: sp.levelText(s.k), value: s.k })));
const secs = (v: number | null) => v === null ? "" : `${v.toFixed(1)} s`;

function resultClass(r: string): string {
	return r === "pass" ? "text-success" : r === "fail" ? "text-error" : r === "running" ? "text-primary" : "text-medium-emphasis";
}

function resultText(r: string, reason: string): string {
	return r === "pass" ? `✔ ${t("speed.pass")}` : r === "fail" ? `✖ ${reason}` : r === "running" ? t("speed.running")
		: r === "skipped" ? t("speed.skipped") : t("speed.notRun");
}

onMounted(() => {
	if (!tuner.docks.value.numbers.includes(sp.tool.value) && tuner.docks.value.numbers.length > 0) {
		sp.tool.value = tuner.docks.value.numbers[0];
	}
	if (!sp.groups.value.includes(sp.group.value) && sp.groups.value.length > 0) {
		sp.group.value = sp.groups.value[0];
	}
});
</script>

<style scoped>
.indx-locked {
	opacity: 0.4;
	pointer-events: none;
}
.indx-small-switch :deep(.v-selection-control) {
	min-height: 0;
	height: 24px;
}
.indx-small-switch {
	transform: scale(0.8);
	transform-origin: left center;
}
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
.indx-chosen td {
	background: rgba(var(--v-theme-primary), 0.08);
}
.indx-skipped td {
	opacity: 0.38;
}
.indx-rail {
	position: relative;
	width: 34px;
	padding: 0 !important;
}
.indx-rail-line, .indx-rail-fill {
	position: absolute;
	left: 15px;
	width: 4px;
	top: 0;
	bottom: 0;
	background: rgba(var(--v-theme-on-surface), 0.25);
}
.indx-rail-fill {
	background: rgb(var(--v-theme-primary));
}
.indx-rail-line.first, .indx-rail-fill.first {
	top: 50%;
}
.indx-rail-line.last, .indx-rail-fill.last {
	bottom: 50%;
}
.indx-knob {
	position: absolute;
	left: 8px;
	top: 50%;
	width: 18px;
	height: 18px;
	margin-top: -9px;
	border-radius: 50%;
	background: rgb(var(--v-theme-primary));
	border: 2px solid rgb(var(--v-theme-surface));
	box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
	cursor: ns-resize;
	touch-action: none;
	z-index: 1;
}
.indx-skipped td.indx-rail {
	opacity: 1;
}
</style>
