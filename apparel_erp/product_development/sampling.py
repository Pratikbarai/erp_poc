"""Sampling module server logic (spec sections 4 and 6).

Deliberately not a workflow engine: stage progression is governed by a
small dependency rule (section 4.3) plus status fields (section 4), not by
Frappe Workflow. A single pass over a plan's stages is enough at this
scale - no graph solver, no state machine framework.

Scope note: this file covers milestones M1 and M2 from the spec's build
sequence (data model, plan/stage/version creation, dependency validation,
derived stage status, decide + create-next-version with carry-forward).
Photos/pins/mobile capture (M3) and external sharing/WhatsApp (M4) are not
implemented here.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_days, now_datetime, today


# ---------------------------------------------------------------------------
# Dependency evaluation (spec 4.3) and derived stage status (spec 4.2)
# ---------------------------------------------------------------------------

def _parse_depends_on(raw):
	if not raw:
		return []
	try:
		deps = json.loads(raw)
	except (TypeError, ValueError):
		return []
	return [d for d in deps if isinstance(d, str)]


def _plan_stages_by_name(plan):
	stages = frappe.get_all(
		"Sample Stage", filters={"sample_plan": plan}, fields=["name", "stage_name", "status"]
	)
	return {s.stage_name: s for s in stages}


def _dependencies_satisfied(stage_doc, plan_stages_by_name):
	deps = _parse_depends_on(stage_doc.depends_on)
	blockers = [
		d for d in deps
		if plan_stages_by_name.get(d) and plan_stages_by_name[d].status != "Closed - Approved"
	]
	return (not blockers), blockers


def _derive_stage_status(stage_doc, plan_stages_by_name):
	"""Spec 4.2. Blocked/Not Started/In Progress/Closed - Approved are all
	derived; Closed - Dropped is the one value a user sets directly and is
	never overwritten here."""
	if stage_doc.status == "Closed - Dropped":
		return "Closed - Dropped"

	satisfied, _blockers = _dependencies_satisfied(stage_doc, plan_stages_by_name)
	if stage_doc.dependency_type == "Blocking" and not satisfied:
		return "Blocked"

	versions = frappe.get_all(
		"Sample Version", filters={"sample_stage": stage_doc.name},
		fields=["status"], order_by="version_no desc",
	)
	if not versions:
		return "Not Started"
	if versions[0].status == "Approved":
		return "Closed - Approved"
	if any(v.status in ("In Progress", "Submitted") for v in versions):
		return "In Progress"
	# Latest version is Revised or Cancelled with nothing open behind it -
	# reads as needing a fresh round rather than silently looking done.
	return "Not Started"


def _recompute_and_save_stage(stage_name):
	stage_doc = frappe.get_doc("Sample Stage", stage_name)
	plan_stages = _plan_stages_by_name(stage_doc.sample_plan)
	new_status = _derive_stage_status(stage_doc, plan_stages)
	if new_status != stage_doc.status:
		stage_doc.status = new_status
		if new_status == "Closed - Approved":
			latest_decided = frappe.db.get_value(
				"Sample Version", {"sample_stage": stage_name, "status": "Approved"},
				"decided_on", order_by="version_no desc",
			)
			if latest_decided:
				stage_doc.closure_date = latest_decided
		stage_doc.save(ignore_permissions=True)
	return stage_doc


def _as_bool(value, default=True):
	if isinstance(value, bool):
		return value
	if value is None:
		return default
	return str(value).strip().lower() not in ("0", "false", "no", "")


# ---------------------------------------------------------------------------
# Plan / stage / version creation (spec 6.1)
# ---------------------------------------------------------------------------

def _resolve_default_template(customer, style):
	"""Resolution order (spec 5.1): customer + category, then category,
	then the default template. 'Category' is the style's own product_type,
	matched against Sampling Template.product_category (an Item Group link)
	by name - loose but adequate for the PoC."""
	category = frappe.db.get_value("Style", style, "product_type")
	candidate_filters = []
	if customer and category:
		candidate_filters.append({"customer": customer, "product_category": category, "is_active": 1})
	if category:
		candidate_filters.append({"product_category": category, "is_active": 1})
	candidate_filters.append({"is_default": 1, "is_active": 1})
	for f in candidate_filters:
		name = frappe.db.get_value("Sampling Template", f, "name")
		if name:
			return name
	return None


def _first_user_with_role(role):
	rows = frappe.get_all(
		"Has Role", filters={"role": role, "parenttype": "User"}, fields=["parent"], limit_page_length=1
	)
	return rows[0].parent if rows else None


@frappe.whitelist()
def create_plan(style, customer=None, season=None, template=None):
	if not frappe.has_permission("Sample Plan", "create"):
		frappe.throw(_("Not permitted to create a Sample Plan"))
	if frappe.db.exists("Sample Plan", {"style": style}):
		frappe.throw(_("A Sample Plan already exists for {0}.").format(style))

	template_name = template or _resolve_default_template(customer, style)
	if not template_name:
		frappe.throw(_("No active Sampling Template found for {0}. Create one first, or pick one explicitly.").format(style))
	template_doc = frappe.get_doc("Sampling Template", template_name)
	if not template_doc.stages:
		frappe.throw(_("{0} has no stages defined.").format(template_name))

	plan = frappe.get_doc({
		"doctype": "Sample Plan",
		"style": style,
		"customer": customer,
		"season": season,
		"sampling_template": template_name,
		"status": "Draft",
	})
	plan.insert(ignore_permissions=True)

	for row in template_doc.stages:
		owner_user = _first_user_with_role(row.owner_role) if row.owner_role else None
		planned_date = add_days(today(), row.default_tat_days) if row.default_tat_days else None
		frappe.get_doc({
			"doctype": "Sample Stage",
			"sample_plan": plan.name,
			"stage_name": row.stage_name,
			"source_template_stage": row.stage_name,
			"is_added_for_style": 0,
			"status": "Not Started",
			"planned_date": planned_date,
			"depends_on": row.depends_on,
			"dependency_type": row.dependency_type or "Blocking",
			"owner_user": owner_user,
			"observation_set": row.observation_set,
		}).insert(ignore_permissions=True)

	plan.status = "Active"
	plan.save(ignore_permissions=True)

	# First pass now so Blocked vs Not Started is right immediately rather
	# than waiting for the next load.
	for stage in frappe.get_all("Sample Stage", filters={"sample_plan": plan.name}, fields=["name"]):
		_recompute_and_save_stage(stage.name)

	frappe.db.commit()
	return get_workspace_sampling(style)


@frappe.whitelist()
def add_stage(plan, stage_name, after=None, observation_set=None, dependency_type="Blocking"):
	if not frappe.has_permission("Sample Stage", "create"):
		frappe.throw(_("Not permitted to add a stage"))
	if frappe.db.exists("Sample Stage", {"sample_plan": plan, "stage_name": stage_name}):
		frappe.throw(_("{0} already has a stage named '{1}'.").format(plan, stage_name))

	stage = frappe.get_doc({
		"doctype": "Sample Stage",
		"sample_plan": plan,
		"stage_name": stage_name,
		"is_added_for_style": 1,
		"status": "Not Started",
		"depends_on": json.dumps([after]) if after else None,
		"dependency_type": dependency_type or "Blocking",
		"observation_set": observation_set,
	})
	stage.insert(ignore_permissions=True)
	_recompute_and_save_stage(stage.name)
	frappe.db.commit()

	style = frappe.db.get_value("Sample Plan", plan, "style")
	return get_workspace_sampling(style)


def _carry_forward_observations(stage, new_version_name):
	prior_versions = frappe.get_all(
		"Sample Version", filters={"sample_stage": stage},
		fields=["name"], order_by="version_no desc", limit_page_length=2,
	)
	prior_versions = [v.name for v in prior_versions if v.name != new_version_name]
	if not prior_versions:
		return
	latest_prior = prior_versions[0]
	open_observations = frappe.get_all(
		"Sample Observation", filters={"sample_version": latest_prior, "status": "Open"},
		fields=["name", "category", "observation_text", "is_free_text"], order_by="seq asc",
	)
	for obs in open_observations:
		frappe.db.set_value("Sample Observation", obs.name, "status", "Carried Forward")
		frappe.get_doc({
			"doctype": "Sample Observation",
			"sample_version": new_version_name,
			"category": obs.category,
			"observation_text": obs.observation_text,
			"is_free_text": obs.is_free_text,
			"status": "Open",
			"carried_from": obs.name,
		}).insert(ignore_permissions=True)


def _create_version(stage, carry_observations=True):
	"""Internal: shared by the whitelisted create_version endpoint and by
	decide_version's auto-created successor on a Revised decision."""
	stage_doc = frappe.get_doc("Sample Stage", stage)
	if stage_doc.status == "Closed - Dropped":
		frappe.throw(_("{0} is Closed - Dropped; no further versions can be created.").format(stage_doc.name))

	# Rule 2 (spec 6.3): no new version while a prior one on this stage is
	# still In Progress or Submitted.
	open_version = frappe.db.get_value(
		"Sample Version", {"sample_stage": stage, "status": ["in", ["In Progress", "Submitted"]]}, "name"
	)
	if open_version:
		frappe.throw(_(
			"{0} already has a version in progress ({1}). Decide it before creating another."
		).format(stage_doc.name, open_version))

	# Rule 1 (spec 6.3): dependency check.
	plan_stages = _plan_stages_by_name(stage_doc.sample_plan)
	satisfied, blockers = _dependencies_satisfied(stage_doc, plan_stages)
	override = False
	override_reason = None
	if not satisfied:
		if stage_doc.dependency_type == "Blocking":
			frappe.throw(_(
				"{0} is blocked on: {1}. Close those stages as Approved first."
			).format(stage_doc.name, ", ".join(blockers)))
		override = True
		override_reason = _("Advisory dependency not yet satisfied: {0}").format(", ".join(blockers))

	new_version = frappe.get_doc({
		"doctype": "Sample Version",
		"sample_stage": stage,
		"status": "In Progress",
		"dependency_override": 1 if override else 0,
		"dependency_override_reason": override_reason,
	})
	new_version.insert(ignore_permissions=True)

	if _as_bool(carry_observations):
		_carry_forward_observations(stage, new_version.name)

	_recompute_and_save_stage(stage)
	return new_version.name


