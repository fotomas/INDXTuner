# INDX Tuner - design

A DuetWebControl 3.7 plugin for tuning the settings of the INDX tool changer on RepRapFirmware.

## Purpose and output

The plugin edits one settings file: `0:/sys/INDX_variables_override.g`, the list of values that differ from the
defaults in `INDX_variables.g`. That file is the plugin's only output. Nothing is changed live with
`set global` from the editor; a save writes the file and runs `INDX_variables.g` again, which is the
same path the printer takes at startup.

## Files

| File | Used for |
| --- | --- |
| `0:/sys/INDX_variables.g` | Every INDX variable: name, default, comments, section. Missing = plugin is read-only and says the INDX files need to be installed |
| `0:/sys/INDX_variables_override.g` | Current overrides. Missing = created on the first save |
| `0:/sys/INDX_*.g`, `tfree/tpre/tpost<n>.g`, the system macros of the release, `config.g`, the `0:/macros` listing | The INDX files check (Setup → INDX files). The tool macros and a missing called `INDX_Prime.g` are the only macros the plugin writes |
| `0:/sys/indx-tuner-clamp.csv` | The plugin's own log of clamp measurements, written by Measure; created on the first measurement |
| `0:/sys/indx_tc_checks.csv` | The clamping force of each tool's last pickup when the INDX check log is on, for the bars on the Tool docks page |
| Object model `tools`, `boards[0].shortName` | The number of docks; the mesh point limit |
| `0:/sys/indx-state.g`, `0:/sys/indx-head.g` | Variables restored after the override file (calibration and head state). They are shown as "set by calibration/state" and are not editable, because an override would be overwritten |

Nothing about the variables is hard-coded: the plugin works with any INDX version whose
`INDX_variables.g` declares variables as `global NAME = value`. A small table in the plugin adds units
and limits for the variables it knows; the rest are edited with a type check only.

### Parsing `INDX_variables.g`

- A section starts at a header comment `; --- Title ---`. Text in brackets after the title is the
  section's description.
- A variable is the first `global NAME = value ; comment` for that name. Comment lines directly above
  its `if !exists(...)` block, plus the inline comment, are its help text.
- Editable defaults are literals: numbers, `null`, and lists of those (`{1, 2.5, null}`). A default that
  is an expression, a string or a boolean is shown but not editable.
- Sections whose title starts with "Tool change state" hold runtime values and are not shown.
- A number with a decimal point (`11.0`) stays a float when written (`12` is written `12.0`), because
  RRF keeps integers and floats apart.

## Layout

Same layout as Resonance Lab: a rail on the left, the working pane on the right.

- Rail, **Settings**: one entry per section of `INDX_variables.g` in Title Case, with a red mark when it
  has a problem that blocks saving. No modified counters, except Overrides (count) and Save (unsaved changes).
- Rail, **Setup**: *INDX files*.
- Rail, **Review**: *Overrides* (only what is in the override file, plus override lines the plugin does
  not know), *Save* (the pending changes and the file diff).
- Pane: section title and description, then one row per variable: name and help, default, value in the
  file, the edit field and a "back to default" button. Rows show their state: default, override,
  pending.

### Section names and icons

A table in the plugin (`src/model/sections.ts`), matched on the start of the header. A header it does
not know is shown as written, with the default icon.

| Header starts with | Shown as | Icon | Notes |
| --- | --- | --- | --- |
| Tool docks | Tool docks | `mdi-garage-variant` | graphical page, see below |
| Latch | - | `mdi-download-lock-outline` | merged into Tool docks |
| Prime and wipe | Prime & Wipe | `mdi-wiper` | |
| Tool change speeds | | `mdi-speedometer` | |
| Tool change checks | | `mdi-order-bool-ascending-variant` | |
| Load cell calibration | | `mdi-scale-balance` | |
| Load cell probing | | `mdi-download-multiple-outline` | |
| Mesh area | | `mdi-artboard` | point count, see below |
| homez probe point | | `mdi-crosshairs-gps` | |

The plugin's own icon is `mdi-lock-smart`.

### Hidden variables

- Variables whose default is not a plain value (an expression, a string, a boolean) and that are not in
  the override file, e.g. `INDX_Y_hard_min` and `INDX_TC_log`.
- `INDX_latch_tool`, unless its number collides with a dock tool; then it is shown with a warning.
- Sections whose title starts with "Tool change state".

### Choices

Variables with a fixed set of values are buttons instead of a field: `INDX_TC_MODE` (Quiet 0.3,
Normal 0.7, Full 1.0), `INDX_TC_check_action`, `INDX_TC_heat_overlap`, `INDX_dock_dir`. A value in the
file that is none of them is shown as an extra "(custom)" button, so the real setting is never hidden.

### Tool docks

