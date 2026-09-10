import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt

from apparel_erp.product_development.doctype.style.style import STYLE_STAGE_STATUSES
from apparel_erp.product_development.doctype.style_bom.style_bom import (
	cost_bom_lines,
	find_workspace_style_bom,
)


class StyleCostSheet(Document):
	def validate(self):
		self.apply_computed_totals()
		if self.docstatus == 0 and self.workflow_state != "Draft":
			self.workflow_state = "Draft"

	def on_submit(self):
		# Versioning: each submit is a new revision, chained via amended_from,
		# exactly like Style BOM's version field - every submitted costing
		# stays a permanent, read-only snapshot and edits only ever happen
		# on a fresh Draft (amend).
		if self.amended_from:
			prev = frappe.db.get_value("Style Cost Sheet", self.amended_from, "revision") or 1
			self.db_set("revision", prev + 1)
		elif not self.revision:
			self.db_set("revision", 1)
		# Submitting only ever lands the document in "Submitted" - a further,
		# explicit Approve step (see approve_workspace_cost_sheet_final) is
		# required before it is considered Approved.
		self.db_set("workflow_state", "Submitted")
		self._mark_style_costed()

	def on_cancel(self):
		self.db_set("workflow_state", "Draft")

	def apply_computed_totals(self):
		amounts = compute_cost_amounts(self)
		for key, value in amounts.items():
			setattr(self, key, value)

	def _mark_style_costed(self):
		if not self.style:
			return
		current = frappe.db.get_value("Style", self.style, "style_stage_status") or "Draft"
		if current not in STYLE_STAGE_STATUSES:
			return
		if STYLE_STAGE_STATUSES.index(current) < STYLE_STAGE_STATUSES.index("Costed"):
			frappe.db.set_value("Style", self.style, "style_stage_status", "Costed")


def compute_cost_amounts(doc, bom_costs=None):
	if bom_costs is None:
		bom_costs = {"fabric_amount": 0, "trims_amount": 0}
		if doc.style_bom and frappe.db.exists("Style BOM", doc.style_bom):
			sb = frappe.get_doc("Style BOM", doc.style_bom)
			bom_costs = cost_bom_lines(sb)

	fabric = flt(bom_costs.get("fabric_amount"))
	trims = flt(bom_costs.get("trims_amount"))
	cmt = flt(doc.cmt_rate)
	testing = flt(doc.testing_logistics)
	# User-added ad-hoc commercial line items (freight surcharge, sample
	# fee, etc.) - as many as the user wants, added on the Costing tab.
	# They're direct cost, same as CMT/testing, so they feed into overhead
	# and total the same way. Each row's own amount is resolved from its
	# Type first (Actual/On Net Total/On Previous Row Amount/On Previous
	# Row Total/On Item Quantity) and written back onto the row, exactly
	# like ERPNext's own Sales/Purchase Taxes and Charges "Type" column.
	net_total = fabric + trims + cmt + testing
	resolved_extra = compute_extra_item_amounts(doc, net_total)
	for row, amount in zip(doc.get("extra_items") or [], resolved_extra):
		row.amount = amount
	extra = sum(resolved_extra)
	overhead_pct = flt(doc.overhead_pct)
	overhead = (fabric + trims + cmt + testing + extra) * overhead_pct / 100.0
	total = fabric + trims + cmt + testing + extra + overhead
	margin = flt(doc.target_margin)
	selling = total / (1 - margin / 100.0) if margin < 100 else total
	return {
		"fabric_amount": fabric,
		"trims_amount": trims,
		"cmt_amount": cmt,
		"testing_amount": testing,
		"extra_items_amount": extra,
		"overhead_amount": overhead,
		"total_cost": total,
		"selling_price": selling,
	}