@frappe.whitelist()
def create_version(stage, carry_observations=True):
	if not frappe.has_permission("Sample Version", "create"):
		frappe.throw(_("Not permitted to create a Sample Version"))
	name = _create_version(stage, carry_observations)
	frappe.db.commit()
	stage_doc = frappe.get_doc("Sample Stage", stage)
	style = frappe.db.get_value("Sample Plan", stage_doc.sample_plan, "style")
	result = get_workspace_sampling(style)
	result["created_version"] = name
	return result


@frappe.whitelist()
def decide_version(version, decision, reason_category=None):
	if decision not in ("Approved", "Revised"):
		frappe.throw(_("decision must be 'Approved' or 'Revised'."))
	if decision == "Revised" and not reason_category:
		# Rule 3 (spec 6.3): enforced server-side, not only in the form.
		frappe.throw(_("A reason category is required to mark a version Revised."))
	if not frappe.has_permission("Sample Version", "write"):
		frappe.throw(_("Not permitted to decide this version"))

	doc = frappe.get_doc("Sample Version", version)
	if doc.status != "Submitted":
		frappe.throw(_("Only a Submitted version can be decided. {0} is currently {1}.").format(doc.name, doc.status))

	doc.status = decision
	doc.decided_by = frappe.session.user
	doc.decided_on = today()
	doc.save(ignore_permissions=True)

	successor_name = None
	if decision == "Revised":
		frappe.get_doc({
			"doctype": "Sample Observation",
			"sample_version": doc.name,
			"category": reason_category,
			"observation_text": _("Revision reason"),
			"status": "Open",
		}).insert(ignore_permissions=True)
		successor_name = _create_version(doc.sample_stage, carry_observations=True)
		frappe.db.set_value("Sample Version", successor_name, "predecessor", doc.name)

	_recompute_and_save_stage(doc.sample_stage)
	frappe.db.commit()

	stage_plan = frappe.db.get_value("Sample Stage", doc.sample_stage, "sample_plan")
	style = frappe.db.get_value("Sample Plan", stage_plan, "style")
	result = get_workspace_sampling(style)
	result["decided_version"] = doc.name
	result["successor_version"] = successor_name
	return result