- The number of docks comes from the printer: every tool in the object model except
  `INDX_latch_tool`. The tool number is the dock index, so the tools must be T0 to Tn-1.
- When that count differs from the length of `INDX_tool_x`, a banner says so and `INDX_tool_x` and
  `INDX_latch_close_tool` are resized as pending edits (cut, or padded with null). A dock without an X
  position blocks saving until it is entered. Tool numbers with gaps only give a warning.
- The tools are drawn left to right, evenly spaced, as a grid with a label column on the left:
  the tool head, "Clamping force (g)", "X position (mm)", "Latch travel (mm)", "Measure". The latch row
  is only there when `INDX_variables.g` declares `INDX_latch_close_tool` (the official release has no
  latch settings; its latch travel is fixed in `INDX_TC_POST.g`). Units are only in the
  labels. The tool drawing is "A2, ends on the head's curve": stem, rounded body, stem, as tall as the head
  capsule with the stem ends on the head's own curve, and a separate triangle nozzle. The tool on the head is
  drawn in front of the blue head capsule. A tool without its own latch travel shows the
  default (`INDX_latch_close_e`) as a grey value in its field; typing the default value stores null.
- Beside each tool a bar shows the clamping force of its last pickup (pick_g): the newer of the
  plugin's own measurement (`indx-tuner-clamp.csv`) and the `pick_lc` row in `indx_tc_checks.csv`. A
  check-log row from the current boot gets its date from the uptime; older ones count as older than any
  measurement. Source and age are in the tooltip. Red below `INDX_TC_lc_min_g` (the check fails), amber below a fixed
  800 g (the weak level of `INDX_LATCH_TEST`), green above; a line marks `INDX_LC_locking_force`, the
  force the load cell is calibrated to. `INDX_LC_locking_force` itself stays under Load cell calibration.
- The other variables of Tool docks and Latch are listed below the drawing.

### Mesh area

The number of points is worked out as RRF does for `M557` (`Grid.cpp`): `floor(range / spacing) + 1`
per axis, at most 41 in an X row and 441 in total (961 on MB6HC and MB6XD, from `boards[0].shortName`),
spacing at least 0.1 mm, range at least 1 mm. A mesh RRF would refuse blocks saving, with the smallest
spacing that fits.

### Measuring the clamping force

*Measure* per tool and *Measure all* use only the official INDX macros and globals, no extra files on
the card. Allowed when the printer is idle, X, Y and Z are homed, `INDX_LC_calibrated` is true and the
head is empty (`INDX_State` -1, no tool selected); otherwise the reasons are listed. After a
confirmation, for each tool:

1. `M568 P<n> S0 R0` (cold: no print temperature; the pickup heat check still warms it a few degrees),
2. `T<n>`, wait until idle, read `INDX_State`, `INDX_LC_raw`, `INDX_TC_lc_before`, `INDX_LC_scale` and
   `INDX_TC_pick_lc_ok` from DWC's object model; pick_g = |(raw - before) * scale|, as `INDX_TC_POST` computes it,
3. `T-1`, wait until idle, check `INDX_State` is -1,
4. append `date,tool,pick_g,ok` to `0:/sys/indx-tuner-clamp.csv`.

A pickup or park that did not complete stops the run with a message to check the head. *Stop* ends the
run after the current tool. Each `T` is atomic in the firmware, so a browser that disconnects leaves the
printer in a normal state.

### INDX files (Setup)

- **Loaded**: `config.g` runs `INDX_variables.g`, and the INDX globals exist on the printer.
- **INDX release files**: the required INDX macros (`INDX_variables.g`, `INDX_TC_PRE/POST/FREE/REPORT`,
  `INDX_LATCH_MOVE`, `INDX_LATCH_ENGAGE`, `INDX_OPEN`, `INDX_CLOSE`, `INDX_CLOSE_CAL`,
  `INDX_UNLOCK_DANCE`, `INDX_TOOL_CHECK`, `INDX_WRITE_STATE`, `INDX_LC_RAW`, `INDX_TARE`, `INDX_LC_CAL`,
  `INDX_LC_CALIBRATE`, `INDX_LC_RETARE`), the system macros the release replaces (`homez.g`, `bed.g`,
  `mesh.g`, `pause.g`, `stop.g`, `resurrect-prologue.g`) and optional ones (`INDX_LC_SPEED_SWEEP`,
  `INDX_TC_TEST`, also looked for in `0:/macros`). Present or missing.
- **Macro calls**: every literal `M98 P"..."` in the INDX macros, tool macros and system macros above
  must point to an existing file (RRF looks in `0:/sys`, then `0:/macros`). Calls guarded by
  `fileexists("...")` are skipped (e.g. `indx-state.g`, written at runtime); calls built from expressions
  and paths into sub-directories are not checked.
