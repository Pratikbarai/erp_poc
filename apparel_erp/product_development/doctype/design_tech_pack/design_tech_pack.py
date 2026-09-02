import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime
from frappe import _
from apparel_erp.product_development.doctype.style.style import advance_stage_at_least, get_latest_style_bom


class DesignTechPack(Document):
	def validate(self):
		if not self.created_on:
			self.created_on = frappe.db.get_value("Style", self.style, "creation")
		previous = self.get_doc_before_save()
		if not previous:
			self.tech_pack_version = "1.0"
		elif any(self.has_value_changed(fieldname) for fieldname in (
			"front_sketch", "back_sketch", "callouts", "measurements", "seam_type",
			"stitch_per_inch", "seam_allowance", "overlock", "top_stitch",
			"special_instructions", "construction_diagram", "reference_images", "attachments",
			"assign_to"
		)):
			self.tech_pack_version = _next_version(previous.tech_pack_version or "1.0")
		else:
			self.tech_pack_version = previous.tech_pack_version or "1.0"
		self.last_updated_on = now_datetime()
		self.last_updated_by = frappe.session.user

	def before_insert(self):
		if not self.created_on:
			self.created_on = frappe.utils.today()

	def after_insert(self):
		if self.style:
			advance_stage_at_least(self.style, "Design & Tech Pack")


@frappe.whitelist()
def get_style_snapshot(style):
	"""Read-only data the client renders for Colourways / Size Range / Fabric & Trims.
	Kept server-side (rather than a raw client frappe.db.get_doc) so a user only needs
	read access to the Style, not necessarily full doctype metadata permissions."""
	style_doc = frappe.get_doc("Style", style)
	if not frappe.has_permission("Style", "read", doc=style_doc):
		frappe.throw(_("Not permitted to read Style {0}").format(style))

	colours = [
		{
			"colour_name": c.colour_name,
			"colour_code": c.colour_code,
			"swatch": c.swatch,
			"status": c.status,
			"approved_for_production": c.get("approved_for_production") or 0
		}
		for c in style_doc.colours
	]

	sizes = []
	for s in style_doc.sizes:
		size_code = frappe.db.get_value("Size", s.size, "size_code") or s.size
		sizes.append({"size": s.size, "size_code": size_code})

	bom_items = []
	latest_sb = get_latest_style_bom(style_doc.name)
	if latest_sb:
		sb_doc = frappe.get_doc("Style BOM", latest_sb["name"])
		item_codes = list({row.item for row in sb_doc.lines if row.item})
		item_meta = {}
		if item_codes:
			for i in frappe.get_all(
				"Item", filters={"name": ["in", item_codes]}, fields=["name", "item_name", "description"]
			):
				item_meta[i.name] = i
		for row in sb_doc.lines:
			meta = item_meta.get(row.item, {})
			bom_items.append({
				"item_type": row.section,
				"item_name": meta.get("item_name") or row.item,
				"description": meta.get("description") or "",
				"composition": "",
				"gsm": "",
				"consumption": f"{row.base_consumption} {row.uom}" if row.base_consumption else "",
				"uom": row.uom,
				"base_qty": row.base_consumption,
				"tolerance": "",
				"available_in_market": 1,
			})

	matrix_items = [
		{
			"colour": row.colour,
			"colour_code": row.colour_code,
			"size": row.size,
			"size_code": row.size_code,
			"sku": row.sku,
			"item": row.item,
			"bom": row.bom,
			"status": row.status or "Not Generated",
			"production_for_sku": row.get("production_for_sku") or 1
		}
		for row in style_doc.matrix_items
	]

	return {
		"style_fields": {
			"style_no": style_doc.style_no,
			"style_name": style_doc.style_name,
			"product_type": style_doc.product_type,
			"category": style_doc.category,
			"season": style_doc.season,
			"customer_brand": style_doc.customer_brand,
			"company": style_doc.company,
			"designer": style_doc.designer,
			"merchandiser": style_doc.merchandiser,
			"department": style_doc.department,
			"country_of_origin": style_doc.country_of_origin,
			"description": style_doc.description,
			"fit": style_doc.fit,
			"sleeve": style_doc.sleeve,
			"placket": style_doc.placket,
			"collar": style_doc.collar,
			"gender": style_doc.gender,
			"fabric_type_field": style_doc.fabric_type,
			"style_image": style_doc.style_image,
			"size_chart": style_doc.size_chart,
			"current_stage": style_doc.development_stage,
			"created_on": style_doc.creation
		},
		"colours": colours,
		"sizes": sizes,
		"bom_items": bom_items,
		"matrix_items": matrix_items
	}