def compute_extra_item_amounts(doc, net_total):
	"""Resolve every Extra Item row's amount from its charge_type, mirroring
	ERPNext's Sales/Purchase Taxes and Charges "Type" pattern applied to
	this cost sheet's commercial line items:

	  - Actual: the row's own Amount / pc is entered directly and used as-is.
	  - On Net Total: Rate% of net_total (fabric + trims + CMT + testing -
	    the direct cost BEFORE any extra item or overhead).
	  - On Previous Row Amount: Rate% of one specific EARLIER row's own
	    resolved amount, chosen via that row's 1-based position (row_id).
	  - On Previous Row Total: Rate% of the running total through that
	    earlier row (net_total + every extra item amount up to and
	    including it).
	  - On Item Quantity: Rate x quantity. This cost sheet is entirely
	    per-piece, so quantity is always 1 here - behaves like Actual
	    entered via a Rate field, kept for parity with the familiar
	    ERPNext charge-type list and to leave room for a real per-order
	    quantity later.

	Rows are resolved strictly top-to-bottom, so a row can only reference
	one above it - never itself or one below (prevents circular refs)."""
	rows = doc.get("extra_items") or []
	resolved = []
	running_totals = []
	running = net_total
	for idx, row in enumerate(rows):
		charge_type = row.get("charge_type") or "Actual"
		rate = flt(row.get("rate"))
		if charge_type == "On Net Total":
			amount = net_total * rate / 100.0
		elif charge_type == "On Item Quantity":
			amount = rate
		elif charge_type in ("On Previous Row Amount", "On Previous Row Total"):
			ref_pos = cint(row.get("row_id"))
			ref_idx = ref_pos - 1
			if ref_pos < 1 or ref_idx >= idx:
				frappe.throw(_(
					"Extra item row {0} ('{1}'): \"Reference Row\" must point to an earlier row (1 to {2})."
				).format(idx + 1, row.get("label") or "", idx))
			base = resolved[ref_idx] if charge_type == "On Previous Row Amount" else running_totals[ref_idx]
			amount = base * rate / 100.0
		else:
			amount = flt(row.get("amount"))
		resolved.append(amount)
		running += amount
		running_totals.append(running)
	return resolved


def serialize_cost_sheet(doc, bom_meta=None, tech_pack=None, bom_costs=None):
	if bom_costs is None and doc.style_bom:
		try:
			sb = frappe.get_doc("Style BOM", doc.style_bom)
			bom_costs = cost_bom_lines(sb)
		except Exception:
			bom_costs = {}
	bom_costs = bom_costs or {}
	return {
		"name": doc.name,
		"style": doc.style,
		"style_bom": doc.style_bom,
		"revision": doc.revision or 0,
		"docstatus": doc.docstatus,
		"workflow_state": doc.workflow_state or ("Submitted" if doc.docstatus == 1 else "Draft"),
		"currency": doc.currency or "INR",
		"target_margin": doc.target_margin,
		"buyer_target": doc.buyer_target,
		"cmt_rate": doc.cmt_rate,
		"testing_logistics": doc.testing_logistics,
		"overhead_pct": doc.overhead_pct,
		"fabric_amount": doc.fabric_amount,
		"trims_amount": doc.trims_amount,
		"cmt_amount": doc.cmt_amount,
		"testing_amount": doc.testing_amount,
		"extra_items_amount": doc.extra_items_amount,
		"overhead_amount": doc.overhead_amount,
		"total_cost": doc.total_cost,
		"selling_price": doc.selling_price,
		"editable": doc.docstatus == 0,
		"fabric_qty": bom_costs.get("fabric_qty") or 0,
		"fabric_rate": bom_costs.get("fabric_rate") or 0,
		"extra_items": [
			{
				"name": row.name,
				"label": row.label,
				"charge_type": row.charge_type or "Actual",
				"rate": row.rate,
				"row_id": row.row_id,
				"amount": row.amount,
			}
			for row in (doc.get("extra_items") or [])
		],
		"bom": bom_meta,
		"tech_pack": tech_pack,
	}


def _tech_pack_meta(style):
	name = frappe.db.get_value("Design Tech Pack", {"style": style}, "name")
	if not name:
		return None
	version = frappe.db.get_value("Design Tech Pack", name, "tech_pack_version")
	return {"name": name, "version": version or "1.0"}


