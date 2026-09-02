const WORKFLOW_STAGES = [
	"Style Created",
	"Design & Tech Pack",
	"Sampling",
	"Fit Approval",
	"Proto Approval",
	"Production"
];
frappe.ui.form.on("Style", {
	refresh(frm) {
		render_matrix(frm);
		render_gallery(frm);
		render_workflow(frm);
		render_status_dropdown(frm);
		render_size_chart_preview(frm);
		render_style_bom_panel(frm);

		if (!frm.is_new()) {
			frm.add_custom_button(__("Open Style Workspace"), () => {
				frappe.set_route("style-workspace", frm.doc.name);
			}).addClass("btn-primary");
		}

		frm.add_custom_button(__("Sync Matrix"), () => {
			frm.save().then(() => render_matrix(frm));
		});

		frm.add_custom_button(__("Production Selection"), () => {
			show_production_selection_dialog(frm);
		}).addClass("btn-info");

		if (!frm.is_new()) {
			frm.add_custom_button(__("Open/Create Style BOM"), () => {
				open_style_bom(frm);
			}).addClass("btn-info");
		}

		frm.add_custom_button(__("Generate All SKUs"), () => {
			generate_all_skus(frm);
		});

		if (!frm.is_new()) {
			frm.add_custom_button(__("Design & Tech Pack"), () => open_tech_pack(frm));
		}

		if (frm.doc.size_chart) {
			frm.add_custom_button(__("Size Chart"), () => window.open(frm.doc.size_chart, "_blank"));
		}

		render_style_image_preview(frm);
		if (frm.is_new()) {
			frm.add_custom_button(__("Select Existing Style"), () => {
				frappe.set_route("List", "Style");
			});
		}
	},

	development_stage(frm) {
		render_workflow(frm);
	},

	base_style(frm) {
		if (!frm.doc.base_style) return;
		frappe.call({
			method: "apparel_erp.product_development.doctype.style.style.get_base_style_snapshot",
			args: { base_style: frm.doc.base_style, current_style: frm.doc.name },
			freeze: true,
			freeze_message: __("Loading Base Style data...")
		}).then((r) => {
			if (!r.message) return;
			const snapshot = r.message;
			Object.entries(snapshot.fields || {}).forEach(([fieldname, value]) => {
				if (value !== null && value !== undefined) frm.set_value(fieldname, value);
			});
			["colours", "sizes"].forEach((fieldname) => {
				frm.clear_table(fieldname);
				(snapshot[fieldname] || []).forEach(row => frm.add_child(fieldname, clean_child_row(row)));
				frm.refresh_field(fieldname);
			});
			frm.dirty();
			frappe.show_alert({
				message: __("Base Style data loaded. You can edit the copied fields before saving."),
				indicator: "green"
			});
			render_matrix(frm);
		});
	},

	// Table MultiSelect fires the fieldname event on add/remove, same as a normal field
	sizes(frm) {
		sync_and_render(frm);
	},

	colours_add(frm) {
		sync_and_render(frm);
	},

	colours_remove(frm) {
		sync_and_render(frm);
	},

	onload(frm) {
		render_matrix(frm);
		render_style_image_preview(frm);
		render_size_chart_preview(frm);
	}
});

function clean_child_row(row) {
	const cleaned = { ...row };
	delete cleaned.name;
	delete cleaned.parent;
	delete cleaned.parentfield;
	delete cleaned.parenttype;
	delete cleaned.idx;
	return cleaned;
}

function render_style_image_preview(frm) {
	if (!frm.doc.style_image) return;
	const field = frm.get_field("style_image");
	if (!field || !field.$wrapper) return;
	const $wrapper = field.$wrapper;
	$wrapper.find("img").css("max-width", "100%").css("height", "auto");
	$wrapper.find("a").off("click").on("click", function(e) {
		e.preventDefault();
		frappe.show_alert({ message: __("Image preview"), indicator: "info" });
	});
}

