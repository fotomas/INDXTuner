<template>
	<tr :class="`indx-row indx-row--${row.state}`">
		<td class="indx-name">
			<div class="d-flex align-center ga-2">
				<span class="indx-mono font-weight-medium">{{ row.name }}</span>
				<v-chip v-if="chip" :color="chip.color" size="x-small" variant="tonal" label>{{ chip.text }}</v-chip>
			</div>
			<div v-if="help" class="text-caption text-medium-emphasis indx-help">{{ help }}</div>
			<div v-if="liveToggle" class="text-caption text-medium-emphasis font-italic">{{ $t("plugins.indxTuner.row.liveState", { file: LIVE_STATE_VARS[row.name] }) }}</div>
			<div v-else-if="row.readonlyReason" class="text-caption text-medium-emphasis font-italic">{{ row.readonlyReason }}</div>
		</td>
		<td class="text-right indx-mono text-medium-emphasis">
			<ToolListGrid v-if="toolList" :values="cellsOf(row.info?.defaultValue)" />
			<template v-else>{{ xy ? xyText(row.info?.defaultValue) : defaultText }}</template>
		</td>
		<td class="text-right indx-mono" :class="{ 'text-medium-emphasis': row.entry === undefined }">
			<ToolListGrid v-if="toolList && row.entry !== undefined" :values="cellsOf(row.entry?.value)" />
			<template v-else>{{ row.entry !== undefined ? (xy ? xyText(row.entry?.value) : fileText) : "—" }}</template>
		</td>
		<td class="indx-edit">
			<!-- a setting the INDX macros keep in a state file (INDX_DEBUG): an unsaved change, saved by their macro -->
			<v-btn-toggle v-if="liveToggle" :model-value="liveValue" mandatory divided density="compact" variant="outlined"
						  :color="row.state === 'pending' ? 'warning' : 'primary'" :disabled="disabled" @update:model-value="setLive">
				<v-btn v-for="o in liveToggle" :key="o.value" :value="o.value" size="small">{{ o.title }}</v-btn>
			</v-btn-toggle>
			<template v-else-if="row.editable">
				<v-btn-toggle v-if="options" :model-value="toggleValue" mandatory divided density="compact" variant="outlined"
							  :color="row.state === 'pending' || row.state === 'remove' ? 'warning' : 'primary'"
							  :disabled="disabled" @update:model-value="(v: number) => tuner.setNumber(row.name, v)">
					<v-btn v-for="o in buttons" :key="o.value" :value="o.value" size="small">{{ o.title }}</v-btn>
				</v-btn-toggle>
				<div v-else-if="toolList" class="d-flex align-center flex-wrap ga-2">
					<ToolListGrid :values="newCells" :changed="newChanged" :muted="row.state !== 'pending'" />
					<v-btn size="small" variant="outlined" color="primary" :disabled="disabled" @click="openDialog">{{ $t("plugins.indxTuner.row.edit") }}</v-btn>
					<div v-if="row.error" class="text-error text-caption w-100">{{ row.error }}</div>
				</div>
				<div v-else-if="xy" class="d-flex ga-2">
					<v-text-field v-for="(c, i) in ['X', 'Y']" :key="c" v-model="xyFields[i]" density="compact" variant="outlined" hide-details="auto"
								  :label="c" :placeholder="xyPlaceholder[i]" :suffix="row.unit" :error-messages="i === 0 ? row.error : undefined"
								  :disabled="disabled" persistent-placeholder @blur="commitXY" @keyup.enter="commitXY" />
				</div>
				<v-text-field v-else v-model="text" density="compact" variant="outlined" single-line hide-details="auto"
							  :placeholder="placeholder" :suffix="row.unit" :error-messages="row.error" :disabled="disabled"
							  @blur="commit" @keyup.enter="commit" />
			</template>
		</td>
		<td class="indx-actions text-no-wrap">
			<v-btn v-if="row.state === 'pending' || row.state === 'remove' || row.error" icon="mdi-undo" size="small" variant="text"
				   :title="$t('plugins.indxTuner.row.undo')" :disabled="disabled" @click="tuner.undo(row.name)" />
			<v-btn v-else-if="row.entry !== undefined" icon="mdi-backup-restore" size="small" variant="text"
				   :title="$t('plugins.indxTuner.row.toDefault')" :disabled="disabled" @click="tuner.toDefault(row.name)" />
		</td>
	</tr>

	<!-- per-tool list: one field per tool -->
	<v-dialog v-if="toolList" v-model="dialog" max-width="420">
		<v-card>
			<v-card-title class="indx-mono">{{ row.name }}</v-card-title>
			<v-card-subtitle v-if="help" class="indx-dlg-help">{{ help }}</v-card-subtitle>
			<v-card-text>
				<div v-for="(f, i) in fields" :key="i" class="d-flex align-center ga-3 mb-2">
					<span class="indx-dlg-tool">T{{ i }}</span>
					<v-text-field v-model="fields[i]" density="compact" variant="outlined" hide-details single-line :suffix="row.unit"
								  :placeholder="nullHint" persistent-placeholder style="max-width: 170px" @keyup.enter="applyDialog" />
				</div>
				<div v-if="nullHint !== ''" class="text-caption text-medium-emphasis">{{ $t("plugins.indxTuner.row.emptyUses", { value: nullHint }) }}</div>
			</v-card-text>
			<v-card-actions>
				<v-btn variant="text" @click="fields = fields.map(() => '')">{{ $t("plugins.indxTuner.row.clearAll") }}</v-btn>
				<v-spacer />
				<v-btn variant="text" @click="dialog = false">{{ $t("plugins.indxTuner.save.cancel") }}</v-btn>
				<v-btn color="primary" variant="flat" @click="applyDialog">OK</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import i18n from "@/i18n";

