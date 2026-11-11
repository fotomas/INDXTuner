<template>
	<v-text-field v-model="text" density="compact" variant="outlined" hide-details="auto" single-line
				  :label="label" :placeholder="placeholder" :suffix="suffix" :error-messages="error ?? undefined"
				  :base-color="changed ? 'warning' : undefined" :color="changed ? 'warning' : 'primary'"
				  :disabled="disabled" class="indx-dock-field" @blur="commit" @keyup.enter="commit" />
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

/** An edit field that is only taken over on Enter or when it loses focus */
const props = defineProps<{
	value: string;
	placeholder?: string;
	label?: string;
	suffix?: string;
	changed?: boolean;
	error?: string | null;
	disabled?: boolean;
}>();
const emit = defineEmits<{ (e: "commit", text: string): void }>();

const text = ref(props.value);
watch(() => props.value, v => { text.value = v; });

function commit(): void {
	if (text.value !== props.value) {
		emit("commit", text.value);
	}
}
</script>

<style scoped>
.indx-dock-field {
	width: 80px;
}
.indx-dock-field :deep(input) {
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	text-align: right;
}
</style>
