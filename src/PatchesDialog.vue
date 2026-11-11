<template>
	<v-dialog :model-value="modelValue" max-width="860" scrollable @update:model-value="close">
		<v-card>
			<v-card-title class="pt-4">{{ revertMode ? $t("plugins.indxTuner.patch.revertTitle") : $t("plugins.indxTuner.patch.title") }}</v-card-title>
			<!-- steps -->
			<div class="d-flex align-center px-6 pb-2 indx-steps">
				<template v-for="(s, i) in steps" :key="s">
					<div class="d-flex align-center ga-2" :class="{ 'text-medium-emphasis': i > step }">
						<v-avatar size="24" :color="i < step ? 'success' : i === step ? 'primary' : 'grey-darken-2'" class="text-caption">
							<v-icon v-if="i < step" size="16">mdi-check</v-icon><span v-else>{{ i + 1 }}</span>
						</v-avatar>
						<span class="text-body-2">{{ $t(`plugins.indxTuner.patch.step.${s}`) }}</span>
					</div>
					<v-divider v-if="i < steps.length - 1" class="mx-3" />
				</template>
			</div>

			<v-card-text style="min-height: 260px">
				<!-- 1 choose -->
				<template v-if="step === 0">
					<v-alert type="error" variant="tonal" density="compact" class="mb-3">
						<b>{{ $t("plugins.indxTuner.patch.warnTitle") }}</b> {{ $t("plugins.indxTuner.patch.warnText") }}
					</v-alert>
					<v-table density="compact">
						<thead>
							<tr>
								<th style="width: 52px" />
								<th>{{ $t("plugins.indxTuner.patch.colPatch") }}</th>
								<th>{{ $t("plugins.indxTuner.patch.colUnlocks") }}</th>
								<th>{{ $t("plugins.indxTuner.patch.colStatus") }}</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="p in PATCHES" :key="p.id">
								<td>
									<v-switch v-if="!revertMode" :model-value="isOn(p.id)" :disabled="status(p.id) !== 'available'" color="primary" density="compact"
											  hide-details inset class="indx-small-switch" @update:model-value="toggle(p.id)" />
									<v-switch v-else :model-value="chosen.includes(p.id)" :disabled="status(p.id) !== 'applied'" color="primary" density="compact"
											  hide-details inset class="indx-small-switch" @update:model-value="toggle(p.id)" />
								</td>
								<td class="py-2">
									{{ $t(`plugins.indxTuner.patch.p.${p.id}.title`) }}
									<v-chip v-if="p.advanced" size="x-small" color="warning" variant="tonal" class="ml-1">{{ $t("plugins.indxTuner.patch.advanced") }}</v-chip>
									<div class="text-caption text-medium-emphasis">{{ $t(`plugins.indxTuner.patch.p.${p.id}.text`) }}</div>
									<div v-if="status(p.id) === 'incompatible'" class="text-caption text-error">{{ $t("plugins.indxTuner.patch.incompatibleText") }}</div>
									<div v-if="status(p.id) === 'official'" class="text-caption text-info">{{ $t("plugins.indxTuner.patch.officialText") }}</div>
								</td>
								<td class="text-body-2">{{ $t(`plugins.indxTuner.patch.p.${p.id}.unlocks`) }}</td>
								<td><v-chip size="x-small" :color="statusColor(status(p.id))" variant="tonal">{{ $t(`plugins.indxTuner.patch.status.${status(p.id)}`) }}</v-chip></td>
							</tr>
						</tbody>
					</v-table>
				</template>

				<!-- 2 preview -->
				<template v-else-if="step === 1">
					<v-chip-group v-model="tab" mandatory selected-class="text-primary" class="mb-2">
						<v-chip v-for="(f, i) in files" :key="f.file" :value="i" size="small" variant="outlined">{{ f.file }}</v-chip>
					</v-chip-group>
					<pre v-if="files[tab]" class="indx-diff"><span v-for="(d, i) in shortDiff(files[tab].before, files[tab].after)" :key="i"
						:class="`indx-diff-line indx-diff--${d.type}`">{{ d.type === "add" ? "+ " : d.type === "del" ? "- " : d.type === "gap" ? "" : "  " }}{{ d.text }}</span></pre>
				</template>

				<!-- 3 confirm -->
				<template v-else-if="step === 2">
					<div class="text-warning text-subtitle-1 mb-2"><v-icon color="warning" class="mr-1">mdi-alert</v-icon>{{ revertMode ? $t("plugins.indxTuner.patch.confirmRevert") : $t("plugins.indxTuner.patch.confirmTitle") }}</div>
					<ul class="pl-5 mb-3 text-body-2">
						<li>{{ $t("plugins.indxTuner.patch.c1", { n: files.length }) }}</li>
						<li>{{ $t("plugins.indxTuner.patch.c2", { dir: tuner.sysDir() }) }}</li>
						<template v-if="!revertMode">
							<li>{{ $t("plugins.indxTuner.patch.c3") }}</li>
							<li>{{ $t("plugins.indxTuner.patch.c4") }}</li>
							<li>{{ $t("plugins.indxTuner.patch.c5") }}</li>
						</template>
						<li>{{ $t("plugins.indxTuner.patch.c6") }}</li>
					</ul>
					<v-alert v-if="blocked.length > 0" type="error" variant="tonal" density="compact" class="mb-3">
						<div v-for="b in blocked" :key="b">{{ b }}</div>
					</v-alert>
					<v-alert v-else type="success" variant="tonal" density="compact" class="mb-3">{{ $t("plugins.indxTuner.patch.checksOk") }}</v-alert>
					<v-checkbox v-if="!revertMode" v-model="understood" density="compact" hide-details :label="$t('plugins.indxTuner.patch.understand')" />
				</template>

				<!-- 4 done -->
				<template v-else>
					<v-alert v-if="pt.busy.value" type="info" variant="tonal" density="compact">{{ $t("plugins.indxTuner.patch.working") }}</v-alert>
					<v-alert v-else-if="pt.result.value" :type="pt.result.value.type" variant="tonal" density="compact">{{ pt.result.value.text }}</v-alert>
				</template>
			</v-card-text>

			<v-card-actions class="px-6 pb-4">
				<v-spacer />
				<template v-if="step < 3">
					<v-btn variant="text" @click="step === 0 ? close() : step--">{{ step === 0 ? $t("plugins.indxTuner.macros.cancel") : $t("plugins.indxTuner.patch.back") }}</v-btn>
					<v-btn v-if="step === 0" color="primary" variant="flat" :disabled="chosenIds.length === 0" @click="toPreview">
						{{ chosenIds.length === 0 ? $t("plugins.indxTuner.patch.nothing") : $t("plugins.indxTuner.patch.preview", { n: chosenIds.length }, chosenIds.length) }}
					</v-btn>
					<v-btn v-else-if="step === 1" color="primary" variant="flat" @click="step = 2">{{ $t("plugins.indxTuner.patch.continue") }}</v-btn>
					<v-btn v-else color="primary" variant="flat" :disabled="blocked.length > 0 || (!revertMode && !understood)" @click="go">
						{{ revertMode ? $t("plugins.indxTuner.patch.doRevert") : $t("plugins.indxTuner.patch.doApply") }}
					</v-btn>
				</template>
				<v-btn v-else color="primary" variant="flat" :disabled="pt.busy.value" @click="close">{{ $t("plugins.indxTuner.patch.close") }}</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
