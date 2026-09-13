import frappe
from frappe import _
from frappe.model.document import Document

TERMINAL_STATUSES = {"Approved", "Revised", "Cancelled"}


class SampleVersion(Document):
	def before_insert(self):
		if not self.version_no:
			existing = frappe.get_all(
				"Sample Version", filters={"sample_stage": self.sample_stage}, fields=["version_no"]
			)
			self.version_no = max([e.version_no or 0 for e in existing], default=0) + 1

	def validate(self):
		self._enforce_readonly_after_terminal()

	def _enforce_readonly_after_terminal(self):
		"""Rule 4 (spec 6.3): Approved, Revised and Cancelled versions are
		read-only except for comments. Comments live entirely in Frappe's
		own Comment doctype and never touch this document's own fields, so
		blocking any change to THIS doc once its prior status was terminal
		is sufficient - nothing further needs special-casing."""
		if self.is_new():
			return
		before = self.get_doc_before_save()
		if not before or before.status not in TERMINAL_STATUSES:
			return
		changed = [f for f in self.meta.get_valid_columns() if self.get(f) != before.get(f)]
		if changed:
			frappe.throw(_(
				"{0} is {1} and read-only (comments are still possible)."
			).format(self.name, before.status))
