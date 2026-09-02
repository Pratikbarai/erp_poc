frappe.ui.form.on("Design Tech Pack", {
	refresh(frm) {
		$(frm.wrapper).addClass("design-tech-pack-form");
		render_tp_header(frm);
		render_header_actions(frm);
		load_style_snapshot(frm);
		render_measurements(frm);
		render_attachments(frm);
		render_activity(frm);
		render_next_action(frm);
		render_design_tech_pack_image_preview(frm);
		render_callouts(frm);
		render_print_options(frm);
		add_measurement_upload_action(frm);
	},

	style(frm) {
		if (frm.doc.style) {
			load_style_snapshot(frm);
		}
	},

	bom_template(frm) {
		if (!frm.doc.bom_template || !frm.doc.style) return;
		frappe.call({
			method: "apparel_erp.product_development.doctype.style.style.import_bom_to_style",
			args: { style: frm.doc.style, bom: frm.doc.bom_template },
			freeze: true,
			freeze_message: __("Loading BOM materials...")
		}).then((r) => {
			if (!r.message) return;
			frappe.show_alert({
				message: __("Loaded {0} BOM material(s) into the linked Style.", [r.message.item_count]),
				indicator: "green"
			});
			load_style_snapshot(frm);
		});
	},

	status(frm) {
		frm.dirty();
	}
});

const TP_STATUSES = ["Not Started", "In Progress", "Completed"];

function render_header_actions(frm) {
	frm.page.clear_primary_action();
	frm.page.clear_secondary_action();

	if (frm.is_new() || frm.is_dirty()) {
		frm.page.set_primary_action(__("Save"), () => frm.save());
		return;
	}

	frm.page.set_secondary_action(__("Preview Tech Pack (PDF)"), () => frm.print_doc());

	frm.page.set_primary_action(
		frm.doc.status === "Completed" ? __("Completed") : __("Mark as Completed"),
		() => set_status(frm, "Completed")
	);

	// chevron-style dropdown next to the primary action, letting the user jump to any status
	TP_STATUSES.filter(s => s !== frm.doc.status).forEach(s => {
		frm.page.add_custom_button(s, () => set_status(frm, s), __("Set Status"));
	});
}

function set_status(frm, status) {
	if (frm.doc.status === status) return;
	frappe.call({
		method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.set_status",
		args: { name: frm.doc.name, status },
		callback: () => {
			frappe.show_alert({ message: __("Status set to {0}", [status]), indicator: "green" });
			frm.reload_doc();
		}
	});
}

function load_style_snapshot(frm) {
	if (!frm.doc.style) return;
	frappe.call({
		method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.get_style_snapshot",
		args: { style: frm.doc.style },
		callback: (r) => {
			if (!r.message) return;
			frm.tp_snapshot = r.message;
			if (frm.is_new()) {
				Object.entries(r.message.style_fields || {}).forEach(([fieldname, value]) => {
					if (value == null || fieldname === "status" || fieldname === "tech_pack_version") return;
					frm.doc[fieldname] = value;
					frm.refresh_field(fieldname);
				});
			}
			render_tp_header(frm);
			render_colourways(frm, r.message.colours);
			render_sizerange(frm, r.message.sizes);
			render_matrix_status(frm, r.message.matrix_items);
			render_fabric_trims(frm, r.message.bom_items);
			render_production(frm, r.message);
			render_measurements(frm);
		},
		error: (r) => {
			console.error("Unable to load Style data for Design Tech Pack", r);
			frappe.show_alert({
				message: __("Unable to load the linked Style data."),
				indicator: "red"
			});
		}
	});
}

