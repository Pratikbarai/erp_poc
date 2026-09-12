import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, date_diff, getdate, today


class StyleTNA(Document):
	def validate(self):
		self._recompute_rows()

	def _recompute_rows(self):
		for row in self.activities:
			self._recompute_row(row)

	def _recompute_row(self, row):
		# actual_date wins regardless of plan_date - auto-fetched milestones
		# (Design & Tech Pack / Costing / Sampling) are deliberately created
		# with no plan_date at all, since they're tracked by real workspace
		# status rather than planned dates. Checking plan_date first meant
		# those rows could never reach "Done" even once actual_date was set -
		# sync_tna_activities_from_style would report a milestone as newly
		# marked, but the row stayed showing "Open" forever.
		if row.actual_date:
			row.status = "Done"
			row.variance_days = date_diff(getdate(row.actual_date), getdate(row.plan_date)) if row.plan_date else 0
			return

		if not row.plan_date:
			row.status = row.status or "Open"
			row.variance_days = 0
			return

		plan = getdate(row.plan_date)
		revised = getdate(row.revised_date) if row.revised_date else plan

		row.variance_days = date_diff(revised, plan)
		if getdate(today()) > revised:
			row.status = "Late"
		elif revised > plan:
			row.status = "At Risk"
		else:
			row.status = "Open"


def _serialize(doc):
	rows = []
	counts = {"Done": 0, "Open": 0, "At Risk": 0, "Late": 0}
	worst_late = None
	for row in doc.activities:
		status = row.status or "Open"
		counts[status] = counts.get(status, 0) + 1
		if status == "Late" and (worst_late is None or (row.variance_days or 0) > (worst_late.variance_days or 0)):
			worst_late = row
		rows.append({
			"name": row.name,
			"activity_group": row.activity_group,
			"activity": row.activity,
			"responsible": row.responsible,
			"plan_date": row.plan_date,
			"revised_date": row.revised_date,
			"actual_date": row.actual_date,
			"is_milestone": row.is_milestone,
			"status": status,
			"variance_days": row.variance_days or 0,
			"source_reference": row.source_reference,
		})

	banner = None
	if worst_late:
		banner = _(
			"{0} is {1} day(s) late. Downstream activities may need rescheduling."
		).format(worst_late.activity, worst_late.variance_days)

	return {
		"name": doc.name,
		"style": doc.style,
		"po_reference": doc.po_reference,
		"po_qty": doc.po_qty,
		"incoterm": doc.incoterm,
		"template": doc.template,
		"ex_factory_date": doc.ex_factory_date,
		"activities": rows,
		"kpis": {
			"completed": counts.get("Done", 0),
			"on_track": counts.get("Open", 0),
			"at_risk": counts.get("At Risk", 0),
			"delayed": counts.get("Late", 0),
		},
		"banner": banner,
	}


@frappe.whitelist()
def get_workspace_tna(style):
	name = frappe.db.get_value("Style TNA", {"style": style}, "name")
	if not name:
		return None
	doc = frappe.get_doc("Style TNA", name)
	return _serialize(doc)


@frappe.whitelist()
def create_workspace_tna(style, payload=None):
	if frappe.db.exists("Style TNA", {"style": style}):
		frappe.throw(_("A Time & Action schedule already exists for {0}").format(style))
	if not frappe.has_permission("Style TNA", "create"):
		frappe.throw(_("Not permitted to create Style TNA"))

	data = json.loads(payload) if isinstance(payload, str) else (payload or {})
	doc = frappe.new_doc("Style TNA")
	doc.style = style
	doc.po_reference = data.get("po_reference")
	doc.po_qty = data.get("po_qty")
	doc.incoterm = data.get("incoterm") or "FOB"
	doc.template = data.get("template")
	doc.ex_factory_date = data.get("ex_factory_date")
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _serialize(doc)


@frappe.whitelist()
def save_workspace_tna(style, payload):
	name = frappe.db.get_value("Style TNA", {"style": style}, "name")
	if not name:
		frappe.throw(_("No Time & Action schedule for {0} yet.").format(style))
	if not frappe.has_permission("Style TNA", "write"):
		frappe.throw(_("Not permitted to edit Style TNA"))

	doc = frappe.get_doc("Style TNA", name)
	data = json.loads(payload) if isinstance(payload, str) else (payload or {})

	for field in ("po_reference", "po_qty", "incoterm", "template", "ex_factory_date"):
		if field in data:
			setattr(doc, field, data.get(field))

	if "activities" in data:
		doc.set("activities", [])
		for row in data.get("activities") or []:
			if not row.get("activity"):
				continue
			doc.append("activities", {
				"activity_group": row.get("activity_group"),
				"activity": row.get("activity"),
				"responsible": row.get("responsible"),
				"plan_date": row.get("plan_date"),
				"revised_date": row.get("revised_date") or row.get("plan_date"),
				"actual_date": row.get("actual_date"),
				"is_milestone": row.get("is_milestone"),
				"source_reference": row.get("source_reference"),
			})

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _serialize(doc)


