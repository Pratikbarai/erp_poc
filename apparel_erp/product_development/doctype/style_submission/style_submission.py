import frappe
from frappe.model.document import Document
from frappe import _


class StyleSubmission(Document):
	def validate(self):
		per_colourway_types = {"Lab Dip", "Strike-off", "Yarn Dip", "Fabric Swatch"}
		if self.submission_type in per_colourway_types and not self.colourway:
			frappe.throw(_("Submission Type {0} requires a Colourway.").format(self.submission_type))
		if self.submission_type == "Size Set" and not self.size:
			frappe.throw(_("Submission Type 'Size Set' requires a Size."))
