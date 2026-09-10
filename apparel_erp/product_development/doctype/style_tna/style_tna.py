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
		if not row.plan_date:
			row.status = row.status or "Open"
			row.variance_days = 0
			return

		plan = getdate(row.plan_date)
		revised = getdate(row.revised_date) if row.revised_date else plan

		if row.actual_date:
			actual = getdate(row.actual_date)
			row.status = "Done"
			row.variance_days = date_diff(actual, plan)
			return

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


def _auto_milestone_done(style, key):
	"""Whether this milestone's underlying condition is true RIGHT NOW.
	Only ever used to mark a milestone done, never to un-mark one that
	already is - see sync_tna_activities_from_style."""
	if key == "auto:design_tech_pack":
		return frappe.db.get_value("Design Tech Pack", {"style": style}, "status") == "Completed"
	if key == "auto:costing":
		return bool(frappe.db.exists("Style Cost Sheet", {"style": style, "docstatus": 1}))
	if key == "auto:sampling":
		style_doc = frappe.get_doc("Style", style)
		matrix_items = [m for m in (style_doc.get("matrix_items") or []) if (m.status or "Active") == "Active"]
		return bool(matrix_items) and all(m.item for m in matrix_items)
	return False


@frappe.whitelist()
def sync_tna_activities_from_style(style):
	"""Creates any AUTO_TNA_MILESTONES row that doesn't exist yet on this
	Style TNA (as an open milestone with no plan/actual date - planning
	dates stay the merchandiser's to set), and stamps actual_date = today()
	on any whose underlying condition is met for the first time.

	Deliberately never un-marks a milestone that was already completed
	(e.g. if a costing later gets cancelled) - once-done T&A history isn't
	erased by a later regression - and never touches manually-added
	activities, since those don't carry one of the AUTO_TNA_MILESTONES
	source_reference keys."""
	name = frappe.db.get_value("Style TNA", {"style": style}, "name")
	if not name:
		frappe.throw(_("No Time & Action schedule for {0} yet. Set one up first.").format(style))
	if not frappe.has_permission("Style TNA", "write"):
		frappe.throw(_("Not permitted to edit Style TNA"))

	doc = frappe.get_doc("Style TNA", name)
	auto_keys = {m["key"] for m in AUTO_TNA_MILESTONES}
	existing_by_key = {row.source_reference: row for row in doc.activities if row.source_reference in auto_keys}

	newly_marked = []
	for milestone in AUTO_TNA_MILESTONES:
		row = existing_by_key.get(milestone["key"])
		if not row:
			row = doc.append("activities", {
				"activity_group": milestone["activity_group"],
				"activity": milestone["activity"],
				"is_milestone": 1,
				"source_reference": milestone["key"],
			})
		if row.actual_date:
			continue
		if _auto_milestone_done(style, milestone["key"]):
			row.actual_date = today()
			newly_marked.append(milestone["activity"])

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	result = _serialize(doc)
	result["newly_marked"] = newly_marked
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
