# Apparel ERP — Architecture & Developer Guide

This document explains how this app is put together, so anyone can read the code, understand why it's shaped the way it is, and safely extend it. It reflects the code as it actually exists on this branch — not a spec, not an aspiration.

If you're new here, read this document top to bottom once. After that, use it as a reference.

## 1. What this app is

A custom Frappe app (`apparel_erp`, single module: **Product Development**) that sits on top of standard ERPNext. The design principle, straight from the original architecture spec this was built against:

> Build apparel intelligence above ERPNext. Let ERPNext remain the execution and accounting truth.

Concretely: this app owns *product development* (styles, tech packs, BOM recipes, costing, sampling, time & action) and hands off to **standard, unmodified ERPNext doctypes** — `Item` and `BOM` — for anything that needs to actually be manufactured. The only ERPNext core doctype this app touches at all is `BOM`, and only via four `Custom Field`s (`custom_style`, `custom_style_bom`, `custom_style_bom_version`, `custom_colourway`) plus one `validate` hook. Everything else is either a brand-new custom doctype or plain `Item` creation through normal Frappe APIs.

## 2. Where everything lives

```
apparel_erp/
├── hooks.py                          # fixtures + the one doc_event hook on BOM
├── fixtures/
│   ├── custom_field.json             # the 4 custom fields added to ERPNext's BOM
│   └── observation_category.json     # seed data for Sampling's observation taxonomy
└── product_development/              # the one module - everything lives here
    ├── doctype/                      # ~34 doctypes, see the table below
    ├── page/style_workspace/         # the single custom Page - the whole UI
    │   ├── style_workspace.py        # trivial: just serves the page
    │   └── style_workspace.js        # ~3500 lines - see section 5
    ├── sampling.py                   # Sampling module's whitelisted API (not tied to one doctype)
    └── (style_bom.py, style.py, style_tna.py, style_cost_sheet.py live inside
         their own doctype folders, per Frappe convention, but each is really
         a small "API module" - most of their weight is whitelisted functions,
         not the Document class itself)
```

There is no separate `sampling` Frappe module — the Sampling doctypes live under the same `Product Development` module folder as everything else. Don't be confused by `sampling.py` sitting directly under `product_development/` rather than under a `doctype/` folder — it's a free-standing API file, exactly like `style_bom.py` conceptually is, just not attached to one specific doctype.

## 3. The three-layer model

This is the mental model everything else follows:

| Layer | Owns | Example doctypes |
|---|---|---|
| **1. Product Development** | Style identity, tech pack, BOM *recipe*, costing, sampling | `Style`, `Design Tech Pack`, `Style BOM`, `Style Cost Sheet`, `Sample Plan`/`Sample Stage`/`Sample Version` |
| **2. Order Pre-Production** | Buyer PO, order matrix, T&A | `Apparel Order`, `Style TNA` |
| **3. ERPNext Manufacturing** | Executable, standard ERPNext records | `Item`, `BOM` (native, untouched except 4 custom fields) |

The single most important consequence of this model: **`Style BOM` and `BOM` are deliberately two different things.** Style BOM is a recipe — a rule set that says "fabric varies by colour, fusing varies by size" — and it's meant to be edited freely, over and over, as development progresses. `BOM` (ERPNext's own doctype) is the *resolved, executable* output: one real BOM per colourway (or per SKU), generated *from* a Style BOM, then locked. Never confuse "editing the Style BOM" with "editing a generated production BOM" — the system enforces this distinction in code (see §6.3).

## 4. Doctype reference