function render_size_chart_preview(frm) {
	if (!frm.doc.size_chart || !/\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(frm.doc.size_chart)) return;
	const field = frm.get_field("size_chart");
	if (!field || !field.$wrapper) return;
	const $wrapper = field.$wrapper;
	if ($wrapper.find(".apparel-size-chart-preview").length) return;
	$wrapper.append(`<img src="${frm.doc.size_chart}" class="apparel-size-chart-preview" alt="${__("Size Chart")}">`);
	$wrapper.find(".apparel-size-chart-preview").css({
		"max-width": "160px",
		"max-height": "160px",
		"object-fit": "cover",
		"display": "block",
		"margin-top": "8px",
		"border": "1px solid var(--border-color)",
		"border-radius": "4px",
		"cursor": "pointer"
	}).on("click", () => window.open(frm.doc.size_chart, "_blank"));
}

function open_tech_pack(frm) {
	frappe.db.get_value("Design Tech Pack", { style: frm.doc.name }, "name").then(r => {
		if (r.message && r.message.name) {
			frappe.set_route("Form", "Design Tech Pack", r.message.name);
		} else {
			frappe.new_doc("Design Tech Pack", { style: frm.doc.name });
		}
	});
}

function open_style_bom(frm) {
	frappe.call({
		method: "apparel_erp.product_development.doctype.style.style.get_latest_style_bom",
		args: { style: frm.doc.name },
		freeze: true,
		freeze_message: __("Looking up Style BOM...")
	}).then((r) => {
		if (r.message && r.message.name && !r.message.inherited_from) {
			frappe.set_route("Form", "Style BOM", r.message.name);
		} else if (r.message && r.message.inherited_from) {
			frappe.confirm(
				__("This Style has no Style BOM of its own yet - it currently inherits from Base Style {0} (v{1}). Create a new Style BOM for this Style?", [r.message.inherited_from, r.message.version]),
				() => frappe.new_doc("Style BOM", { style: frm.doc.name, bom_type: "Development" })
			);
		} else {
			frappe.new_doc("Style BOM", { style: frm.doc.name, bom_type: "Development" });
		}
	});
}

function render_style_bom_panel(frm) {
	const field = frm.get_field("style_bom_html");
	if (!field || !field.$wrapper || frm.is_new()) return;

	frappe.call({
		method: "apparel_erp.product_development.doctype.style.style.get_latest_style_bom",
		args: { style: frm.doc.name }
	}).then((r) => {
		if (!r.message) {
			field.$wrapper.html(`<div class="text-muted">${__("No Style BOM yet.")}</div>`);
			return;
		}
		const sb = r.message;
		const inherited_note = sb.inherited_from
			? `<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${__("Inherited from Base Style {0}", [sb.inherited_from])}</div>`
			: "";
		field.$wrapper.html(`
			<div style="padding: 10px; border-left: 3px solid var(--primary); background: #f9f9f9; border-radius: 4px;">
				<b>${sb.name}</b> - ${__("v{0}", [sb.version])} - <span class="indicator-pill ${sb.bom_type === "Bulk" ? "green" : "orange"}">${sb.bom_type}</span>
				<div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">${sb.line_count} ${__("line(s)")}</div>
				${inherited_note}
			</div>
		`);
	});
}

function sync_and_render(frm) {
	if (frm.is_new()) {
		render_matrix(frm);
		return;
	}
	frm.save().then(() => render_matrix(frm));
}