function render_tp_header(frm) {
		if (frm.tp_header) frm.tp_header.remove();

		const style_no = frm.doc.style_no || frm.doc.style || __("New Tech Pack");
		const style_name = frm.doc.style_name || __("Link a Style to begin");
		const status = frm.doc.status || __("Not Started");
		const status_class = status === "Completed" ? "done" : status === "In Progress" ? "active" : "pending";
		const image = frm.doc.style_image
			? `<img src="${frappe.utils.escape_html(frm.doc.style_image)}" alt="${__("Style image")}">`
			: `<span class="tp-header-placeholder">${__("No image")}</span>`;

		const $header = $(`<div class="tp-record-header">
			<div class="tp-record-image">${image}</div>
			<div class="tp-record-copy">
				<div class="tp-record-kicker">${__("Design & Tech Pack")} <span>/</span> ${frappe.utils.escape_html(frm.doc.tech_pack_version || "v1.0")}</div>
				<div class="tp-record-title-row">
					<h1>${frappe.utils.escape_html(style_no)}</h1>
					<span class="tp-record-status ${status_class}"><span></span>${frappe.utils.escape_html(status)}</span>
				</div>
				<div class="tp-record-subtitle">${frappe.utils.escape_html(style_name)}${frm.doc.customer_brand ? ` <span>·</span> ${frappe.utils.escape_html(frm.doc.customer_brand)}` : ""}${frm.doc.season ? ` <span>·</span> ${frappe.utils.escape_html(frm.doc.season)}` : ""}</div>
			</div>
			<div class="tp-record-actions">
				${frm.doc.style ? `<button type="button" class="btn btn-default btn-sm tp-open-style">${__("Open Style")}</button>` : ""}
				${!frm.is_new() ? `<button type="button" class="btn btn-default btn-sm tp-preview">${__("Preview PDF")}</button>` : ""}
			</div>
		</div>`);

		if (frm.doc.style) $header.find(".tp-open-style").on("click", () => frappe.set_route("Form", "Style", frm.doc.style));
		if (!frm.is_new()) $header.find(".tp-preview").on("click", () => frm.print_doc());
		frm.tp_header = $header;
		$header.insertBefore(frm.layout.wrapper);
}

function render_colourways(frm, colours) {
	const $w = frm.get_field("colourways_html").$wrapper;
	if (!colours || !colours.length) {
		$w.html(`<div class="text-muted">${__("No colours on the Style yet.")}</div>`);
		return;
	}
	let html = `<div class="tp-swatch-row">`;
	colours.forEach(c => {
		html += `<div class="tp-swatch">
			<div class="tp-swatch-box" style="background:${c.swatch || "#eee"}"></div>
			<div class="tp-swatch-label">${c.colour_code || ""}<br>${frappe.utils.escape_html(c.colour_name)}</div>
		</div>`;
	});
	html += `</div><style>
		.tp-swatch-row{display:flex;gap:16px;flex-wrap:wrap;}
		.tp-swatch{text-align:center;font-size:12px;}
		.tp-swatch-box{width:48px;height:48px;border-radius:6px;border:1px solid var(--border-color);margin-bottom:4px;}
	</style>`;
	$w.html(html);
}

function render_sizerange(frm, sizes) {
	const $w = frm.get_field("sizerange_html").$wrapper;
	if (!sizes || !sizes.length) {
		$w.html(`<div class="text-muted">${__("No sizes selected on the Style yet.")}</div>`);
		return;
	}
	let html = `<div class="tp-size-pills">`;
	sizes.forEach(s => {
		html += `<span class="tp-size-pill">${frappe.utils.escape_html(s.size_code || s.size || "")}</span>`;
	});
	if (frm.doc.size_chart) {
		if (is_image_file(frm.doc.size_chart)) {
			html += `<img src="${frm.doc.size_chart}" class="tp-size-chart-preview" alt="${__("Size Chart")}">`;
		} else {
			html += `<span class="tp-size-chart-link">${__("Size Chart")}</span>`;
		}
	}
	html += `</div><style>
		.tp-size-pills{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
		.tp-size-pill{border:1px solid var(--border-color);border-radius:6px;padding:6px 14px;font-weight:600;}
		.tp-size-chart-link{color:var(--primary);cursor:pointer;font-weight:600;margin-left:8px;}
		.tp-size-chart-preview{width:96px;height:96px;object-fit:cover;border:1px solid var(--border-color);border-radius:6px;cursor:pointer;margin-left:8px;}
	</style>`;
	$w.html(html);
	$w.find(".tp-size-chart-link").on("click", () => window.open(frm.doc.size_chart, "_blank"));
	$w.find(".tp-size-chart-preview").on("click", () => window.open(frm.doc.size_chart, "_blank"));
}

function render_matrix_status(frm, rows) {
	const $w = frm.get_field("matrix_status_html").$wrapper;
	if (!rows || !rows.length) {
		$w.html(`<div class="text-muted">${__("No SKU matrix rows on the Style yet.")}</div>`);
		return;
	}
	let html = `<div class="table-responsive"><table class="table table-bordered tp-matrix-status"><thead><tr><th>${__("Colour")}</th><th>${__("Size")}</th><th>${__("SKU")}</th><th>${__("BOM")}</th><th>${__("Status")}</th></tr></thead><tbody>`;
	rows.forEach(row => {
		html += `<tr><td>${frappe.utils.escape_html(row.colour || row.colour_code || "")}</td><td>${frappe.utils.escape_html(row.size || row.size_code || "")}</td><td>${frappe.utils.escape_html(row.sku || row.item || "-")}</td><td>${frappe.utils.escape_html(row.bom || "-")}</td><td><span class="tp-matrix-status-pill">${frappe.utils.escape_html(row.status || "Not Generated")}</span></td></tr>`;
	});
	html += `</tbody></table></div><style>.tp-matrix-status-pill{font-weight:600;}</style>`;
	$w.html(html);
}

