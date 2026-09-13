import frappe
from frappe.model.document import Document


class SampleObservation(Document):
	def before_insert(self):
		if not self.seq:
			existing = frappe.get_all(
				"Sample Observation", filters={"sample_version": self.sample_version}, fields=["seq"]
			)
			self.seq = max([e.seq or 0 for e in existing], default=0) + 1

	def on_trash(self):
		"""'Re-sequenced on delete' (spec 5.2): close the gap left in this
		version's observation list so seq stays a dense, ordered display
		index rather than accumulating holes."""
		remaining = frappe.get_all(
			"Sample Observation",
			filters={"sample_version": self.sample_version, "name": ["!=", self.name]},
			fields=["name", "seq"],
			order_by="seq asc",
		)
		for i, row in enumerate(remaining, start=1):
			if row.seq != i:
				frappe.db.set_value("Sample Observation", row.name, "seq", i)
