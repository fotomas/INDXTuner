<template>
	<div class="indx-tuner d-flex flex-column">
		<!-- Toolbar -->
		<div class="d-flex flex-wrap align-center ga-2 px-3 py-2">
			<v-icon>mdi-lock-smart</v-icon>
			<span class="text-h6">{{ $t("plugins.indxTuner.title") }}</span>
			<v-chip v-if="pendingCount > 0" color="warning" size="small" class="ml-2">
				{{ $t("plugins.indxTuner.toolbar.pending", { n: pendingCount }, pendingCount) }}
			</v-chip>
			<v-spacer />
			<a :href="manifest.homepage" target="_blank" rel="noopener" class="indx-version text-caption text-medium-emphasis mr-2"
			   :title="$t('plugins.indxTuner.toolbar.github')">
				v{{ manifest.version }} · <v-icon size="x-small">mdi-github</v-icon> GitHub
			</a>
			<v-btn size="small" variant="text" prepend-icon="mdi-refresh" :loading="tuner.loading.value" :disabled="!connected || tuner.saving.value" @click="tuner.load()">
				{{ $t("plugins.indxTuner.toolbar.reload") }}
			</v-btn>
			<v-btn size="small" variant="text" prepend-icon="mdi-close" :disabled="pendingCount === 0 || tuner.saving.value" @click="tuner.discardAll()">
				{{ $t("plugins.indxTuner.toolbar.discard") }}
			</v-btn>
			<v-btn size="small" color="primary" variant="tonal" prepend-icon="mdi-content-save" :disabled="pendingCount === 0" @click="view = 'save'">
				{{ $t("plugins.indxTuner.toolbar.review") }}
			</v-btn>
		</div>
		<v-divider />

		<div class="d-flex flex-grow-1" style="min-height: 0">
			<!-- Rail -->
			<v-list nav density="compact" class="flex-shrink-0 py-2 indx-rail" style="width: 240px">
				<v-list-item v-for="s in dashSections" :key="s.id" :active="view === s.id" :disabled="tuner.saving.value"
							 :prepend-icon="s.icon" :title="s.title" @click="view = s.id" />
				<v-list-subheader>{{ $t("plugins.indxTuner.rail.settings") }}</v-list-subheader>
				<v-list-item v-for="s in settingSections" :key="s.id" :active="view === s.id" :disabled="tuner.saving.value"
							 :prepend-icon="s.icon" :title="s.title" @click="view = s.id">
					<template #append>
						<v-icon v-if="s.problems > 0" color="error" size="small">mdi-alert-circle</v-icon>
					</template>
				</v-list-item>

				<v-list-subheader>{{ $t("plugins.indxTuner.rail.tuning") }}</v-list-subheader>
				<v-list-item :active="view === 'zoff'" prepend-icon="mdi-arrow-collapse-down" :title="$t('plugins.indxTuner.rail.zOffset')"
							 :disabled="tuner.saving.value" @click="view = 'zoff'" />
				<v-list-item :active="view === 'speed'" prepend-icon="mdi-speedometer" :title="$t('plugins.indxTuner.rail.speed')"
							 :disabled="tuner.saving.value" @click="view = 'speed'" />
				<v-list-item :active="view === 'dockpos'" prepend-icon="mdi-crosshairs" :title="$t('plugins.indxTuner.rail.dockPosition')"
							 :disabled="tuner.saving.value" @click="view = 'dockpos'" />
				<v-list-item :active="view === 'clamp'" prepend-icon="mdi-gauge" :title="$t('plugins.indxTuner.rail.clampingForce')"
							 :disabled="tuner.saving.value" @click="view = 'clamp'" />
				<v-list-item :active="view === 'recovery'" class="indx-recovery" prepend-icon="mdi-alert" :title="$t('plugins.indxTuner.rail.recovery')"
							 :disabled="tuner.saving.value" @click="view = 'recovery'" />

				<v-list-subheader>{{ $t("plugins.indxTuner.rail.setup") }}</v-list-subheader>
				<v-list-item :active="view === 'macros'" :disabled="tuner.saving.value" prepend-icon="mdi-folder-check-outline"
							 :title="$t('plugins.indxTuner.rail.toolMacros')" @click="view = 'macros'">
					<template #append>
						<span v-if="tuner.macroProblems.value > 0" class="indx-dot indx-dot--error mr-1" />
					</template>
				</v-list-item>

				<v-list-subheader>{{ $t("plugins.indxTuner.rail.review") }}</v-list-subheader>
				<v-list-item :active="view === 'overrides'" :disabled="tuner.saving.value" prepend-icon="mdi-file-document-edit-outline"
							 :title="$t('plugins.indxTuner.rail.overrides')" @click="view = 'overrides'">
					<template #append>
						<v-badge :content="tuner.overrideCount.value" color="primary" inline />
					</template>
				</v-list-item>
				<v-list-item :active="view === 'save'" prepend-icon="mdi-content-save" :title="$t('plugins.indxTuner.rail.save')" @click="view = 'save'">
					<template #append>
						<v-badge v-if="pendingCount > 0" :content="pendingCount" color="warning" inline />
					</template>
				</v-list-item>
			</v-list>
			<v-divider vertical />

			<!-- Working pane -->
			<div class="flex-grow-1 d-flex flex-column pa-3 indx-pane" style="min-width: 0">
				<div class="d-flex align-center ga-2">
					<v-icon size="large">{{ paneIcon }}</v-icon>
					<div class="text-h6">{{ paneTitle }}</div>
				</div>
				<div v-if="paneBlurb" class="text-body-2 text-medium-emphasis mt-1 mb-3" style="max-width: 80ch">{{ paneBlurb }}</div>
				<div v-else class="mb-3" />

				<!-- Readiness -->
				<v-alert v-if="!connected" type="info" variant="tonal" density="compact" class="mb-3">
					{{ $t("plugins.indxTuner.status.notConnected") }}
				</v-alert>
				<v-alert v-else-if="tuner.loading.value && !tuner.loadedOnce.value" type="info" variant="tonal" density="compact" class="mb-3">
					{{ $t("plugins.indxTuner.status.loading") }}
				</v-alert>
				<v-alert v-else-if="tuner.missingVariables.value" type="warning" variant="tonal" density="compact" class="mb-3">
					{{ $t("plugins.indxTuner.status.missingVariables", { dir: tuner.sysDir() }) }}
				</v-alert>
				<v-alert v-else-if="tuner.loadError.value" type="error" variant="tonal" density="compact" class="mb-3">
					{{ $t("plugins.indxTuner.status.loadError", { error: tuner.loadError.value }) }}
				</v-alert>
				<v-alert v-if="tuner.loadedOnce.value && !tuner.missingVariables.value && !tuner.overrideExists.value" type="info" variant="tonal" density="compact" class="mb-3">
					{{ $t("plugins.indxTuner.status.noOverrideFile") }}
				</v-alert>

				<!-- A section of INDX_variables.g -->
				<template v-if="currentSection">
				<v-alert v-for="p in sectionProblems" :key="p.text" type="error" variant="tonal" density="compact" class="mb-3">{{ p.text }}</v-alert>
				<v-alert v-for="f in tuner.missingMacrosFor(currentSection.header)" :key="f.file" type="warning" variant="tonal" density="compact" class="mb-3">
					{{ $t("plugins.indxTuner.macros.missingFor", f) }}
					<template #append>
						<v-btn size="small" variant="text" @click="view = 'macros'">{{ $t("plugins.indxTuner.macros.open") }}</v-btn>
					</template>
				</v-alert>
				<ToolDocks v-if="currentSection.view === 'docks'" :disabled="editDisabled" @go="(v: string) => view = v" />
				<BedProbing v-if="currentSection.view === 'mesh'" />
				<div v-if="currentSection.view === 'docks' && sectionRows.length > 0" class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.docks.common") }}</div>
				<v-card v-if="sectionRows.length > 0" variant="outlined">
					<v-table density="compact">
						<thead>
							<tr>
								<th>{{ $t("plugins.indxTuner.columns.setting") }}</th>
								<th class="text-right">{{ $t("plugins.indxTuner.columns.default") }}</th>
								<th class="text-right">{{ $t("plugins.indxTuner.columns.file") }}</th>
								<th>{{ $t("plugins.indxTuner.columns.new") }}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							<VarRow v-for="r in sectionRows" :key="r.name" :row="r" :disabled="editDisabled" />
						</tbody>
					</v-table>
				</v-card>
				</template>

				<!-- Tuning: recovery -->
				<ClampingForce v-else-if="view === 'clamp'" />
				<ZOffset v-else-if="view === 'zoff'" />
				<SpeedTuning v-else-if="view === 'speed'" />
				<DockPosition v-else-if="view === 'dockpos'" />
				<RecoveryPage v-else-if="view === 'recovery'" />

				<!-- Setup: tool macros -->
				<ToolMacros v-else-if="view === 'macros'" :disabled="editDisabled || !idle" />

				<!-- Overrides: what the file sets -->
				<template v-else-if="view === 'overrides'">
					<v-autocomplete v-model="addPick" :items="addItems" :label="$t('plugins.indxTuner.overrides.add')" :disabled="editDisabled"
									prepend-inner-icon="mdi-plus" density="compact" variant="outlined" class="mb-3" style="max-width: 560px"
									:item-props="addItemProps" clearable hide-details auto-select-first @update:model-value="addPicked" />
					<div v-if="tuner.overrideRows.value.length === 0 && tuner.loadedOnce.value" class="text-medium-emphasis">
						{{ $t("plugins.indxTuner.overrides.empty") }}
					</div>
					<v-card v-else variant="outlined">
						<v-table density="compact">
							<thead>
								<tr>
									<th>{{ $t("plugins.indxTuner.columns.setting") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.columns.default") }}</th>
									<th class="text-right">{{ $t("plugins.indxTuner.columns.file") }}</th>
									<th>{{ $t("plugins.indxTuner.columns.new") }}</th>
									<th />
								</tr>
							</thead>
							<tbody>
								<VarRow v-for="r in tuner.overrideRows.value" :key="r.name" :row="r" :disabled="editDisabled" />
							</tbody>
						</v-table>
					</v-card>
				</template>

				<!-- Save -->
				<template v-else-if="view === 'save'">
					<v-alert v-if="tuner.saveResult.value" :type="tuner.saveResult.value.type" variant="tonal" density="compact" class="mb-3">
						{{ tuner.saveResult.value.text }}
						<div v-for="d in tuner.saveResult.value.details" :key="d" class="indx-mono mt-1">{{ d }}</div>
					</v-alert>

					<div v-if="tuner.saveSteps.value.length > 0 && (tuner.saving.value || tuner.saveResult.value?.type !== 'success')" class="mb-3">
						<div v-for="s in tuner.saveSteps.value" :key="s.label" class="d-flex align-center ga-2">
							<v-progress-circular v-if="s.state === 'running'" indeterminate size="16" width="2" />
							<v-icon v-else size="small" :color="stepColor(s.state)">{{ stepIcon(s.state) }}</v-icon>
							<span :class="{ 'text-medium-emphasis': s.state === 'waiting' }">{{ s.label }}</span>
						</div>
					</div>

					<div v-if="tuner.changes.value.length === 0 && !tuner.saving.value" class="text-medium-emphasis mb-3">
						{{ $t("plugins.indxTuner.save.nothing") }}
					</div>
					<template v-else-if="!tuner.saving.value">
						<v-alert v-if="!idle" type="warning" variant="tonal" density="compact" class="mb-3">
							{{ $t("plugins.indxTuner.status.notIdle") }}
						</v-alert>
						<v-alert v-for="p in tuner.problems.value" :key="p.text" type="error" variant="tonal" density="compact" class="mb-3">
							{{ p.text }}
							<template #append>
								<v-btn size="small" variant="text" @click="view = p.sectionId">{{ $t("plugins.indxTuner.save.show") }}</v-btn>
							</template>
						</v-alert>

						<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.save.changes") }}</div>
						<v-card variant="outlined" class="mb-4">
							<v-table density="compact">
								<tbody>
									<tr v-for="c in changeList" :key="c.name">
										<td class="indx-mono font-weight-medium">{{ c.name }}</td>
										<td class="indx-mono">{{ c.text }}</td>
										<td class="text-right">
											<v-btn icon="mdi-undo" size="small" variant="text" :title="$t('plugins.indxTuner.row.undo')" @click="tuner.undo(c.name)" />
										</td>
									</tr>
								</tbody>
							</v-table>
						</v-card>

						<div class="text-subtitle-2 mb-1">{{ $t("plugins.indxTuner.save.diff") }}</div>
						<pre class="indx-diff mb-4"><span v-for="(d, i) in diff" :key="i" :class="`indx-diff-line indx-diff--${d.type}`">{{ d.type === "add" ? "+ " : d.type === "del" ? "- " : "  " }}{{ d.text }}</span></pre>

						<div class="d-flex">
							<v-spacer />
							<v-btn color="primary" prepend-icon="mdi-content-save" :disabled="!tuner.canSave.value" @click="confirmOpen = true">
								{{ $t("plugins.indxTuner.save.write") }}
							</v-btn>
						</div>
					</template>
				</template>
			</div>
		</div>

		<!-- Confirm the write -->
		<v-dialog v-model="confirmOpen" max-width="560">
			<v-card>
				<v-card-title>{{ $t("plugins.indxTuner.save.confirmTitle") }}</v-card-title>
				<v-card-text>
					{{ $t("plugins.indxTuner.save.confirmText", { file: overridePath, backup: BACKUP, command: reloadCommand }) }}
				</v-card-text>
				<v-card-actions>
					<v-spacer />
					<v-btn variant="text" @click="confirmOpen = false">{{ $t("plugins.indxTuner.save.cancel") }}</v-btn>
					<v-btn color="primary" variant="tonal" @click="confirmSave">{{ $t("plugins.indxTuner.save.write") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { diffLines } from "./model/diff";
import manifest from "../plugin.json";
import { patchRequest } from "./usePatches";
import ToolDocks from "./ToolDocks.vue";
import ToolMacros from "./ToolMacros.vue";
import BedProbing from "./BedProbing.vue";
import ClampingForce from "./ClampingForce.vue";
import DockPosition from "./DockPosition.vue";
import SpeedTuning from "./SpeedTuning.vue";
import ZOffset from "./ZOffset.vue";
import RecoveryPage from "./RecoveryPage.vue";
import { useRecovery } from "./useRecovery";
import { BACKUP, LIVE_STATE_VARS, OVERRIDE, VARIABLES, useIndxTuner, type SaveStep } from "./useIndxTuner";
import VarRow from "./VarRow.vue";

const machineStore = useMachineStore();
const tuner = useIndxTuner();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const view = ref<string>("");
const confirmOpen = ref(false);

const connected = computed(() => machineStore.isConnected);
const idle = computed(() => tuner.machineStatus() === "idle");
const editDisabled = computed(() => !connected.value || tuner.missingVariables.value || tuner.saving.value);

const pendingCount = computed(() => tuner.changes.value.length);

// "Add setting" on the Overrides page: any INDX setting that is not listed yet
const addPick = ref<string | null>(null);
const addItems = computed(() => tuner.addableRows.value.map(r => ({ title: r.name, value: r.name, section: r.section, help: r.help })));
const addItemProps = (item: { section: string; help: string }) => ({ subtitle: item.help ? `${item.section} · ${item.help}` : item.section });

function addPicked(name: string | null): void {
	if (name) {
		tuner.addSetting(name);
	}
	nextTick(() => {
		addPick.value = null;
	});
}
/** The Dashboard (the tool docks section) above "Settings", the other sections under it */
const dashSections = computed(() => tuner.sections.value.filter(s => s.view === "docks"));
const settingSections = computed(() => tuner.sections.value.filter(s => s.view !== "docks"));

const currentSection = computed(() => tuner.sections.value.find(s => s.id === view.value) ?? null);

/** The list under a section; on the Tool docks page without the per-tool lists drawn above it */
const sectionRows = computed(() => currentSection.value?.view === "docks" ? [] : (currentSection.value?.rows ?? []));

const sectionProblems = computed(() => tuner.problems.value.filter(p => p.sectionId === view.value
	&& currentSection.value?.view !== "docks"));     // the docks page shows its own per-field messages

const overridePath = computed(() => tuner.sysDir() + OVERRIDE);
const reloadCommand = computed(() => `M98 P"${tuner.sysDir()}${VARIABLES}"`);

// open the first section once the files are read
watch(() => tuner.sections.value, sections => {
	if (view.value === "" && sections.length > 0) {
		view.value = sections[0].id;
	}
}, { immediate: true });

const paneIcon = computed(() => currentSection.value?.icon
	?? (view.value === "save" ? "mdi-content-save" : view.value === "macros" ? "mdi-folder-check-outline"
		: view.value === "recovery" ? "mdi-alert" : view.value === "clamp" ? "mdi-gauge" : view.value === "zoff" ? "mdi-arrow-collapse-down" : view.value === "speed" ? "mdi-speedometer" : view.value === "dockpos" ? "mdi-crosshairs" : "mdi-file-document-edit-outline"));

const paneTitle = computed(() => currentSection.value?.title
	?? (view.value === "save" ? t("rail.save") : view.value === "macros" ? t("rail.toolMacros")
		: view.value === "recovery" ? t("rail.recovery") : view.value === "clamp" ? t("rail.clampingForce") : view.value === "zoff" ? t("rail.zOffset") : view.value === "speed" ? t("rail.speed") : view.value === "dockpos" ? t("rail.dockPosition") : t("rail.overrides")));

const paneBlurb = computed(() => currentSection.value
	? (currentSection.value.view === "docks" ? "" : currentSection.value.description)
	: view.value === "save" ? t("save.blurb") : view.value === "macros" ? t("macros.blurb")
		: view.value === "recovery" ? t("recovery.blurb") : view.value === "clamp" ? t("clamp.blurb") : view.value === "zoff" ? t("zoff.blurb") : view.value === "speed" ? t("speed.blurb") : view.value === "dockpos" ? t("dockpos.blurb") : t("overrides.blurb"));

// a tuning run that fails opens Recovery
// "Patches…" on a page with a locked feature: go to INDX Files, which opens the patch dialog
watch(patchRequest, r => { if (r) { view.value = "macros"; } });

const recoveryReason = useRecovery().reason;
watch(recoveryReason, r => {
	if (r) {
		view.value = "recovery";
	}
});

const changeList = computed(() => tuner.changes.value.map(c => {
	const row = tuner.rowFor(c.name);
	if (row === null) {
		return { name: c.name, text: "" };
	}
	const def = row.info?.defaultValue !== undefined ? tuner.display(row.info.defaultValue, row) : "?";
	const old = row.entry !== undefined ? tuner.display(row.entry.value, row) : def;
	let text: string;
	if (LIVE_STATE_VARS[c.name] !== undefined) {
		const live = tuner.globalValue(c.name);
		text = t("save.liveState", { old: typeof live === "number" ? tuner.display(live, row) : "?", new: tuner.display(c.value, row), file: LIVE_STATE_VARS[c.name] });
	} else if (c.value === null) {
		text = t("save.removeLine", { old, def });
	} else if (row.entry === undefined) {
		text = t("save.addLine", { def, new: tuner.display(c.value, row) });
	} else {
		text = t("save.from", { old, new: tuner.display(c.value, row) });
	}
	return { name: c.name, text };
}));

const diff = computed(() => tuner.preview.value === null ? [] : diffLines(tuner.overrideText.value, tuner.preview.value.text));

function stepIcon(state: SaveStep["state"]): string {
	return state === "done" ? "mdi-check-circle" : state === "failed" ? "mdi-alert-circle" : "mdi-circle-outline";
}

function stepColor(state: SaveStep["state"]): string | undefined {
	return state === "done" ? "success" : state === "failed" ? "error" : undefined;
}

function confirmSave(): void {
	confirmOpen.value = false;
	void tuner.save();
}

onMounted(() => {
	if (connected.value && !tuner.loadedOnce.value) {
		void tuner.load();
	}
});

watch(connected, c => {
	if (c) {
		void tuner.load();
	}
});
</script>

<style scoped>
.indx-version {
	text-decoration: none;
	white-space: nowrap;
}
.indx-version:hover {
	text-decoration: underline;
}
.indx-pane > * {
	flex-shrink: 0;
}
.indx-pane > .v-alert {
	flex: 0 0 auto;
}
.indx-rail {
	position: sticky;
	top: 0;
	align-self: flex-start;
}
.indx-rail :deep(.v-list-item-title) {
	white-space: normal;
	line-height: 1.25;
}
.indx-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: rgb(var(--v-theme-warning));
}
.indx-recovery {
	color: rgb(var(--v-theme-warning)) !important;
}
.indx-dot--error {
	background: rgb(var(--v-theme-error));
}
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
.indx-diff {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	font-size: 0.8125rem;
	max-height: 50vh;
	overflow: auto;
	padding: 8px 10px;
	border-radius: 4px;
	background: rgba(128, 128, 128, 0.12);
	white-space: pre;
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
