<template>
	<div>
		<v-alert v-if="rec.reason.value" type="error" variant="tonal" density="compact" class="mb-3">{{ rec.reason.value }}</v-alert>
		<v-alert v-if="rec.result.value" :type="rec.result.value.type" variant="tonal" density="compact" class="mb-3" closable
				 @click:close="rec.result.value = null">
			{{ rec.result.value.text }}
		</v-alert>

		<!-- What the printer reports -->
		<v-card variant="outlined" class="mb-4">
			<v-card-title class="text-subtitle-1 d-flex align-center">
				{{ $t("plugins.indxTuner.recovery.reports") }}
				<v-spacer />
				<v-btn size="small" variant="text" prepend-icon="mdi-refresh" :loading="rec.busy.value" :disabled="!rec.canAct.value" @click="rec.read()">
					{{ $t("plugins.indxTuner.recovery.readAgain") }}
				</v-btn>
			</v-card-title>
			<v-table v-if="r" density="compact">
				<tbody>
					<tr>
						<td>INDX_State</td>
						<td class="indx-mono">{{ r.state ?? "?" }}</td>
						<td class="text-medium-emphasis">{{ stateText }}</td>
					</tr>
					<tr>
						<td>{{ $t("plugins.indxTuner.recovery.selected") }}</td>
						<td class="indx-mono">{{ r.selected >= 0 ? `T${r.selected}` : $t("plugins.indxTuner.recovery.none") }}</td>
						<td />
					</tr>
					<tr>
						<td>{{ $t("plugins.indxTuner.recovery.loadCell") }}</td>
						<td class="indx-mono">{{ r.grams === null ? "?" : `${Math.round(r.grams)} g` }}</td>
						<td class="text-medium-emphasis">{{ lcText }}</td>
					</tr>
					<tr>
						<td>{{ $t("plugins.indxTuner.recovery.position") }}</td>
						<td class="indx-mono">{{ r.x === null ? "?" : `X${r.x.toFixed(1)} Y${r.y?.toFixed(1)}` }}</td>
						<td />
					</tr>
				</tbody>
			</v-table>
			<v-card-text>
				<div v-if="r" :class="verdictClass" class="font-weight-medium">{{ $t(`plugins.indxTuner.recovery.verdict.${r.verdict}`, { tool: r.state, g: Math.round(r.grams ?? 0), min: r.minG }) }}</div>
				<div v-else class="text-medium-emphasis">{{ $t("plugins.indxTuner.recovery.notRead") }}</div>
				<div class="text-caption text-medium-emphasis mt-1">{{ $t("plugins.indxTuner.recovery.look") }}</div>
			</v-card-text>
		</v-card>

		<!-- Actions -->
		<div class="indx-recover mb-4">
			<v-card variant="outlined" :class="{ 'indx-rec': recommended === 'remove' }">
				<v-card-text>
					<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.recovery.remove.title") }}</div>
					<div class="text-body-2 text-medium-emphasis mb-3">{{ $t("plugins.indxTuner.recovery.remove.text") }}</div>
					<v-btn color="primary" :variant="recommended === 'remove' ? 'flat' : 'tonal'" :disabled="!rec.canAct.value" @click="ask('remove')">
						{{ $t("plugins.indxTuner.recovery.remove.button") }}
					</v-btn>
				</v-card-text>
			</v-card>
			<v-card variant="outlined" :class="{ 'indx-rec': recommended === 'reset' }">
				<v-card-text>
					<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.recovery.reset.title") }}</div>
					<div class="text-body-2 text-medium-emphasis mb-3">{{ $t("plugins.indxTuner.recovery.reset.text") }}</div>
					<v-btn color="primary" :variant="recommended === 'reset' ? 'flat' : 'tonal'" :disabled="!rec.canAct.value" @click="ask('reset')">
						{{ $t("plugins.indxTuner.recovery.reset.button") }}
					</v-btn>
				</v-card-text>
			</v-card>
			<v-card variant="outlined" :class="{ 'indx-rec': recommended === 'seat' }">
				<v-card-text>
					<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.recovery.seat.title") }}</div>
					<div class="text-body-2 text-medium-emphasis mb-3">{{ $t("plugins.indxTuner.recovery.seat.text") }}</div>
					<div class="d-flex align-center ga-2">
						<v-select v-model="seatTool" :items="toolItems" density="compact" variant="outlined" hide-details style="max-width: 100px" />
						<v-btn color="primary" :variant="recommended === 'seat' ? 'flat' : 'tonal'" :disabled="!rec.canAct.value" @click="ask('seat')">
							{{ $t("plugins.indxTuner.recovery.seat.button") }}
						</v-btn>
					</div>
				</v-card-text>
			</v-card>
		</div>

		<v-alert type="info" variant="tonal" density="compact">
			{{ $t("plugins.indxTuner.recovery.after") }}
			<template #append>
				<v-btn size="small" variant="tonal" :disabled="!rec.canAct.value" @click="ask('home')">{{ $t("plugins.indxTuner.recovery.homeXY") }}</v-btn>
			</template>
		</v-alert>

		<!-- Confirm -->
		<v-dialog v-model="confirmOpen" max-width="520">
			<v-card>
				<v-card-title>{{ confirmTitle }}</v-card-title>
				<v-card-text>{{ confirmText }}</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="confirmOpen = false">{{ $t("plugins.indxTuner.save.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="confirm">{{ $t("plugins.indxTuner.recovery.go") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import i18n from "@/i18n";

import { useIndxTuner } from "./useIndxTuner";
import { useRecovery } from "./useRecovery";

const rec = useRecovery();
const tuner = useIndxTuner();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const r = computed(() => rec.reading.value);

const stateText = computed(() => {
	const s = r.value?.state;
	return s === -1 ? t("recovery.stateEmpty") : s === 99 ? t("recovery.stateUnknown") : s !== null && s !== undefined ? t("recovery.stateTool", { tool: s }) : "";
});

const lcText = computed(() => {
	const v = r.value;
	if (!v || v.grams === null) {
		return t("recovery.lcUnknown");
	}
	return t(v.refExact ? "recovery.lcRef" : "recovery.lcApprox", { tool: v.refTool });
});

const verdictClass = computed(() => r.value?.verdict === "emptyOk" || r.value?.verdict === "toolOk" ? "text-success" : r.value?.verdict === "unknown" ? "" : "text-error");

/** The action that matches the reading */
const recommended = computed(() => {
	switch (r.value?.verdict) {
		case "toolButEmptyState": return "remove";
		case "weakTool": return "remove";
		case "emptyButToolState": return "reset";
		default: return "";
	}
});

const toolItems = computed(() => tuner.docks.value.numbers.map(n => ({ title: `T${n}`, value: n })));
const seatTool = ref<number>(0);
watch(() => r.value?.state, s => {
	if (typeof s === "number" && s >= 0 && s !== 99) {
		seatTool.value = s;
	}
});

const confirmOpen = ref(false);
const pending = ref<"remove" | "reset" | "seat" | "home">("reset");
const confirmTitle = computed(() => t(pending.value === "home" ? "recovery.homeXY" : `recovery.${pending.value}.title`));
const confirmText = computed(() => t(pending.value === "home" ? "recovery.homeConfirm" : `recovery.${pending.value}.confirm`, { tool: seatTool.value }));

function ask(kind: "remove" | "reset" | "seat" | "home"): void {
	pending.value = kind;
	confirmOpen.value = true;
}

function confirm(): void {
	confirmOpen.value = false;
	if (pending.value === "home") {
		void rec.homeXY();
	} else {
		void rec.act(pending.value, pending.value === "seat" ? seatTool.value : undefined);
	}
}

onMounted(() => {
	if (rec.reading.value === null) {
		void rec.read();
	}
});
</script>

<style scoped>
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
.indx-recover {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 12px;
}
.indx-rec {
	border-color: rgb(var(--v-theme-primary)) !important;
	box-shadow: 0 0 0 1px rgb(var(--v-theme-primary)) inset;
}
</style>
