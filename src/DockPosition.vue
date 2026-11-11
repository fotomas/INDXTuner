<template>
	<div>
		<ToolPicker v-model="dp.tool.value" :disabled="dp.busy.value !== ''">
			<span class="text-medium-emphasis">{{ $t("plugins.indxTuner.dockpos.saved") }}</span>
			<b class="indx-mono">{{ dp.savedX.value === null ? "?" : dp.savedX.value.toFixed(2) }} mm</b>
		</ToolPicker>
		<v-alert v-if="dp.message.value" :type="dp.message.value.type" variant="tonal" density="compact" class="mb-3">{{ dp.message.value.text }}</v-alert>
		<div v-if="dp.busy.value !== '' && dp.status.value" class="d-flex align-center ga-2 mb-3">
			<v-progress-circular indeterminate size="16" width="2" color="primary" /><span class="text-body-2">{{ dp.status.value }}</span>
		</div>

		<v-row dense>
			<!-- 1 Measure -->
			<v-col cols="12" md="6">
				<v-card variant="outlined" class="h-100">
					<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.dockpos.measureTitle") }}</v-card-title>
					<v-card-text>
						<div v-for="b in dp.measureBlockers.value" :key="b" class="text-error text-body-2 mb-1">✖ {{ b }}</div>
						<ol class="indx-steps text-body-2">
							<li>
								{{ $t("plugins.indxTuner.dockpos.step1") }}
								<v-btn v-if="dp.currentTool() >= 0" size="small" variant="outlined" color="primary" class="ml-2" :disabled="dp.busy.value !== ''" @click="parkTool">
									{{ $t("plugins.indxTuner.clamp.park", { tool: dp.currentTool() }) }}
								</v-btn>
							</li>
							<li>
								<v-btn size="small" variant="outlined" color="primary" :loading="dp.busy.value === 'motors'"
									   :disabled="dp.busy.value !== '' || dp.measureBlockers.value.length > 0" @click="dp.switchMotorsOff()">
									{{ $t("plugins.indxTuner.dockpos.motorsOff") }}
								</v-btn>
								<span class="text-medium-emphasis ml-2">{{ $t("plugins.indxTuner.dockpos.motorsOffNote") }}</span>
							</li>
							<li>{{ $t("plugins.indxTuner.dockpos.step3", { tool: dp.tool.value }) }}</li>
							<li>
								<v-btn size="small" color="primary" prepend-icon="mdi-play" :loading="dp.busy.value === 'measure'"
									   :disabled="dp.busy.value !== '' || dp.measureBlockers.value.length > 0 || !dp.motorsOff.value" @click="confirm = 'measure'">
									{{ $t("plugins.indxTuner.dockpos.measure") }}
								</v-btn>
								<span class="text-medium-emphasis ml-2">{{ $t("plugins.indxTuner.dockpos.measureNote") }}</span>
							</li>
						</ol>
						<div class="text-caption text-medium-emphasis mb-2">
							{{ dp.xEndstop.value.sensorless
								? $t("plugins.indxTuner.dockpos.sensorless", { c: dp.settings.stallCurrent, f: dp.settings.feed })
								: $t("plugins.indxTuner.dockpos.switch", { f: dp.settings.feed }) }}
						</div>
						<div class="d-flex ga-2 mb-2">
							<v-text-field v-model.number="dp.settings.feed" type="number" :label="$t('plugins.indxTuner.dockpos.feed')" suffix="mm/min"
										  density="compact" variant="outlined" hide-details style="max-width: 170px" />
							<v-text-field v-if="dp.xEndstop.value.sensorless" v-model.number="dp.settings.stallCurrent" type="number"
										  :label="$t('plugins.indxTuner.dockpos.stallCurrent')" suffix="%" density="compact" variant="outlined" hide-details style="max-width: 150px" />
						</div>

						<template v-if="dp.stats.value">
							<v-table density="compact">
								<thead><tr><th>#</th><th class="text-right">{{ $t("plugins.indxTuner.dockpos.dockX") }}</th></tr></thead>
								<tbody>
									<tr v-for="(x, i) in dp.stats.value.xs" :key="i"><td>{{ i + 1 }}</td><td class="text-right indx-mono">{{ x.toFixed(2) }}</td></tr>
									<tr><td class="text-medium-emphasis">{{ $t("plugins.indxTuner.dockpos.mean") }}</td>
										<td class="text-right indx-mono"><b>{{ dp.stats.value.mean.toFixed(2) }}</b>
											<span class="text-medium-emphasis"> {{ $t("plugins.indxTuner.dockpos.spread", { s: dp.stats.value.spread.toFixed(2) }) }}</span></td></tr>
								</tbody>
							</v-table>
							<div v-if="dp.xEndstop.value.sensorless && dp.stats.value.xs.length < 3" class="text-warning text-caption mt-1">
								{{ $t("plugins.indxTuner.dockpos.more") }}
							</div>
							<div class="d-flex align-end ga-4 mt-3">
								<div><div class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.clamp.now") }}</div>
									<div class="text-h5 indx-mono">{{ dp.savedX.value === null ? "?" : dp.savedX.value.toFixed(2) }}</div></div>
								<div class="text-h5 text-medium-emphasis">→</div>
								<div><div class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.dockpos.measuredLabel") }}</div>
									<div class="text-h5 indx-mono text-primary">{{ dp.stats.value.mean.toFixed(2) }}</div></div>
							</div>
						</template>
						<div class="d-flex flex-wrap ga-2 mt-3">
							<v-btn color="primary" :disabled="!dp.stats.value" @click="dp.use(round2(dp.stats.value!.mean))">
								{{ $t("plugins.indxTuner.dockpos.use", { x: dp.stats.value ? dp.stats.value.mean.toFixed(2) : "", tool: dp.tool.value }) }}
							</v-btn>
							<v-btn variant="text" :disabled="!dp.stats.value" @click="dp.clearMeasurements()">{{ $t("plugins.indxTuner.dockpos.clear") }}</v-btn>
						</div>
					</v-card-text>
				</v-card>
			</v-col>

			<!-- 2 Fine-tune -->
			<v-col cols="12" md="6">
				<v-card variant="outlined" class="h-100">
					<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.dockpos.fineTitle") }}</v-card-title>
					<v-card-text>
						<div v-for="b in dp.fineBlockers.value" :key="b" class="text-error text-body-2 mb-1">✖ {{ b }}</div>
						<div class="d-flex align-center flex-wrap ga-2 mb-3">
							<v-text-field :model-value="dp.trialX.value ?? dp.savedX.value ?? ''" type="number" step="0.05" :label="$t('plugins.indxTuner.dockpos.trialX')" suffix="mm"
										  density="compact" variant="outlined" hide-details style="max-width: 160px"
										  @update:model-value="v => dp.trialX.value = v === '' ? null : Number(v)" />
							<span v-if="trialDelta !== null" class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.dockpos.fromSaved", { d: trialDelta }) }}</span>
						</div>
						<div class="d-flex flex-wrap align-center ga-2 mb-3">
							<span class="text-caption text-medium-emphasis mr-1">{{ $t("plugins.indxTuner.dockpos.nudge") }}</span>
							<v-btn v-for="d in [-0.1, -0.05, 0.05, 0.1]" :key="d" size="small" variant="outlined" class="indx-mono"
								   :disabled="dp.busy.value !== ''" @click="dp.nudge(d)">
								{{ (d > 0 ? "+" : "−") + Math.abs(d).toFixed(2) }}
							</v-btn>
						</div>
						<div class="d-flex flex-wrap ga-2 mb-3">
							<v-text-field v-model.number="dp.settings.approachCurrent" type="number" :label="$t('plugins.indxTuner.dockpos.approachCurrent')" suffix="%"
										  density="compact" variant="outlined" hide-details style="max-width: 150px" />
							<v-text-field v-model.number="dp.settings.approachSpeed" type="number" :label="$t('plugins.indxTuner.dockpos.approachSpeed')" suffix="mm/min"
										  density="compact" variant="outlined" hide-details style="max-width: 190px" />
						</div>
						<div class="d-flex flex-wrap ga-2">
							<v-btn color="primary" variant="outlined" :loading="dp.busy.value === 'approach'"
								   :disabled="dp.busy.value !== '' || dp.fineBlockers.value.length > 0 || dp.atDock.value || dp.trialX.value === null" @click="confirm = 'approach'">
								{{ $t("plugins.indxTuner.dockpos.approach") }}
							</v-btn>
							<v-btn color="primary" variant="outlined" prepend-icon="mdi-play" :loading="dp.busy.value === 'test'"
								   :disabled="dp.busy.value !== '' || dp.fineBlockers.value.length > 0 || dp.trialX.value === null" @click="confirm = 'test'">
								{{ $t("plugins.indxTuner.dockpos.test") }}
							</v-btn>
							<v-btn variant="outlined" :loading="dp.busy.value === 'leave'" :disabled="dp.busy.value !== ''" @click="dp.leave()">
								{{ $t("plugins.indxTuner.dockpos.leave") }}
							</v-btn>
						</div>
						<div class="text-caption text-medium-emphasis mt-2">{{ $t("plugins.indxTuner.dockpos.fineNote", { tool: dp.tool.value }) }}</div>
						<div v-if="dp.lastTest.value" class="mt-3 text-body-2" :class="dp.lastTest.value.ok ? 'text-success' : 'text-warning'">
							{{ $t("plugins.indxTuner.dockpos.lastTest", { x: dp.lastTest.value.x.toFixed(2), g: dp.lastTest.value.grams === null ? "?" : Math.round(dp.lastTest.value.grams) }) }}
						</div>
						<v-btn class="mt-3" color="primary" :disabled="dp.trialX.value === null || dp.busy.value !== ''" @click="dp.use(dp.trialX.value!)">
							{{ $t("plugins.indxTuner.dockpos.use", { x: dp.trialX.value === null ? "" : dp.trialX.value.toFixed(2), tool: dp.tool.value }) }}
						</v-btn>
					</v-card-text>
				</v-card>
			</v-col>
		</v-row>

		<div class="text-subtitle-2 mt-4 mb-1">{{ $t("plugins.indxTuner.dockpos.settings") }}</div>
		<SettingsTable :rows="dockRows" :disabled="dp.busy.value !== ''" />

		<v-dialog :model-value="confirm !== null" max-width="540" @update:model-value="confirm = null">
			<v-card>
				<v-card-title>{{ $t(`plugins.indxTuner.dockpos.confirm.${confirm ?? "measure"}Title`, { tool: dp.tool.value }) }}</v-card-title>
				<v-card-text>{{ $t(`plugins.indxTuner.dockpos.confirm.${confirm ?? "measure"}`, { tool: dp.tool.value, x: dp.trialX.value?.toFixed(2) ?? "" }) }}</v-card-text>
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
import { computed, onMounted, ref, watch } from "vue";

