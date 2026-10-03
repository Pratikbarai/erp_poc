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
		"sales_order": doc.get("sales_order"),
		"sales_order_docstatus": frappe.db.get_value("Sales Order", doc.sales_order, "docstatus") if doc.get("sales_order") else None,
		"production_plan": doc.get("production_plan"),
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
	of whether anything was actually ordered."""
	name = _latest_order_name(style)
	if not name:
		return []
	doc = frappe.get_doc("Apparel Order", name)
	return [
		{"colour_code": r.colour_code, "size_code": r.size_code, "quantity": r.quantity}
		for r in doc.order_matrix if (r.quantity or 0) > 0
	]


@frappe.whitelist()
def create_sales_order_from_apparel_order(style):
	"""Hand-off to standard ERPNext manufacturing (architecture doc, section 6):
	Apparel Order matrix -> real Sales Order on the generated SKU Items.

	Only non-zero ordered cells become Sales Order rows. Every ordered cell
	must already have a SKU Item (created by "Generate all SKUs") - if not,
	this stops with the exact list of missing colour/size cells rather than
	silently creating a partial order. Safe to click twice: if a non-cancelled
	Sales Order is already linked, it is returned instead of creating another.
	From the Sales Order, standard ERPNext takes over (Production Plan, Work
	Orders, Material Requests) using the Production BOMs on those SKU Items."""
	name = _latest_order_name(style)
	if not name:
		frappe.throw(_("No Apparel Order for {0}.").format(style))

	order = frappe.get_doc("Apparel Order", name)
	if not (
		frappe.has_permission("Sales Order", "create")
		or frappe.has_permission("Apparel Order", "write", order)
	):
		frappe.throw(_("Not permitted to create a Sales Order"))

	if order.status == "Cancelled":
		frappe.throw(_("{0} is cancelled.").format(order.name))

	if order.get("sales_order"):
		if frappe.db.get_value("Sales Order", order.sales_order, "docstatus") in (0, 1):
			return {"sales_order": order.sales_order, "created": False}

	rows = [r for r in order.order_matrix if (r.quantity or 0) > 0]
	if not rows:
		frappe.throw(_("{0} has no ordered (non-zero) quantities.").format(order.name))
	if not order.customer:
		frappe.throw(_("Set a Customer on {0} first.").format(order.name))

	customer = frappe.db.get_value("Customer", {"customer_name": order.customer}, "name")
	if not customer:
		customer = frappe.get_doc({
			"doctype": "Customer", "customer_name": order.customer, "customer_type": "Company",
			"customer_group": "All Customer Groups", "territory": "All Territories",
		}).insert(ignore_permissions=True).name

	items, missing = [], []
	for r in rows:
		item = frappe.db.get_value(
			"Style Matrix Item", {"parent": style, "colour_code": r.colour_code, "size_code": r.size_code}, "item"
		)
		if not item:
			missing.append(f"{r.colour_code}/{r.size_code}")
		else:
			items.append({"item_code": item, "qty": r.quantity, "delivery_date": order.delivery_date})
	if missing:
		frappe.throw(_(
			"No SKU Item yet for: {0}. Run \"Generate all SKUs\" on the Colours & sizes tab first."
		).format(", ".join(missing)))

	so = frappe.new_doc("Sales Order")
	so.customer = customer
	so.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	so.transaction_date = frappe.utils.today()
	so.delivery_date = order.delivery_date or frappe.utils.add_days(frappe.utils.today(), 30)
	so.po_no = order.buyer_po
	for row in items:
		so.append("items", row)
	so.insert(ignore_permissions=True)

	frappe.db.set_value("Apparel Order", order.name, "sales_order", so.name)
	frappe.db.commit()
	return {"sales_order": so.name, "created": True}


@frappe.whitelist()
def create_production_plan_from_apparel_order(style):
	"""Create a draft ERPNext Production Plan for the Apparel Order's submitted
	Sales Order, using ERPNext's own item/BOM selection logic. The plan remains
	a draft for review; users submit it and create Work Orders through ERPNext."""
	name = _latest_order_name(style)
	if not name:
		frappe.throw(_("No Apparel Order for {0}.").format(style))
	if not frappe.has_permission("Production Plan", "create"):
		frappe.throw(_("Not permitted to create a Production Plan"))

	order = frappe.get_doc("Apparel Order", name)
	if order.status == "Cancelled":
		frappe.throw(_("{0} is cancelled.").format(order.name))
	if not order.get("sales_order"):
		frappe.throw(_("Create a Sales Order from this Apparel Order first."))

	if order.get("production_plan"):
		plan_status = frappe.db.get_value("Production Plan", order.production_plan, "docstatus")
		if plan_status is not None and plan_status < 2:
			return {"production_plan": order.production_plan, "created": False}

	sales_order = frappe.get_doc("Sales Order", order.sales_order)
	if sales_order.docstatus != 1:
		frappe.throw(_(
			"Sales Order {0} must be submitted before creating a Production Plan. "
			"Open and submit it, then try again."
		).format(sales_order.name))

	missing_boms = [
		row.item_code
		for row in sales_order.items
		if not frappe.db.exists(
			"BOM",
			{"item": row.item_code, "docstatus": 1, "is_active": 1},
		)
	]
	if missing_boms:
		frappe.throw(_(
			"No active, submitted Production BOM was found for: {0}. "
			"Generate Per-SKU production BOMs before creating the Production Plan."
		).format(", ".join(sorted(set(missing_boms)))))

	plan = frappe.new_doc("Production Plan")
	plan.company = sales_order.company
	plan.get_items_from = "Sales Order"
	plan.posting_date = frappe.utils.today()
	plan.append("sales_orders", {
		"sales_order": sales_order.name,
		"sales_order_date": sales_order.transaction_date,
		"customer": sales_order.customer,
		"grand_total": sales_order.base_grand_total,
	})
	plan.get_items()
	if not plan.po_items:
		frappe.throw(_(
			"ERPNext found no remaining Sales Order items with active BOMs for Production. "
			"Check that the Sales Order quantities are not already delivered or covered by Work Orders."
		))

	plan.insert(ignore_permissions=True)
	frappe.db.set_value("Apparel Order", order.name, "production_plan", plan.name)
	frappe.db.commit()
	return {"production_plan": plan.name, "created": True}


@frappe.whitelist()
def get_workspace_manufacturing(style):
	"""Return the ERPNext manufacturing documents connected to this style's
	latest Apparel Order for the Style Workspace Manufacturing tab."""
	style_doc = frappe.get_doc("Style", style)
	if not frappe.has_permission("Style", "read", style_doc):
		frappe.throw(_("Not permitted to read this Style"))

	boms = []
	if frappe.has_permission("BOM", "read"):
		boms = frappe.get_list(
			"BOM",
			filters={"custom_style": style},
			fields=[
				"name", "item", "item_name", "custom_colourway", "custom_size",
				"docstatus", "is_active", "is_default",
			],
			order_by="custom_colourway asc, custom_size asc",
			limit_page_length=0,
		)

	order_name = _latest_order_name(style)
	if not order_name:
		return {
			"order": None,
			"boms": boms,
			"work_orders": [],
			"subcontracting_orders": [],
			"subcontracting_receipts": [],
		}

	order = frappe.get_doc("Apparel Order", order_name)
	if not frappe.has_permission("Apparel Order", "read", order):
		frappe.throw(_("Not permitted to read this Apparel Order"))

	sales_order = None
	if order.get("sales_order") and frappe.has_permission("Sales Order", "read"):
		sales_orders = frappe.get_list(
			"Sales Order",
			filters={"name": order.sales_order},
			fields=["name", "docstatus", "status"],
			limit_page_length=1,
		)
		sales_order = sales_orders[0] if sales_orders else None

	production_plan = None
	if order.get("production_plan") and frappe.has_permission("Production Plan", "read"):
		production_plans = frappe.get_list(
			"Production Plan",
			filters={"name": order.production_plan},
			fields=["name", "docstatus", "status", "posting_date", "total_planned_qty"],
			limit_page_length=1,
		)
		production_plan = production_plans[0] if production_plans else None

	work_orders = []
	work_order_filters = []
	if production_plan and frappe.has_permission("Work Order", "read"):
		work_order_filters.append({"production_plan": production_plan.name})
	if sales_order and frappe.has_permission("Work Order", "read"):
		work_order_filters.append({"sales_order": sales_order.name})

	seen_work_orders = set()
	for filters in work_order_filters:
		for work_order in frappe.get_list(
			"Work Order",
			filters=filters,
			fields=[
				"name", "production_item", "qty", "produced_qty", "status",
				"docstatus", "production_plan", "sales_order",
			],
			order_by="creation desc",
			limit_page_length=0,
		):
			if work_order.name not in seen_work_orders:
				seen_work_orders.add(work_order.name)
				work_orders.append(work_order)

	subcontracting_orders = []
	subcontracting_receipts = []
	if production_plan and frappe.has_permission("Subcontracting Order", "read"):
		subcontracting_order_names = {
			row.name
			for row in frappe.get_list(
				"Subcontracting Order",
				filters={"production_plan": production_plan.name},
				fields=["name"],
				limit_page_length=0,
			)
		}
		plan_subassembly_names = frappe.get_all(
			"Production Plan Sub Assembly Item",
			filters={"parent": production_plan.name},
			pluck="name",
		)
		if plan_subassembly_names:
			subcontracting_order_names.update(
				frappe.get_all(
					"Subcontracting Order Item",
					filters={"production_plan_sub_assembly_item": ["in", plan_subassembly_names]},
					pluck="parent",
				)
			)

		if subcontracting_order_names:
			subcontracting_orders = frappe.get_list(
				"Subcontracting Order",
				filters={"name": ["in", list(subcontracting_order_names)]},
				fields=[
					"name", "supplier", "supplier_name", "status", "docstatus",
					"purchase_order", "production_plan", "transaction_date", "total_qty",
				],
				order_by="creation desc",
				limit_page_length=0,
			)
		if subcontracting_orders and frappe.has_permission("Subcontracting Receipt", "read"):
			subcontracting_order_names = [row.name for row in subcontracting_orders]
			receipt_names = {
				row.parent
				for row in frappe.get_all(
					"Subcontracting Receipt Item",
					filters={"subcontracting_order": ["in", subcontracting_order_names]},
					fields=["parent"],
					limit_page_length=0,
				)
			}
			if receipt_names:
				subcontracting_receipts = frappe.get_list(
					"Subcontracting Receipt",
					filters={"name": ["in", list(receipt_names)]},
					fields=["name", "supplier", "supplier_name", "status", "docstatus", "posting_date", "total_qty"],
					order_by="posting_date desc, creation desc",
					limit_page_length=0,
				)

	return {
		"order": {
			"name": order.name,
			"buyer_po": order.buyer_po,
			"status": order.status,
			"sales_order": sales_order,
			"production_plan": production_plan,
		},
		"boms": boms,
		"work_orders": work_orders,
		"subcontracting_orders": subcontracting_orders,
		"subcontracting_receipts": subcontracting_receipts,
	}