import { LIMITS } from "./model/limits";
import ToolListGrid from "./ToolListGrid.vue";
import { LIVE_STATE_VARS, useIndxTuner, type Row } from "./useIndxTuner";

const props = defineProps<{ row: Row; disabled: boolean }>();

const tuner = useIndxTuner();
const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

const options = computed(() => LIMITS[props.row.name]?.options);

const help = computed(() => LIMITS[props.row.name]?.help ?? (props.row.info?.help ?? []).join(" "));

const defaultText = computed(() => props.row.info === null ? "?" : tuner.display(props.row.info.defaultValue, props.row));
const fileText = computed(() => tuner.display(props.row.entry?.value, props.row));
const placeholder = computed(() => tuner.display(props.row.effective, props.row));

const toggleValue = computed(() => {
	const v = props.row.current;
	if (typeof v !== "number") {
		return undefined;
	}
	// the matching button's own value, so 1 and 1.0 select the same button
	return buttons.value.find(o => Math.abs(o.value - v) < 1e-6)?.value ?? v;
});

/** The choices, plus a custom button when the file holds another value, so the real setting is never hidden */
const buttons = computed(() => {
	const list = [...(options.value ?? [])];
	for (const v of [props.row.effective, props.row.current]) {
		if (typeof v === "number" && !list.some(o => Math.abs(o.value - v) < 1e-6)) {
			list.push({ value: v, title: t("row.custom", { value: v }) });
		}
	}
	return list;
});

const chip = computed(() => {
	switch (props.row.state) {
		case "override": return { color: "primary", text: t("row.override") };
		case "pending": return { color: "warning", text: t("row.pending") };
		case "remove": return { color: "warning", text: t("row.remove") };
		default: return null;
	}
});

// the field keeps its own text while typing; it is checked and taken over on Enter or when leaving it
const text = ref(props.row.pendingText ?? "");
watch(() => props.row.pendingText, v => { text.value = v ?? ""; });

// settings restored from a state file after the override file (INDX_DEBUG): a toggle that makes a normal
// unsaved change; saving sets it live and saves it with the INDX macro that writes the state file
const liveToggle = computed(() => LIVE_STATE_VARS[props.row.name] !== undefined && options.value ? options.value : null);
const liveValue = computed(() => {
	const v = props.row.pendingValue ?? tuner.globalValue(props.row.name);
	return typeof v === "number" ? v : undefined;
});

function setLive(v: number): void {
	tuner.setNumber(props.row.name, v);
}

// per-tool lists are shown as T0...Tn cells and edited in a dialog, one field per tool
const TOOL_LIST_VARS = ["INDX_tool_x", "INDX_latch_close_tool"];
/** For an empty field (null): the general value the tool then uses */
const NULL_MEANS: Record<string, string> = { INDX_latch_close_tool: "INDX_latch_close_e" };
const toolList = computed(() => TOOL_LIST_VARS.includes(props.row.name) && props.row.shape.list);

