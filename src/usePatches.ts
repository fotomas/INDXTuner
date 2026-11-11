/**
 * Patches for the official INDX files (model/patches.ts): their status on the printer, and applying or
 * reverting them with a backup first. Everything runs from the patch dialog on the INDX Files page.
 */
import { computed, ref } from "vue";

import i18n from "@/i18n";
import { useMachineStore } from "@/stores/machine";

import { INDX_MACROS } from "./model/indxMacros";
import { applyPatches, PATCH_FILES, PATCHES, patchFiles, patchStatus, revertPatches, type PatchStatus } from "./model/patches";
import { useIndxTuner } from "./useIndxTuner";

const t = (key: string, args?: Record<string, unknown>) => i18n.global.t(`plugins.indxTuner.${key}`, args ?? {});

/** Which page features each patch unlocks (the settings they add), for the locked hints elsewhere */
export const FEATURE_PATCH: Record<string, string> = {
	"speed-latch": "latch", "clamp-use": "latch", "speed-accel": "accel",
};

/** A feature that needs a patch is available when the setting the patch adds exists on the printer */
const FEATURE_GLOBAL: Record<string, string> = {
	"speed-latch": "INDX_latch_feed", "clamp-use": "INDX_latch_close_tool", "speed-accel": "INDX_TC_accel",
};

export function featureAvailable(feature: string): boolean {
	const g = FEATURE_GLOBAL[feature];
	return g === undefined || useIndxTuner().globalValue(g) !== undefined;
}

/** Set by a "Patches…" button on another page: the page switches to INDX Files, which opens the dialog */
export const patchRequest = ref(false);

const busy = ref(false);
const result = ref<{ type: "success" | "error"; text: string } | null>(null);
const lastBackup = ref<string | null>(null);

function textOf(file: string): string | null {
	const texts = useIndxTuner().macroTexts.value;
	for (const [name, text] of texts) {
		if (name.toLowerCase() === file.toLowerCase()) {
			return text;
		}
	}
	return null;
}

const statuses = computed(() => new Map<string, PatchStatus>(PATCHES.map(p => [p.id, patchStatus(p, textOf)])));
const counts = computed(() => {
	const s = [...statuses.value.values()];
	return { applied: s.filter(x => x === "applied").length, available: s.filter(x => x === "available").length };
});

/** Why patching cannot start now; empty when it can */
function blockers(): string[] {
	const machineStore = useMachineStore();
	const tuner = useIndxTuner();
	const out: string[] = [];
	if (!machineStore.isConnected) {
		return [t("measure.notConnected")];
	}
	if (tuner.machineStatus() !== "idle") {
		out.push(t("patch.notIdle"));
	}
	if (Number((machineStore.model.state as any).currentTool ?? -1) >= 0 || (tuner.globalValue("INDX_State") ?? -1) !== -1) {
		out.push(t("patch.toolOnHead"));
	}
	return out;
}

/** The files as they will be after applying (ids) or reverting (revert = true) */
function preview(ids: string[], revert = false): Array<{ file: string; before: string; after: string }> {
	const changed = revert ? revertPatches(ids, textOf) : applyPatches(ids, textOf);
	return [...changed].map(([file, after]) => ({ file, before: (textOf(file) ?? "").replace(/\r\n/g, "\n"), after }));
}

const stamp = () => {
	const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

async function upload(path: string, text: string): Promise<void> {
	await useMachineStore().upload({ filename: path, content: new Blob([text], { type: "text/plain" }) }, false, false, true);
}

async function download(path: string): Promise<string> {
	const c = await useMachineStore().download({ filename: path, type: "text" }, false, false, false);
	return typeof c === "string" ? c : await (c as Blob).text();
}

/**
 * Back up the files, write the new contents, read them back, then run INDX_variables.g so the settings
 * exist, and reload. `revert` takes the patches out again.
 */
async function run(ids: string[], revert: boolean): Promise<boolean> {
	const machineStore = useMachineStore();
	const tuner = useIndxTuner();
	if (busy.value || blockers().length > 0 || ids.length === 0) {
		return false;
	}
	busy.value = true;
	result.value = null;
	const dir = tuner.sysDir();
	try {
		const files = preview(ids, revert);
		const backup = `${dir}indx-backup-${stamp()}/`;
		for (const f of patchFiles(PATCHES.filter(p => ids.includes(p.id)))) {
			const text = textOf(f);
			if (text !== null) {
				await upload(backup + f, text);
			}
		}
		lastBackup.value = backup;
		for (const f of files) {
			await upload(dir + f.file, f.after);
			const back = (await download(dir + f.file)).replace(/\r\n/g, "\n");
			if (back !== f.after) {
				throw new Error(t("patch.readBack", { file: f.file }));
			}
		}
		const names = new Set((await machineStore.getFileList(dir)).filter((f: any) => !f.isDirectory).map((f: any) => String(f.name).toLowerCase()));
		if (!revert) {
			// files the patches need: created when missing, never overwritten
			for (const p of PATCHES.filter(x => ids.includes(x.id))) {
				for (const nf of p.newFiles ?? []) {
					if (!names.has(nf.toLowerCase())) {
						const content = PATCH_FILES[nf] ?? INDX_MACROS.find(m => m.file === nf)?.template;
						if (content !== undefined) {
							await upload(dir + nf, content);
						}
					}
				}
			}
		} else if (ids.includes("state")) {
			// back to the official state file: write it once with the official macro, then remove indx-head.g
			await machineStore.sendCode('M98 P"INDX_WRITE_STATE.g"', false, false);
			if (names.has("indx-head.g")) {
				await machineStore.sendCode(`M30 "${dir}indx-head.g"`, false, false);
			}
		}
		await machineStore.sendCode('M98 P"INDX_variables.g"', false, false);
		await tuner.load();
		result.value = { type: "success", text: t(revert ? "patch.reverted" : "patch.applied", { n: ids.length, files: files.length, backup }) };
		return true;
	} catch (e) {
		result.value = { type: "error", text: t("patch.failed", { error: e instanceof Error ? e.message : String(e), backup: lastBackup.value ?? "" }) };
		return false;
	} finally {
		busy.value = false;
	}
}

export function usePatches() {
	return { statuses, counts, busy, result, lastBackup, blockers, preview, apply: (ids: string[]) => run(ids, false), revert: (ids: string[]) => run(ids, true) };
}