function is_image_file(file_url) {
	return /\.(png|jpe?g|gif|webp|bmp)(\?.*)?$/i.test(file_url || "");
}

const FILE_ICON_MAP = {
	pdf: { icon: "📕", color: "#e03e2d" },
	doc: { icon: "📘", color: "#2b579a" },
	docx: { icon: "📘", color: "#2b579a" },
	xls: { icon: "📗", color: "#217346" },
	xlsx: { icon: "📗", color: "#217346" },
	csv: { icon: "📗", color: "#217346" },
	ppt: { icon: "📙", color: "#d24726" },
	pptx: { icon: "📙", color: "#d24726" },
	ai: { icon: "🎨", color: "#330000" },
	psd: { icon: "🎨", color: "#001e36" },
	png: { icon: "🖼️", color: "#666" },
	jpg: { icon: "🖼️", color: "#666" },
	jpeg: { icon: "🖼️", color: "#666" },
	zip: { icon: "🗜️", color: "#666" }
};

function format_file_size(bytes) {
	if (!bytes) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function render_attachments(frm) {
	const $w = frm.get_field("attachments_html").$wrapper;
	$w.empty();

	let html = `<div class="tp-attach-grid">`;
	(frm.doc.attachments || []).forEach((row, idx) => {
		const ext = (row.file_type || (row.file_name || "").split(".").pop() || "").toLowerCase();
		const meta = FILE_ICON_MAP[ext] || { icon: "📄", color: "#666" };
		const file_display = is_image_file(row.file) || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)
			? `<img src="${row.file}" class="tp-attach-preview" alt="${frappe.utils.escape_html(row.file_name || __("Attachment"))}">`
			: `<a href="${row.file}" target="_blank" class="tp-attach-name">${frappe.utils.escape_html(row.file_name || row.file)}</a>`;
		html += `<div class="tp-attach-card" data-idx="${idx}">
			<div class="tp-attach-icon">${file_display}</div>
			<div class="tp-attach-info">
				${is_image_file(row.file) || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext) ? `<div class="tp-attach-name">${frappe.utils.escape_html(row.file_name || row.file)}</div>` : ""}
				<div class="tp-attach-meta">${(ext || "").toUpperCase()}${row.file_size ? " • " + format_file_size(row.file_size) : ""}</div>
			</div>
			<span class="tp-attach-remove" data-idx="${idx}" title="${__("Remove")}">&times;</span>
		</div>`;
	});
	html += `<div class="tp-attach-add">+ ${__("Add File")}</div></div>
	<style>
		.tp-attach-grid{display:flex;gap:10px;flex-wrap:wrap;}
		.tp-attach-card{position:relative;display:flex;align-items:center;gap:8px;border:1px solid var(--border-color);
			border-radius:8px;padding:10px 14px;min-width:180px;}
		.tp-attach-icon{font-size:22px;}
		.tp-attach-preview{width:64px;height:64px;object-fit:cover;border-radius:4px;display:block;cursor:pointer;}
		.tp-attach-name{display:block;font-size:12px;font-weight:600;max-width:130px;overflow:hidden;
			text-overflow:ellipsis;white-space:nowrap;}
		.tp-attach-meta{font-size:11px;color:var(--text-muted);}
		.tp-attach-remove{position:absolute;top:4px;right:6px;cursor:pointer;color:var(--text-muted);}
		.tp-attach-add{display:flex;align-items:center;justify-content:center;min-width:120px;
			border:2px dashed var(--border-color);border-radius:8px;cursor:pointer;color:var(--text-muted);font-size:12px;}
	</style>`;

	$w.html(html);

	$w.find(".tp-attach-remove").on("click", function (e) {
		e.stopPropagation();
		const idx = $(this).attr("data-idx");
		frm.doc.attachments.splice(idx, 1);
		frm.refresh_field("attachments");
		render_attachments(frm);
		frm.dirty();
	});

	$w.find(".tp-attach-add").on("click", () => {
		new frappe.ui.FileUploader({
			doctype: "Design Tech Pack",
			docname: frm.doc.name,
			on_success: (file) => {
				frm.add_child("attachments", {
					file: file.file_url,
					file_name: file.file_name,
					file_type: (file.file_name || "").split(".").pop(),
					file_size: file.file_size
				});
				frm.refresh_field("attachments");
				render_attachments(frm);
				frm.dirty();
			}
		});
	});
}