@frappe.whitelist()
def mark_version_submitted(version, received_on=None):
	if not frappe.has_permission("Sample Version", "write"):
		frappe.throw(_("Not permitted to update this version"))
	doc = frappe.get_doc("Sample Version", version)
	if doc.status != "In Progress":
		frappe.throw(_("Only an In Progress version can be marked Submitted."))
	doc.status = "Submitted"
	doc.received_on = received_on or today()
	doc.save(ignore_permissions=True)
	_recompute_and_save_stage(doc.sample_stage)
	frappe.db.commit()
	stage_plan = frappe.db.get_value("Sample Stage", doc.sample_stage, "sample_plan")
	style = frappe.db.get_value("Sample Plan", stage_plan, "style")
	return get_workspace_sampling(style)


@frappe.whitelist()
def cancel_version(version):
	if not frappe.has_permission("Sample Version", "write"):
		frappe.throw(_("Not permitted to update this version"))
	doc = frappe.get_doc("Sample Version", version)
	if doc.status not in ("In Progress", "Submitted"):
		frappe.throw(_("Only an In Progress or Submitted version can be cancelled."))
	doc.status = "Cancelled"
	doc.decided_by = frappe.session.user
	doc.decided_on = today()
	doc.save(ignore_permissions=True)
	_recompute_and_save_stage(doc.sample_stage)
	frappe.db.commit()
	stage_plan = frappe.db.get_value("Sample Stage", doc.sample_stage, "sample_plan")
	style = frappe.db.get_value("Sample Plan", stage_plan, "style")
	return get_workspace_sampling(style)