/** Step by step: choose patches, preview the changed lines, confirm (with the checks), then the result */
import { computed, ref, watch } from "vue";

import { diffLines } from "./model/diff";
import { PATCHES, type PatchStatus } from "./model/patches";
import { useIndxTuner } from "./useIndxTuner";
import { usePatches } from "./usePatches";

const props = defineProps<{ modelValue: boolean; revertMode?: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

const tuner = useIndxTuner();
const pt = usePatches();
const steps = ["choose", "preview", "confirm", "done"];
const step = ref(0);
const chosen = ref<string[]>([]);
const tab = ref(0);
const understood = ref(false);
const files = ref<Array<{ file: string; before: string; after: string }>>([]);
const blocked = ref<string[]>([]);

const status = (id: string): PatchStatus => pt.statuses.value.get(id) ?? "incompatible";
const isOn = (id: string) => status(id) === "applied" || status(id) === "official" || chosen.value.includes(id);
const chosenIds = computed(() => chosen.value.filter(id => status(id) === (props.revertMode ? "applied" : "available")));
const statusColor = (s: PatchStatus) => s === "applied" ? "success" : s === "official" ? "info" : s === "incompatible" ? "error" : undefined;

function toggle(id: string): void {
	chosen.value = chosen.value.includes(id) ? chosen.value.filter(x => x !== id) : [...chosen.value, id];
}

watch(() => props.modelValue, open => {
	if (open) {
		step.value = 0;
		understood.value = false;
		tab.value = 0;
		// revert: everything applied is chosen; apply: nothing until switched on
		chosen.value = props.revertMode ? PATCHES.filter(p => status(p.id) === "applied").map(p => p.id) : [];
	}
});

function toPreview(): void {
	files.value = pt.preview(chosenIds.value, props.revertMode);
	tab.value = 0;
	step.value = 1;
}

watch(step, s => {
	if (s === 2) {
		blocked.value = pt.blockers();
	}
});

async function go(): Promise<void> {
	step.value = 3;
	await (props.revertMode ? pt.revert(chosenIds.value) : pt.apply(chosenIds.value));
}

function close(): void {
	if (!pt.busy.value) {
		emit("update:modelValue", false);
	}
}

/** The diff with only the changed lines and two lines around them */
function shortDiff(before: string, after: string): Array<{ type: string; text: string }> {
	const d = diffLines(before, after);
	const keep = d.map((x, i) => d.slice(Math.max(0, i - 2), i + 3).some(y => y.type !== "same"));
	const out: Array<{ type: string; text: string }> = [];
	d.forEach((x, i) => {
		if (keep[i]) {
			out.push(x);
		} else if (i > 0 && keep[i - 1]) {
			out.push({ type: "gap", text: "  …" });
		}
	});
	return out;
}
</script>

<style scoped>
.indx-steps .v-divider {
	flex: 1 1 auto;
}
.indx-small-switch {
	transform: scale(0.8);
	transform-origin: left center;
}
.indx-diff {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	font-size: 12px;
	line-height: 1.5;
	background: rgba(var(--v-theme-on-surface), 0.04);
	border-radius: 4px;
	padding: 6px 0;
	max-height: 420px;
	overflow: auto;
	white-space: pre;
}
.indx-diff-line {
	display: block;
	padding: 0 10px;
}
.indx-diff--add {
	background: rgba(var(--v-theme-success), 0.15);
}
.indx-diff--del {
	background: rgba(var(--v-theme-error), 0.15);
}
.indx-diff--gap {
	opacity: 0.5;
}
</style>