function render_matrix(frm) {
	const matrix_field = frm.get_field("matrix_html");
	if (!matrix_field || !matrix_field.$wrapper) {
		return; // Field not available on this form layout
	}

	const wrapper = matrix_field.$wrapper;
	wrapper.empty();

	const colours = (frm.doc.colours || []).filter(c => (c.status || "Active") === "Active");
	const sizes = frm.doc.sizes || [];

	if (!colours.length || !sizes.length) {
		wrapper.html(`<div class="text-muted padding">${__(
			"Add at least one Colour and select Sizes above, then save, to generate the matrix."
		)}</div>`);
		return;
	}

	if (frm.is_new() || frm.is_dirty()) {
		wrapper.html(`<div class="text-muted padding">
			${__("Save the Style to build the Colour x Size matrix.")}
		</div>`);
		return;
	}

	let html = `<div class="table-responsive"><table class="table table-bordered apparel-matrix">
		<thead><tr><th>${__("Colour")}</th>`;
	sizes.forEach(s => {
		html += `<th class="text-center">${frappe.utils.escape_html(s.size)}</th>`;
	});
	html += `</tr></thead><tbody>`;

	colours.forEach(colour => {
		const colour_code = colour.colour_code || colour.colour_name;
		const approved = colour.approved_for_production ? "✓" : "✗";
		const approval_class = colour.approved_for_production ? "badge-success" : "badge-danger";
		html += `<tr><td><strong>${frappe.utils.escape_html(colour.colour_name)}</strong>`;
		if (colour.swatch) {
			html += ` <span class="indicator-pill" style="background:${colour.swatch}">&nbsp;</span>`;
		}
		html += ` <span class="badge ${approval_class}" title="Approved for Production">${approved}</span>`;
		html += `</td>`;

		sizes.forEach(size_row => {
			const size_code = get_size_code(frm, size_row.size);
			const matrix_row = (frm.doc.matrix_items || []).find(
				m => m.colour_code === colour_code && m.size_code === size_code
			);

			html += `<td class="text-center apparel-matrix-cell" data-colour="${colour_code}" data-size="${size_code}">`;
			if (matrix_row && (matrix_row.item || matrix_row.sku || matrix_row.bom)) {
				const item_label = matrix_row.item_name
					? `${matrix_row.item_name}${matrix_row.item_code ? ` (${matrix_row.item_code})` : ""}`
					: matrix_row.sku || matrix_row.item || matrix_row.bom;
				const item_status = matrix_row.status || "Active";
				html += `<a href="#" class="matrix-sku matrix-generated" data-item="${frappe.utils.escape_html(matrix_row.item || "")}">
					${frappe.utils.escape_html(item_label)}</a>
					<button type="button" class="btn btn-xs matrix-status-button" data-row="${frappe.utils.escape_html(matrix_row.name)}">${frappe.utils.escape_html(item_status)}</button>`;
			} else if (matrix_row) {
				html += `<a href="#" class="matrix-sku matrix-empty">
					${__("+ Generate")}</a>`;
			} else {
				html += `<span class="text-muted">${__("--")}</span>`;
			}
			html += `</td>`;
		});
		html += `</tr>`;
	});

	html += `</tbody></table></div>
	<style>
		.apparel-matrix th, .apparel-matrix td { vertical-align: middle; }
		.apparel-matrix .matrix-sku { display: inline-block; padding: 6px 4px; }
		.apparel-matrix .matrix-empty { color: var(--text-muted); border: 1px dashed var(--dark-border-color); border-radius: 4px; padding: 6px 10px; }
		.apparel-matrix .matrix-generated { font-weight: 600; }
		.apparel-matrix .matrix-status-button { display: block; margin: 2px auto 0; }
	</style>`;

	wrapper.html(html);
	render_production_readiness(frm);

	wrapper.find(".matrix-sku").on("click", function (e) {
		e.preventDefault();
		const $cell = $(this).closest(".apparel-matrix-cell");
		const colour_code = $cell.attr("data-colour");
		const size_code = $cell.attr("data-size");
		const item = $(this).attr("data-item");

		if (item) {
			// already generated - just redirect straight to the Item (image preview, not a link)
			frappe.set_route("Form", "Item", item);
			return;
		}

		// Generation now happens on the Style BOM document (gated: Style
		// Confirmed, PP approved, Lab Dip approved per colourway, etc) and
		// covers every active colourway in one go - not per matrix cell.
		frappe.msgprint({
			title: __("Not generated yet"),
			message: __("{0} / {1} hasn't been generated. Open or create this Style's Style BOM, submit it as Bulk, then use 'Generate Production BOMs' there - it generates every approved colourway at once.", [colour_code, size_code]),
			primary_action: {
				label: __("Open/Create Style BOM"),
				action: () => open_style_bom(frm)
			}
		});
	});

	wrapper.find(".matrix-status-button").on("click", function () {
		const matrix_item = $(this).attr("data-row");
		const current_status = $(this).text();
		const dialog = new frappe.ui.Dialog({
			title: __("Set Item Status"),
			fields: [{ fieldname: "status", fieldtype: "Select", label: __("Status"), options: "Active\nDrop\nOn Hold", default: current_status }],
			primary_action_label: __("Save"),
			primary_action(values) {
				frappe.call({
					method: "apparel_erp.product_development.doctype.style.style.set_matrix_item_status",
					args: { style: frm.doc.name, matrix_item, status: values.status },
					callback: () => {
						dialog.hide();
						frm.reload_doc().then(() => render_matrix(frm));
					}
				});
			}
		});
		dialog.show();
	});
}