function render_fabric_trims(frm, items) {
	const $w = frm.get_field("fabric_trims_html").$wrapper;
	const edit_button = frm.doc.style
		? `<button type="button" class="btn btn-default btn-sm tp-edit-bom">${__("Edit BOM")}</button>`
		: "";
	if (!items || !items.length) {
		$w.html(`<div class="tp-fabric-trims-toolbar">${edit_button}</div>
			<div class="text-muted">${__("No BOM lines on the Style yet.")}</div>`);
		bind_edit_bom(frm, $w);
		return;
	}
	let html = `<div class="tp-fabric-trims-toolbar">${edit_button}</div>
		<div class="table-responsive"><table class="table table-bordered">
		<thead><tr><th>#</th><th>${__("Item")}</th><th>${__("Description")}</th>
		<th>${__("Composition")}</th><th>${__("GSM")}</th><th>${__("Consumption")}</th></tr></thead><tbody>`;
	let current_group = null;
	items.forEach((row, idx) => {
		if (row.item_type !== current_group) {
			current_group = row.item_type;
			html += `<tr><td colspan="6"><strong>${frappe.utils.escape_html((current_group || "").toUpperCase())}</strong></td></tr>`;
		}
		html += `<tr>
			<td>${idx + 1}</td>
			<td>${frappe.utils.escape_html(row.item_name || "")}</td>
			<td>${frappe.utils.escape_html(row.description || "-")}</td>
			<td>${frappe.utils.escape_html(row.composition || "-")}</td>
			<td>${frappe.utils.escape_html(row.gsm || "-")}</td>
			<td>${frappe.utils.escape_html(row.consumption || "-")}</td>
		</tr>`;
	});
	html += `</tbody></table></div>`;
	$w.html(html);
	bind_edit_bom(frm, $w);
}

function bind_edit_bom(frm, $wrapper) {
	$wrapper.find(".tp-edit-bom").on("click", () => {
		frappe.set_route("style-workspace", frm.doc.style);
		setTimeout(() => {
			const workspace = frappe.pages["style-workspace"] && frappe.pages["style-workspace"].wrapper;
			if (workspace && workspace.style_workspace) workspace.style_workspace.switch_tab("bom");
		}, 300);
	});
}

