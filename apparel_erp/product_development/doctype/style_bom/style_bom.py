import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import flt


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


@frappe.whitelist()
def generate_style_bom_for_stage(style, stage):
	"""Backs the "Generate BOM" action surfaced on the Design & Tech Pack,
	Costing and Sampling tabs of the Style Workspace. Each style declares
	(via Style.bom_generation_stage) which single stage is responsible for
	kicking off its Style BOM - this enforces that choice server-side rather
	than trusting the tab the click came from, and is idempotent: calling it
	again just returns the existing Draft/submitted Style BOM instead of
	creating duplicates."""
	if stage not in ("Design & Tech Pack", "Costing", "Sampling"):
		frappe.throw(_("Unknown BOM generation stage {0}").format(stage))

	style_doc = frappe.get_doc("Style", style)
	if not frappe.has_permission("Style BOM", "create"):
		frappe.throw(_("Not permitted to create Style BOM"))

	configured_stage = style_doc.get("bom_generation_stage") or "Sampling"
	if configured_stage != stage:
		frappe.throw(_(
			"{0} is configured to generate its BOM at the <b>{1}</b> stage, not {2}. "
			"Change \"Generate BOM At\" on the Style if you want to trigger it from here instead."
		).format(style, configured_stage, stage))

	_assert_stage_complete(style_doc, stage)

	existing, inherited_from = find_workspace_style_bom(style)
	if existing:
		return {
			"style_bom": existing.name,
			"docstatus": existing.docstatus,
			"created": False,
			"inherited_from": inherited_from,
		}

	sb = frappe.new_doc("Style BOM")
	sb.style = style
	sb.bom_type = "Development"
	sb.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"style_bom": sb.name, "docstatus": sb.docstatus, "created": True, "inherited_from": None}


def _assert_stage_complete(style_doc, stage):
	"""Generate BOM is only wired up on the tab matching Style.bom_generation_stage,
	but reaching that tab isn't enough on its own - the actual work for that
	stage has to be done first, or the BOM would be built from an unfinished
	tech pack, an un-costed style, or SKUs that don't exist yet."""
	if stage == "Design & Tech Pack":
		status = frappe.db.get_value("Design Tech Pack", {"style": style_doc.name}, "status")
		if status != "Completed":
			frappe.throw(_(
				"The Design Tech Pack for {0} is not marked <b>Completed</b> yet (currently {1}). "
				"Finish it on the Tech Pack tab before generating the Style BOM."
			).format(style_doc.name, status or "Not Started"))

	elif stage == "Costing":
		submitted = frappe.db.exists("Style Cost Sheet", {"style": style_doc.name, "docstatus": 1})
		if not submitted:
			frappe.throw(_(
				"There is no submitted Style Cost Sheet for {0} yet. "
				"Submit the costing on the Costing tab before generating the Style BOM."
			).format(style_doc.name))

	elif stage == "Sampling":
		matrix_items = [m for m in (style_doc.get("matrix_items") or []) if (m.status or "Active") == "Active"]
		if not matrix_items:
			frappe.throw(_(
				"{0} has no active colour × size combinations yet. "
				"Add colours and sizes on the Colours & Sizes tab before generating the Style BOM."
			).format(style_doc.name))
		pending = [m for m in matrix_items if not m.item]
		if pending:
			frappe.throw(_(
				"{0} of {1} SKUs on the Colours & Sizes tab are not generated yet. "
				"Generate all SKUs before generating the Style BOM."
			).format(len(pending), len(matrix_items)))


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


# ---------------------------------------------------------------------------
# Style Workspace authoring
# ---------------------------------------------------------------------------

def _item_display_name(item_code):
	if not item_code:
		return ""
	return frappe.db.get_value("Item", item_code, "item_name") or item_code