function get_size_code(frm, size_link) {
	// pull from locals cache populated by the Size link field / fetched list
	const size_doc = frappe.get_doc("Size", size_link);
	if (size_doc && size_doc.size_code) return size_doc.size_code;
	return size_link;
}

function render_production_readiness(frm) {
	// Skip rendering for new forms
	if (frm.is_new()) {
		return;
	}

	const colours = frm.doc.colours || [];
	const approved_colours = colours.filter(c => c.approved_for_production);
	const sizes = frm.doc.sizes || [];
	const total_possible_skus = approved_colours.length * sizes.length;

	let status_html = `<div class="apparel-production-readiness" style="padding: 12px; margin: 10px 0; background: #f9f9f9; border-left: 4px solid var(--primary); border-radius: 4px;">
		<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
			<div>
				<strong>Colours for Production</strong><br>
				<span style="font-size: 20px; font-weight: bold; color: ${approved_colours.length > 0 ? '#27ae60' : '#e74c3c'}">
					${approved_colours.length}/${colours.length}
				</span>
			</div>
			<div>
				<strong>Style BOM</strong><br>
				<span id="sw-style-bom-status" style="font-size: 20px; font-weight: bold; color: var(--text-muted)">…</span>
			</div>
			<div>
				<strong>Possible SKUs</strong><br>
				<span style="font-size: 20px; font-weight: bold; color: var(--primary)">
					${total_possible_skus}
				</span>
				<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
					${approved_colours.length} colours × ${sizes.length} sizes
				</div>
			</div>
		</div>
	</div>`;
	
	// Try to render to new Production tab field if it exists, otherwise fall back to prepending to matrix
	const production_readiness_field = frm.get_field("production_readiness_html");
	let $status_wrapper = null;
	if (production_readiness_field && production_readiness_field.$wrapper) {
		production_readiness_field.$wrapper.html(status_html);
		$status_wrapper = production_readiness_field.$wrapper;
	} else {
		// Backwards compatibility: prepend to matrix if new field doesn't exist yet
		const matrix_field = frm.get_field("matrix_html");
		if (matrix_field && matrix_field.$wrapper) {
			matrix_field.$wrapper.prepend(status_html);
			$status_wrapper = matrix_field.$wrapper;
		}
	}

	if ($status_wrapper) {
		frappe.call({
			method: "apparel_erp.product_development.doctype.style.style.get_latest_style_bom",
			args: { style: frm.doc.name }
		}).then((r) => {
			const $el = $status_wrapper.find("#sw-style-bom-status");
			if (!$el.length) return;
			if (!r.message) {
				$el.text(__("None yet")).css("color", "#e74c3c");
				return;
			}
			const sb = r.message;
			$el.text(`v${sb.version} (${sb.bom_type})`).css("color", sb.bom_type === "Bulk" ? "#27ae60" : "#f39c12");
		});
	}
}

