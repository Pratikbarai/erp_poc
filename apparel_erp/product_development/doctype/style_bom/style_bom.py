import frappe
from frappe.model.document import Document
from frappe import _


class StyleBOM(Document):
	def validate(self):
		self._ensure_line_ids()

	def on_submit(self):
		if self.amended_from:
			prev_version = frappe.db.get_value("Style BOM", self.amended_from, "version") or 1
			self.db_set("version", prev_version + 1)
		else:
			self.db_set("version", 1)

	def on_cancel(self):
		# Cancelling a Style BOM does not touch already-generated production
		# BOMs - see section 7.2. Amend and resubmit to trigger regeneration.
		pass

	def _ensure_line_ids(self):
		for row in self.lines:
			if not row.line_id:
				row.line_id = frappe.generate_hash(length=8)


def guard_generated_bom_readonly(bom_doc, method=None):
	"""Section 7.1: generated BOMs are read-only forever, no exceptions -
	including a manual Duplicate of one. Only the generator (which sets
	frappe.flags.in_style_bom_generation while it builds/submits/cancels a
	BOM) may write to a BOM carrying custom_style_bom."""
	if not bom_doc.get("custom_style_bom"):
		return
	if frappe.flags.in_style_bom_generation:
		return
	frappe.throw(
		_("BOM {0} was generated from Style BOM {1} and is read-only. Amend the Style BOM and regenerate instead of editing it directly.")
		.format(bom_doc.name, bom_doc.custom_style_bom)
	)


@frappe.whitelist()
def import_bom_to_style_bom(style, bom):
	"""Copy an existing native BOM's materials into a Draft Style BOM for
	this style - creating one (Development type) if none exists yet. Lines
	are copied as Fixed/invariant; mark varies_by_colour / varies_by_size
	and add overrides afterwards for anything that actually varies."""
	existing_name = frappe.db.get_value(
		"Style BOM", {"style": style, "docstatus": 0}, "name", order_by="creation desc"
	)
	if existing_name:
		sb = frappe.get_doc("Style BOM", existing_name)
	else:
		sb = frappe.new_doc("Style BOM")
		sb.style = style
		sb.bom_type = "Development"

	source = frappe.get_doc("BOM", bom)
	item_count = 0
	for row in source.items:
		sb.append("lines", {
			"section": "Fabric",
			"item": row.item_code,
			"uom": row.uom,
			"base_consumption": row.qty,
			"resolution_rule": "Fixed",
		})
		item_count += 1

	sb.save(ignore_permissions=True)
	frappe.db.commit()
	return {"style_bom": sb.name, "item_count": item_count}


# ---------------------------------------------------------------------------
# Resolution chain (spec section 5)
# Specificity wins: colourway+size beats size-only beats colourway-only
# beats the line's base value. Identical logic to the Style-level chain in
# style.py, operating over this doctype's own lines/overrides instead.
# ---------------------------------------------------------------------------

def _specificity(o):
	return (2 if o.get("colourway") else 0) + (1 if o.get("size") else 0)


def _resolve(overrides, line_id, colourway, size, field):
	candidates = [
		o for o in overrides
		if o.line_id == line_id
		and o.get(field) not in (None, "", 0)
		and (not o.colourway or o.colourway == colourway)
		and (not o.size or o.size == size)
	]
	if not candidates:
		return None
	return max(candidates, key=_specificity).get(field)


def _variant_of(template_item_code, attribute, attribute_value):
	if not template_item_code or not frappe.db.exists("Item", template_item_code):
		return None
	if not frappe.db.get_value("Item", template_item_code, "has_variants"):
		return None
	match = frappe.db.sql(
		"""
		select iva.parent from `tabItem Variant Attribute` iva
		inner join `tabItem` i on i.name = iva.parent
		where iva.attribute = %s and iva.attribute_value = %s and i.variant_of = %s
		limit 1
		""",
		(attribute, attribute_value, template_item_code),
	)
	return match[0][0] if match else None


def resolve_item(sb, line, colourway, size, colour_attribute_value=None):
	explicit = _resolve(sb.overrides, line.line_id, colourway, size, "item_code")
	if explicit:
		return explicit
	if line.resolution_rule == "Match garment colour" and colourway:
		variant = _variant_of(line.item, "Colour", colour_attribute_value or colourway)
		if variant:
			return variant
	if line.resolution_rule == "Match garment size" and size:
		variant = _variant_of(line.item, "Size", size)
		if variant:
			return variant
	return line.item