def serialize_style_bom(sb, style_doc, inherited_from=None):
	item_codes = list({row.item for row in sb.lines if row.item})
	item_codes += [o.item_code for o in sb.overrides if o.item_code]
	names = {}
	if item_codes:
		for row in frappe.get_all("Item", filters={"name": ["in", list(set(item_codes))]}, fields=["name", "item_name"]):
			names[row.name] = row.item_name

	lines = []
	for row in sb.lines:
		lines.append({
			"name": row.name,
			"line_id": row.line_id,
			"section": row.section,
			"item": row.item,
			"item_name": names.get(row.item) or row.item,
			"uom": row.uom,
			"base_consumption": row.base_consumption,
			"wastage_pct": row.wastage_pct or 0,
			"varies_by_colour": row.varies_by_colour or 0,
			"varies_by_size": row.varies_by_size or 0,
			"resolution_rule": row.resolution_rule or "Fixed",
			"supplied_by": row.get("supplied_by") or "Us",
			"position": row.position,
			"rate": flt(row.rate),
		})

	overrides = []
	for row in sb.overrides:
		overrides.append({
			"name": row.name,
			"line_id": row.line_id,
			"colourway": row.colourway,
			"size": row.size,
			"item_code": row.item_code,
			"item_name": names.get(row.item_code) or row.item_code,
			"consumption": row.consumption,
			"note": row.note,
		})

	sizes = []
	for sz in style_doc.sizes:
		sizes.append({
			"size": sz.size,
			"size_code": sz.size_code or sz.size,
			"ratio": sz.ratio if sz.ratio is not None else 1,
			"consumption_factor": sz.get("consumption_factor") if sz.get("consumption_factor") not in (None, "") else 1,
		})

	editable = sb.docstatus == 0 and not inherited_from
	return {
		"name": sb.name,
		"version": sb.version or 0,
		"bom_type": sb.bom_type,
		"docstatus": sb.docstatus,
		"inherited_from": inherited_from,
		"editable": editable,
		"line_count": len(lines),
		"lines": lines,
		"overrides": overrides,
		"sizes": sizes,
	}


def find_workspace_style_bom(style):
	"""Own draft first, then own submitted, then inherited submitted from Base Style."""
	draft = frappe.db.get_value(
		"Style BOM", {"style": style, "docstatus": 0}, "name", order_by="modified desc"
	)
	if draft:
		return frappe.get_doc("Style BOM", draft), None

	own = frappe.db.get_value(
		"Style BOM", {"style": style, "docstatus": 1}, "name", order_by="version desc"
	)
	if own:
		return frappe.get_doc("Style BOM", own), None

	seen = {style}
	current = frappe.db.get_value("Style", style, "base_style")
	while current and current not in seen:
		seen.add(current)
		name = frappe.db.get_value(
			"Style BOM", {"style": current, "docstatus": 1}, "name", order_by="version desc"
		)
		if name:
			return frappe.get_doc("Style BOM", name), current
		current = frappe.db.get_value("Style", current, "base_style")
	return None, None


@frappe.whitelist()
def get_workspace_style_bom(style):
	style_doc = frappe.get_doc("Style", style)
	if not frappe.has_permission("Style", "read", doc=style_doc):
		frappe.throw(_("Not permitted to read Style {0}").format(style))

	sb, inherited_from = find_workspace_style_bom(style)
	if not sb:
		return {
			"name": None,
			"inherited_from": None,
			"editable": True,
			"bom_type": "Development",
			"docstatus": 0,
			"version": 0,
			"lines": [],
			"overrides": [],
			"sizes": [
				{
					"size": sz.size,
					"size_code": sz.size_code or sz.size,
					"ratio": sz.ratio if sz.ratio is not None else 1,
					"consumption_factor": sz.get("consumption_factor") if sz.get("consumption_factor") not in (None, "") else 1,
				}
				for sz in style_doc.sizes
			],
			"line_count": 0,
		}
	return serialize_style_bom(sb, style_doc, inherited_from)


def _rule_flags(line):
	varies_colour = int(line.get("varies_by_colour") or 0)
	varies_size = int(line.get("varies_by_size") or 0)
	rule = line.get("resolution_rule") or "Fixed"
	if varies_colour and varies_size:
		rule = rule if rule in ("Explicit Override",) else "Match garment colour"
	elif varies_colour and rule == "Fixed":
		rule = "Match garment colour"
	elif varies_size and rule == "Fixed":
		rule = "Match garment size"
	return varies_colour, varies_size, rule