function render_gallery(frm) {
	const field = frm.get_field("gallery_html");
	if (!field || !field.$wrapper) return;
	const $w = field.$wrapper;
	$w.empty();

	let html = `<div class="tp-gallery-strip">`;
	(frm.doc.gallery || []).forEach((row, idx) => {
		const active = row.image === frm.doc.style_image;
		html += `<div class="tp-gallery-thumb ${active ? "active" : ""}" data-idx="${idx}">
			<img src="${row.image}">
			<span class="tp-gallery-remove" data-idx="${idx}" title="${__("Remove")}">&times;</span>
		</div>`;
	});
	html += `<div class="tp-gallery-add" title="${__("Add image")}">+</div></div>
	<style>
		.tp-gallery-strip{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}
		.tp-gallery-thumb{position:relative;width:48px;height:48px;border-radius:6px;overflow:hidden;
			border:2px solid var(--border-color);cursor:pointer;}
		.tp-gallery-thumb.active{border-color:var(--primary);}
		.tp-gallery-thumb img{width:100%;height:100%;object-fit:cover;display:block;}
		.tp-gallery-remove{position:absolute;top:0;right:0;background:rgba(0,0,0,.6);color:#fff;
			font-size:11px;line-height:14px;width:14px;height:14px;text-align:center;border-radius:0 0 0 4px;}
		.tp-gallery-add{width:48px;height:48px;border:2px dashed var(--border-color);border-radius:6px;
			display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--text-muted);cursor:pointer;}
	</style>`;

	$w.html(html);

	$w.find(".tp-gallery-thumb img").on("click", function () {
		const idx = $(this).closest(".tp-gallery-thumb").attr("data-idx");
		frm.set_value("style_image", frm.doc.gallery[idx].image);
	});

	$w.find(".tp-gallery-remove").on("click", function (e) {
		e.stopPropagation();
		const idx = $(this).attr("data-idx");
		frm.doc.gallery.splice(idx, 1);
		frm.refresh_field("gallery");
		render_gallery(frm);
		frm.dirty();
	});

	$w.find(".tp-gallery-add").on("click", () => {
		new frappe.ui.FileUploader({
			doctype: "Style",
			docname: frm.doc.name,
			on_success: (file) => {
				const row = frm.add_child("gallery", { image: file.file_url });
				if (!frm.doc.style_image) frm.set_value("style_image", file.file_url);
				frm.refresh_field("gallery");
				render_gallery(frm);
				frm.dirty();
			}
		});
	});
}

function render_workflow(frm) {
	const field = frm.get_field("workflow_html");
	if (!field || !field.$wrapper) return;
	const $w = field.$wrapper;
	$w.empty();

	if (frm.is_new()) {
		$w.html(`<div class="text-muted">${__("Save the Style to see its workflow.")}</div>`);
		return;
	}

	const current = frm.doc.development_stage || "Style Created";
	const current_idx = WORKFLOW_STAGES.indexOf(current);

	let html = `<div class="tp-workflow-stepper">`;
	WORKFLOW_STAGES.forEach((stage, idx) => {
		let state = "pending";
		if (idx < current_idx) state = "done";
		else if (idx === current_idx) state = "active";

		html += `<div class="tp-wf-step">
			<div class="tp-wf-bubble ${state}" data-stage="${stage}" title="${__("Set as current stage")}">
				${state === "done" ? "&#10003;" : idx + 1}
			</div>
			<div class="tp-wf-label ${state}">${__(stage)}</div>
			<div class="tp-wf-sub">${state === "done" ? __("Done") : state === "active" ? __("In Progress") : __("Pending")}</div>
		</div>`;
		if (idx < WORKFLOW_STAGES.length - 1) {
			html += `<div class="tp-wf-connector ${idx < current_idx ? "done" : ""}"></div>`;
		}
	});
	html += `</div>
	<style>
		.tp-workflow-stepper{display:flex;align-items:flex-start;padding:16px 0;overflow-x:auto;}
		.tp-wf-step{display:flex;flex-direction:column;align-items:center;min-width:110px;text-align:center;}
		.tp-wf-bubble{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;
			font-weight:600;cursor:pointer;border:2px solid var(--border-color);color:var(--text-muted);background:var(--fg-color);}
		.tp-wf-bubble.done{background:var(--dark-green-500,#2e8b57);border-color:var(--dark-green-500,#2e8b57);color:#fff;}
		.tp-wf-bubble.active{background:var(--yellow-500,#e0a800);border-color:var(--yellow-500,#e0a800);color:#fff;}
		.tp-wf-label{margin-top:6px;font-size:12px;font-weight:600;}
		.tp-wf-sub{font-size:11px;color:var(--text-muted);}
		.tp-wf-connector{height:2px;background:var(--border-color);flex:1;margin-top:19px;min-width:24px;}
		.tp-wf-connector.done{background:var(--dark-green-500,#2e8b57);}
	</style>`;

	$w.html(html);

	$w.find(".tp-wf-bubble").on("click", function () {
		const stage = $(this).attr("data-stage");
		if (stage === current) return;
		frappe.confirm(
			__("Set development stage to {0}?", [stage]),
			() => {
				frappe.call({
					method: "apparel_erp.product_development.doctype.style.style.set_development_stage",
					args: { style: frm.doc.name, stage },
					callback: () => {
						frm.doc.development_stage = stage;
						render_workflow(frm);
						frappe.show_alert({ message: __("Stage updated"), indicator: "green" });
					}
				});
			}
		);
	});
}