import { useMachineStore } from "@/stores/machine";

import SettingsTable from "./SettingsTable.vue";
import ToolPicker from "./ToolPicker.vue";
import { useDockPosition } from "./useDockPosition";
import { DOCK_LIST_VARS, useIndxTuner } from "./useIndxTuner";

const tuner = useIndxTuner();
const machineStore = useMachineStore();
const dp = useDockPosition();
const confirm = ref<"measure" | "approach" | "test" | null>(null);

/** The dock settings of INDX_variables.g ("Tool docks" section); the per-tool lists are set above */
const dockRows = computed(() => tuner.rowsOfSection("tool docks", DOCK_LIST_VARS));
async function parkTool(): Promise<void> {
	await machineStore.sendCode("T-1", false, true, true);
}
const round2 = (x: number) => Math.round(x * 100) / 100;
const trialDelta = computed(() => {
	if (dp.trialX.value === null || dp.savedX.value === null) {
		return null;
	}
	const d = dp.trialX.value - dp.savedX.value;
	return (d >= 0 ? "+" : "") + d.toFixed(2);
});

function go(): void {
	const what = confirm.value;
	confirm.value = null;
	if (what === "measure") {
		void dp.measure();
	} else if (what === "approach") {
		void dp.approach();
	} else if (what === "test") {
		void dp.dockTest();
	}
}

// a new tool starts from its saved X (or its measurements)
watch(() => dp.tool.value, () => {
	dp.trialX.value = dp.stats.value ? round2(dp.stats.value.mean) : dp.savedX.value;
	dp.lastTest.value = null;
});

onMounted(() => {
	if (!tuner.docks.value.numbers.includes(dp.tool.value) && tuner.docks.value.numbers.length > 0) {
		dp.tool.value = tuner.docks.value.numbers[0];
	}
	if (dp.trialX.value === null) {
		dp.trialX.value = dp.savedX.value;
	}
});
</script>

<style scoped>
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
.indx-steps {
	padding-left: 20px;
	margin-bottom: 12px;
}
.indx-steps li {
	margin-bottom: 8px;
}
</style>