@frappe.whitelist()
def add_observation(version, observation_text, category=None):
	if not observation_text or not observation_text.strip():
		frappe.throw(_("Observation text is required."))
	if not frappe.has_permission("Sample Observation", "create"):
		frappe.throw(_("Not permitted to add an observation"))
	doc = frappe.get_doc("Sample Version", version)
	if doc.status not in ("In Progress", "Submitted"):
		frappe.throw(_("Observations can only be added while a version is In Progress or Submitted."))

	frappe.get_doc({
		"doctype": "Sample Observation",
		"sample_version": version,
		"category": category,
		"observation_text": observation_text.strip(),
		"is_free_text": 1,
		"status": "Open",
	}).insert(ignore_permissions=True)
	frappe.db.commit()

	stage_plan = frappe.db.get_value("Sample Stage", doc.sample_stage, "sample_plan")
	style = frappe.db.get_value("Sample Plan", stage_plan, "style")
	return get_workspace_sampling(style)


@frappe.whitelist()
def add_photo(version, file_url, caption=None, capture_source="Desktop"):
	"""Backs the Sampling tab's camera/upload capture (spec 7 - the
	differentiating feature). file_url comes from a prior plain
	/api/method/upload_file call from the client; this just creates the
	Sample Photo record and points it at that already-uploaded file.
	The first photo on a version is automatically the primary one used
	for share previews; deleting it promotes the next-oldest (see
	SamplePhoto.on_trash)."""
	if not file_url:
		frappe.throw(_("No file uploaded."))
	if not frappe.has_permission("Sample Photo", "create"):
		frappe.throw(_("Not permitted to add a photo"))
	doc = frappe.get_doc("Sample Version", version)
	if doc.status not in ("In Progress", "Submitted"):
		frappe.throw(_("Photos can only be added while a version is In Progress or Submitted."))

	is_first = not frappe.db.exists("Sample Photo", {"sample_version": version})
	source = capture_source if capture_source in ("Desktop", "Mobile", "WhatsApp Inbound") else "Desktop"
	photo = frappe.get_doc({
		"doctype": "Sample Photo",
		"sample_version": version,
		"image": file_url,
		"caption": caption,
		"capture_source": source,
		"captured_by": frappe.session.user,
		"captured_on": now_datetime(),
		"is_primary": 1 if is_first else 0,
	})
	photo.insert(ignore_permissions=True)
	# Point the already-uploaded File record at its real parent so it shows
	# up under this Sample Photo (permissions/cleanup) instead of floating
	# as an unattached upload.
	frappe.db.set_value(
		"File", {"file_url": file_url},
		{"attached_to_doctype": "Sample Photo", "attached_to_name": photo.name},
	)
	frappe.db.commit()

	stage_plan = frappe.db.get_value("Sample Stage", doc.sample_stage, "sample_plan")
	style = frappe.db.get_value("Sample Plan", stage_plan, "style")
	return get_workspace_sampling(style)


@frappe.whitelist()
def delete_photo(photo):
	if not frappe.has_permission("Sample Photo", "delete"):
		frappe.throw(_("Not permitted to delete a photo"))
	doc = frappe.get_doc("Sample Photo", photo)
	version = doc.sample_version
	doc.delete(ignore_permissions=True)
	frappe.db.commit()

	stage_plan = frappe.db.get_value(
		"Sample Stage", frappe.db.get_value("Sample Version", version, "sample_stage"), "sample_plan"
	)
	style = frappe.db.get_value("Sample Plan", stage_plan, "style")
	return get_workspace_sampling(style)