function render_production(frm, snapshot) {
	const $w = frm.get_field("production_selection_html").$wrapper;
	$w.empty();

	const colours = snapshot && snapshot.colours ? snapshot.colours : [];
	const sizes = (frm.tp_snapshot && frm.tp_snapshot.sizes) || [];
	const bom_items = snapshot && snapshot.bom_items ? snapshot.bom_items : [];
	const matrix_items = snapshot && snapshot.matrix_items ? snapshot.matrix_items : [];
	const confirmed = frm.doc.production_confirmed;

	// Build summary card
	let html = `<div class="tp-production-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px;">`;
	html += `<div class="tp-production-card">
		<div class="tp-production-label">Status</div>
		<div class="tp-production-value ${confirmed ? "ok" : "warn"}">${confirmed ? "Confirmed ✓" : "Pending"}</div>
	</div>`;
	html += `<div class="tp-production-card">
		<div class="tp-production-label">Approved Colours</div>
		<div class="tp-production-value">${colours.filter(c => c.approved_for_production).length} / ${colours.length || 0}</div>
	</div>`;
	html += `<div class="tp-production-card">
		<div class="tp-production-label">Size Range</div>
		<div class="tp-production-value">${sizes.length || 0}</div>
	</div></div>`;

	if (confirmed) {
		// Show confirmed selection
		html += `<div style="background:#e8f5e9;border:1px solid #4caf50;border-radius:8px;padding:16px;margin:16px 0;">
			<h5 style="color:#2e7d32;margin-top:0;">Production Selection Locked</h5>
			<p style="color:#558b2f;margin:8px 0;">Production has been confirmed. Style and BOM editing is now disabled.</p>
		</div>`;
	} else {
		// Show selection interface
		html += `<div style="margin:20px 0;">
			<h5>${__("Step 1: Select Colours")}</h5>
			<div class="tp-prod-colours" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">`;
		
		colours.forEach(c => {
			const checked = c.approved_for_production ? "checked" : "disabled";
			const disabled = c.approved_for_production ? "" : "disabled";
			html += `<label class="tp-prod-colour-label" ${disabled ? 'style="opacity:0.5;"' : ''}>
				<input type="checkbox" class="tp-prod-colour-check" value="${frappe.utils.escape_html(c.colour_name)}" ${checked}>
				<span class="tp-swatch-box" style="background:${c.swatch || '#eee'};width:32px;height:32px;display:inline-block;border-radius:4px;margin-right:6px;border:2px solid ${checked ? 'var(--primary)' : 'transparent'};"></span>
				<span>${frappe.utils.escape_html(c.colour_name)}</span>
			</label>`;
		});
		
		html += `</div>
			<h5>${__("Step 2: Select Sizes")}</h5>
			<div class="tp-prod-sizes" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">`;
		
		sizes.forEach(s => {
			html += `<label class="tp-prod-size-label">
				<input type="checkbox" class="tp-prod-size-check" value="${frappe.utils.escape_html(s.size)}" checked>
				<span style="border:1px solid var(--border-color);border-radius:4px;padding:6px 12px;display:inline-block;cursor:pointer;">${frappe.utils.escape_html(s.size_code || s.size)}</span>
			</label>`;
		});
		
		html += `</div>
			<h5>${__("Step 3: Review BOM")}</h5>`;
		
		if (bom_items.length) {
			html += `<div class="table-responsive" style="margin-bottom:20px;"><table class="table table-bordered">
				<thead><tr><th>${__("Item")}</th><th>${__("Type")}</th><th>${__("Composition")}</th><th>${__("Available")}</th></tr></thead><tbody>`;
			bom_items.forEach(b => {
				const available = b.available_in_market ? "✓" : "✗";
				const available_class = b.available_in_market ? "text-success" : "text-danger";
				html += `<tr>
					<td>${frappe.utils.escape_html(b.item_name || "")}</td>
					<td>${frappe.utils.escape_html(b.item_type || "")}</td>
					<td>${frappe.utils.escape_html(b.composition || "-")}</td>
					<td class="${available_class}" style="font-weight:bold;">${available}</td>
				</tr>`;
			});
			html += `</tbody></table></div>`;
		} else {
			html += `<div class="text-muted">${__("No BOM items defined yet.")}</div>`;
		}
		
		html += `<div style="margin-top:20px;">
			<button class="btn btn-primary tp-confirm-production">${__("Confirm Production Selection")}</button>
			<span style="margin-left:10px;font-size:12px;color:var(--text-muted);">After confirmation, colour/size selection and BOM will be locked.</span>
		</div>`;
	}

	html += `<style>
		.tp-production-card{border:1px solid var(--border-color);border-radius:8px;padding:12px;background:#fafafa;}
		.tp-production-label{font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:6px;}
		.tp-production-value{font-size:20px;font-weight:700;color:var(--primary);}
		.tp-production-value.ok{color:#2e8b57;}
		.tp-production-value.warn{color:#d97706;}
		.tp-prod-colour-label,.tp-prod-size-label{display:flex;align-items:center;cursor:pointer;margin:4px;user-select:none;}
		.tp-prod-colour-label input,.tp-prod-size-label input{margin-right:8px;cursor:pointer;}
		.tp-prod-colour-label span:last-child,.tp-prod-size-label span{padding:4px 8px;}
	</style>`;

	$w.html(html);

	// Bind event handlers
	if (!confirmed) {
		$w.find(".tp-confirm-production").on("click", () => {
			const selected_colours = [];
			const selected_sizes = [];
			
			$w.find(".tp-prod-colour-check:checked").each(function() {
				selected_colours.push($(this).val());
			});
			
			$w.find(".tp-prod-size-check:checked").each(function() {
				selected_sizes.push($(this).val());
			});
			
			if (!selected_colours.length || !selected_sizes.length) {
				frappe.msgprint(__("Please select at least one colour and one size."));
				return;
			}
			
			frappe.confirm(__("Confirm production selection? After confirmation, editing will be restricted."), () => {
				frappe.call({
					method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.confirm_production_selection",
					args: {
						name: frm.doc.name,
						colours: selected_colours,
						sizes: selected_sizes
					},
					freeze: true,
					freeze_message: __("Confirming production selection..."),
					callback: () => {
						frappe.show_alert({
							message: __("Production selection confirmed!"),
							indicator: "green"
						});
						frm.reload_doc();
					}
				});
			});
		});
	}
}