function fmt(v: unknown): string | null {
	if (typeof v !== "number") {
		return v === null || v === undefined ? null : String(v);
	}
	return props.row.shape.float && Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** How many tools to show: the docks, or more when a list is longer */
function toolCount(...lists: unknown[]): number {
	return Math.max(tuner.docks.value.numbers.length, ...lists.map(l => Array.isArray(l) ? l.length : 0));
}

function cellsOf(v: unknown): (string | null)[] {
	const list = Array.isArray(v) ? v : [];
	return list.map(fmt);
}

const newCells = computed(() => {
	const cur = Array.isArray(props.row.current) ? props.row.current : [];
	const n = toolCount(cur, props.row.effective);
	return Array.from({ length: n }, (_, i) => fmt(cur[i] ?? null));
});
const newChanged = computed(() => {
	const eff = Array.isArray(props.row.effective) ? props.row.effective : [];
	return newCells.value.map((c, i) => props.row.state === "pending" && c !== fmt(eff[i] ?? null));
});

const nullHint = computed(() => {
	const general = NULL_MEANS[props.row.name];
	return general ? (fmt(tuner.currentValue(general)) ?? "") : "";
});

const dialog = ref(false);
const fields = ref<string[]>([]);

function openDialog(): void {
	fields.value = newCells.value.map(c => c ?? "");
	dialog.value = true;
}

function applyDialog(): void {
	const items = fields.value.map(f => f.trim() === "" ? "null" : f.trim());
	// trailing empty tools are left out, as long as one entry remains
	while (items.length > 1 && items[items.length - 1] === "null") {
		items.pop();
	}
	tuner.setValue(props.row.name, `{${items.join(", ")}}`);
	dialog.value = false;
}

// X/Y pairs ({x, y} lists) are edited as two fields
const XY_VARS = ["INDX_mesh_min", "INDX_mesh_max"];
const xy = computed(() => XY_VARS.includes(props.row.name) && props.row.shape.list);

function pairOf(v: unknown): [string, string] {
	if (Array.isArray(v) && v.length === 2) {
		return [String(v[0] ?? ""), String(v[1] ?? "")];
	}
	if (typeof v === "string") {
		const m = /^\s*\{?\s*([^,{}]*?)\s*,\s*([^,{}]*?)\s*\}?\s*$/.exec(v);
		if (m) {
			return [m[1], m[2]];
		}
	}
	return ["", ""];
}

function xyText(v: unknown): string {
	const [x, y] = pairOf(v);
	return x === "" && y === "" ? "?" : `X ${x}  Y ${y}`;
}

const xyPlaceholder = computed(() => pairOf(props.row.effective));
const xyFields = ref<[string, string]>(pairOf(props.row.pendingText ?? ""));
watch(() => props.row.pendingText, v => { xyFields.value = pairOf(v ?? ""); });

function commitXY(): void {
	const [x, y] = xyFields.value.map(v => v.trim());
	if (x === "" && y === "") {
		if (props.row.pendingText !== undefined) {
			tuner.undo(props.row.name);
		}
		return;
	}
	const text = `{${x === "" ? xyPlaceholder.value[0] : x}, ${y === "" ? xyPlaceholder.value[1] : y}}`;
	if (text !== props.row.pendingText) {
		tuner.setValue(props.row.name, text);
	}
}

function commit(): void {
	if (text.value !== (props.row.pendingText ?? "")) {
		tuner.setValue(props.row.name, text.value);
	}
}
</script>

<style scoped>
.indx-mono {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	white-space: nowrap;
}
.indx-name {
	min-width: 240px;
	padding-top: 6px !important;
	padding-bottom: 6px !important;
}
.indx-help {
	max-width: 60ch;
	white-space: normal;
}
.indx-dlg-tool {
	width: 2.2em;
	opacity: 0.75;
}
.indx-dlg-help {
	white-space: normal;
}
.indx-edit {
	min-width: 220px;
	width: 260px;
}
.indx-row--pending,
.indx-row--remove {
	background: rgba(var(--v-theme-warning), 0.08);
}
</style>
