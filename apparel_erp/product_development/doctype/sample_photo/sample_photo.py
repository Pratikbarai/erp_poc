import frappe
from frappe.model.document import Document


class SamplePhoto(Document):
	def on_trash(self):
		# If the primary photo is removed, promote the next-oldest one so
		# share previews always have something to point at.
		if not self.is_primary:
			return
		next_photo = frappe.db.get_value(
			"Sample Photo",
			{"sample_version": self.sample_version, "name": ["!=", self.name]},
			"name",
			order_by="creation asc",
		)
		if next_photo:
			frappe.db.set_value("Sample Photo", next_photo, "is_primary", 1)