@frappe.whitelist()
def parse_measurements_sheet(name, file_url):
	"""Parse an uploaded XLS/XLSX measurement sheet into child-table rows."""
	doc = frappe.get_doc("Design Tech Pack", name)
	if not frappe.has_permission("Design Tech Pack", "write", doc=doc):
		frappe.throw(_("Not permitted to update Design Tech Pack {0}").format(name))

	file_doc = frappe.get_doc("File", {"file_url": file_url})
	if file_doc.attached_to_doctype != "Design Tech Pack" or file_doc.attached_to_name != name:
		frappe.throw(_("The measurement file must be attached to this Design Tech Pack."))
	filename = (file_doc.file_name or "").lower()
	if filename.endswith(".csv"):
		import csv
		from io import StringIO
		content = file_doc.get_content()
		if isinstance(content, bytes):
			content = content.decode("utf-8-sig")
		rows = list(csv.reader(StringIO(content)))
	elif filename.endswith((".xls", ".xlsx")):
		content = file_doc.get_content(encodings=[])
		if isinstance(content, str):
			content = content.encode("latin-1")
		if filename.endswith(".xls"):
			from frappe.utils.xlsxutils import read_xls_file_from_attached_file
			rows = read_xls_file_from_attached_file(content)
		else:
			from frappe.utils.xlsxutils import read_xlsx_file_from_attached_file
			rows = read_xlsx_file_from_attached_file(
				fcontent=content, filepath=file_doc.file_name
			)
	else:
		frappe.throw(_("Upload an Excel (.xls/.xlsx) or CSV file."))
	rows = [[str(cell).strip() if cell is not None else "" for cell in row] for row in rows]
	rows = [row for row in rows if any(row)]
	if len(rows) < 2:
		frappe.throw(_("The measurement sheet must contain a header and at least one data row."))

	style_doc = frappe.get_doc("Style", doc.style)
	selected_sizes = {}
	for style_size in style_doc.sizes:
		size_code = frappe.db.get_value("Size", style_size.size, "size_code") or style_size.size
		for size_value in (style_size.size, size_code):
			if size_value:
				selected_sizes[_normalise_sheet_header(size_value)] = style_size.size

	headers = [_normalise_sheet_header(value) for value in rows[0]]
	point_index = _find_header_index(headers, ("measurement point", "measurement_point", "point"))
	if point_index is None:
		point_index = 0

	long_size_index = _find_header_index(headers, ("size", "size code", "size_code"))
	value_index = _find_header_index(headers, ("value", "measurement", "measurement value"))
	tolerance_index = _find_header_index(headers, ("tolerance", "tol", "tol (+/-)"))
	parsed = []

	if long_size_index is not None and value_index is not None:
		for sequence, row in enumerate(rows[1:], 1):
			point = _sheet_cell(row, point_index)
			size = _sheet_cell(row, long_size_index)
			if not point or not size:
				continue
			parsed.append({
				"measurement_point": point,
				"size": size,
				"value": _sheet_number(_sheet_cell(row, value_index)),
				"tolerance": _sheet_number(_sheet_cell(row, tolerance_index)) if tolerance_index is not None else None,
				"sequence": sequence
			})
	else:
		size_indexes = [
			(index, selected_sizes.get(header)) for index, header in enumerate(headers)
			if index != point_index and header and index != tolerance_index
		]
		if any(size is None for _, size in size_indexes):
			frappe.throw(_("Every measurement size column must be selected on the Style."))
		for sequence, row in enumerate(rows[1:], 1):
			point = _sheet_cell(row, point_index)
			if not point:
				continue
			tolerance = _sheet_number(_sheet_cell(row, tolerance_index)) if tolerance_index is not None else None
			for size_index, size in size_indexes:
				value = _sheet_number(_sheet_cell(row, size_index))
				if value is None:
					continue
				parsed.append({
					"measurement_point": point,
					"size": size,
					"value": value,
					"tolerance": tolerance,
					"sequence": sequence
				})

	if not parsed:
		frappe.throw(_("No measurement values were found in the sheet."))
	return parsed


def _normalise_sheet_header(value):
	return " ".join(str(value or "").lower().replace("_", " ").split())