function render_measurements(frm) {
	const $w = frm.get_field("measurements_html").$wrapper;
	$w.empty();

	const sizes = (frm.tp_snapshot && frm.tp_snapshot.sizes) || [];
	const upload_button = `<button class="btn btn-xs btn-default tp-upload-measurements">${__("Upload Excel/CSV")}</button>`;
	if (!sizes.length) {
		$w.html(`<div class="tp-measure-toolbar">${upload_button}</div><div class="text-muted">${__("Select Sizes on the Style first.")}</div>`);
		bind_measurement_upload(frm, $w);
		return;
	}

	const points = [];
	(frm.doc.measurements || []).forEach(row => {
		if (!points.find(p => p.measurement_point === row.measurement_point)) {
			points.push({ measurement_point: row.measurement_point, sequence: row.sequence || points.length + 1 });
		}
	});
	points.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

	let html = `<div class="table-responsive"><table class="table table-bordered tp-measure-table">
		<thead><tr><th>#</th><th>${__("Measurement Point")}</th>`;
	sizes.forEach(s => html += `<th class="text-center">${frappe.utils.escape_html(s.size)}</th>`);
	html += `<th class="text-center">${__("Tol. (+/-)")}</th></tr></thead><tbody>`;

	points.forEach((pt, idx) => {
		html += `<tr data-point="${frappe.utils.escape_html(pt.measurement_point)}">
			<td>${idx + 1}</td>
			<td>${frappe.utils.escape_html(pt.measurement_point)}</td>`;
		sizes.forEach(s => {
			const row = (frm.doc.measurements || []).find(
				m => m.measurement_point === pt.measurement_point && m.size === s.size
			);
			html += `<td class="text-center">
				<input type="number" step="0.01" class="form-control input-sm tp-measure-input"
					data-size="${frappe.utils.escape_html(s.size)}"
					value="${row ? row.value : ""}">
			</td>`;
		});
		const tol_row = (frm.doc.measurements || []).find(m => m.measurement_point === pt.measurement_point);
		html += `<td class="text-center">
			<input type="number" step="0.01" class="form-control input-sm tp-tolerance-input"
				value="${tol_row && tol_row.tolerance != null ? tol_row.tolerance : ""}">
		</td></tr>`;
	});

	html += `</tbody></table></div>
	<div class="tp-measure-toolbar">${upload_button}<button class="btn btn-xs btn-default tp-add-point">${__("+ Add Measurement Point")}</button></div>
	<style>.tp-measure-table input{width:70px;display:inline-block;}</style>`;

	$w.html(html);

	$w.find(".tp-add-point").on("click", () => {
		const point_name = prompt(__("Measurement point name (e.g. Chest, Body Length)"));
		if (!point_name) return;
		sizes.forEach(s => {
			frm.add_child("measurements", {
				measurement_point: point_name,
				size: s.size,
				sequence: points.length + 1
			});
		});
		frm.refresh_field("measurements");
		render_measurements(frm);
	});

	$w.find(".tp-measure-input").on("change", function () {
		const $tr = $(this).closest("tr");
		const point = $tr.attr("data-point");
		const size = $(this).attr("data-size");
		const value = parseFloat($(this).val());
		upsert_measurement_cell(frm, point, size, { value });
	});

	$w.find(".tp-tolerance-input").on("change", function () {
		const $tr = $(this).closest("tr");
		const point = $tr.attr("data-point");
		const tolerance = parseFloat($(this).val());
		(frm.doc.measurements || [])
			.filter(m => m.measurement_point === point)
			.forEach(m => { m.tolerance = tolerance; });
		frm.dirty();
	});
	bind_measurement_upload(frm, $w);
}

function bind_measurement_upload(frm, $wrapper) {
	$wrapper.find(".tp-upload-measurements").on("click", () => {
		start_measurement_upload(frm);
	});
}

function add_measurement_upload_action(frm) {
	if (frm.is_new() || frm._measurement_upload_action_added) return;
	frm.add_custom_button(__("Upload Measurements"), () => start_measurement_upload(frm));
	frm._measurement_upload_action_added = true;
}

function start_measurement_upload(frm) {
	if (frm.is_new()) {
		frappe.msgprint(__("Save the Design & Tech Pack before uploading measurements."));
		return;
	}
	new frappe.ui.FileUploader({
		doctype: "Design Tech Pack",
		docname: frm.doc.name,
		allow_multiple: false,
		on_success: (file) => {
			frappe.call({
				method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.parse_measurements_sheet",
				args: { name: frm.doc.name, file_url: file.file_url },
				freeze: true,
				freeze_message: __("Reading measurement sheet...")
			}).then((r) => {
				if (!r.message) return;
				frm.clear_table("measurements");
				r.message.forEach(row => frm.add_child("measurements", row));
				frm.refresh_field("measurements");
				frm.dirty();
				render_measurements(frm);
				frappe.show_alert({
					message: __("Imported {0} measurement row(s). Save to apply.", [r.message.length]),
					indicator: "green"
				});
			});
		}
	});
}

