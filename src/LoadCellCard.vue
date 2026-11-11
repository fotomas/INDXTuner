<template>
	<v-card variant="outlined">
		<v-card-title class="text-subtitle-1 d-flex align-center ga-2"><v-icon size="small">mdi-scale</v-icon>{{ $t("plugins.indxTuner.lc.title") }}</v-card-title>
		<v-card-text>
			<div v-if="!calibrated" class="mb-2">
				<v-alert type="error" variant="tonal" density="compact">{{ $t("plugins.indxTuner.lc.notCalibrated") }}</v-alert>
			</div>
			<v-alert v-else-if="isDefault" type="warning" variant="tonal" density="compact" class="mb-2">
				{{ $t("plugins.indxTuner.lc.seemsDefault", { v: fmt(defaultScale) }) }}
			</v-alert>
			<div v-else class="text-success mb-1">✔ {{ $t("plugins.indxTuner.lc.calibrated") }}</div>

			<div v-if="scale !== null" class="indx-kv text-body-2 mb-2">
				<span class="text-medium-emphasis">{{ $t("plugins.indxTuner.lc.scale") }}</span><span class="indx-mono">{{ fmt(scale) }} g/count</span>
				<template v-if="before !== null && before !== scale">
					<span class="text-medium-emphasis">{{ $t("plugins.indxTuner.lc.before") }}</span><span class="indx-mono">{{ fmt(before) }} g/count</span>
				</template>
				<template v-if="calibrated && !isDefault">
					<span class="text-medium-emphasis">{{ $t("plugins.indxTuner.lc.direction") }}</span>
					<span class="indx-mono">{{ scale < 0 ? $t("plugins.indxTuner.lc.inverted") : $t("plugins.indxTuner.lc.normal") }}</span>
				</template>
			</div>

			<!-- after a calibration: the tool used is still on the head, and Z must be homed with the new scale -->
			<template v-if="done">
				<v-alert type="info" variant="tonal" density="compact" class="mb-2">
					{{ $t("plugins.indxTuner.lc.after") }}
					<ol class="pl-4 mt-1"><li>{{ $t("plugins.indxTuner.lc.afterPark") }}</li><li>{{ $t("plugins.indxTuner.lc.afterHome") }}</li></ol>
				</v-alert>
				<div class="d-flex ga-2">
					<v-btn size="small" variant="outlined" color="primary" :disabled="busy || currentTool < 0" @click="send('T-1')">{{ $t("plugins.indxTuner.lc.park") }}</v-btn>
					<v-btn size="small" variant="outlined" color="primary" :disabled="busy" @click="send('G28 Z')">{{ $t("plugins.indxTuner.lc.homeZ") }}</v-btn>
				</div>
			</template>
			<v-btn v-else :color="'primary'" :variant="calibrated && !isDefault ? 'outlined' : 'flat'" :loading="calibrating" :disabled="disabled || busy"
				   @click="calibrate">
				{{ calibrated && !isDefault ? $t("plugins.indxTuner.lc.again") : $t("plugins.indxTuner.lc.calibrate") }}
			</v-btn>
		</v-card-text>
	</v-card>
</template>

<script setup lang="ts">
/**
 * Load-cell calibration status, and INDX_LC_CALIBRATE.g started from the plugin. The macro asks its own
 * questions in DWC dialogs (M291); the plugin only starts it and shows the result.
 */
import { computed, ref } from "vue";

import { useMachineStore } from "@/stores/machine";

import { useIndxTuner } from "./useIndxTuner";

defineProps<{ disabled?: boolean }>();

const machineStore = useMachineStore();
const tuner = useIndxTuner();

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
const calibrated = computed(() => tuner.globalValue("INDX_LC_calibrated") === true);
const scale = computed(() => num(tuner.globalValue("INDX_LC_scale")));
const defaultScale = computed(() => num(tuner.rowFor("INDX_LC_scale")?.info?.defaultValue));
/** Still the INDX default: most likely never calibrated on this printer */
const isDefault = computed(() => scale.value !== null && defaultScale.value !== null && Math.abs(Math.abs(scale.value) - defaultScale.value) < 1e-6);
const currentTool = computed(() => Number((machineStore.model.state as any).currentTool ?? -1));
const busy = computed(() => tuner.machineStatus() !== "idle");

const calibrating = ref(false);
const done = ref(false);
const before = ref<number | null>(null);

const fmt = (v: number | null) => v === null ? "?" : v.toFixed(4);

async function calibrate(): Promise<void> {
	before.value = scale.value;
	done.value = false;
	calibrating.value = true;
	try {
		await machineStore.sendCode('M98 P"INDX_LC_CALIBRATE.g"', false, true, true);
		// the macro waits for answers in dialogs, so allow it plenty of time
		await tuner.waitUntilIdle(4000, 1800000);
		await tuner.readGlobals();
		done.value = scale.value !== before.value || calibrated.value && currentTool.value >= 0;
	} finally {
		calibrating.value = false;
	}
}

async function send(code: string): Promise<void> {
	await machineStore.sendCode(code, false, true, true);
	await tuner.waitUntilIdle(4000, 180000);
	if (code === "G28 Z") {
		done.value = false;
	}
}
</script>

<style scoped>
.indx-kv {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 2px 14px;
}
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
</style>
