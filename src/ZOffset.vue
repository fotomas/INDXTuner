<template>
	<div>
		<v-alert type="warning" variant="tonal" density="compact" class="mb-3">{{ $t("plugins.indxTuner.zoff.cleanNote") }}</v-alert>
		<v-alert v-if="zo.message.value" :type="zo.message.value.type" variant="tonal" density="compact" class="mb-3">{{ zo.message.value.text }}</v-alert>
		<v-row dense>
			<v-col cols="12" md="7">
				<v-card variant="outlined">
					<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.zoff.table") }}</v-card-title>
					<v-card-text>
						<v-table density="compact">
							<thead>
								<tr>
									<th style="width: 1%">
										<input type="checkbox" class="indx-check" :checked="allSelected" :indeterminate.prop="someSelected" :disabled="zo.running.value"
											   :title="$t('plugins.indxTuner.zoff.allTools')" @change="zo.setAll(($event.target as HTMLInputElement).checked)" />
									</th>
									<th>{{ $t("plugins.indxTuner.zoff.tool") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.zoff.trigger") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.zoff.spread") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.zoff.now") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.zoff.measured") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.zoff.change") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="r in tableRows" :key="r.tool" :class="{ 'indx-off': !isSelected(r.tool) }">
									<td>
										<input type="checkbox" class="indx-check" :checked="isSelected(r.tool)" :disabled="zo.running.value || r.tool === 0"
											   :title="r.tool === 0 ? $t('plugins.indxTuner.zoff.alwaysRef') : undefined"
											   @change="zo.setSelected(r.tool, ($event.target as HTMLInputElement).checked)" />
									</td>
									<td class="text-no-wrap">
										<span class="d-inline-flex align-center ga-2">
											<ToolGlyph :scale="0.3" /> T{{ r.tool }}
											<span v-if="r.tool === 0" class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.zoff.reference") }}</span>
										</span>
									</td>
									<td class="text-right indx-mono">{{ f3(r.trigger) }}</td>
									<td class="text-right indx-mono" :class="{ 'text-warning': r.spread !== null && r.spread > 0.02 }">{{ f3(r.spread) }}</td>
									<td class="text-right indx-mono">{{ s3(r.now) }}</td>
									<td class="text-right indx-mono text-primary">{{ s3(r.measured) }}</td>
									<td class="text-right indx-mono" :class="{ 'text-warning': r.change !== null && Math.abs(r.change) > 0.002 }">{{ r.tool === 0 ? "" : s3(r.change) }}</td>
								</tr>
							</tbody>
						</v-table>
						<div class="mt-3">
							<v-btn color="primary" :disabled="zo.running.value || zo.saveCodes.value.length === 0" @click="saveOpen = true">
								{{ $t("plugins.indxTuner.zoff.saveAll") }}
							</v-btn>
						</div>
						<div class="text-caption text-medium-emphasis mt-2">{{ $t("plugins.indxTuner.zoff.saveNote") }}</div>
					</v-card-text>
				</v-card>
			</v-col>
			<v-col cols="12" md="5">
				<v-card variant="outlined">
					<v-card-title class="text-subtitle-1">{{ $t("plugins.indxTuner.speed.run") }}</v-card-title>
					<v-card-text>
						<div v-if="zo.startBlockers.value.length === 0" class="text-success mb-1">✔ {{ $t("plugins.indxTuner.clamp.ready") }}</div>
						<div v-for="b in zo.startBlockers.value" :key="b" class="text-error mb-1">✖ {{ b }}</div>
						<div v-if="bedOn" :class="bedStable ? 'text-success' : 'text-warning'" class="mb-3">{{ bedStable ? "✔" : "!" }} {{ bedText }}</div>
						<v-row dense>
							<v-col cols="6"><v-text-field v-model.number="zo.settings.probes" type="number" :label="$t('plugins.indxTuner.zoff.probes')" density="compact" variant="outlined" hide-details /></v-col>
							<v-col cols="6"><v-text-field v-model.number="zo.settings.startZ" type="number" :label="$t('plugins.indxTuner.zoff.startZ')" suffix="mm" density="compact" variant="outlined" hide-details /></v-col>
						</v-row>
						<div class="d-flex align-center ga-3 mt-3">
							<v-btn-toggle v-model="zo.settings.hot" mandatory divided density="compact" variant="outlined" color="primary">
								<v-btn :value="false" size="small">{{ $t("plugins.indxTuner.clamp.cold") }}</v-btn>
								<v-btn :value="true" size="small">{{ $t("plugins.indxTuner.clamp.hot") }}</v-btn>
							</v-btn-toggle>
							<v-text-field v-if="zo.settings.hot" v-model.number="zo.settings.hotTemp" type="number" :label="$t('plugins.indxTuner.clamp.hotTemp')" suffix="°C"
										  density="compact" variant="outlined" hide-details style="max-width: 130px" />
						</div>
						<div class="mt-4 d-flex ga-2 align-center">
							<v-btn color="primary" prepend-icon="mdi-play" :disabled="zo.startBlockers.value.length > 0 || zo.running.value" @click="confirmOpen = true">
								{{ allSelected ? $t("plugins.indxTuner.zoff.measureAll") : $t("plugins.indxTuner.zoff.measureN", { n: zo.selectedTools.value.length }) }}
							</v-btn>
							<v-btn v-if="zo.running.value" color="error" variant="tonal" prepend-icon="mdi-stop" @click="zo.stop()">{{ $t("plugins.indxTuner.clamp.stop") }}</v-btn>
						</div>
						<div class="text-caption text-medium-emphasis mt-1">{{ whichText }}</div>
						<div v-if="zo.running.value" class="d-flex align-center ga-2 mt-2">
							<v-progress-circular indeterminate size="16" width="2" color="primary" /><span class="text-body-2">{{ zo.status.value }}</span>
						</div>
						<div class="text-caption text-medium-emphasis mt-2">{{ $t("plugins.indxTuner.zoff.how", { x: probeX, y: probeY }) }}</div>
					</v-card-text>
				</v-card>
			</v-col>
		</v-row>

		<v-dialog v-model="confirmOpen" max-width="520">
			<v-card>
				<v-card-title>{{ $t("plugins.indxTuner.zoff.confirmTitle") }}</v-card-title>
				<v-card-text>{{ $t("plugins.indxTuner.zoff.confirmText", { n: zo.settings.probes, tools: whichText }) }}</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="confirmOpen = false">{{ $t("plugins.indxTuner.save.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="confirmOpen = false; zo.start()">{{ $t("plugins.indxTuner.recovery.go") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<v-dialog v-model="saveOpen" max-width="520">
			<v-card>
				<v-card-title>{{ $t("plugins.indxTuner.zoff.saveTitle") }}</v-card-title>
				<v-card-text>
					<div class="mb-2">{{ $t("plugins.indxTuner.zoff.saveText") }}</div>
					<pre class="indx-mono indx-code">{{ zo.saveCodes.value.join("\n") }}</pre>
				</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="saveOpen = false">{{ $t("plugins.indxTuner.save.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="saveOpen = false; zo.saveAll()">{{ $t("plugins.indxTuner.macros.write") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import ToolGlyph from "./ToolGlyph.vue";
import { useIndxTuner } from "./useIndxTuner";
import { useZOffset } from "./useZOffset";

const machineStore = useMachineStore();
const tuner = useIndxTuner();
const zo = useZOffset();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const confirmOpen = ref(false);
const saveOpen = ref(false);

const probeX = computed(() => tuner.currentNumber("INDX_probe_x") ?? 0);
const probeY = computed(() => tuner.currentNumber("INDX_probe_y") ?? 0);

/** Every dock tool: its result from the last run, else its present offset */
const tableRows = computed(() => {
	const tools: any[] = (machineStore.model as any).tools ?? [];
	return tuner.docks.value.numbers.map(tool => {
		const measured = zo.rows.value.find(r => r.tool === tool);
		if (measured) {
			return measured;
		}
		const z = tools.find(x => x?.number === tool)?.offsets?.[2];
		return { tool, trigger: null, spread: null, now: typeof z === "number" ? z : null, measured: null, change: null, n: 0 };
	});
});

const isSelected = (tool: number) => zo.selectedTools.value.includes(tool);
const allSelected = computed(() => zo.selectedTools.value.length === tuner.docks.value.numbers.length);
const someSelected = computed(() => !allSelected.value && zo.selectedTools.value.length > 1);
const whichText = computed(() => {
	const others = zo.selectedTools.value.filter(t => t !== 0).map(t => `T${t}`);
	return others.length === 0 ? t("zoff.whichOnlyRef") : t("zoff.which", { tools: others.join(", ") });
});

/** The bed heater: at its set temperature, or not heated */
const bed = computed(() => {
	const heat: any = (machineStore.model as any).heat;
	const h = heat?.bedHeaters?.[0];
	const heater = typeof h === "number" && h >= 0 ? heat?.heaters?.[h] : null;
	return heater ? { current: Number(heater.current), active: Number(heater.active), state: String(heater.state) } : null;
});
/** Only a bed that is switched on is reported: warned about while it is not yet at its temperature */
const bedOn = computed(() => bed.value !== null && bed.value.state === "active" && bed.value.active > 0);
const bedStable = computed(() => bedOn.value && Math.abs(bed.value!.current - bed.value!.active) < 1.5);
const bedText = computed(() => bed.value === null ? t("zoff.noBed")
	: bedStable.value ? t("zoff.bedOk", { c: bed.value.current.toFixed(1) })
		: t("zoff.bedNotStable", { c: bed.value.current.toFixed(1), a: bed.value.state === "active" ? bed.value.active : 0 }));

const f3 = (v: number | null) => v === null ? "" : v.toFixed(3);
const s3 = (v: number | null) => v === null ? "" : (v >= 0 ? "+" : "") + v.toFixed(3);
</script>

<style scoped>
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
.indx-check {
	width: 16px;
	height: 16px;
	accent-color: rgb(var(--v-theme-primary));
	cursor: pointer;
	vertical-align: middle;
}
.indx-off td:not(:first-child) {
	opacity: 0.4;
}
.indx-code {
	background: rgba(var(--v-theme-on-surface), 0.06);
	padding: 8px 10px;
	border-radius: 4px;
	white-space: pre-wrap;
}
</style>
