import frappe
from frappe.model.document import Document
from frappe import _

WORKFLOW_STAGES = [
	"Style Created",
	"Design & Tech Pack",
	"Sampling",
	"Fit Approval",
	"Proto Approval",
	"Production"
]

STYLE_STATUSES = ("Not Started", "In Progress", "Completed")
STYLE_STAGE_STATUSES = ("Draft", "Development", "Costed", "Confirmed", "In Production", "Closed", "Dropped")
MATRIX_ITEM_STATUSES = ("Active", "Drop", "On Hold")


class Style(Document):
	def validate(self):
		# Check if linked Design Tech Pack has production confirmed
		tech_pack = frappe.db.get_value(
			"Design Tech Pack",
			{"style": self.name},
			["name", "production_confirmed"],
			as_dict=True
		)
		
		if tech_pack and tech_pack.production_confirmed:
			previous = self.get_doc_before_save()
			if previous:
				# Check if colours or sizes have changed. BOM lock is enforced
				# separately: a submitted Style BOM is read-only by Frappe's
				# submittable framework itself, and generated native BOMs are
				# guarded read-only via style_bom.guard_generated_bom_readonly.
				if self.colours != previous.colours:
					frappe.throw(_("Cannot edit Colours: Production has been confirmed in Design Tech Pack {0}. Colours are now locked.").format(tech_pack.name))
				if self.sizes != previous.sizes:
					frappe.throw(_("Cannot edit Sizes: Production has been confirmed in Design Tech Pack {0}. Sizes are now locked.").format(tech_pack.name))
		
		if (self.status or "Not Started") not in STYLE_STATUSES:
			frappe.throw(_("Status must be one of: {0}").format(", ".join(STYLE_STATUSES)))
		if (self.style_stage_status or "Draft") not in STYLE_STAGE_STATUSES:
			frappe.throw(_("Style Stage must be one of: {0}").format(", ".join(STYLE_STAGE_STATUSES)))
		self.validate_base_style()
		self.sync_matrix_rows()
		if not self.development_stage:
			self.development_stage = "Style Created"

	def validate_base_style(self):
		if not self.base_style:
			return
		seen = {self.name}
		current = self.base_style
		while current:
			if current in seen:
				frappe.throw(_("Base Style cannot reference itself or create a cycle."))
			seen.add(current)
			current = frappe.db.get_value("Style", current, "base_style")

	def sync_matrix_rows(self):
		"""Whenever Colours or Sizes change, make sure every approved Colour x Size
		combination has a placeholder row in matrix_items. Existing rows
		(already generated SKUs) are never removed automatically.
		Only creates matrix items for colours approved for production."""
		existing_keys = {
			(row.colour_code, row.size_code): row for row in self.matrix_items
		}
		for row in self.matrix_items:
			if row.item and (not row.item_name or not row.item_code):
				item_data = frappe.db.get_value(
					"Item", row.item, ["item_name", "item_code"], as_dict=True
				)
				if item_data:
					row.item_name = item_data.item_name
					row.item_code = item_data.item_code

		# Only include colours that are: Active AND Approved for Production
		approved_colours = [
			c for c in self.colours 
			if (c.status or "Active") == "Active" and (c.get("approved_for_production") or 0)
		]

		for colour in approved_colours:
			colour_code = colour.colour_code or colour.colour_name
			for size_row in self.sizes:
				size_doc_code = frappe.db.get_value("Size", size_row.size, "size_code") or size_row.size
				key = (colour_code, size_doc_code)
				if key not in existing_keys:
					self.append("matrix_items", {
						"colour": colour.colour_name,
						"colour_code": colour_code,
						"size": size_row.size,
						"size_code": size_doc_code,
						"status": "Not Generated"
					})


@frappe.whitelist()
def get_latest_style_bom(style):
	"""Latest submitted Style BOM for this style, or walk up the Base Style
	chain when this style has none of its own yet. Mirrors the old
	get_effective_bom_items base-style walk, but against the standalone
	Style BOM doctype instead of an embedded child table."""
	seen = set()
	current = style
	while current and current not in seen:
		seen.add(current)
		name = frappe.db.get_value(
			"Style BOM", {"style": current, "docstatus": 1}, "name", order_by="version desc"
		)
		if name:
			bom = frappe.get_doc("Style BOM", name)
			return {
				"name": bom.name,
				"version": bom.version,
				"bom_type": bom.bom_type,
				"style": bom.style,
				"inherited_from": current if current != style else None,
				"line_count": len(bom.lines),
			}
		current = frappe.db.get_value("Style", current, "base_style")
	return None


@frappe.whitelist()
def sync_matrix_for_colour_bom(style, colour_code, bom_name):
	"""Called by the Style BOM generator right after it builds (or reuses)
	one BOM for a colourway. Every size in that colour still needs its own
	sellable Item/SKU - ERPNext needs a concrete unit per order line - only
	the BOM itself is shared across every size of the colour."""
	style_doc = frappe.get_doc("Style", style)
	colour_rows = [r for r in style_doc.matrix_items if r.colour_code == colour_code]
	if not colour_rows:
		return {"sku_count": 0}

	colour_meta = next(
		(c for c in style_doc.colours if c.colour_code == colour_code or c.colour_name == colour_code), None
	)
	for row in colour_rows:
		if not row.item or not frappe.db.exists("Item", row.item):
			sku = row.sku or f"{style_doc.style_no}-{colour_code}-{row.size_code}"
			item = _get_or_create_style_item(
				style_doc,
				item_code=sku,
				item_name=f"{style_doc.style_name} - {colour_meta.colour_name if colour_meta else colour_code} - {row.size_code}",
			)
			row.sku = sku
			row.item = item.name
			row.item_name = item.item_name
			row.item_code = item.item_code
		row.bom = bom_name
		row.status = "Active"
		row.production_for_sku = row.get("production_for_sku") or 1

	style_doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"sku_count": len(colour_rows)}