# "Fetch activities" (spec: auto-populate/tick off milestones like Design &
# Tech Pack / Costing / Sampling from the style's own real progress
# elsewhere in the workspace, instead of the merchandiser re-typing what
# already happened). Each key is a stable machine reference stored in
# Style TNA Activity.source_reference so a re-sync finds the same row again
# even if the merchandiser has since edited its label/owner/dates.
AUTO_TNA_MILESTONES = [
	{"key": "auto:design_tech_pack", "activity": "Design & Tech Pack completed", "activity_group": "Product Development"},
	{"key": "auto:costing", "activity": "Costing submitted", "activity_group": "Product Development"},
	{"key": "auto:sampling", "activity": "Sampling SKUs generated", "activity_group": "Product Development"},
]


# "Fetch activities" (spec: auto-populate/tick off milestones like Design &
# Tech Pack / Costing / Sampling from the style's own real progress
# elsewhere in the workspace, instead of the merchandiser re-typing what
# already happened). Each key is a stable machine reference stored in
# Style TNA Activity.auto_key so a re-sync finds the same row again even
# after the merchandiser has edited its label/owner/dates, or after
# source_reference has been overwritten with a human-readable detail.
AUTO_TNA_MILESTONES = [
	{"key": "auto:design_tech_pack", "activity": "Design & Tech Pack completed", "activity_group": "Product Development"},
	{"key": "auto:costing", "activity": "Costing submitted", "activity_group": "Product Development"},
	{"key": "auto:sampling", "activity": "Sampling SKUs generated", "activity_group": "Product Development"},
]


def _auto_milestone_info(style, key):
	"""Where this milestone's underlying condition actually stands RIGHT
	NOW - state ("Not Started" / "In Progress" / "Done"), plus who last
	touched it and which version/revision of the real record backs that
	state. Every stage already carries its own versioning (Tech Pack
	version, Costing revision, Style BOM version) - this is what surfaces
	that on the T&A row instead of just a bare date with nothing behind
	it, so "Done" is something the user can actually go look at."""
	if key == "auto:design_tech_pack":
		row = frappe.db.get_value(
			"Design Tech Pack", {"style": style},
			["name", "status", "tech_pack_version", "modified_by"], as_dict=True
		)
		if not row:
			return {"state": "Not Started"}
		state = "Done" if row.status == "Completed" else ("In Progress" if row.status == "In Progress" else "Not Started")
		if state == "Not Started":
			return {"state": "Not Started"}
		return {
			"state": state,
			"responsible": row.modified_by,
			"reference": f"{row.name} (v{row.tech_pack_version or 1})",
		}

	if key == "auto:costing":
		submitted = frappe.db.get_value(
			"Style Cost Sheet", {"style": style, "docstatus": 1},
			["name", "revision", "workflow_state", "modified_by"], as_dict=True, order_by="revision desc"
		)
		if submitted:
			return {
				"state": "Done",
				"responsible": submitted.modified_by,
				"reference": f"{submitted.name} (Rev {submitted.revision or 1}, {submitted.workflow_state})",
			}
		draft = frappe.db.get_value(
			"Style Cost Sheet", {"style": style, "docstatus": 0},
			["name", "modified_by"], as_dict=True
		)
		if draft:
			return {"state": "In Progress", "responsible": draft.modified_by, "reference": f"{draft.name} (Draft)"}
		return {"state": "Not Started"}

	if key == "auto:sampling":
		style_doc = frappe.get_doc("Style", style)
		matrix_items = [m for m in (style_doc.get("matrix_items") or []) if (m.status or "Active") == "Active"]
		if not matrix_items:
			return {"state": "Not Started"}
		generated = [m for m in matrix_items if m.item]
		if not generated:
			return {"state": "Not Started"}

		bom = frappe.db.get_value(
			"Style BOM", {"style": style, "docstatus": 1, "bom_type": "Bulk"},
			["name", "version", "modified_by"], as_dict=True, order_by="version desc"
		)
		reference = f"{len(generated)}/{len(matrix_items)} SKUs"
		if bom:
			reference = f"{bom.name} (v{bom.version or 1}) \u00b7 {reference}"
		info = {"reference": reference, "responsible": bom.modified_by if bom else None}
		info["state"] = "Done" if len(generated) == len(matrix_items) else "In Progress"
		return info

	return {"state": "Not Started"}


