/**
 * How the sections of INDX_variables.g are shown: display name, icon, special page, merges.
 * Matched on the start of the section header, so a header the table does not know is shown as
 * written with the default icon.
 */

export type SectionView = "docks" | "mesh";

export interface SectionStyle {
	match: string;          // lower-case start of the header
	title?: string;         // display name; the header's own title when left out
	icon: string;
	view?: SectionView;     // a section with its own page layout
	mergeInto?: string;     // shown inside the section with this match instead of on its own
	inMenu?: false;         // not in the menu: tuned under Tuning (some shown there), the rest added on the Overrides page
	extraVars?: string[];   // variables of other sections shown in this one too
}

export const DEFAULT_SECTION_ICON = "mdi-tune";

export const SECTION_STYLES: SectionStyle[] = [
	{ match: "tool docks", title: "Dashboard", icon: "mdi-view-dashboard-variant-outline", view: "docks" },
	{ match: "latch", icon: "mdi-download-lock-outline", inMenu: false },   // on Tuning - Tool Clamping
	{ match: "prime and wipe", title: "Prime & Wipe", icon: "mdi-wiper" },
	{ match: "tool change speeds", icon: "mdi-speedometer", inMenu: false },
	{ match: "tool change checks", icon: "mdi-order-bool-ascending-variant", inMenu: false },
	{ match: "load cell calibration", icon: "mdi-scale-balance", inMenu: false },
	{ match: "load cell probing", icon: "mdi-download-multiple-outline", inMenu: false },
	{ match: "mesh area", title: "Bed Probing", icon: "mdi-grid", view: "mesh" },
	{ match: "homez probe point", icon: "mdi-crosshairs-gps", mergeInto: "mesh area" },
];

export function styleFor(title: string): SectionStyle | undefined {
	const t = title.toLowerCase();
	return SECTION_STYLES.find(s => t.startsWith(s.match));
}

/** Title Case for menu texts: every word starts with a capital, the rest is kept ("INDX" stays "INDX") */
export function titleCase(text: string): string {
	return text.replace(/(^|[\s\-/(])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}