- **Called macros the plugin can create**: `INDX_Prime.g` (not part of the official release). Only when
  another macro calls it: a missing one is listed under the broken calls with *Generate skeleton*, which
  writes it after a preview and never overwrites. The skeleton's only active code is the cold check
  `if !exists(param.T) || param.T < heat.coldExtrudeTemperature` / `M99`, so a cold pickup leaves at
  once; the purge (`M116 P{state.currentTool}`, `INDX_prime_e`, `INDX_prime_retract`) is commented out,
  and comments mark where the user moves to their purge/cleaning position, wipes and moves back. The
  Prime & Wipe page warns when it is called but missing, naming the caller.
- **Tool macros**: for every dock tool, `tfree<n>.g`, `tpre<n>.g` and `tpost<n>.g` must be a single
  `M98 P"INDX_TC_FREE.g" T<n>` (`INDX_TC_PRE.g`, `INDX_TC_POST.g`) with the file's own tool number, as in
  the official release. Each file is marked OK, missing, wrong (another macro or tool number), extra
  lines, or wrong comment. *Fix* and *Fix all* write the official content after a preview; no backup.
  Files for tool numbers the printer does not have are listed but never changed. The latch tool's
  macros are not checked.

## Tuning - Tool Clamping (stepwise close in the dock)