@frappe.whitelist()
def get_base_style_snapshot(base_style, current_style=None):
	"""Return editable Style data for copying from an existing Base Style."""
	if current_style and base_style == current_style:
		frappe.throw(_("A Style cannot use itself as its Base Style."))

	base_doc = frappe.get_doc("Style", base_style)
	if not frappe.has_permission("Style", "read", doc=base_doc):
		frappe.throw(_("Not permitted to read Base Style {0}").format(base_style))

	return {
		"fields": {
			"company": base_doc.company,
			"product_type": base_doc.product_type,
			"category": base_doc.category,
			"season": base_doc.season,
			"launch_date": base_doc.launch_date,
			"customer_brand": base_doc.customer_brand,
			"designer": base_doc.designer,
			"merchandiser": base_doc.merchandiser,
			"department": base_doc.department,
			"country_of_origin": base_doc.country_of_origin,
			"description": base_doc.description,
			"fit": base_doc.fit,
			"sleeve": base_doc.sleeve,
			"placket": base_doc.placket,
			"collar": base_doc.collar,
			"gender": base_doc.gender,
			"fabric_type": base_doc.fabric_type,
			"style_image": base_doc.style_image,
			"size_chart": base_doc.size_chart
		},
		"colours": [row.as_dict() for row in base_doc.colours],
		"sizes": [row.as_dict() for row in base_doc.sizes]
	}



@frappe.whitelist()
def set_development_stage(style, stage):
	"""Manually advance/rewind the workflow stepper on the Development Workflow tab."""
	if stage not in WORKFLOW_STAGES:
		frappe.throw(_("Unknown stage: {0}").format(stage))
	frappe.db.set_value("Style", style, "development_stage", stage)
	frappe.db.commit()
	return {"development_stage": stage}


def advance_stage_at_least(style, stage):
	"""Called from Design Tech Pack - push the Style forward to `stage` unless it is
	already at or past it. Never moves the stepper backwards automatically."""
	if stage not in WORKFLOW_STAGES:
		return
	current = frappe.db.get_value("Style", style, "development_stage") or "Style Created"
	if WORKFLOW_STAGES.index(stage) > WORKFLOW_STAGES.index(current):
		frappe.db.set_value("Style", style, "development_stage", stage)


@frappe.whitelist()
def set_matrix_item_status(style, matrix_item, status):
	if status not in MATRIX_ITEM_STATUSES:
		frappe.throw(_("Status must be one of: {0}").format(", ".join(MATRIX_ITEM_STATUSES)))

	style_doc = frappe.get_doc("Style", style)
	target_row = next((row for row in style_doc.matrix_items if row.name == matrix_item), None)
	if not target_row:
		frappe.throw(_("Matrix item not found: {0}").format(matrix_item))
	if not target_row.item:
		frappe.throw(_("Generate the SKU before setting its status."))

	target_row.status = status
	style_doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"status": status}


@frappe.whitelist()
def get_production_selection_matrix(style):
	"""Return matrix data for production selection dialog."""
	style_doc = frappe.get_doc("Style", style)
	
	# Group matrix items by colour and size
	matrix_data = []
	for row in style_doc.matrix_items:
		matrix_data.append({
			"name": row.name,
			"colour": row.colour,
			"colour_code": row.colour_code,
			"size": row.size,
			"size_code": row.size_code,
			"sku": row.sku or f"{style_doc.style_no}-{row.colour_code}-{row.size_code}",
			"status": row.status,
			"production_for_sku": row.get("production_for_sku") or 1,  # Default to 1 (true)
			"has_bom": bool(row.bom)
		})
	
	return {"matrix_items": matrix_data}


@frappe.whitelist()
def save_production_selection(style, selection_data):
	"""Save which colour/size/BOM combinations are for production."""
	import json
	
	if isinstance(selection_data, str):
		selection_data = json.loads(selection_data)
	
	style_doc = frappe.get_doc("Style", style)
	
	# Update matrix items with production selection
	for item_data in selection_data:
		for row in style_doc.matrix_items:
			if row.name == item_data.get("name"):
				row.production_for_sku = item_data.get("production_for_sku", 1)
				break
	
	style_doc.save(ignore_permissions=True)
	frappe.db.commit()
	
	return {"success": True, "message": _("Production selection saved successfully.")}


def _get_or_create_item_group(name):
	if not frappe.db.exists("Item Group", name):
		ig = frappe.new_doc("Item Group")
		ig.item_group_name = name
		ig.parent_item_group = frappe.db.get_value(
			"Item Group", {"is_group": 1}, "name"
		) or "All Item Groups"
		ig.insert(ignore_permissions=True)
	return name


def _get_or_create_style_item(style_doc, item_code=None, item_name=None):
	item_code = item_code or style_doc.style_no
	if frappe.db.exists("Item", item_code):
		return frappe.get_doc("Item", item_code)

	item = frappe.new_doc("Item")
	item.item_code = item_code
	item.item_name = item_name or style_doc.style_name
	item.item_group = _get_or_create_item_group(style_doc.product_type or "Finished Goods")
	item.stock_uom = "Nos"
	item.is_stock_item = 1
	item.description = style_doc.description
	if style_doc.style_image:
		item.image = style_doc.style_image
	item.insert(ignore_permissions=True)
	return item

