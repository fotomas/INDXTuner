<template>
	<div class="mb-3">
		<div class="d-flex flex-wrap align-center ga-2 mb-3">
			<span class="text-caption text-medium-emphasis mr-1">{{ label ?? $t("plugins.indxTuner.clamp.tool") }}</span>
			<v-chip v-for="n in numbers" :key="n" :color="n === modelValue ? 'primary' : undefined"
					:variant="n === modelValue ? 'flat' : 'outlined'" :disabled="disabled" @click="emit('update:modelValue', n)">
				T{{ n }}<span v-if="n === currentTool && !noHeadMark" class="ml-1">●</span>
			</v-chip>
			<span v-if="!noHeadMark" class="text-caption text-medium-emphasis ml-2">● {{ $t("plugins.indxTuner.clamp.onHead") }}</span>
		</div>
		<div v-if="!compact" class="d-flex align-center ga-4">
			<ToolGlyph current :scale="0.8" />
			<div class="text-body-2">
				<div class="font-weight-medium">T{{ modelValue }}
					<span class="text-medium-emphasis font-weight-regular">{{ $t("plugins.indxTuner.clamp.inDock", { x: toolX }) }}</span></div>
				<slot />
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * Tool selection for the tuning pages: tool chips, and the chosen tool drawn on the head exactly as
 * the Tool Docks page draws the tool on the head. The slot holds the values the page cares about.
 */
import { computed } from "vue";

import { useMachineStore } from "@/stores/machine";

import ToolGlyph from "./ToolGlyph.vue";
import { useIndxTuner } from "./useIndxTuner";

const props = withDefaults(defineProps<{ modelValue: number; disabled?: boolean; label?: string; noHeadMark?: boolean; compact?: boolean }>(), { disabled: false, label: undefined, noHeadMark: false, compact: false });
const emit = defineEmits<{ (e: "update:modelValue", tool: number): void }>();

const machineStore = useMachineStore();
const tuner = useIndxTuner();
const numbers = computed(() => tuner.docks.value.numbers);
const currentTool = computed(() => Number((machineStore.model.state as any).currentTool ?? -1));
const toolX = computed(() => {
	const x = (tuner.currentList("INDX_tool_x") ?? [])[props.modelValue];
	return typeof x === "number" ? x.toFixed(2).replace(/0$/, "") : "?";
});
</script>