def _bom_meta(style, preferred_name=None):
	if preferred_name and frappe.db.exists("Style BOM", preferred_name):
		sb = frappe.get_doc("Style BOM", preferred_name)
		return {
			"name": sb.name,
			"version": sb.version or 0,
			"bom_type": sb.bom_type,
			"docstatus": sb.docstatus,
		}
	sb, inherited = find_workspace_style_bom(style)
	if not sb:
		return None
	return {
		"name": sb.name,
		"version": sb.version or 0,
		"bom_type": sb.bom_type,
		"docstatus": sb.docstatus,
		"inherited_from": inherited,
	}


def _get_or_create_draft_cost_sheet(style):
	name = frappe.db.get_value(
		"Style Cost Sheet", {"style": style, "docstatus": 0}, "name", order_by="modified desc"
	)
	if name:
		return frappe.get_doc("Style Cost Sheet", name)

	submitted = frappe.db.get_value(
		"Style Cost Sheet", {"style": style, "docstatus": 1}, "name", order_by="revision desc"
	)
	if submitted:
		return frappe.get_doc("Style Cost Sheet", submitted)

	doc = frappe.new_doc("Style Cost Sheet")
	doc.style = style
	doc.currency = "INR"
	doc.target_margin = 18
	doc.overhead_pct = 8
	doc.revision = 0
	bom = _bom_meta(style)
	if bom:
		doc.style_bom = bom["name"]
	return doc


@frappe.whitelist()
def get_workspace_cost_sheet(style):
	style_doc = frappe.get_doc("Style", style)
	if not frappe.has_permission("Style", "read", doc=style_doc):
		frappe.throw(_("Not permitted to read Style {0}").format(style))

	doc = _get_or_create_draft_cost_sheet(style)

	if doc.docstatus == 0:
		bom_meta = _bom_meta(style)
		if bom_meta and doc.style_bom != bom_meta["name"]:
			doc.style_bom = bom_meta["name"]
	else:
		bom_meta = _bom_meta(style, doc.style_bom)

	bom_costs = {"fabric_amount": 0, "trims_amount": 0, "fabric_qty": 0, "fabric_rate": 0}
	if doc.style_bom and frappe.db.exists("Style BOM", doc.style_bom):
		bom_costs = cost_bom_lines(frappe.get_doc("Style BOM", doc.style_bom))

	if doc.docstatus == 0:
		for key, value in compute_cost_amounts(doc, bom_costs).items():
			setattr(doc, key, value)

	payload = serialize_cost_sheet(doc, bom_meta, _tech_pack_meta(style), bom_costs)
	payload["unsaved"] = not bool(doc.name)
	return payload


@frappe.whitelist()
def save_workspace_cost_sheet(style, payload=None):
	if payload is None:
		payload = frappe.form_dict.get("payload")
	if isinstance(payload, str):
		payload = json.loads(payload)

	if not frappe.has_permission("Style Cost Sheet", "write"):
		frappe.throw(_("Not permitted to update Style Cost Sheet"))

	doc = _get_or_create_draft_cost_sheet(style)
	if doc.docstatus == 1:
		frappe.throw(_("Submitted cost sheet {0} is read-only. Amend it to recost.").format(doc.name))

	for field in ("currency", "target_margin", "buyer_target", "cmt_rate", "testing_logistics", "overhead_pct"):
		if field in payload:
			setattr(doc, field, payload.get(field))

	# Replace extra_items wholesale from the payload each save - the user
	# can add/remove as many ad-hoc commercial line items as they want on
	# the Costing tab, so the whole set is sent and rebuilt here rather
	# than diffed row by row.
	if "extra_items" in payload:
		doc.set("extra_items", [])
		for row in (payload.get("extra_items") or []):
			label = (row.get("label") or "").strip()
			if not label:
				continue
			doc.append("extra_items", {
				"label": label,
				"charge_type": row.get("charge_type") or "Actual",
				"rate": flt(row.get("rate")),
				"row_id": cint(row.get("row_id")) or None,
				# Recomputed by apply_computed_totals() on save regardless
				# of Type - sent through so an Actual row's typed value
				# round-trips even before the next save recalculates it.
				"amount": flt(row.get("amount")),
			})

	bom_meta = _bom_meta(style)
	if bom_meta:
		doc.style_bom = bom_meta["name"]

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	bom_costs = cost_bom_lines(frappe.get_doc("Style BOM", doc.style_bom)) if doc.style_bom else {}
	return serialize_cost_sheet(doc, bom_meta, _tech_pack_meta(style), bom_costs)