def resolve_qty(sb, line, colourway, size):
	qty = _resolve(sb.overrides, line.line_id, colourway, size, "consumption")
	return qty if qty is not None else line.base_consumption


def _weighted_avg(values, weights):
	total_weight = sum(weights) or 1
	return sum(v * w for v, w in zip(values, weights)) / total_weight


def get_size_ratio(style_doc):
	return [
		{"size_code": row.size_code or row.size, "ratio": row.get("ratio") or 1}
		for row in style_doc.sizes
	]


# ---------------------------------------------------------------------------
# Gates (spec section 6.3) - all must pass before generation.
# ---------------------------------------------------------------------------

def assert_gates_passed(style_doc, sb):
	if (style_doc.get("style_stage_status") or "Draft") != "Confirmed":
		frappe.throw(_("Style {0} must be Confirmed (Style Stage Status) before generating production BOMs.").format(style_doc.name))

	pp_approved = frappe.db.exists("Style Submission", {
		"style": style_doc.name,
		"submission_type": "PP",
		"status": "Approved",
		"style_bom_version": sb.version,
		"docstatus": 1,
	})
	if not pp_approved:
		frappe.throw(_("No approved PP Style Submission against Style BOM version {0}. Submit and approve one before generating.").format(sb.version))

	active_colourways = [c for c in style_doc.colours if (c.status or "Active") == "Active" and c.get("approved_for_production")]
	if not active_colourways:
		frappe.throw(_("No colourway is Active and Approved for Production."))

	missing_lab_dip = []
	for cw in active_colourways:
		colour_code = cw.colour_code or cw.colour_name
		approved = frappe.db.exists("Style Submission", {
			"style": style_doc.name,
			"submission_type": "Lab Dip",
			"colourway": colour_code,
			"status": "Approved",
			"docstatus": 1,
		})
		if not approved:
			missing_lab_dip.append(colour_code)
	if missing_lab_dip:
		frappe.throw(_("Missing an approved Lab Dip Style Submission for colourway(s): {0}").format(", ".join(missing_lab_dip)))

	for line in sb.lines:
		if line.varies_by_size:
			ratios = get_size_ratio(style_doc)
			has_ratio = any(r["ratio"] and r["ratio"] != 1 for r in ratios)
			has_override_qty = any(
				o.line_id == line.line_id and o.size and o.consumption not in (None, "", 0)
				for o in sb.overrides
			)
			if not has_ratio and not has_override_qty:
				frappe.throw(_(
					"Line '{0}' is marked Varies by Size but no Size Planning Ratio or per-size Style BOM Override has been set. "
					"Populate one of those, or untick Varies by Size to use Base Consumption for every size."
				).format(line.item))


# ---------------------------------------------------------------------------
# The generator (spec section 6) - generate per colourway, not per SKU.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def generate_production_boms(style_bom_name):
	sb = frappe.get_doc("Style BOM", style_bom_name)
	style_doc = frappe.get_doc("Style", sb.style)

	if sb.docstatus != 1:
		frappe.throw(_("Style BOM must be submitted before generating."))
	if sb.bom_type != "Bulk":
		frappe.throw(_("Only a Bulk Style BOM can generate production BOMs."))

	assert_gates_passed(style_doc, sb)

	ratio = get_size_ratio(style_doc)
	active_colourways = [c for c in style_doc.colours if (c.status or "Active") == "Active" and c.get("approved_for_production")]

	generated = []
	frappe.flags.in_style_bom_generation = True
	try:
		for cw in active_colourways:
			colour_code = cw.colour_code or cw.colour_name
			bom_name = _generate_or_branch_for_colourway(style_doc, sb, cw, colour_code, ratio)
			if bom_name:
				generated.append({"colourway": colour_code, "bom": bom_name})
	finally:
		frappe.flags.in_style_bom_generation = False

	frappe.db.commit()
	return {"generated": generated, "count": len(generated)}


