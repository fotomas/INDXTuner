/**
 * Units, limits and choices for the INDX variables the plugin knows.
 * Optional: a variable missing here is still shown and edited, with a type check only.
 * The limits are plausibility bounds to catch typing mistakes, not machine limits.
 */

export interface Limits {
	unit?: string;
	min?: number;
	max?: number;
	step?: number;
	integer?: boolean;
	options?: Array<{ value: number; title: string }>;
	help?: string;          // description shown instead of the comments in INDX_variables.g
}

/**
 * Variables the INDX macros write themselves (saved values, calibration results). They are shown
 * read-only, because a value in the override file would be overwritten.
 */
export const MANAGED_BY_MACROS = ["INDX_TC_accel_saved", "INDX_LC_offset", "INDX_LC_calibrated", "INDX_LC_scale", "INDX_State"];

const onOff = [{ value: 0, title: "Off" }, { value: 1, title: "On" }];

export const LIMITS: Record<string, Limits> = {
	// tool docks and geometry
	INDX_tool_x: { unit: "mm", min: -1000, max: 1000 },
	INDX_dock_y: { unit: "mm", min: -1000, max: 1000, step: 0.1 },
	INDX_latch_tool: { min: 0, max: 49, integer: true },
	INDX_dock_dir: { options: [{ value: -1, title: "Docks at min Y" }, { value: 1, title: "Docks at max Y" }] },
	INDX_trigger_offset: { unit: "mm", min: 0, max: 30, step: 0.5 },
	INDX_peel_distance: { unit: "mm", min: 0, max: 50, step: 0.5 },
	INDX_z_hop: { unit: "mm", min: 0, max: 20, step: 0.5 },
	safeYmin: { unit: "mm", min: -1000, max: 1000 },

	// latch
	INDX_latch_close_e: { unit: "mm of E", min: 1, max: 30, step: 0.5 },
	INDX_latch_close_tool: { unit: "mm of E", min: 1, max: 30 },
	INDX_latch_feed: { unit: "mm/min", min: 60, max: 20000, step: 250 },

	// prime and wipe
	INDX_prime_e: { unit: "mm", min: 0, max: 100, step: 0.5, help: "extrude mm" },
	INDX_prime_feed: { unit: "mm/min", min: 60, max: 10000, step: 100 },
	INDX_prime_retract: { unit: "mm", min: 0, max: 20, step: 0.1, help: "retract mm" },
	INDX_prime_retract_feed: { unit: "mm/min", min: 60, max: 10000, step: 100 },
	INDX_prime_wipe_feed: { unit: "mm/min", min: 60, max: 30000, step: 250 },

	// tool change speeds
	INDX_TC_SPEED: { unit: "mm/min", min: 600, max: 60000, step: 1000 },
	INDX_TC_MODE: { min: 0.05, max: 1, options: [{ value: 0.3, title: "Quiet" }, { value: 0.7, title: "Normal" }, { value: 1.0, title: "Full" }] },
	INDX_TC_contact_speed: { unit: "mm/min", min: 60, max: 20000, step: 250 },
	INDX_TC_slow_zone: { unit: "mm", min: 0, max: 100, step: 1 },
	INDX_TC_accel: { unit: "mm/s²", min: 0, max: 50000, step: 500 },

	// tool change checks
	INDX_TC_check_action: { options: [{ value: 0, title: "Report" }, { value: 1, title: "Abort" }] },
	INDX_TC_lc_samples: { min: 1, max: 32, step: 1, integer: true },
	INDX_TC_lc_settle: { unit: "ms", min: 0, max: 5000, step: 50, integer: true },
	INDX_TC_lc_min_g: { unit: "g", min: 10, max: 5000, step: 50 },
	INDX_TC_heat_delta: { unit: "°C", min: 1, max: 100, step: 1 },
	INDX_TC_heat_rise: { unit: "°C", min: 0.5, max: 50, step: 1 },
	INDX_TC_heat_timeout: { unit: "s", min: 1, max: 120, step: 1 },
	INDX_TC_heat_overlap: { options: onOff },
	INDX_TC_drop_temp_min: { unit: "°C", min: 0, max: 999, step: 10 },
	INDX_TC_drop_temp_dx: { unit: "mm", min: -200, max: 200, step: 5 },
	INDX_TC_drop_temp_fall: { unit: "°C", min: 0, max: 100, step: 1 },
	INDX_TC_drop_dwell: { unit: "ms", min: 0, max: 10000, step: 100, integer: true },

	// load cell calibration
	INDX_LC_scale_limits: { unit: "g/count", min: 0, max: 10 },
	INDX_LC_locking_force: { unit: "g", min: 100, max: 10000, step: 100 },
	INDX_LC_samples: { min: 1, max: 64, step: 1, integer: true },

	// load cell probing
	INDX_LC_trigger_grams: { unit: "g", min: 5, max: 1000, step: 5 },
	INDX_LC_preload_lo: { unit: "g", min: -5000, max: 5000 },
	INDX_LC_preload_hi: { unit: "g", min: -5000, max: 5000 },

	// mesh and probe point
	INDX_mesh_min: { unit: "mm", min: -1000, max: 1000 },
	INDX_mesh_max: { unit: "mm", min: -1000, max: 1000 },
	INDX_mesh_spacing: { unit: "mm", min: 2, max: 200, step: 5 },
	INDX_LC_probe_fuzz: { unit: "mm", min: 0, max: 20, step: 0.5 },
	INDX_probe_x: { unit: "mm", min: -1000, max: 1000 },
	INDX_probe_y: { unit: "mm", min: -1000, max: 1000 },

	INDX_DEBUG: { options: [{ value: 0, title: "Quiet" }, { value: 1, title: "Log" }] },
};

/** Check a value against the limits; returns an error text or null */
export function checkLimits(v: number | null | Array<number | null>, lim: Limits | undefined, allowNullEntries: boolean): string | null {
	const items = Array.isArray(v) ? v : [v];
	for (const x of items) {
		if (x === null) {
			if (!allowNullEntries) {
				return "null is not allowed here";
			}
			continue;
		}
		if (lim === undefined) {
			continue;
		}
		// with a min/max range the options are presets and other values in the range are allowed
		if (lim.options !== undefined && lim.min === undefined && lim.max === undefined && !lim.options.some(o => o.value === x)) {
			return `must be one of ${lim.options.map(o => o.value).join(", ")}`;
		}
		if (lim.integer && !Number.isInteger(x)) {
			return "must be a whole number";
		}
		if (lim.min !== undefined && x < lim.min) {
			return `below the minimum ${lim.min}`;
		}
		if (lim.max !== undefined && x > lim.max) {
			return `above the maximum ${lim.max}`;
		}
	}
	return null;
}