@frappe.whitelist()
def approve_workspace_cost_sheet(style):
	"""Clicking "Submit costing" in the workspace lands the sheet in the
	Submitted state (docstatus 1, workflow_state "Submitted") - it does NOT
	jump straight to Approved. A separate reviewer action
	(approve_workspace_cost_sheet_final) is required to mark it Approved."""
	if not frappe.has_permission("Style Cost Sheet", "submit"):
		frappe.throw(_("Not permitted to submit Style Cost Sheet"))

	doc = _get_or_create_draft_cost_sheet(style)
	if not doc.name:
		doc.save(ignore_permissions=True)
	if doc.docstatus == 1:
		return serialize_cost_sheet(doc, _bom_meta(style, doc.style_bom), _tech_pack_meta(style))
	doc.submit()
	frappe.db.commit()
	doc.reload()
	return serialize_cost_sheet(doc, _bom_meta(style, doc.style_bom), _tech_pack_meta(style))


@frappe.whitelist()
def approve_workspace_cost_sheet_final(style):
	"""Explicit reviewer step that moves an already-Submitted costing to
	Approved. Kept separate from submit() on purpose so "Submitted" and
	"Approved" stay two distinct, auditable states instead of one click
	skipping straight past review."""
	if not frappe.has_permission("Style Cost Sheet", "submit"):
		frappe.throw(_("Not permitted to approve Style Cost Sheet"))

	name = frappe.db.get_value(
		"Style Cost Sheet", {"style": style, "docstatus": 1}, "name", order_by="revision desc"
	)
	if not name:
		frappe.throw(_("Submit the costing before it can be approved."))
	doc = frappe.get_doc("Style Cost Sheet", name)
	if doc.workflow_state == "Approved":
		return serialize_cost_sheet(doc, _bom_meta(style, doc.style_bom), _tech_pack_meta(style))
	doc.db_set("workflow_state", "Approved")
	frappe.db.commit()
	doc.reload()
	return serialize_cost_sheet(doc, _bom_meta(style, doc.style_bom), _tech_pack_meta(style))


@frappe.whitelist()
def amend_workspace_cost_sheet(style):
	"""Explicit "Start new revision" action in the workspace - creates the
	next Draft revision from the latest Submitted/Approved Style Cost Sheet
	via a standard Frappe amend, chained through amended_from exactly like
	Style BOM's version history. Idempotent: reuses an amendment already in
	progress instead of creating duplicates."""
	if not frappe.has_permission("Style Cost Sheet", "create"):
		frappe.throw(_("Not permitted to create Style Cost Sheet"))

	latest = frappe.db.get_value(
		"Style Cost Sheet", {"style": style, "docstatus": 1}, "name", order_by="revision desc"
	)
	if not latest:
		frappe.throw(_("No submitted costing to amend yet."))

	existing_draft = frappe.db.get_value(
		"Style Cost Sheet", {"style": style, "docstatus": 0, "amended_from": latest}, "name"
	)
	if existing_draft:
		doc = frappe.get_doc("Style Cost Sheet", existing_draft)
	else:
		source = frappe.get_doc("Style Cost Sheet", latest)
		doc = frappe.copy_doc(source)
		doc.amended_from = latest
		doc.workflow_state = "Draft"
		doc.revision = 0
		doc.insert(ignore_permissions=True)
		frappe.db.commit()

	bom_meta = _bom_meta(style, doc.style_bom)
	bom_costs = cost_bom_lines(frappe.get_doc("Style BOM", doc.style_bom)) if doc.style_bom else {}
	return serialize_cost_sheet(doc, bom_meta, _tech_pack_meta(style), bom_costs)