function render_status_dropdown(frm) {
	if (frm.is_new()) return;
	const statuses = ["Not Started", "In Progress", "Completed"];
	statuses
		.filter(s => s !== frm.doc.status)
		.forEach(s => {
			frm.add_custom_button(s, () => {
				frappe.db.set_value("Style", frm.doc.name, "status", s).then(() => {
					frm.reload_doc();
					frappe.show_alert({ message: __("Status set to {0}", [s]), indicator: "green" });
				});
			}, __("Set Status"));
		});
}

function render_rest_tab(frm) {
	const wrapper = frm.get_field("rest_api_html").$wrapper;
	wrapper.empty();

	if (frm.is_new()) {
		wrapper.html(`<div class="text-muted padding">${__(
			"Save the record to get its REST API endpoint."
		)}</div>`);
		return;
	}

	const base = window.location.origin;
	const resource_url = `${base}/api/resource/Style/${encodeURIComponent(frm.doc.name)}`;
	const curl = `curl -X GET "${resource_url}" \\\n  -H "Authorization: token <api_key>:<api_secret>"`;

	const html = `
		<div class="apparel-rest-tab">
			<h5>${__("Resource URL")}</h5>
			<div class="input-group" style="max-width:640px;">
				<input type="text" class="form-control" readonly value="${resource_url}">
				<div class="input-group-append">
					<button class="btn btn-default btn-sm copy-rest-url">${__("Copy")}</button>
				</div>
			</div>
			<h5 class="margin-top">${__("Example (cURL)")}</h5>
			<pre>${frappe.utils.escape_html(curl)}</pre>
			<h5 class="margin-top">${__("Common operations")}</h5>
			<ul>
				<li><b>GET</b> ${resource_url} - ${__("fetch this Style")}</li>
				<li><b>PUT</b> ${resource_url} - ${__("update this Style")}</li>
				<li><b>DELETE</b> ${resource_url} - ${__("delete this Style")}</li>
				<li><b>POST</b> ${base}/api/resource/Style - ${__("create a new Style")}</li>
				<li><b>POST</b> ${base}/api/method/apparel_erp.product_development.doctype.style_bom.style_bom.generate_production_boms - ${__("generate production BOMs for a submitted Bulk Style BOM")}</li>
			</ul>
		</div>`;

	wrapper.html(html);
	wrapper.find(".copy-rest-url").on("click", function () {
		frappe.utils.copy_to_clipboard(resource_url);
	});
}

