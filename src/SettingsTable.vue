<template>
	<v-card v-if="rows.length > 0" variant="outlined">
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
				<VarRow v-for="r in rows" :key="r.name" :row="r" :disabled="disabled" />
			</tbody>
		</v-table>
	</v-card>
</template>

<script setup lang="ts">
/** A list of settings as on the Settings pages, for use on other pages (Tool Clamping, Speed) */
import { computed } from "vue";

import { useMachineStore } from "@/stores/machine";

import { useIndxTuner, type Row } from "./useIndxTuner";
import VarRow from "./VarRow.vue";

const props = defineProps<{ rows: Row[]; disabled?: boolean }>();
const tuner = useIndxTuner();
const machineStore = useMachineStore();
const disabled = computed(() => props.disabled || !machineStore.isConnected || tuner.missingVariables.value || tuner.saving.value);
</script>
