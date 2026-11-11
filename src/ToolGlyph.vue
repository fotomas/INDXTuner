<template>
	<svg :width="48 * scale" :height="106 * scale" viewBox="0 0 48 106" :class="{ 'indx-tool--current': current }">
		<template v-if="current">
			<rect x="4" y="10" width="40" height="80" rx="20" class="indx-tool-head" />
			<path :d="TOOL_PATH" class="indx-tool-backing" />
		</template>
		<path :d="TOOL_PATH" class="indx-tool-body" />
		<path :d="current ? 'M18.5 94 H29.5 L24 105 Z' : 'M19 94 H29 L24 103 Z'" class="indx-tool-nozzle" />
	</svg>
</template>

<script setup lang="ts">
/**
 * Tool drawing "A2, ends on the head's curve": stem, rounded body, stem, exactly as tall as the head
 * capsule (y 10..90), with the top and bottom of the stem on the head's own circle (radius 20).
 * The nozzle is a separate triangle. A tool on the head is drawn in front of the blue head capsule.
 */
withDefaults(defineProps<{ current?: boolean; scale?: number }>(), { current: false, scale: 1 });

const TOOL_PATH = (() => {
	const cx = 24, s = 10, w = 20, r = (w - s) / 2, re = 20, y0 = 10, y1 = 28, y2 = 72, y3 = 90;
	const L = cx - w / 2, R = cx + w / 2, sl = cx - s / 2, sr = cx + s / 2;
	const dy = re - Math.sqrt(re * re - (s / 2) * (s / 2));
	const yt = y0 + dy, yb = y3 - dy;
	return `M${sl} ${yt} A${re} ${re} 0 0 1 ${sr} ${yt} V${y1} A${r} ${r} 0 0 1 ${R} ${y1 + r} V${y2 - r} A${r} ${r} 0 0 1 ${sr} ${y2}`
		+ ` V${yb} A${re} ${re} 0 0 1 ${sl} ${yb} V${y2} A${r} ${r} 0 0 1 ${L} ${y2 - r} V${y1 + r} A${r} ${r} 0 0 1 ${sl} ${y1} Z`;
})();
</script>

<style scoped>
.indx-tool-body {
	fill: rgba(var(--v-theme-on-surface), 0.1);
	stroke: rgba(var(--v-theme-on-surface), 0.55);
	stroke-width: 1.5;
	stroke-linejoin: round;
}
.indx-tool-nozzle {
	fill: rgba(var(--v-theme-on-surface), 0.55);
}
.indx-tool-head {
	fill: rgba(var(--v-theme-primary), 0.25);
	stroke: rgb(var(--v-theme-primary));
	stroke-width: 1.5;
}
.indx-tool-backing {
	fill: rgb(var(--v-theme-surface));
}
.indx-tool--current .indx-tool-body {
	fill: rgba(var(--v-theme-primary), 0.25);
	stroke: rgb(var(--v-theme-primary));
}
.indx-tool--current .indx-tool-nozzle {
	fill: rgb(var(--v-theme-primary));
}
</style>