function upsert_measurement_cell(frm, point, size, values) {
	let row = (frm.doc.measurements || []).find(
		m => m.measurement_point === point && m.size === size
	);
	if (!row) {
		row = frm.add_child("measurements", { measurement_point: point, size });
	}
	Object.assign(row, values);
	frm.refresh_field("measurements");
	frm.dirty();
}

function render_activity(frm) {
	const $w = frm.get_field("activity_html").$wrapper;
	if (frm.is_new()) {
		$w.html(`<div class="text-muted">${__("Save to start the activity log.")}</div>`);
		return;
	}
	$w.html(`<div class="text-muted">${__("Loading...")}</div>`);

	frappe.call({
		method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.get_activity_feed",
		args: { name: frm.doc.name },
		callback: (r) => {
			const feed = r.message || [];
			if (!feed.length) {
				$w.html(`<div class="text-muted">${__("No activity yet.")}</div>`);
				return;
			}
			let html = `<div class="tp-activity-feed">`;
			feed.forEach(row => {
				html += `<div class="tp-activity-row">
					<div class="tp-activity-meta">${frappe.datetime.str_to_user(row.creation)} &middot; ${frappe.utils.escape_html(row.owner)}</div>
					<div>${frappe.utils.escape_html(row.message)}</div>
				</div>`;
			});
			html += `</div><style>
				.tp-activity-row{padding:8px 0;border-bottom:1px solid var(--border-color);}
				.tp-activity-meta{font-size:11px;color:var(--text-muted);}
			</style>`;
			$w.html(html);
		}
	});
}

function render_next_action(frm) {
	const $w = frm.get_field("next_action_html").$wrapper;
	$w.empty();

	if (frm.is_new()) {
		$w.html(`<div class="text-muted">${__("Save first.")}</div>`);
		return;
	}

	const $btn = $(`<button class="btn btn-primary btn-sm">${__("Send for Sampling")}</button>`);
	$btn.on("click", () => {
		if (frm.is_dirty()) {
			frappe.msgprint(__("Please save your changes first."));
			return;
		}
		frappe.call({
			method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.send_for_sampling",
			args: { name: frm.doc.name, assign_to: frm.doc.assign_to },
			callback: () => {
				frappe.show_alert({ message: __("Sent for Sampling"), indicator: "green" });
				frm.reload_doc();
			}
		});
	});
	$w.append($btn);
}

function render_design_tech_pack_image_preview(frm) {
	const image_fields = ["style_image", "front_sketch", "back_sketch", "construction_diagram"];

	image_fields.forEach(fieldname => {
		const $field = frm.get_field(fieldname);
		if (!$field || !$field.$wrapper) return;

		const $wrapper = $field.$wrapper;
		const $img = $wrapper.find("img");
		if (!$img.length) return;

		// Ensure image displays as preview thumbnail
		$img.css("max-width", "100%").css("height", "auto").css("display", "block");

		// Make click non-navigable - just show preview alert
		const $anchor = $wrapper.find("a");
		if ($anchor.length) {
			$anchor.off("click").on("click", function(e) {
				e.preventDefault();
				e.stopPropagation();
				frappe.show_alert({
					message: __("Image preview - click to view details"),
					indicator: "info"
				});
			});
		}
	});
}

