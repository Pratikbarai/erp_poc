import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class SampleStage(Document):
	def validate(self):
		self._validate_closure_date_vs_latest_decision()

	def _validate_closure_date_vs_latest_decision(self):
		"""Rule 5 (spec 6.3): closure_date cannot precede the latest
		version's decided_on."""
		if not self.closure_date:
			return
		latest_decided = frappe.db.get_value(
			"Sample Version",
			{"sample_stage": self.name, "decided_on": ["is", "set"]},
			"decided_on",
			order_by="decided_on desc",
		)
		if latest_decided and getdate(self.closure_date) < getdate(latest_decided):
			frappe.throw(_(
				"Closure Date ({0}) cannot be before the latest version's decision date ({1})."
			).format(self.closure_date, latest_decided))

	def on_trash(self):
		"""Rule 7 (spec 6.3): deleting a stage with versions is forbidden -
		it can only be set to Closed - Dropped."""
		if frappe.db.exists("Sample Version", {"sample_stage": self.name}):
			frappe.throw(_(
				"{0} has versions and cannot be deleted. Set its status to 'Closed - Dropped' instead."
			).format(self.name))
