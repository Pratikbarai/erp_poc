import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ApparelOrder(Document):
	def validate(self):
		self.total_quantity = int(sum(flt(row.quantity) for row in self.order_matrix))


def _serialize(doc):
	rows = [{
		"name": row.name,
		"colour_code": row.colour_code,
		"colour_name": row.colour_name,
		"size_code": row.size_code,
		"quantity": row.quantity or 0,
	} for row in doc.order_matrix]

	return {
		"name": doc.name,
		"style": doc.style,
		"buyer_po": doc.buyer_po,
		"customer": doc.customer,
		"status": doc.status,
		"currency": doc.currency,
		"incoterm": doc.incoterm,
		"delivery_date": doc.delivery_date,
		"total_quantity": doc.total_quantity or 0,
		"order_matrix": rows,
	}


def _latest_order_name(style):
	return frappe.db.get_value("Apparel Order", {"style": style}, "name", order_by="creation desc")


@frappe.whitelist()
def get_workspace_order(style):
	name = _latest_order_name(style)
	if not name:
		return None
	return _serialize(frappe.get_doc("Apparel Order", name))


@frappe.whitelist()
def create_workspace_order(style, payload=None):
	"""Seeds the order matrix from the style's own active colour x size
	combinations (spec section 5's worked example: 2 colours x 4 sizes)
	so the user only has to type quantities, not rebuild the grid from
	scratch. Cells default to 0 - the point of the matrix is precisely to
	say which of those combinations were actually ordered."""
	if not frappe.has_permission("Apparel Order", "create"):
		frappe.throw(_("Not permitted to create Apparel Order"))

	data = json.loads(payload) if isinstance(payload, str) else (payload or {})
	if not data.get("buyer_po"):
		frappe.throw(_("Buyer PO is required"))

	style_doc = frappe.get_doc("Style", style)
	doc = frappe.new_doc("Apparel Order")
	doc.style = style
	doc.buyer_po = data.get("buyer_po")
	doc.customer = data.get("customer")
	doc.currency = data.get("currency") or "INR"
	doc.incoterm = data.get("incoterm") or "FOB"
	doc.delivery_date = data.get("delivery_date")

	colours = [c for c in style_doc.colours if (c.status or "Active") == "Active"]
	sizes = style_doc.sizes or []
	size_code_by_link = {}
	for sz in sizes:
		size_code_by_link[sz.size] = frappe.db.get_value("Size", sz.size, "size_code") or sz.size

	for c in colours:
		for sz in sizes:
			doc.append("order_matrix", {
				"colour_code": c.colour_code or c.colour_name,
				"colour_name": c.colour_name,
				"size_code": size_code_by_link.get(sz.size, sz.size),
				"quantity": 0,
			})

	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return _serialize(doc)


@frappe.whitelist()
def save_workspace_order(style, payload):
	name = _latest_order_name(style)
	if not name:
		frappe.throw(_("No Apparel Order for {0} yet.").format(style))
	if not frappe.has_permission("Apparel Order", "write"):
		frappe.throw(_("Not permitted to edit Apparel Order"))

	doc = frappe.get_doc("Apparel Order", name)
	data = json.loads(payload) if isinstance(payload, str) else (payload or {})

	for field in ("buyer_po", "customer", "currency", "incoterm", "delivery_date", "status"):
		if field in data:
			setattr(doc, field, data.get(field))

	if "order_matrix" in data:
		doc.set("order_matrix", [])
		for row in data.get("order_matrix") or []:
			doc.append("order_matrix", {
				"colour_code": row.get("colour_code"),
				"colour_name": row.get("colour_name"),
				"size_code": row.get("size_code"),
				"quantity": row.get("quantity") or 0,
			})

	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return _serialize(doc)


@frappe.whitelist()
def get_ordered_combinations(style):
	"""Non-zero colour x size cells from the latest Apparel Order - this is
	the filter the BOM Generator is meant to use per spec section 4 step 2
	("use actual ordered color-size combinations; ignore zero-quantity
	cells"), instead of generating for every colour x size row regardless
	of whether anything was actually ordered.

	Not yet wired into generate_production_boms - that function is under
	active development elsewhere (Per Colourway / Per SKU modes). This is
	the read-only data contract other code should call once that wiring
	happens, so the two pieces of work can land independently without
	conflicting.
	"""
	name = _latest_order_name(style)
	if not name:
		return []
	doc = frappe.get_doc("Apparel Order", name)
	return [
		{"colour_code": r.colour_code, "size_code": r.size_code, "quantity": r.quantity}
		for r in doc.order_matrix if (r.quantity or 0) > 0
	]