def _generate_or_branch_for_colourway(style_doc, sb, cw, colour_code, ratio):
	"""Regeneration branching per spec 7.2: don't blindly regenerate. Branch
	on the downstream state of any BOM already generated from this Style BOM
	for this colourway."""
	existing_bom_name = frappe.db.get_value(
		"BOM",
		{"custom_style": style_doc.name, "custom_colourway": colour_code, "docstatus": ["<", 2]},
		"name",
		order_by="creation desc",
	)

	if existing_bom_name:
		wo = frappe.db.get_value(
			"Work Order", {"bom_no": existing_bom_name, "docstatus": 1},
			["name", "status", "produced_qty"], as_dict=True, order_by="creation desc",
		)
		
		if wo and wo.status in ("In Process", "Completed"):
			_write_variance_register(style_doc, sb, colour_code, existing_bom_name,
				reason=_("Work Order {0} is {1} - existing BOM left untouched.").format(wo.name, wo.status))
			return existing_bom_name
		if wo and (wo.produced_qty or 0) == 0:
			# Submitted WO, nothing produced yet: safe to cancel WO + BOM and regenerate.
			wo_doc = frappe.get_doc("Work Order", wo.name)
			wo_doc.flags.ignore_permissions = True
			wo_doc.cancel()
			old_bom = frappe.get_doc("BOM", existing_bom_name)
			if old_bom.docstatus == 1:
				old_bom.flags.ignore_permissions = True
				old_bom.cancel()
		elif not wo:
			# BOM exists, no Work Order at all: cancel and regenerate silently.
			old_bom = frappe.get_doc("BOM", existing_bom_name)
			if old_bom.docstatus == 1:
				old_bom.flags.ignore_permissions = True
				old_bom.cancel()

	bom_name = _build_colour_bom(style_doc, sb, cw, colour_code, ratio)
	write_generation_log(sb, colour_code, bom_name)
	return bom_name


def _write_variance_register(style_doc, sb, colour_code, bom_name, reason):
	frappe.get_doc({
		"doctype": "Style BOM Generation Log",
		"style_bom": sb.name,
		"style_bom_version": sb.version,
		"style": style_doc.name,
		"colourway": colour_code,
		"generated_bom": bom_name,
		"is_variance": 1,
		"note": reason,
	}).insert(ignore_permissions=True)


def write_generation_log(sb, colour_code, bom_name):
	frappe.get_doc({
		"doctype": "Style BOM Generation Log",
		"style_bom": sb.name,
		"style_bom_version": sb.version,
		"style": sb.style,
		"colourway": colour_code,
		"generated_bom": bom_name,
	}).insert(ignore_permissions=True)


def _get_or_create_colour_carrier_item(style_doc, colour_code):
	"""BOM.item must be a concrete (non-template) Item. Since a colour-level
	BOM in this model is shared across every size of that colour, it needs a
	dedicated non-stock carrier Item to attach to - it is not itself a
	sellable SKU. (Real sellable SKUs are the Style Matrix Item Items, one
	per colour x size, generated separately for ordering/stock.)"""
	item_code = f"{style_doc.style_no}-{colour_code}-BOM"
	if frappe.db.exists("Item", item_code):
		return item_code
	item = frappe.new_doc("Item")
	item.item_code = item_code
	item.item_name = f"{style_doc.style_name} - {colour_code} (BOM carrier)"
	item.item_group = frappe.db.get_value("Item Group", {"is_group": 1}, "name") or "All Item Groups"
	item.stock_uom = "Nos"
	item.is_stock_item = 0
	item.disabled = 1  # not sellable/purchasable on its own - carrier only
	item.description = _("Non-stock carrier item. Exists only so the shared {0} colourway BOM has somewhere to attach.").format(colour_code)
	item.insert(ignore_permissions=True)
	return item.item_code


def _build_colour_bom(style_doc, sb, cw, colour_code, ratio):
	carrier_item = _get_or_create_colour_carrier_item(style_doc, colour_code)

	rows = []
	for line in sb.lines:
		if line.varies_by_size:
			values = [resolve_qty(sb, line, colour_code, s["size_code"]) or 0 for s in ratio] or [line.base_consumption]
			weights = [s["ratio"] for s in ratio] or [1]
			qty = _weighted_avg(values, weights)
		else:
			qty = resolve_qty(sb, line, colour_code, None) or line.base_consumption

		rows.append({
			"item_code": resolve_item(sb, line, colour_code, None, cw.get("colour_attribute_value")),
			"qty": qty * (1 + (line.wastage_pct or 0) / 100.0),
			"uom": line.uom,
		})

	operations = [
		{
			"operation": op.operation,
			"workstation": op.workstation,
			"time_in_mins": op.time_in_mins,
		}
		for op in sb.operations
	]

	bom = frappe.new_doc("BOM")
	bom.item = carrier_item
	bom.quantity = 1
	bom.is_active = 1
	bom.is_default = 1
	bom.with_operations = 1 if operations else 0
	for r in rows:
		bom.append("items", r)
	for op in operations:
		bom.append("operations", op)
	bom.custom_style = style_doc.name
	bom.custom_style_bom = sb.name
	bom.custom_style_bom_version = sb.version
	bom.custom_colourway = colour_code
	bom.insert(ignore_permissions=True)
	bom.submit()
	return bom.name
