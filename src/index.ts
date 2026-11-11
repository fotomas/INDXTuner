/**
 * INDX Tuner - entry point.
 * Adds Plugins -> INDX Tuner, a page that edits 0:/sys/INDX_variables_override.g and reloads
 * INDX_variables.g so the new values take effect.
 */
import { registerPluginMessages, registerRoute, unregisterRoute } from "@/plugins";
import Events from "@/utils/events";

import en from "./i18n/en.json";
import IndxTunerPage from "./IndxTunerPage.vue";

/** Manifest id (plugin.json `id`), used by DWC's plugin load/unload events */
export const PLUGIN_ID = "IndxTuner";
const ROUTE_PATH = "/Plugins/IndxTuner";

// strings live under plugins.indxTuner.*
registerPluginMessages("indxTuner", { en });

registerRoute(IndxTunerPage, {
	Plugins: {
		IndxTuner: {
			icon: "mdi-lock-smart",
			caption: "plugins.indxTuner.menuCaption",
			path: ROUTE_PATH,
		},
	},
});

function onPluginUnloaded(id: string): void {
	if (id === PLUGIN_ID) {
		unregisterRoute(ROUTE_PATH);
		Events.off("dwcPluginUnloaded", onPluginUnloaded);
	}
}
Events.on("dwcPluginUnloaded", onPluginUnloaded);