function render_callouts(frm) {
	const callouts = frm.doc.callouts || [];
	const $list = frm.get_field("callouts_html").$wrapper;
	$list.html(callouts.length ? callouts.map(row => `
		<div class="tp-callout-row">
			<span class="tp-callout-number">${row.sequence || ""}</span>
			<span class="tp-callout-sketch">${frappe.utils.escape_html(row.sketch || "Front")}</span>
			<span class="tp-callout-text">${frappe.utils.escape_html(row.text || "")}</span>
		</div>`).join("") : `<div class="text-muted">${__("Click a sketch to add a numbered construction callout.")}</div>`);

	["front_sketch", "back_sketch"].forEach(fieldname => {
		const sketch = fieldname === "front_sketch" ? "Front" : "Back";
		const $field = frm.get_field(fieldname);
		if (!$field || !$field.$wrapper) return;
		const $wrapper = $field.$wrapper;
		$wrapper.find(".tp-marker-layer").remove();
		const $img = $wrapper.find("img").first();
		if (!$img.length) return;

		$wrapper.css("position", "relative");
		const $layer = $(`<div class="tp-marker-layer" title="${__("Click to add a callout")}"></div>`);
		$wrapper.append($layer);
		callouts.filter(row => (row.sketch || "Front") === sketch).forEach(row => {
			$layer.append(`<span class="tp-sketch-marker" style="left:${row.x || 0}%;top:${row.y || 0}%">${row.sequence || ""}</span>`);
		});

		$img.css("cursor", "crosshair").off("click.tp-callout").on("click.tp-callout", function (event) {
			event.preventDefault();
			event.stopPropagation();
			const rect = this.getBoundingClientRect();
			const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
			const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
			const text = prompt(__("Construction note for this callout:"));
			if (!text || !text.trim()) return;
			const sequence = callouts.reduce((max, row) => Math.max(max, row.sequence || 0), 0) + 1;
			frm.add_child("callouts", { sequence, text: text.trim(), sketch, x, y });
			frm.refresh_field("callouts");
			render_callouts(frm);
			frm.dirty();
		});
	});
}

function render_print_options(frm) {
	const $w = frm.get_field("print_options_html").$wrapper;
	if (!$w.length) return;
	
	$w.empty();
	
	const sections = [
		{ key: "Design Sketch", label: "Design Sketch (Front & Back)", checked: true },
		{ key: "Colourways", label: "Colourways", checked: true },
		{ key: "Size Range", label: "Size Range & Measurements", checked: true },
		{ key: "Measurements", label: "Detailed Measurements", checked: true },
		{ key: "Construction Details", label: "Construction Details", checked: true },
		{ key: "Fabric & Trims", label: "Fabric & Trims (BOM)", checked: true },
		{ key: "Reference Images", label: "Reference Images", checked: true }
	];
	
	let html = `<div style="margin:16px 0;">
		<p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Select sections to include in the printed tech pack:</p>
		<div class="tp-print-options">`;
	
	sections.forEach(section => {
		const is_selected = frm.doc.print_sections && frm.doc.print_sections.includes(section.key);
		html += `<label class="tp-print-option-label">
			<input type="checkbox" class="tp-print-option-check" value="${frappe.utils.escape_html(section.key)}" ${is_selected ? "checked" : ""}>
			<span style="margin-left:6px;cursor:pointer;">${frappe.utils.escape_html(section.label)}</span>
		</label>`;
	});
	
	html += `</div>
		<div style="margin-top:16px;">
			<button class="btn btn-default btn-sm tp-print-preview">${__("Preview")}</button>
			<button class="btn btn-primary btn-sm tp-print-pdf" style="margin-left:8px;">${__("Print PDF")}</button>
			<span style="margin-left:12px;font-size:12px;color:var(--text-muted);">Choose sections above before printing</span>
		</div>
	</div>
	<style>
		.tp-print-options{display:flex;flex-direction:column;gap:8px;margin:12px 0;}
		.tp-print-option-label{display:flex;align-items:center;cursor:pointer;padding:8px;border-radius:4px;transition:background 0.2s;}
		.tp-print-option-label:hover{background:#f5f5f5;}
		.tp-print-option-label input{cursor:pointer;}
	</style>`;
	
	$w.html(html);
	
	// Bind event handlers
	$w.find(".tp-print-option-check").on("change", function() {
		const selected = [];
		$w.find(".tp-print-option-check:checked").each(function() {
			selected.push($(this).val());
		});
		frm.set_value("print_sections", selected.join("\n"));
	});
	
	$w.find(".tp-print-preview").on("click", () => {
		frappe.msgprint(__("Preview PDF - functionality can be expanded to show a preview modal."));
	});
	
	$w.find(".tp-print-pdf").on("click", () => {
		const selected_sections = [];
		$w.find(".tp-print-option-check:checked").each(function() {
			selected_sections.push($(this).val());
		});
		
		if (!selected_sections.length) {
			frappe.msgprint(__("Please select at least one section to print."));
			return;
		}
		
		// Use Frappe's built-in print functionality with selected sections
		frappe.call({
			method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.generate_custom_print",
			args: {
				name: frm.doc.name,
				sections: selected_sections
			},
			callback: (r) => {
				if (r.message && r.message.pdf_url) {
					window.open(r.message.pdf_url, "_blank");
				}
			}
		});
	});
}
