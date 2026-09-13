import json

import frappe
from frappe import _
from frappe.model.document import Document


class SamplingTemplate(Document):
	def validate(self):
		self._validate_stage_names_unique()
		self._validate_dependency_references_and_cycles()
		self._enforce_single_default()

	def _validate_stage_names_unique(self):
		names = [row.stage_name for row in self.stages]
		dupes = {n for n in names if names.count(n) > 1}
		if dupes:
			frappe.throw(_("Stage name(s) used more than once in this template: {0}").format(", ".join(sorted(dupes))))

	def _validate_dependency_references_and_cycles(self):
		"""Rule 6 (spec 6.3): template save rejects dependency cycles and
		references to non-existent stage names. A single depth-limited walk
		is enough at this scale - no graph solver."""
		stage_names = {row.stage_name for row in self.stages}
		edges = {}
		for row in self.stages:
			deps = _parse_depends_on(row.depends_on)
			unknown = [d for d in deps if d not in stage_names]
			if unknown:
				frappe.throw(_(
					"Stage '{0}' depends on unknown stage(s): {1}"
				).format(row.stage_name, ", ".join(unknown)))
			if row.stage_name in deps:
				frappe.throw(_("Stage '{0}' cannot depend on itself.").format(row.stage_name))
			edges[row.stage_name] = deps

		# Depth-limited walk: len(edges) is a safe upper bound on path length
		# for an acyclic graph of this size, so exceeding it means a cycle.
		limit = len(edges) + 1
		for start in edges:
			seen = {start}
			frontier = [start]
			depth = 0
			while frontier:
				depth += 1
				if depth > limit:
					frappe.throw(_("Dependency cycle detected involving stage '{0}'.").format(start))
				nxt = []
				for node in frontier:
					for dep in edges.get(node, []):
						if dep == start:
							frappe.throw(_("Dependency cycle detected involving stage '{0}'.").format(start))
						if dep not in seen:
							seen.add(dep)
							nxt.append(dep)
				frontier = nxt

	def _enforce_single_default(self):
		if not self.is_default:
			return
		others = frappe.get_all(
			"Sampling Template",
			filters={"is_default": 1, "name": ["!=", self.name or ""]},
		)
		for other in others:
			frappe.db.set_value("Sampling Template", other.name, "is_default", 0)


def _parse_depends_on(raw):
	if not raw:
		return []
	try:
		deps = json.loads(raw)
	except (TypeError, ValueError):
		return []
	return [d for d in deps if isinstance(d, str)]