def _get_or_create_draft_style_bom(style, bom_type="Development"):
	name = frappe.db.get_value(
		"Style BOM", {"style": style, "docstatus": 0}, "name", order_by="modified desc"
	)
	if name:
		return frappe.get_doc("Style BOM", name)
	sb = frappe.new_doc("Style BOM")
	sb.style = style
	sb.bom_type = bom_type or "Development"
	return sb


def _copy_bom_children(source, target):
	for row in source.lines:
		target.append("lines", {
			"line_id": row.line_id,
			"section": row.section,
			"item": row.item,
			"uom": row.uom,
			"base_consumption": row.base_consumption,
			"wastage_pct": row.wastage_pct,
			"varies_by_colour": row.varies_by_colour,
			"varies_by_size": row.varies_by_size,
			"resolution_rule": row.resolution_rule,
			"supplied_by": row.get("supplied_by") or "Us",
			"position": row.position,
		})
	for row in source.overrides:
		target.append("overrides", {
			"line_id": row.line_id,
			"colourway": row.colourway,
			"size": row.size,
			"item_code": row.item_code,
			"consumption": row.consumption,
			"note": row.note,
		})
	for row in source.operations:
		target.append("operations", {
			"operation": row.operation,
			"workstation": row.workstation,
			"time_in_mins": row.time_in_mins,
		})


@frappe.whitelist()
def fork_inherited_style_bom(style):
	"""Copy an inherited (base-style) Style BOM into a draft owned by this style."""
	sb, inherited_from = find_workspace_style_bom(style)
	if not inherited_from or not sb:
		frappe.throw(_("This style already has its own Style BOM, or there is nothing to copy."))
	draft = _get_or_create_draft_style_bom(style, sb.bom_type)
	if draft.get("name") and (draft.lines or draft.overrides):
		frappe.throw(_("A draft Style BOM already exists for this style."))
	draft.bom_type = sb.bom_type
	draft.set("lines", [])
	draft.set("overrides", [])
	draft.set("operations", [])
	_copy_bom_children(sb, draft)
	draft.save(ignore_permissions=True)
	frappe.db.commit()
	style_doc = frappe.get_doc("Style", style)
	return serialize_style_bom(draft, style_doc)


def _apply_size_factors(style, factors):
	if not factors:
		return
	style_doc = frappe.get_doc("Style", style)
	changed = False
	for sz in style_doc.sizes:
		code = sz.size_code or sz.size
		match = next((f for f in factors if (f.get("size_code") or f.get("size")) == code), None)
		if match is None:
			continue
		factor = match.get("consumption_factor")
		if factor is None or factor == "":
			continue
		if flt_or_none(sz.get("consumption_factor")) != float(factor):
			sz.consumption_factor = float(factor)
			changed = True
	if changed:
		style_doc.save(ignore_permissions=True)


def flt_or_none(val):
	if val in (None, ""):
		return None
	return float(val)


@frappe.whitelist()
def save_workspace_style_bom(style, payload=None):
	import json

	if payload is None:
		payload = frappe.form_dict.get("payload")
	if isinstance(payload, str):
		payload = json.loads(payload)
	if not payload:
		frappe.throw(_("Missing Style BOM payload"))

	style_doc = frappe.get_doc("Style", style)
	if not frappe.has_permission("Style BOM", "write"):
		frappe.throw(_("Not permitted to update Style BOM"))

	existing, inherited_from = find_workspace_style_bom(style)
	if inherited_from:
		frappe.throw(_("This Style BOM is inherited from {0}. Create this style's own copy before editing.").format(inherited_from))
	if existing and existing.docstatus == 1:
		frappe.throw(_("Submitted Style BOM {0} is read-only. Amend it on the Style BOM form to edit.").format(existing.name))

	sb = existing if existing and existing.docstatus == 0 else _get_or_create_draft_style_bom(style)
	if payload.get("bom_type"):
		sb.bom_type = payload["bom_type"]

	sb.set("lines", [])
	for line in payload.get("lines") or []:
		if not line.get("item"):
			continue
		varies_colour, varies_size, rule = _rule_flags(line)
		sb.append("lines", {
			"line_id": line.get("line_id") or None,
			"section": line.get("section") or "Fabric",
			"item": line.get("item"),
			"uom": line.get("uom"),
			"base_consumption": flt(line.get("base_consumption")),
			"wastage_pct": flt(line.get("wastage_pct")),
			"varies_by_colour": varies_colour,
			"varies_by_size": varies_size,
			"resolution_rule": rule,
			"supplied_by": line.get("supplied_by") or "Us",
			"position": line.get("position"),
			"rate": flt(line.get("rate")),
		})

	line_ids = {row.line_id for row in sb.lines}
	sb.set("overrides", [])
	for row in payload.get("overrides") or []:
		if not row.get("line_id") or row.get("line_id") not in line_ids:
			continue
		sb.append("overrides", {
			"line_id": row.get("line_id"),
			"colourway": row.get("colourway"),
			"size": row.get("size"),
			"item_code": row.get("item_code"),
			"consumption": flt(row.get("consumption")) if row.get("consumption") not in (None, "") else None,
			"note": row.get("note"),
		})

	sb.save(ignore_permissions=True)
	_apply_size_factors(style, payload.get("size_factors"))
	frappe.db.commit()
	style_doc.reload()
	return serialize_style_bom(sb, style_doc)