function generate_all_skus(frm) {
	// Check if colours and sizes are available
	const colours = (frm.doc.colours || []).filter(c => (c.status || "Active") === "Active");
	const sizes = frm.doc.sizes || [];

	if (!colours.length || !sizes.length) {
		frappe.msgprint(__("Please add at least one Colour and select Sizes first."));
		return;
	}

	// Check if any matrix rows need generation
	const matrix_rows = frm.doc.matrix_items || [];
	const pending_rows = matrix_rows.filter(m => m.status === "Not Generated");

	if (!pending_rows.length) {
		frappe.msgprint(__("All SKUs are already generated."));
		render_matrix(frm);
		return;
	}

	// Generation now happens on the Style BOM document (gated: Style
	// Confirmed, PP approved, Lab Dip approved per colourway, etc) and
	// covers every active + approved colourway in one go.
	frappe.call({
		method: "apparel_erp.product_development.doctype.style.style.get_latest_style_bom",
		args: { style: frm.doc.name }
	}).then((r) => {
		if (!r.message) {
			frappe.msgprint({
				title: __("No Style BOM yet"),
				message: __("Create and submit a Bulk Style BOM for this Style first."),
				primary_action: { label: __("Open/Create Style BOM"), action: () => open_style_bom(frm) }
			});
			return;
		}
		if (r.message.bom_type !== "Bulk") {
			frappe.msgprint({
				title: __("Style BOM is Development type"),
				message: __("Style BOM {0} (v{1}) is Development type. Only a Bulk Style BOM can generate production BOMs.", [r.message.name, r.message.version]),
				primary_action: { label: __("Open Style BOM"), action: () => frappe.set_route("Form", "Style BOM", r.message.name) }
			});
			return;
		}
		frappe.set_route("Form", "Style BOM", r.message.name);
	});
}

function show_production_selection_dialog(frm) {
	// Open a dialog for users to select which colour/size/BOM combinations will go to production.
	frappe.call({
		method: "apparel_erp.product_development.doctype.style.style.get_production_selection_matrix",
		args: { style: frm.doc.name },
		freeze: true,
		freeze_message: __("Loading production matrix...")
	}).then((r) => {
		if (!r.message) return;
		
		const matrix_items = r.message.matrix_items || [];
		
		// Create HTML table for selection
		let html = `
			<div class="production-selection-dialog" style="max-height: 600px; overflow-y: auto;">
				<table class="table table-bordered table-striped">
					<thead>
						<tr>
							<th style="width: 10%;">For Production</th>
							<th style="width: 20%;">Colour</th>
							<th style="width: 20%;">Size</th>
							<th style="width: 20%;">SKU</th>
							<th style="width: 20%;">Status</th>
						</tr>
					</thead>
					<tbody>
		`;
		
		matrix_items.forEach(item => {
			const checked = item.production_for_sku ? "checked" : "";
			html += `
				<tr>
					<td>
						<input type="checkbox" class="production-checkbox" data-name="${item.name}" ${checked} />
					</td>
					<td>${item.colour} (${item.colour_code})</td>
					<td>${item.size} (${item.size_code})</td>
					<td>${item.sku}</td>
					<td>${item.status}</td>
				</tr>
			`;
		});
		
		html += `
					</tbody>
				</table>
			</div>
		`;
		
		// Create and show dialog
		const dialog = new frappe.ui.Dialog({
			title: __("Select Combinations for Production"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "matrix_html",
					html: html
				}
			],
			primary_action_label: __("Save Selection"),
			primary_action() {
				// Collect selections
				const selections = [];
				dialog.$wrapper.find(".production-checkbox").each(function() {
					selections.push({
						name: $(this).data("name"),
						production_for_sku: this.checked ? 1 : 0
					});
				});
				
				// Save selections
				frappe.call({
					method: "apparel_erp.product_development.doctype.style.style.save_production_selection",
					args: {
						style: frm.doc.name,
						selection_data: selections
					},
					freeze: true,
					freeze_message: __("Saving production selection...")
				}).then((r) => {
					if (r.message && r.message.success) {
						frappe.show_alert({
							message: __("Production selection saved successfully!"),
							indicator: "green"
						});
						frm.reload_doc().then(() => render_matrix(frm));
						dialog.hide();
					}
				});
			},
			secondary_action_label: __("Select All"),
			secondary_action() {
				dialog.$wrapper.find(".production-checkbox").prop("checked", true);
			}
		});
		
		// Add "Clear All" button
		dialog.add_custom_action(__("Clear All"), () => {
			dialog.$wrapper.find(".production-checkbox").prop("checked", false);
		});
		
		dialog.show();
	});
}