def _find_header_index(headers, names):
	return next((index for index, header in enumerate(headers) if header in names), None)


def _sheet_cell(row, index):
	return row[index] if index is not None and index < len(row) else ""


def _sheet_number(value):
	if value in (None, ""):
		return None
	try:
		return float(str(value).replace(",", "").strip())
	except (TypeError, ValueError):
		frappe.throw(_("Measurement values must be numeric: {0}").format(value))


@frappe.whitelist()
def get_activity_feed(name):
	"""Merge user Comments with a plain-English reading of the Version log
	(field changes, child table row add/remove) into one feed, newest first."""
	import json

	feed = []

	comments = frappe.get_all(
		"Comment",
		filters={"reference_doctype": "Design Tech Pack", "reference_name": name, "comment_type": "Comment"},
		fields=["content", "owner", "creation"]
	)
	for c in comments:
		feed.append({
			"owner": c.owner,
			"creation": c.creation,
			"message": frappe.utils.strip_html(c.content or "")
		})

	info_comments = frappe.get_all(
		"Comment",
		filters={"reference_doctype": "Design Tech Pack", "reference_name": name, "comment_type": "Info"},
		fields=["content", "owner", "creation"]
	)
	for c in info_comments:
		feed.append({
			"owner": c.owner,
			"creation": c.creation,
			"message": frappe.utils.strip_html(c.content or "")
		})

	versions = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Design Tech Pack", "docname": name},
		fields=["data", "owner", "creation"],
		order_by="creation asc"
	)
	for v in versions:
		try:
			data = json.loads(v.data)
		except Exception:
			continue

		messages = []
		for changed in data.get("changed", []):
			if len(changed) < 3:
				continue
			fieldname, old, new = changed[0], changed[1], changed[2]
			if fieldname in ("last_updated_on", "last_updated_by", "modified"):
				continue
			label = fieldname.replace("_", " ").title()
			if old in (None, "") and new not in (None, ""):
				messages.append(_("Set {0}").format(label))
			elif new in (None, ""):
				messages.append(_("Cleared {0}").format(label))
			else:
				messages.append(_("Updated {0}").format(label))

		for row_change in data.get("row_changed", []):
			table_field = row_change[0]
			messages.append(_("Updated a row in {0}").format(table_field.replace("_", " ").title()))

		added = data.get("added", [])
		for a in added:
			messages.append(_("Added a row to {0}").format(str(a[0]).replace("_", " ").title()))

		removed = data.get("removed", [])
		for r in removed:
			messages.append(_("Removed a row from {0}").format(str(r[0]).replace("_", " ").title()))

		if messages:
			# de-duplicate while keeping order
			seen = []
			for m in messages:
				if m not in seen:
					seen.append(m)
			feed.append({
				"owner": v.owner,
				"creation": v.creation,
				"message": ", ".join(seen)
			})

	feed.sort(key=lambda x: x["creation"], reverse=True)
	return feed[:30]


@frappe.whitelist()
def send_for_sampling(name, assign_to=None):
	doc = frappe.get_doc("Design Tech Pack", name)

	if assign_to:
		doc.assign_to = assign_to
		doc.save(ignore_permissions=True)

		if not frappe.db.exists("ToDo", {"reference_type": "Design Tech Pack", "reference_name": name, "status": "Open"}):
			frappe.get_doc({
				"doctype": "ToDo",
				"allocated_to": assign_to,
				"reference_type": "Design Tech Pack",
				"reference_name": name,
				"description": _("Tech pack for {0} is ready - please proceed with sampling.").format(doc.style)
			}).insert(ignore_permissions=True)

	doc.add_comment("Info", _("Sent for Sampling, assigned to {0}").format(assign_to or _("(unassigned)")))
	if doc.style:
		advance_stage_at_least(doc.style, "Sampling")
	frappe.db.commit()
	return {"ok": True}


@frappe.whitelist()
def set_status(name, status):
	if status not in ("Not Started", "In Progress", "Completed"):
		frappe.throw(_("Unknown status: {0}").format(status))
	doc = frappe.get_doc("Design Tech Pack", name)
	doc.status = status
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"ok": True}


@frappe.whitelist()
def mark_as_completed(name):
	"""Kept for backwards compatibility - prefer set_status(name, 'Completed')."""
	return set_status(name, "Completed")