`ClampingForce.vue` + `useClampTuning.ts`. The latch only moves in the dock (the dock activator switches the
extruder drive to the latch; out of the dock E moves extrude), and the clamp is a spring preload set by the
travel. One docking: the user's `INDX_TC_PRE.g T<t>` (approach, empty-head reading), `T<t> P0`, slide in
with limits off, open the latch 3 mm at 200 mA against its open stop (so the close starts where it does after a park:
the unlock dance opens further than any close; without this the T2 curve came out about 1 mm early), then `INDX_LATCH_MOVE.g` in one move to 8 mm (through the slack: about 8.4 mm on T2, 10 mm on T0),
then fine steps (0.075 mm), `INDX_LC_RAW.g` after each step (re-read until the spread is under 20 counts, at
most 2 s; read from the object model, nothing is printed: the block tags INDX_LC_raw_spread with a number unique
to the reading, so an older model update is never taken for it, and the tag is removed afterwards). Stops at target / dock factor + 25 %, when
the force levels off (under 2 % rise over 6 steps: the latch's maximum, about 1950 g on T0), or the
travel/force limits; never reverses (a 0.3 mm reverse did not release the latch in the test). Then
finished like INDX_TC_POST (state, INDX_WRITE_STATE, peel, safe Y) and the pickup force read at safe Y:
dock factor = pickup force / force in the dock (about 0.63 on T2), kept per tool in the browser. After a
park, a search with real pickups (at most 4): a real pickup clamps harder than the stepwise close at the
same travel (about 0.3 mm on T0), so each check well above the target gives the curve's shift and aims the
next; a check on the latch's maximum jumps 0.2 mm down; a check below steps up; done within target + 8 %
or a bracket under 0.03 mm. Suggestion = lowest checked travel that reached the target (0.025 mm steps). "Use" = pending edit of `INDX_latch_close_tool[t]` and the checked force is logged.
Test macro used to establish this: `INDX_LATCH_STEP_TEST.g` (not part of the plugin).

Settled force (2026-11-09): the force is read again after 3 s and then each second until two readings differ
less than 20 g (at most 10 s), and judged on that; the Result table shows both readings. The drop of about a
third first seen after pickups was the prime and wipe (INDX_Prime.g) in INDX_TC_POST, not the clamp settling:
with the prime skipped, T1 read 1673 g right after and 1675 g settled. INDX_TC_POST now primes only while
printing or paused, so tuning runs and console tool changes do not prime. Dock factor = settled pickup force /
force in the dock (about 0.98 without the prime); stored per tool only from a finished docking and only within
0.4-1.5. A check pickup that settles below `INDX_TC_lc_min_g` + 10 % ends the run at Recovery instead of trying
to park. Tool Docks shows the
head_tool reading (INDX_TC_FREE, before each park) instead of pick_lc. Recovery: under 150 g = empty head;
between that and `INDX_TC_lc_min_g` = a tool on a weak clamp (take it off by hand).

## Tuning - Z Offset, Speed, Dock Position

Shared helpers in `useTuning.ts` (run and wait, pick up / park with the official macros, start
conditions, hand a failure to Recovery). Tool selection on the tuning pages is `ToolPicker.vue`: chips plus
the chosen tool drawn on the head like Tool Docks does.
- Z Offset (`ZOffset.vue`, `useZOffset.ts`): all tools, T0 first, N x `G30 S-1` at INDX_probe_x/y,
  table, "Set and save all" = `G10 P<n> Z<z>` lines + `M500 P10` after a confirmation showing them.
- Speed (`SpeedTuning.vue`, `useSpeedTuning.ts`): three groups tuned separately, in any order: Travel
  (INDX_TC_SPEED + INDX_TC_accel, linked by a switch; unlinked: tune one, the other held), Dock approach
  (INDX_TC_contact_speed), Latch (INDX_latch_feed). Steps of 10 % of the INDX default (the current value when
  the default is 0, as for INDX_TC_accel), -30 % to +100 % (+200 % for approach and latch); a "Start level"
  radio per row, lower rows skipped. One test tool, N cycles per step, stop at the first failure; latch also
  fails when the clamp force drops more than 15 % below the first step. Suggestion one step below the fastest
  that passed; "Use for <group>" -> pending edits. The combined chosen levels can be checked on all tools
  (2 cycles each) and then used together.
- Dock Position (`DockPosition.vue`, `useDockPosition.ts`): Measure (motors off, slide onto the tool,
  `G1 H4` distance to the X endstop) and Fine-tune (trial X, nudge, slow approach, dock/undock test).
  See ROADMAP.md for the assumptions to check.

## Clamping force colours

`clampBands()` / `clampColor()` in `useIndxTuner.ts`, used by Tool Docks and Tool Clamping: red below
`INDX_TC_lc_min_g` (the INDX pickup check), amber below 75 % of `INDX_LC_locking_force` (weak) or above
2500 g (`HIGH_CLAMP_G`, too tight), green otherwise. `WEAK_CLAMP_G` (800 g) is only the Tool Clamping
sweep's safety stop.

## Bed Probing

`BedProbing.vue` above the section's settings: print area from the axis limits, the nozzle position of every
mesh point (blue, red outside the print area; nozzle = mesh point in probe coordinates - G31 X/Y offset of
the chosen probe, by default the load cell, M558 P12; buttons name the probes by type: P12 load cell, P11 scanning probe), the mesh area moved the same way, the
homez probe point with its fuzz circle, and the dock line with the docks (reference only). Uses the values
as edited, so it follows typing. A warning names the bound to raise or lower. INDX_mesh_min/max are edited
as separate X and Y fields (`VarRow.vue`, XY_VARS).

## Menu and Overrides

`SECTION_STYLES` (`model/sections.ts`): `inMenu: false` keeps a section out of the menu (Tool Change Speeds,
Tool Change Checks, Load Cell Calibration, Load Cell Probing, Latch). `SettingsTable.vue` with
`rowsOfSection()` shows the latch settings on Tool Clamping; Speed shows INDX_TC_MODE and tunes at
full speed (INDX_TC_MODE 1.0 set live, restored). `extraVars` can show variables of other sections in a section.
Tool Docks shows no settings list; the "Tool docks" section settings are on Dock Position. `PINNED_VARS`
(INDX_DEBUG) are left out of the Settings pages and always listed first on Overrides.
`LIVE_STATE_VARS` (INDX_DEBUG -> INDX_WRITE_STATE.g): kept in indx-state.g, which runs after the override
file. Its toggle makes a normal unsaved change; Save sets it live and runs INDX_WRITE_STATE.g before the
reload instead of writing an override line. The Overrides page lists the override file, then unsaved
changes and settings picked with "Add setting" (an autocomplete of every editable INDX setting not listed
yet, with its section and help text). Its menu badge counts only what the override file sets.

## Reading values from the printer

Never with `M409`: its large JSON replies can end up in the console (a reply may be attributed to another
pending command) and flood out RRF's and other plugins' messages. Globals and other values are read from
DWC's own object model (`readGlobals`, `readKey` in `useIndxTuner.ts`), after a short wait for its next
update; tool changes are confirmed by polling until `INDX_State` is as expected and the printer is idle.

## Save

1. Pending edits are listed with old and new value; a value equal to the default becomes "remove from
   the file". The new file is shown as a diff.
2. On confirm: the file is downloaded again and compared with the loaded copy (refuse and reload if it
   changed elsewhere), the old file is written to `INDX_variables_override.g.bak` (one backup, replaced
   on each save), the new file is written, `M98 P"0:/sys/INDX_variables.g"` runs, and once the machine
   is idle again the globals are read back from the object model and each saved value is checked.
3. Saving is only possible while the machine is idle.

New override lines go into the section of the override file with the matching header, or a new
section at the end. Existing lines keep their comment and its column.

## Safety

- Every write and the reload are confirmed in a dialog that names the file and the command.
- Values are checked against the limits table before they can be saved; unknown variables are checked
  for type only.
- Read-only mode when `INDX_variables.g` is missing or the machine is not connected.

## Not in this version

- A check that the INDX files are the version of the official release (would need a fingerprint per
  release in the plugin).
- Swap tests and timing history (to be decided), the self-update runtime, a dashboard widget.
