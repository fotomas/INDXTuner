<template>
	<div>
		<v-alert v-if="tuner.macroResult.value" :type="tuner.macroResult.value.type" variant="tonal" density="compact" class="mb-3" closable
				 @click:close="tuner.macroResult.value = null">
			{{ tuner.macroResult.value.text }}
		</v-alert>
		<!-- Loaded: config.g runs INDX_variables.g, globals on the printer -->
		<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.files.loadedTitle") }}</div>
		<v-card variant="outlined" class="mb-4">
			<v-card-text class="py-2">
				<div class="d-flex align-center ga-2">
					<v-icon size="small" :color="loaded.config === true ? 'success' : loaded.config === false ? 'error' : 'warning'">
						{{ loaded.config === true ? "mdi-check" : loaded.config === false ? "mdi-close-circle" : "mdi-help-circle" }}
					</v-icon>
					<span>{{ $t(`plugins.indxTuner.files.${loaded.config === true ? "configOk" : loaded.config === false ? "configMissing" : "configUnknown"}`) }}</span>
				</div>
				<div class="d-flex align-center ga-2 mt-1">
					<v-icon size="small" :color="loaded.globals ? 'success' : 'error'">{{ loaded.globals ? "mdi-check" : "mdi-close-circle" }}</v-icon>
					<span>{{ $t(`plugins.indxTuner.files.${loaded.globals ? "globalsOk" : "globalsMissing"}`) }}</span>
				</div>
			</v-card-text>
		</v-card>

		<!-- The files of the INDX release -->
		<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.files.filesTitle") }}</div>
		<v-card variant="outlined" class="mb-4">
			<div class="indx-files pa-2">
				<div v-for="f in tuner.setupFiles.value" :key="f.file" class="d-flex align-center ga-1">
					<v-icon size="small" :color="f.present ? 'success' : f.kind === 'optional' ? undefined : 'error'">
						{{ f.present ? "mdi-check" : f.kind === "optional" ? "mdi-circle-outline" : "mdi-close-circle" }}
					</v-icon>
					<span class="indx-mono" :class="{ 'text-error': !f.present && f.kind !== 'optional' }">{{ f.file }}</span>
					<span v-if="f.kind !== 'indx'" class="text-caption text-medium-emphasis">{{ $t(`plugins.indxTuner.files.${f.kind}`) }}</span>
				</div>
			</div>
		</v-card>

		<!-- Patches for INDX Tuner: summary here, everything else in the dialog -->
		<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.patch.cardTitle") }}</div>
		<v-card variant="outlined" class="mb-4">
			<v-card-text class="py-3">
				<div class="mb-2">{{ $t("plugins.indxTuner.patch.cardText") }}</div>
				<div class="d-flex flex-wrap align-center ga-2 mb-3">
					<v-chip size="small" color="success" variant="tonal">{{ $t("plugins.indxTuner.patch.nApplied", { n: pt.counts.value.applied }) }}</v-chip>
					<v-chip size="small" variant="tonal">{{ $t("plugins.indxTuner.patch.nAvailable", { n: pt.counts.value.available }) }}</v-chip>
					<span v-if="pt.lastBackup.value" class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.patch.backupAt", { dir: pt.lastBackup.value }) }}</span>
				</div>
				<v-alert v-if="pt.result.value && !patchOpen" :type="pt.result.value.type" variant="tonal" density="compact" class="mb-3" closable
						 @click:close="pt.result.value = null">{{ pt.result.value.text }}</v-alert>
				<v-btn color="primary" variant="flat" class="mr-2" :disabled="disabled" @click="openPatches(false)">{{ $t("plugins.indxTuner.patch.open") }}</v-btn>
				<v-btn color="primary" variant="outlined" :disabled="disabled || pt.counts.value.applied === 0" @click="openPatches(true)">
					{{ $t("plugins.indxTuner.patch.revert") }}
				</v-btn>
			</v-card-text>
		</v-card>
		<PatchesDialog v-model="patchOpen" :revert-mode="patchRevert" />

		<!-- Macro calls -->
		<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.files.brokenTitle") }}</div>
		<v-alert v-if="tuner.broken.value.length === 0" type="success" icon="mdi-check" variant="tonal" density="compact" class="mb-4">
			{{ $t("plugins.indxTuner.files.brokenNone") }}
		</v-alert>
		<template v-else>
		<v-alert v-for="b in tuner.broken.value" :key="b.target" type="error" variant="tonal" density="compact" class="mb-2">
			{{ $t("plugins.indxTuner.files.brokenRow", { target: b.target, callers: b.callers.join(", ") }) }}
			<template v-if="generatable(b.target)" #append>
				<v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-file-plus-outline" :disabled="disabled"
					   :loading="tuner.macroBusy.value" @click="openGenerate(generatable(b.target)!)">
					{{ $t("plugins.indxTuner.macros.generate") }}
				</v-btn>
			</template>
		</v-alert>
		</template>
		<div v-if="tuner.broken.value.length > 0" class="mb-4" />

		<!-- Called macros the plugin can create (shown once they exist, too) -->
		<template v-if="tuner.indxMacros.value.some(m => m.present)">
			<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.macros.indxTitle") }}</div>
			<v-card variant="outlined" class="mb-4">
				<v-table density="compact">
					<tbody>
						<tr v-for="m in tuner.indxMacros.value.filter(x => x.present)" :key="m.file">
							<td class="indx-mono">{{ m.file }}</td>
							<td>
								<v-icon size="small" color="success">mdi-check</v-icon>
								<span class="ml-1">{{ $t("plugins.indxTuner.macros.present") }}</span>
							</td>
							<td class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.files.calledBy", { callers: m.callers.join(", ") }) }}</td>
						</tr>
					</tbody>
				</v-table>
			</v-card>
		</template>

		<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.macros.toolTitle") }}</div>
		<v-alert v-if="tuner.docks.value.numbers.length === 0 && tuner.loadedOnce.value" type="info" variant="tonal" density="compact" class="mb-3">
			{{ $t("plugins.indxTuner.docks.noTools") }}
		</v-alert>
		<v-alert v-else-if="broken.length === 0 && tuner.staleMacros.value.length === 0 && tuner.loadedOnce.value" type="success" icon="mdi-check" variant="tonal" density="compact" class="mb-3">
			{{ $t("plugins.indxTuner.macros.allGood") }}
		</v-alert>

		<v-card v-if="tuner.docks.value.numbers.length > 0" variant="outlined" class="mb-3">
			<v-table density="compact">
				<thead>
					<tr>
						<th>{{ $t("plugins.indxTuner.macros.tool") }}</th>
						<th v-for="k in MACRO_KINDS" :key="k">{{ k }}</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="tool in tuner.docks.value.numbers" :key="tool">
						<td class="font-weight-medium">T{{ tool }}</td>
						<td v-for="k in MACRO_KINDS" :key="k">
							<div class="d-flex align-center ga-1">
								<v-icon size="small" :color="statusColor(check(tool, k).status)">{{ statusIcon(check(tool, k).status) }}</v-icon>
								<span class="indx-mono">{{ check(tool, k).file }}</span>
								<span v-if="check(tool, k).status !== 'ok'" class="text-caption" :class="`text-${statusColor(check(tool, k).status)}`">
									{{ $t(`plugins.indxTuner.macros.${check(tool, k).status}`) }}
								</span>
								<v-btn v-if="check(tool, k).status !== 'ok'" size="x-small" variant="text" :disabled="disabled" @click="openFix([check(tool, k)])">
									{{ $t("plugins.indxTuner.macros.fix") }}
								</v-btn>
							</div>
							<div v-if="check(tool, k).detail" class="text-caption text-medium-emphasis indx-mono">{{ check(tool, k).detail }}</div>
						</td>
					</tr>
				</tbody>
			</v-table>
		</v-card>

		<div v-if="tuner.staleMacros.value.length > 0" class="mb-3">
			<div class="text-body-2">{{ $t("plugins.indxTuner.macros.stale") }}</div>
			<div class="indx-mono text-body-2">{{ tuner.staleMacros.value.join(", ") }}</div>
		</div>

		<div class="d-flex">
			<v-spacer />
			<v-btn color="primary" variant="tonal" prepend-icon="mdi-auto-fix" :disabled="disabled || broken.length === 0" :loading="tuner.macroBusy.value"
				   @click="openFix(broken)">
				{{ $t("plugins.indxTuner.macros.fixAll") }}
			</v-btn>
		</div>

		<!-- Generate a missing INDX macro: preview and confirm -->
		<v-dialog v-model="generateOpen" max-width="760">
			<v-card v-if="generating">
				<v-card-title>{{ $t("plugins.indxTuner.macros.generateTitle", { file: generating.file }) }}</v-card-title>
				<v-card-text>
					<div class="mb-2">{{ $t("plugins.indxTuner.macros.generateText", { file: tuner.sysDir() + generating.file }) }}</div>
					<pre class="indx-diff">{{ generating.template }}</pre>
				</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="generateOpen = false">{{ $t("plugins.indxTuner.macros.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="confirmGenerate">{{ $t("plugins.indxTuner.macros.write") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Preview and confirm -->
		<v-dialog v-model="fixOpen" max-width="720">
			<v-card>
				<v-card-title>{{ $t("plugins.indxTuner.macros.confirmTitle") }}</v-card-title>
				<v-card-text>
					<div class="mb-2">{{ $t("plugins.indxTuner.macros.confirmText") }}</div>
					<div v-for="f in fixPreview" :key="f.file" class="mb-3">
						<div class="indx-mono font-weight-medium">{{ tuner.sysDir() }}{{ f.file }}</div>
						<pre class="indx-diff"><span v-for="(d, i) in f.diff" :key="i" :class="`indx-diff-line indx-diff--${d.type}`">{{ d.type === "add" ? "+ " : d.type === "del" ? "- " : "  " }}{{ d.text }}</span></pre>
					</div>
				</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="fixOpen = false">{{ $t("plugins.indxTuner.macros.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="confirmFix">{{ $t("plugins.indxTuner.macros.write") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { diffLines } from "./model/diff";
import { INDX_MACROS, type IndxMacro } from "./model/indxMacros";
import { MACRO_KINDS, macroTemplate, type MacroCheck, type MacroKind, type MacroStatus } from "./model/toolMacros";
import { useIndxTuner } from "./useIndxTuner";
import PatchesDialog from "./PatchesDialog.vue";
import { patchRequest, usePatches } from "./usePatches";

defineProps<{ disabled: boolean }>();

const tuner = useIndxTuner();
const pt = usePatches();
const patchOpen = ref(false);
const patchRevert = ref(false);
function openPatches(revert: boolean): void {
	patchRevert.value = revert;
	patchOpen.value = true;
}
// "Patches…" on another page: open the dialog once this page shows
const takeRequest = () => {
	if (patchRequest.value) {
		patchRequest.value = false;
		openPatches(false);
	}
};
onMounted(takeRequest);
watch(patchRequest, takeRequest);

const byKey = computed(() => new Map(tuner.macroChecks.value.map(c => [`${c.kind}${c.tool}`, c])));
function check(tool: number, kind: MacroKind): MacroCheck {
	return byKey.value.get(`${kind}${tool}`) ?? { kind, tool, file: `${kind}${tool}.g`, status: "missing", detail: "" };
}

const broken = computed(() => tuner.macroChecks.value.filter(c => c.status !== "ok"));

const loaded = computed(() => tuner.loadedChecks.value);

/** A missing called macro the plugin has a skeleton for */
function generatable(target: string): IndxMacro | undefined {
	const t = target.toLowerCase();
	return INDX_MACROS.find(m => m.file.toLowerCase() === t);
}

function statusIcon(s: MacroStatus): string {
	return s === "ok" ? "mdi-check" : (s === "extra" || s === "comment") ? "mdi-alert" : "mdi-close-circle";
}

function statusColor(s: MacroStatus): string {
	return s === "ok" ? "success" : (s === "extra" || s === "comment") ? "warning" : "error";
}

const fixOpen = ref(false);
const fixing = ref<MacroCheck[]>([]);
const fixPreview = computed(() => fixing.value.map(c => ({
	file: c.file,
	diff: diffLines((tuner.macroTexts.value.get(c.file) ?? "").replace(/\r?\n$/, ""), macroTemplate(c.kind, c.tool).replace(/\n$/, "")),
})));

function openFix(checks: MacroCheck[]): void {
	fixing.value = checks;
	fixOpen.value = true;
}

const generateOpen = ref(false);
const generating = ref<IndxMacro | null>(null);

function openGenerate(m: IndxMacro): void {
	generating.value = m;
	generateOpen.value = true;
}

function confirmGenerate(): void {
	generateOpen.value = false;
	if (generating.value !== null) {
		void tuner.generateIndxMacro(generating.value);
	}
}

function confirmFix(): void {
	fixOpen.value = false;
	void tuner.fixMacros(fixing.value);
}
</script>

<style scoped>
.indx-files {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 2px 16px;
}
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
.indx-diff {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	font-size: 0.8125rem;
	padding: 6px 10px;
	border-radius: 4px;
	background: rgba(128, 128, 128, 0.12);
	white-space: pre;
	overflow-x: auto;
}
.indx-diff-line {
	display: block;
}
.indx-diff--add {
	background: rgba(var(--v-theme-success), 0.18);
}
.indx-diff--del {
	background: rgba(var(--v-theme-error), 0.18);
	text-decoration: line-through;
	opacity: 0.8;
}
</style>