@frappe.whitelist()
def sync_tna_activities_from_style(style):
	"""Creates any AUTO_TNA_MILESTONES row that doesn't exist yet on this
	Style TNA (as an open milestone with no plan/actual date - planning
	dates stay the merchandiser's to set), stamps actual_date = today() on
	any that have reached "Done" for the first time, and otherwise keeps
	the row's status, owner and source reference in sync with the real
	record driving it - not just a date with nothing behind it.

	Once a milestone is Done it's permanent - actual_date is never cleared
	and status is never moved back to Open/In Progress, even if the
	underlying record later regresses (e.g. a costing gets cancelled) -
	but the owner/reference are still refreshed on Done rows so they keep
	pointing at the latest version if it changes after the fact (e.g. a
	costing amendment producing a new revision after the original was
	approved). Manually-added activities are untouched either way, since
	those never carry an auto_key - the merchandiser is always free to add
	their own on top of these.

	Pre-existing rows from before auto_key existed matched on
	source_reference instead; those are migrated in place here rather than
	duplicated."""
	name = frappe.db.get_value("Style TNA", {"style": style}, "name")
	if not name:
		frappe.throw(_("No Time & Action schedule for {0} yet. Set one up first.").format(style))
	if not frappe.has_permission("Style TNA", "write"):
		frappe.throw(_("Not permitted to edit Style TNA"))

	doc = frappe.get_doc("Style TNA", name)
	auto_keys = {m["key"] for m in AUTO_TNA_MILESTONES}
	existing_by_key = {}
	for row in doc.activities:
		key = row.auto_key or (row.source_reference if row.source_reference in auto_keys else None)
		if key in auto_keys:
			existing_by_key[key] = row
			if not row.auto_key:
				row.auto_key = key  # migrate a pre-auto_key row in place

	newly_marked = []
	newly_in_progress = []
	for milestone in AUTO_TNA_MILESTONES:
		row = existing_by_key.get(milestone["key"])
		if not row:
			row = doc.append("activities", {
				"activity_group": milestone["activity_group"],
				"activity": milestone["activity"],
				"is_milestone": 1,
				"auto_key": milestone["key"],
			})

		info = _auto_milestone_info(style, milestone["key"])
		state = info.get("state", "Not Started")

		if row.actual_date:
			# Already Done and permanent - still refresh owner/reference in
			# case a later revision superseded the one that completed it.
			if info.get("responsible"):
				row.responsible = info["responsible"]
			if info.get("reference"):
				row.source_reference = info["reference"]
			continue

		if info.get("responsible"):
			row.responsible = info["responsible"]
		if info.get("reference"):
			row.source_reference = info["reference"]

		if state == "Done":
			row.actual_date = today()
			row.status = "Done"
			newly_marked.append(milestone["activity"])
		elif state == "In Progress":
			if row.status != "In Progress":
				newly_in_progress.append(milestone["activity"])
			row.status = "In Progress"
		else:
			row.status = row.status or "Open"

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	result = _serialize(doc)
	result["newly_marked"] = newly_marked
	result["newly_in_progress"] = newly_in_progress
	return result


@frappe.whitelist()
def mark_tna_activity_actual(style, activity_name, actual_date=None):
	"""Records that an activity actually happened - used by the "Mark done
	today" action in the workspace drawer. Status/variance are re-derived
	on save, not set here directly."""
	name = frappe.db.get_value("Style TNA", {"style": style}, "name")
	if not name:
		frappe.throw(_("No Time & Action schedule for {0} yet.").format(style))
	if not frappe.has_permission("Style TNA", "write"):
		frappe.throw(_("Not permitted to edit Style TNA"))

	doc = frappe.get_doc("Style TNA", name)
	row = next((r for r in doc.activities if r.name == activity_name), None)
	if not row:
		frappe.throw(_("Activity not found"))
	row.actual_date = actual_date or today()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _serialize(doc)


@frappe.whitelist()
def reschedule_workspace_tna(style):
	"""Mirrors the prototype's "Reschedule" action: find the worst live
	delay (an activity that is currently Late and has no actual date yet,
	i.e. still blocking downstream work), and push every not-yet-done
	activity's revised date forward by that many days, so the schedule
	reflects the real critical path instead of silently drifting out of
	date. Activities already marked Done are left untouched."""
	name = frappe.db.get_value("Style TNA", {"style": style}, "name")
	if not name:
		frappe.throw(_("No Time & Action schedule for {0} yet.").format(style))
	if not frappe.has_permission("Style TNA", "write"):
		frappe.throw(_("Not permitted to edit Style TNA"))

	doc = frappe.get_doc("Style TNA", name)
	doc._recompute_rows()

	delay = max(
		[row.variance_days or 0 for row in doc.activities if row.status == "Late" and not row.actual_date]
		or [0]
	)

	shifted = 0
	if delay > 0:
		for row in doc.activities:
			if row.actual_date or row.status == "Done":
				continue
			base = getdate(row.revised_date or row.plan_date) if (row.revised_date or row.plan_date) else None
			if not base:
				continue
			row.revised_date = add_days(base, delay)
			shifted += 1

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	result = _serialize(doc)
	result["shifted"] = shifted
	result["delay_days"] = delay
	return result