@frappe.whitelist()
def update_style_bom_rates(style, rates=None):
	"""Write just the rate on specific Style BOM lines, keyed by line_id.

	The Style BOM Line is the single source of truth for price - the BOM
	tab, Costing tab and Design & Tech Pack tab all read it fresh on every
	visit (see get_workspace_style_bom / get_workspace_cost_sheet /
	get_style_snapshot), so writing here is enough to make an edit made
	from any of those tabs show up on the others: the write happens once,
	against one record, and every reader is already re-fetching that same
	record rather than relying on a cached copy.
	"""
	import json

	if rates is None:
		rates = frappe.form_dict.get("rates")
	if isinstance(rates, str):
		rates = json.loads(rates)
	if not rates:
		frappe.throw(_("No rates supplied"))

	if not frappe.has_permission("Style BOM", "write"):
		frappe.throw(_("Not permitted to update Style BOM"))

	sb, inherited_from = find_workspace_style_bom(style)
	if not sb:
		frappe.throw(_("No Style BOM found for {0}").format(style))
	if inherited_from:
		frappe.throw(_("This Style BOM is inherited from {0}. Create this style's own copy before editing.").format(inherited_from))
	if sb.docstatus == 1:
		frappe.throw(_("Submitted Style BOM {0} is read-only. Amend it on the Style BOM form to edit.").format(sb.name))

	line_by_id = {row.line_id: row for row in sb.lines}
	changed = False
	for line_id, rate in rates.items():
		row = line_by_id.get(line_id)
		if row is None:
			continue
		row.rate = flt(rate)
		changed = True

	if changed:
		sb.save(ignore_permissions=True)
		frappe.db.commit()

	style_doc = frappe.get_doc("Style", style)
	return serialize_style_bom(sb, style_doc)


def get_item_rate(item_code):
	if not item_code or not frappe.db.exists("Item", item_code):
		return 0
	row = frappe.db.get_value(
		"Item", item_code, ["standard_rate", "last_purchase_rate", "valuation_rate"], as_dict=True
	)
	if not row:
		return 0
	return row.standard_rate or row.last_purchase_rate or row.valuation_rate or 0


def cost_bom_lines(sb):
	from frappe.utils import flt

	fabric = 0
	trims = 0
	fabric_qty = 0
	fabric_rate = 0
	for line in sb.lines:
		qty = flt(line.base_consumption) * (1 + flt(line.wastage_pct or 0) / 100.0)
		# The Style BOM line's own rate (editable on the Style Workspace BOM
		# tab) is the source of truth once set - it lets a user override the
		# Item master price for this style. Only fall back to the Item's
		# rate when no line-level rate has been entered, so costing doesn't
		# silently ignore a price the user typed into the BOM.
		rate = flt(line.rate) or flt(get_item_rate(line.item))
		amount = qty * rate
		if line.section == "Fabric":
			fabric += amount
			if not fabric_qty:
				fabric_qty = flt(line.base_consumption)
				fabric_rate = rate
		else:
			trims += amount
	return {
		"fabric_amount": fabric,
		"trims_amount": trims,
		"fabric_qty": fabric_qty,
		"fabric_rate": fabric_rate,
	}