@frappe.whitelist()
def drop_stage(stage):
	if not frappe.has_permission("Sample Stage", "write"):
		frappe.throw(_("Not permitted to update this stage"))
	doc = frappe.get_doc("Sample Stage", stage)
	if (doc.status or "").startswith("Closed"):
		frappe.throw(_("{0} is already closed.").format(stage))
	doc.status = "Closed - Dropped"
	doc.closure_date = today()
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	style = frappe.db.get_value("Sample Plan", doc.sample_plan, "style")
	return get_workspace_sampling(style)


# ---------------------------------------------------------------------------
# Workspace read (spec 3.1) - re-evaluates every stage's status on load
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_workspace_sampling(style):
	plan_name = frappe.db.get_value("Sample Plan", {"style": style}, "name")
	if not plan_name:
		return None
	plan = frappe.get_doc("Sample Plan", plan_name)

	stages = frappe.get_all(
		"Sample Stage", filters={"sample_plan": plan_name},
		fields=["name", "stage_name", "status", "planned_date", "closure_date", "depends_on",
				"dependency_type", "owner_user", "observation_set", "colourway",
				"is_added_for_style", "source_template_stage"],
		order_by="creation asc",
	)
	plan_stages_by_name = {s.stage_name: s for s in stages}

	# "Evaluate ... on load of the plan" (spec 4.3): single pass so a
	# Blocked stage flips to Not Started the moment its dependency closes,
	# even if nothing was clicked to trigger a recompute.
	changed_any = False
	for stage in stages:
		new_status = _derive_stage_status(stage, plan_stages_by_name)
		if new_status != stage.status:
			stage_doc = frappe.get_doc("Sample Stage", stage.name)
			stage_doc.status = new_status
			if new_status == "Closed - Approved":
				latest_decided = frappe.db.get_value(
					"Sample Version", {"sample_stage": stage.name, "status": "Approved"},
					"decided_on", order_by="version_no desc",
				)
				if latest_decided:
					stage_doc.closure_date = latest_decided
			stage_doc.save(ignore_permissions=True)
			stage.status = new_status
			stage.closure_date = stage_doc.closure_date
			changed_any = True
	if changed_any:
		frappe.db.commit()

	stage_names = [s.name for s in stages]
	versions = frappe.get_all(
		"Sample Version", filters={"sample_stage": ["in", stage_names or [""]]},
		fields=["name", "sample_stage", "version_no", "status", "description", "sent_on", "received_on",
				"decided_on", "decided_by", "sample_cost", "is_recoverable", "predecessor",
				"dependency_override", "dependency_override_reason"],
		order_by="sample_stage asc, version_no asc",
	)
	version_names = [v.name for v in versions]
	observations = frappe.get_all(
		"Sample Observation", filters={"sample_version": ["in", version_names or [""]]},
		fields=["name", "sample_version", "seq", "category", "observation_text", "is_free_text",
				"status", "carried_from"],
		order_by="sample_version asc, seq asc",
	)

	observations_by_version = {}
	for o in observations:
		observations_by_version.setdefault(o.sample_version, []).append(o)
	for v in versions:
		v["observations"] = observations_by_version.get(v.name, [])

	photos = frappe.get_all(
		"Sample Photo", filters={"sample_version": ["in", version_names or [""]]},
		fields=["name", "sample_version", "image", "caption", "capture_source",
				"captured_by", "captured_on", "is_primary"],
		order_by="sample_version asc, is_primary desc, captured_on asc",
	)
	photos_by_version = {}
	for p in photos:
		photos_by_version.setdefault(p.sample_version, []).append(p)
	for v in versions:
		v["photos"] = photos_by_version.get(v.name, [])

	versions_by_stage = {}
	for v in versions:
		versions_by_stage.setdefault(v.sample_stage, []).append(v)
	for stage in stages:
		stage["versions"] = versions_by_stage.get(stage.name, [])

	return {
		"plan": {
			"name": plan.name, "style": plan.style, "customer": plan.customer,
			"season": plan.season, "sampling_template": plan.sampling_template, "status": plan.status,
		},
		"stages": stages,
	}