### Core style & product development
| Doctype | Type | Purpose |
|---|---|---|
| `Style` | Document | The canonical garment record. Owns `colours` (child table, `Style Colour`), `sizes` (`Style Size`), `matrix_items` (`Style Matrix Item` — one row per active-colour × size cell), `style_stage_status` (commercial lifecycle: Draft→Development→Costed→Confirmed→In Production→Closed/Dropped), `bom_generation_stage` (which dev stage triggers the *draft* Style BOM). |
| `Style Colour` | Child table | `colour_name`, `colour_code`, `approved_for_production` (Check, **defaults to 1 at doctype level but the Workspace's own `add_colour()` dialog must set it explicitly** — see gotcha in §8), `status` (Active/Inactive). |
| `Style Size` | Child table | `size_code`, `ratio` (used for Per-Colourway weighted-average generation), `consumption_factor` (used for Per-SKU exact generation). |
| `Style Matrix Item` | Child table | One row per active colour × size. `status`: Not Generated / Active / Drop / On Hold. Populated by `style.py`'s `sync_matrix_rows()` (called from `Style.validate()`) — **only for colours that are both Active and `approved_for_production`.** |
| `Design Tech Pack` | Document | Construction, POM, `front_sketch`/`back_sketch` + `callouts` (pinned notes on those two), plus `reference_images` (unlimited photos, each independently pin-annotatable — see §6.5). `status`: Not Started/In Progress/Completed — gates Style BOM generation when `bom_generation_stage = "Design & Tech Pack"`. |
| `Tech Pack Callout` | Child table | A pinned note. Either on `sketch` (Front/Back) or on `reference_image` (a specific photo's row name) — mutually exclusive, `reference_image` wins when set. `x`/`y` are percentages, never pixels. |
| `Apparel Order` | Document | Buyer PO. `style`, `buyer_po`, `customer`, `order_matrix` (child: colour × size quantities), `delivery_date`. |

### BOM & costing
| Doctype | Type | Purpose |
|---|---|---|
| `Style BOM` | Submittable Document | The recipe. `bom_type`: Development/Bulk (Bulk-type no longer required for generation — that gate was deliberately removed). `bom_generation_mode`: **Per Colourway (Material-wise)** or **Per SKU (Colour x Size)**, no default, must be chosen explicitly. `lines`/`overrides`/`operations` all have `allow_on_submit: 1` — **the whole point is this stays editable after submit**, no cancel+amend needed for routine recipe changes. |
| `Style BOM Line` | Child table | One material/component. `resolution_rule`: Fixed (common/stylewise) / Match garment colour / Match garment size / Explicit Override. `varies_by_colour`, `varies_by_size`, `base_consumption`, `wastage_pct`. |
| `Style BOM Override` | Child table | Exception row: a specific colourway/size deviates from a line's base value. Sparse by design — only add a row when something actually deviates. |
| `Style BOM Operation` | Child table | SMV/operations, copied onto generated BOMs when `with_operations` applies. |
| `Style BOM Generation Log` | Document | Audit trail — one row per generation event (or "already generated, skipped" event), with `generated_bom`. **This is a historical snapshot, not a live query** — a name in here can go stale if the BOM is later renamed/cancelled/deleted (see the 404 saga in this conversation's later turns; the UI now checks `frappe.db.exists` before navigating). |
| `Style Cost Sheet` | Document | Fabric/trims/CMT/testing + `extra_items` (child: ad-hoc commercial line items with `charge_type`: Actual / On Net Total / On Previous Row Amount / On Previous Row Total / On Item Quantity — mirrors ERPNext's own Sales/Purchase Taxes and Charges "Type" pattern). |
| `Style Cost Sheet Extra Item` | Child table | One commercial line item; see `compute_extra_item_amounts()` in `style_cost_sheet.py` for the exact resolution algorithm, row-by-row top-to-bottom, can only reference an earlier row. |
| `Style Submission` | Document | PP/Lab Dip submission records. **No longer gates production BOM generation** (that gate was explicitly removed) — still exists for tracking submissions, just isn't a blocking check anymore. |

### Sampling module (spec milestones M1+M2, plus photo annotation from M3)
| Doctype | Type | Purpose |
|---|---|---|
| `Sampling Template` / `Sampling Template Stage` | Document / child | Company-level template: an ordered list of stages (Proto, Fit, Lab Dip, ...), each with `dependency_type` (Blocking/Advisory), `default_tat_days`, `observation_set`. Template save validates against dependency cycles (depth-limited walk, no graph solver). |
| `Sample Plan` | Document | One per style. Links `style` (not an Item — see §8), snapshots `sampling_template` for drift reporting. |
| `Sample Stage` | Document (not a child table — versions need to link to it, and owner-level permissions apply) | A style's own copy of a template stage, or one added ad hoc (`is_added_for_style`). `status` (Blocked/Not Started/In Progress/Closed - Approved/Closed - Dropped) is **derived**, never set directly except Closed - Dropped — see `_derive_stage_status()` in `sampling.py`. |
| `Sample Version` | Document | One physical round. `status`: In Progress→Submitted→(Approved｜Revised｜Cancelled), all terminal except In Progress/Submitted. Once terminal, the whole document is read-only (enforced in `SampleVersion._enforce_readonly_after_terminal`) — comments still work, nothing else changes. |
| `Sample Observation` | Document | A correction/remark. `photo`/`pos_x`/`pos_y` (percentages) make it a pin; blank `photo` makes it a plain unpinned note. `seq` is a display-only index, re-sequenced on delete. `carried_from` tracks carry-forward lineage. |
| `Sample Photo` | Document | One photo on one version. `capture_source`: Desktop/Mobile/WhatsApp Inbound (WhatsApp inbound isn't wired up — M4, not built). First photo on a version is auto-`is_primary`; deleting it promotes the next one. |
| `Observation Set` / `Observation Item` / `Observation Category` | Document / child / Document | The checklist taxonomy. Category is seeded via fixture (`apparel_erp/fixtures/observation_category.json`) with Fit/Measurement/Fabric/Trim/Workmanship/Print/Cost/Other. |
| `Sample Stage Contributor` | Child table | Backs `Sample Stage.contributors`, a Table MultiSelect against `User`. |

### Time & Action
| Doctype | Type | Purpose |
|---|---|---|
| `Style TNA` | Document | One per style. `po_reference`/`po_qty` (free text/number — there's no formal link to `Apparel Order` here, a known gap). |
| `Style TNA Activity` | Child table | `activity_group`, `activity`, `plan_date`/`revised_date`/`actual_date`, `status`, `is_milestone`, `source_reference` (machine key used by the auto-fetch milestones, see §6.6). |

## 5. The Style Workspace page — frontend architecture

**Everything the user sees is one Frappe Page**: `apparel_erp/product_development/page/style_workspace/style_workspace.js`. There is no build step, no framework — it's a single class (`StyleWorkspace`, roughly) that manages its own state and does old-school `$panels.html(template_string)` + manual jQuery event binding. Read this section before touching the file; the patterns here are not optional conventions, they're load-bearing.

### 5.1 Tab dispatch

One tab bar, ten tabs currently: `info`, `order`, `colours`, `bom`, `prodbom`, `techpack`, `costing`, `sampling`, `tna`, `jobwork`. Clicking a tab button triggers a click handler that calls a central dispatch (`render_panel()`-equivalent), which `if/else`s on `this.active_tab` to call the right `render_X_tab($panels)`. Each `render_X_tab` typically:
1. Shows a loading placeholder,
2. Fetches data via one or more `frappe.call`s to a whitelisted server method,
3. Calls `paint_X_tab($panels)`, which builds the HTML string and calls `$panels.html(...)`,
4. Calls `bind_X_tab($panels)` to attach event handlers to the freshly-inserted DOM.

Some tabs (Sampling, Costing, T&A) call `paint_X_tab` directly, many times, *without* going back through `render_X_tab` — e.g. every time you add an observation, toggle a stage, or switch a view, only `paint_X_tab`+`bind_X_tab` run again, not a full data refetch. This is intentional (avoids unnecessary round trips) but is exactly what created the bug in §8.1 — read that before adding a new tab.

### 5.2 The `$panels.off()` convention — mandatory

`#swPanels` is **one single, long-lived DOM container reused by every tab**, never destroyed. Only its `.html()` content gets replaced. Every `bind_X_tab($panels)` function's **first line** must be:

```js
bind_X_tab($panels) {
    $panels.off();
    // ... then $panels.on(...) / $panels.find(...).on(...) as needed
}
```

`$panels.off()` (no arguments) clears every delegated handler bound directly to `$panels` itself, without touching handlers on child elements (those get destroyed and recreated by `.html()` on every render anyway, so they never leak). Skip this and every re-render of that tab stacks another copy of every click handler onto the same container — clicking something after a few re-renders fires once per accumulated binding. This bit us for real; see §8.1.

If you add a new `bind_X_tab`, add `$panels.off()` as its first line. If you add binding logic *inline* inside a `tpl_X` render function instead of a separate `bind_X_tab` (the Tech Pack tab does this — its bindings live inside `tpl_techpack`, not a separate function), put `$panels.off()` right after `$panels.html(...)` and before the first `.on(...)` call.

### 5.3 Per-tab state

There's no formal state management — state lives as plain properties on the `StyleWorkspace` instance (`this.workspace_sampling`, `this.sampling_selected_stage`, `this.sampling_active_photo`, `this.tp_active_refimg`, `this.tna_view`, etc.). When you add a new interactive tab, follow the existing naming convention (`this.<tab>_<thing>`) and remember to reset any per-record state (selected version, active photo, etc.) when the user navigates away from that record — see the reset block in the `.sw-samp-version` click handler for the pattern.

### 5.4 Lightweight re-render vs full refetch

Two ways to redraw a tab after a client-side-only change (e.g. toggling which item is "selected"):
- **Full refetch**: call `render_X_tab($panels)` again — re-fetches from the server. Safe, always correct, wasteful for pure UI toggles.
- **Lightweight**: call `this.tpl_X($panels, this.cached_data, ...)` directly with already-in-memory data — no server round trip. Used e.g. for `tpl_techpack($panels, this.tp, this.style)` when just toggling which reference image's annotator is open.

Prefer lightweight re-render for pure UI state changes (selecting a photo, switching a view); use the real mutating endpoint + full data refresh for anything that actually changes server data.

## 6. Core flows, end to end

### 6.1 Colours & Sizes → matrix

Add a colour via the Workspace → `add_colour()` dialog → must have "Approved for Production" checked (now an explicit dialog field, previously implicit and invisible — see §8.2) → `save_and_refresh("colours")` does a full `frappe.client.save` of the whole Style doc → server-side `Style.validate()` → `sync_matrix_rows()` creates one `Style Matrix Item` row per (Active + `approved_for_production`) colour × size. Colours failing that check get **no matrix row at all**, not an empty one — the Colours & Sizes tab shows a plain `—`, not a "Not Generated" placeholder, for those cells. Each colour also shows a clickable Approved/Not-approved pill (in both the Colours card and directly on the matrix) to fix this after the fact.

### 6.2 Style BOM lifecycle

1. `generate_style_bom_for_stage(style, stage)` creates the **draft** Style BOM (Development type), gated per `Style.bom_generation_stage` (Design & Tech Pack / Costing / Sampling — whichever the user picked; no default, must be chosen explicitly on the Info tab).
2. Merchandiser fills in `lines`/`overrides`/`operations` on the Workspace's BOM tab.
3. Submit. Because `lines`/`overrides`/`operations`/`bom_generation_mode` are all `allow_on_submit`, the recipe stays editable afterward without cancel+amend — submission is a readiness signal, not a lock.
4. Set `bom_generation_mode` (Per Colourway or Per SKU) — required before production BOM generation will run.

### 6.3 Production BOM generation — the core flow

Entry point: `generate_production_boms(style_bom_name)` in `style_bom.py`. In order:

1. **Gates** (`assert_gates_passed`): `Style.style_stage_status` must be `Confirmed`; at least one colourway must be Active + `approved_for_production`. (PP/Lab Dip approval gates existed earlier and were deliberately removed — don't re-add them without being asked.)
2. **Per colourway loop** (`_generate_or_branch`, called once per colourway in Per Colourway mode, once per colourway×size in Per SKU mode):
   - Look for an existing non-cancelled BOM already tagged with this `custom_style`+`custom_colourway`(+`custom_size`). **If one exists, it is returned untouched — production BOMs are generated exactly once.** To replace one, cancel it explicitly first (frees the slot for the next run).
   - Otherwise, build fresh: `_build_colour_bom` (weighted-average consumption across sizes, attached to a synthetic non-sellable "carrier" Item) or `_build_sku_bom` (exact consumption for one specific size, attached to the real sellable SKU Item — created via `sync_matrix_for_sku_bom` in `style.py`).
   - **Rename** the newly-inserted BOM from ERPNext's default autoname to `Production-{style_no}-{colour}[-{size}]` via `_rename_to_production_name` — uses the internal `frappe.model.rename_doc.rename_doc` (not the whitelisted `frappe.rename_doc` alias, which doesn't accept the permission-bypass this needs on v16), with `append_number_if_name_exists` disambiguating collisions.
   - Submit — but only if the doc is still a Draft (the rename's collision-handling path can return an *already-submitted* existing doc; submitting that again would throw).
3. **Lock forever**: `guard_generated_bom_readonly` (a `validate` hook on native `BOM`, registered in `hooks.py`) blocks any edit to a BOM carrying `custom_style_bom` unless the write is coming from inside the generator itself (`frappe.flags.in_style_bom_generation`). This is what actually makes "generated once" mean something — it's not just that regeneration is a no-op, the record itself can't be hand-edited afterward either.
4. **Log**: `write_generation_log` / `_write_variance_register` write one `Style BOM Generation Log` row per colourway per run (including "already generated, skipped" rows).

Two generation modes, real trade-off, see the doctype's own `bom_generation_mode` field description for the exact wording merchandisers see. Short version: Per Colourway is fewer documents but averaged (materially inaccurate) consumption on a non-sellable carrier item; Per SKU is exact consumption on the real SKU, more documents. No default — must be chosen.

### 6.4 Costing — extra item charge types

`compute_extra_item_amounts(doc, net_total)` in `style_cost_sheet.py` resolves each `Style Cost Sheet Extra Item` row strictly top-to-bottom (a row can only reference a row *above* it, never itself or below — prevents circular refs). Five types, mirroring ERPNext's own tax/charge pattern: Actual (typed value), On Net Total (% of fabric+trims+CMT+testing), On Previous Row Amount (% of one specific earlier row's own resolved amount), On Previous Row Total (% of the running total through that row), On Item Quantity (rate × 1, since this sheet is entirely per-piece). The client-side live preview in `recalc_costing_preview` mirrors this exact algorithm in JS so what you see before saving matches what gets persisted.

### 6.5 Tech Pack annotation

Front/back sketch pins were the original feature; reference images (unlimited, camera-capturable) got the same treatment later, reusing the same `.sw-pin`/`.sw-flat-wrap` CSS and the same click-to-place interaction — deliberately *not* forked into a separate component. A `Tech Pack Callout` row belongs either to `sketch` (Front/Back) or to `reference_image` (a specific photo's row name); when filtering which pins belong to the Front sketch, you must exclude rows with `reference_image` set, or a photo's pins will wrongly also render on the Front sketch (this was a real bug, fixed — see the filter in `tpl_techpack`).

The Sampling module's photo pin annotation (§4, Sample Photo/Sample Observation) is the same pattern again, a third time, independently implemented for a different doctype pair. If you're touching pin annotation logic, check whether the fix belongs in all three places (Front/Back, Tech Pack reference images, Sample photos) — they don't share code, only a UI pattern.

### 6.6 Time & Action auto-fetch + Gantt

`get_workspace_tna` silently reconciles three fixed milestones (`AUTO_TNA_MILESTONES` in `style_tna.py`: Design & Tech Pack completed, Costing submitted, Sampling SKUs generated) against real state elsewhere in the workspace, every time the T&A tab loads — no manual "fetch" button, it just happens. Each milestone is matched to its `Style TNA Activity` row via `source_reference` (a stable machine key), so re-running it finds the same row again rather than duplicating it, and it only ever marks a milestone *done*, never un-marks one (a later regression, e.g. a cancelled costing, doesn't erase T&A history). The Gantt view (`render_tna_gantt`) is a from-scratch HTML/CSS timeline, not Frappe's bundled Gantt library — deliberately, to avoid an extra asset load for one view toggle.

## 7. Whitelisted API surface (by file)

- **`style.py`**: `get_latest_style_bom`, `sync_matrix_for_colour_bom`, `ensure_matrix_sku_item`, `sync_matrix_for_sku_bom`, `get_base_style_snapshot`, `set_development_stage`, `advance_stage_at_least`, `set_matrix_item_status`, `get_production_selection_matrix`, `save_production_selection`.
- **`style_bom.py`**: `generate_style_bom_for_stage`, `import_bom_to_style_bom`, `generate_production_boms`, `get_workspace_production_boms`, `set_bom_generation_mode`, `find_workspace_style_bom`, `get_workspace_style_bom`, `fork_inherited_style_bom`, `save_workspace_style_bom`, `update_style_bom_rates`, `get_item_rate`.
- **`style_cost_sheet.py`**: `get_workspace_cost_sheet`, `save_workspace_cost_sheet`, `approve_workspace_cost_sheet`, `approve_workspace_cost_sheet_final`, `amend_workspace_cost_sheet`.
- **`style_tna.py`**: `get_workspace_tna`, `create_workspace_tna`, `save_workspace_tna`, `sync_tna_activities_from_style`, `mark_tna_activity_actual`, `reschedule_workspace_tna`.
- **`sampling.py`**: `create_plan`, `add_stage`, `create_version`, `decide_version`, `mark_version_submitted`, `cancel_version`, `add_observation`, `update_observation`, `delete_observation`, `add_photo`, `delete_photo`, `drop_stage`, `get_workspace_sampling`.

Every function prefixed `_` is a private helper, not whitelisted, not callable from the client — check `@frappe.whitelist()` decorators, don't assume from the name alone.

## 8. Known gotchas (read before you debug the same thing twice)

**8.1 — Event handler accumulation.** Covered in §5.2. If something fires multiple times or a toast appears more than once per click, check whether the relevant `bind_X_tab` starts with `$panels.off()`.

**8.2 — Invisible gates.** Several fields gate important actions but were, at various points, completely absent from the Workspace UI: `Style.style_stage_status` (gates production BOM generation), `Design Tech Pack.status` (gates Style BOM generation when that's the chosen stage), `Style Colour.approved_for_production` (gates matrix row creation). All three are now exposed (header pills, a status select on the Tech Pack tab, a clickable pill in the Colours card/matrix respectively) — but if you add a *new* gated field, expose it in the Workspace immediately, in the same patch. A gate a merchandiser can't see or set from the app they actually use is a bug, not a feature.

**8.3 — `frappe.rename_doc` vs the internal `rename_doc`.** The public, whitelisted `frappe.rename_doc(doctype, old, new)` does not accept a permission-bypass kwarg on this Frappe version. Renaming a doc from inside a whitelisted server function that needs to bypass permissions requires importing the internal `frappe.model.rename_doc.rename_doc` instead. See `_rename_to_production_name` in `style_bom.py` for the working pattern, plus `docstatus == 0` guard before calling `.submit()` afterward (the rename's collision path can return an already-submitted document).

**8.4 — Desk URL prefix isn't guaranteed to be `/app/`.** Don't hardcode `<a href="/app/...">` links to doctype forms. Use `frappe.set_route("Form", "Doctype", name)` — it resolves to whatever the actual desk prefix is for the site. A hardcoded `/app/` link 404s outright on sites using a different prefix (this one uses `/desk/`).

**8.5 — Stale references in log/audit tables.** `Style BOM Generation Log.generated_bom` is a historical snapshot, written once, never updated if the referenced BOM is later renamed, cancelled, or deleted. Any UI that renders a link from a *log* table (as opposed to a live query) should check `frappe.db.exists(...)` before navigating and show a clear message on failure, rather than letting the user hit a raw 404.

**8.6 — `Style BOM Line.resolution_rule`'s "Fixed" default.** A newly-created child row that doesn't explicitly set a field with a doctype-level default can pick that default up silently server-side, even when the client never set it. Don't assume a blank/unset value on the client means blank server-side after save — if a field has a default, either always set it explicitly, or make any filtering logic downstream check for the *other* distinguishing field instead of relying on absence of the default.

**8.7 — Deploy branch vs. `git push`.** This repo has historically had its `main` branch (what Frappe Cloud deploys from by default) diverge significantly from `update-bom-cost-tabs` (the actual working branch). If a patch is applied and "nothing changed," check which branch the hosting environment is actually tracking before assuming the code is broken.

## 9. Extending this app

**Adding a new Workspace tab:**
1. Add the `<button data-t="yourtab">` in the tab bar template, plus a `data-t="yourtab"` dispatch branch.
2. Write `render_yourtab_tab($panels)` (loading state → `frappe.call` → `paint_yourtab_tab`), `paint_yourtab_tab($panels)` (builds HTML, calls `bind_yourtab_tab`), and `bind_yourtab_tab($panels)` — **starting with `$panels.off()`**.
3. Add the server-side whitelisted method it calls, in whichever file makes sense (a new doctype's own `.py`, or a shared module file like `sampling.py` if the tab spans multiple doctypes).

**Adding a new doctype:**
1. `mkdir` under `apparel_erp/product_development/doctype/your_doctype/`, with `__init__.py`, `your_doctype.json` (`"module": "Product Development"`), `your_doctype.py`.
2. If it needs seed data, add a fixture JSON under `apparel_erp/fixtures/` and register it in `hooks.py`'s `fixtures` list.
3. New doctypes require `bench migrate` (or the equivalent Frappe Cloud deploy step) before they exist in the database — a JS/Python-only change needs an asset rebuild but not a migrate; a new doctype needs both.

**Adding a gated action:** if you're adding any new field that blocks an action until set (a new "must be X before Y" rule), expose that field somewhere reachable in the Workspace *in the same change* — see §8.2.

## 10. What's deliberately not built

From the Sampling module spec, milestones M3 (partial) and M4 were explicitly scoped out or only partially built:
- Photo/pin annotation: **built**, for Sample Photos, Tech Pack sketches, and Tech Pack reference images.
- Draggable pins: **not built** — delete and re-place instead of drag.
- Mobile QR-code capture route (`/sample/capture/<version>`, scan a physical tag → camera opens directly, no navigation): **not built**. Camera capture exists, but through the main Workspace UI on a phone browser, not a standalone route.
- External sharing (`Sample Share`, WhatsApp composite send, guest portal, token-based access): **not built at all** (M4).
- `Apparel Order` → `Sales Order` / `Production Plan` hand-off: **not built**. `Apparel Order` exists and captures the order matrix, but nothing downstream consumes it into standard ERPNext planning yet.