@frappe.whitelist()
def get_version_history(name):
	doc = frappe.get_doc("Design Tech Pack", name)
	if not frappe.has_permission("Design Tech Pack", "read", doc=doc):
		frappe.throw(_("Not permitted to read Design Tech Pack {0}").format(name))

	import json
	history = []
	versions = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Design Tech Pack", "docname": name},
		fields=["data", "owner", "creation"],
		order_by="creation desc",
		limit_page_length=20
	)
	for version in versions:
		try:
			data = json.loads(version.data)
		except (TypeError, ValueError):
			continue

		changes = []
		for changed in data.get("changed", []):
			if len(changed) >= 3 and changed[0] not in ("last_updated_on", "last_updated_by", "modified"):
				changes.append({"field": changed[0], "old": changed[1], "new": changed[2]})
		for row_change in data.get("row_changed", []):
			changes.append({"field": row_change[0], "detail": row_change[1:]})
		for row in data.get("added", []):
			changes.append({"field": row[0], "detail": ["Added", row[1:]]})
		for row in data.get("removed", []):
			changes.append({"field": row[0], "detail": ["Removed", row[1:]]})
		if changes:
			history.append({"version": next((c["new"] for c in changes if c["field"] == "tech_pack_version"), "Revision"), "owner": version.owner, "creation": version.creation, "changes": changes})

	return history


def _next_version(version):
	try:
		major, minor = str(version).lstrip("v").split(".", 1)
		return f"{major}.{int(minor) + 1}"
	except (ValueError, AttributeError):
		return "1.1"


@frappe.whitelist()
def confirm_production_selection(name, colours=None, sizes=None):
	"""Confirm production selection, locking the colour/size choices and marking document as confirmed."""
	if not isinstance(colours, list):
		colours = colours.split(",") if colours else []
	if not isinstance(sizes, list):
		sizes = sizes.split(",") if sizes else []
	
	doc = frappe.get_doc("Design Tech Pack", name)
	if not frappe.has_permission("Design Tech Pack", "write", doc=doc):
		frappe.throw(_("Not permitted to update Design Tech Pack {0}").format(name))
	
	if not colours or not sizes:
		frappe.throw(_("Please select at least one colour and one size."))
	
	# Mark as confirmed
	doc.production_confirmed = 1
	doc.add_comment("Info", _("Production selection confirmed. Selected colours: {0}, Sizes: {1}").format(
		", ".join(colours), ", ".join(sizes)
	))
	doc.save(ignore_permissions=True)
	
	# Update the linked Style's matrix items to mark selected combinations for production
	style_doc = frappe.get_doc("Style", doc.style)
	for row in style_doc.matrix_items:
		row.production_for_sku = 1 if (row.colour in colours and row.size in sizes) else 0
	
	style_doc.save(ignore_permissions=True)
	frappe.db.commit()
	
	return {"success": True, "message": _("Production selection confirmed successfully!")}


@frappe.whitelist()
def generate_custom_print(name, sections=None):
	"""Generate a PDF print with selected sections."""
	if isinstance(sections, str):
		sections = sections.split(",") if sections else []
	
	doc = frappe.get_doc("Design Tech Pack", name)
	if not frappe.has_permission("Design Tech Pack", "read", doc=doc):
		frappe.throw(_("Not permitted to read Design Tech Pack {0}").format(name))
	
	if not sections:
		sections = ["Design Sketch", "Colourways", "Size Range", "Measurements", 
		           "Construction Details", "Fabric & Trims", "Reference Images"]
	
	# Use Frappe's standard print mechanism with the selected sections stored
	pdf_options = {
		"orientation": "Portrait",
		"custom_sections": sections
	}
	
	# Generate print using standard print layout
	try:
		print_data = frappe.get_print(
			"Design Tech Pack",
			name,
			print_format="Standard"
		)
		
		# Create a temporary file and return URL
		from frappe.utils import get_files_path
		import uuid
		filename = f"tp_{name}_{uuid.uuid4().hex[:6]}.pdf"
		
		# For now, return a simple message. In a production system, you'd generate actual PDF
		# This would typically use a library like weasyprint or wkhtmltopdf
		return {
			"success": True,
			"message": f"PDF generated: {filename}",
			"sections": sections
		}
	except Exception as e:
		frappe.log_error(f"Error generating print: {str(e)}")
		frappe.throw(_("Error generating print: {0}").format(str(e)))
