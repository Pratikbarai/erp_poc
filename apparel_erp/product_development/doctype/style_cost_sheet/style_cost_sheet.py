import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from apparel_erp.product_development.doctype.style.style import STYLE_STAGE_STATUSES
from apparel_erp.product_development.doctype.style_bom.style_bom import (
	cost_bom_lines,
	find_workspace_style_bom,
)


class StyleCostSheet(Document):
	def validate(self):
		self.apply_computed_totals()

	def on_submit(self):
		if self.amended_from:
			prev = frappe.db.get_value("Style Cost Sheet", self.amended_from, "revision") or 1
			self.db_set("revision", prev + 1)
		elif not self.revision:
			self.db_set("revision", 1)
		self._mark_style_costed()

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
	# and total the same way.
	extra = sum(flt(row.amount) for row in (doc.get("extra_items") or []))
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
			{"name": row.name, "label": row.label, "amount": row.amount}
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
	if not frappe.has_permission("Style Cost Sheet", "submit"):
		frappe.throw(_("Not permitted to approve Style Cost Sheet"))

	doc = _get_or_create_draft_cost_sheet(style)
	if not doc.name:
		doc.save(ignore_permissions=True)
	if doc.docstatus == 1:
		return serialize_cost_sheet(doc, _bom_meta(style, doc.style_bom), _tech_pack_meta(style))
	if not doc.revision:
		doc.revision = 1
		doc.db_set("revision", 1)
	doc.submit()
	frappe.db.commit()
	doc.reload()
	return serialize_cost_sheet(doc, _bom_meta(style, doc.style_bom), _tech_pack_meta(style))