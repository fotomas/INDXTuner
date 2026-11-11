<template>
	<div class="indx-tg" :class="{ 'indx-tg-muted': muted }">
		<div v-for="(v, i) in cells" :key="i" class="indx-tg-col">
			<span class="indx-tg-h">T{{ i }}</span>
			<span class="indx-tg-v" :class="{ 'indx-tg-null': v === null, 'indx-tg-changed': changed?.[i] }">{{ v === null ? "–" : v }}</span>
		</div>
	</div>
</template>

<script setup lang="ts">
/**
 * A per-tool list value (INDX_tool_x, INDX_latch_close_tool) shown as small T0...Tn cells instead of the
 * RRF vector text; null shows as "–" (the tool uses the general value).
 */
import { computed } from "vue";

const props = defineProps<{ values: (string | null)[]; changed?: boolean[]; muted?: boolean }>();
const cells = computed(() => props.values);
</script>

<style scoped>
.indx-tg {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 2px;
	font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	font-size: 12.5px;
}
.indx-tg-col {
	display: flex;
	flex-direction: column;
	align-items: center;
}
.indx-tg-h {
	font-size: 10.5px;
	opacity: 0.6;
}
.indx-tg-v {
	padding: 1px 5px;
	border-radius: 3px;
	background: rgba(var(--v-theme-on-surface), 0.06);
	min-width: 2.2em;
	text-align: center;
}
.indx-tg-muted .indx-tg-v {
	opacity: 0.5;
}
.indx-tg-null {
	opacity: 0.5;
}
.indx-tg-changed {
	background: rgba(var(--v-theme-warning), 0.2);
	color: rgb(var(--v-theme-warning));
}
</style>
