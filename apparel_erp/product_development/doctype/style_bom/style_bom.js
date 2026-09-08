frappe.ui.form.on("Style BOM", {
	refresh(frm) {
		render_generation_log(frm);

		if (frm.doc.docstatus === 1 && frm.doc.bom_type === "Bulk") {
			frm.add_custom_button(__("Generate Production BOMs"), () => {
				generate_production_boms(frm);
			}).addClass("btn-primary");
		}

		if (frm.doc.docstatus === 1 && frm.doc.bom_type === "Development") {
			frm.dashboard.set_headline_alert(
				`<div class="alert alert-warning">${__("This Style BOM is Development type - only a Bulk Style BOM can generate production BOMs. Amend and switch the type when the design is locked.")}</div>`
			);
		}

		if (frm.doc.docstatus === 0) {
			frm.add_custom_button(__("Open Style"), () => {
				frappe.set_route("Form", "Style", frm.doc.style);
			});
		}
	}
});

function generate_production_boms(frm) {
	frappe.confirm(
		__("Generate production BOMs for every Active, Approved-for-Production colourway on {0}? Gates (Style Confirmed, PP approval, Lab Dip approvals) will be checked first.", [frm.doc.style]),
		() => {
			frappe.dom.freeze(__("Checking gates and generating..."));
			frappe.call({
				method: "apparel_erp.product_development.doctype.style_bom.style_bom.generate_production_boms",
				args: { style_bom_name: frm.doc.name },
				callback: function (r) {
					frappe.dom.unfreeze();
					if (r.message) {
						frappe.show_alert({
							message: __("Generated/confirmed {0} BOM(s), one per colourway.", [r.message.count]),
							indicator: "green"
						});
						frm.reload_doc().then(() => render_generation_log(frm));
					}
				},
				error: function () {
					frappe.dom.unfreeze();
				}
			});
		}
	);
}

function render_generation_log(frm) {
	const field = frm.get_field("generation_html");
	if (!field || !field.$wrapper || frm.is_new()) return;

	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Style BOM Generation Log",
			filters: { style_bom: frm.doc.name },
			fields: ["name", "colourway", "generated_bom", "is_variance", "note", "creation"],
			order_by: "creation desc",
			limit_page_length: 50
		}
	}).then((r) => {
		const rows = r.message || [];
		if (!rows.length) {
			field.$wrapper.html(`<div class="text-muted">${__("Nothing generated yet.")}</div>`);
			return;
		}
		let html = `<table class="table table-bordered table-sm"><thead><tr>
			<th>${__("Colourway")}</th><th>${__("BOM")}</th><th>${__("When")}</th><th></th>
		</tr></thead><tbody>`;
		rows.forEach(row => {
			const badge = row.is_variance
				? `<span class="indicator-pill orange" title="${frappe.utils.escape_html(row.note || "")}">${__("Variance - left untouched")}</span>`
				: `<span class="indicator-pill green">${__("Generated")}</span>`;
			html += `<tr>
				<td>${frappe.utils.escape_html(row.colourway || "")}</td>
				<td><a href="#" class="sw-open-bom" data-bom="${frappe.utils.escape_html(row.generated_bom || "")}">${frappe.utils.escape_html(row.generated_bom || "")}</a></td>
				<td>${frappe.datetime.comment_when(row.creation)}</td>
				<td>${badge}</td>
			</tr>`;
		});
		html += `</tbody></table>`;
		field.$wrapper.html(html);
		field.$wrapper.find(".sw-open-bom").on("click", function (e) {
		    e.preventDefault();
		    frappe.set_route("Form", "BOM", $(this).attr("data-bom"));
		});
	});
}

// Inline hints on the BOM Line grid so "varies by colour/size" and
// "resolution rule" stay consistent with each other without the user having
// to remember the relationship themselves. (Moved here from style.js when
// BOM authoring moved off the Style doctype onto this one.)
frappe.ui.form.on("Style BOM Line", {
	resolution_rule(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.resolution_rule === "Match garment colour" && !row.varies_by_colour) {
			frappe.model.set_value(cdt, cdn, "varies_by_colour", 1);
			frappe.show_alert({
				message: __("Ticked 'Varies by Colour' - this line auto-matches to the garment's colour."),
				indicator: "blue"
			});
		}
		if (row.resolution_rule === "Match garment size" && !row.varies_by_size) {
			frappe.model.set_value(cdt, cdn, "varies_by_size", 1);
			frappe.show_alert({
				message: __("Ticked 'Varies by Size' - this line auto-matches to the garment's size."),
				indicator: "blue"
			});
		}
		if (row.resolution_rule === "Explicit Override" && !row.varies_by_colour && !row.varies_by_size) {
			frappe.show_alert({
				message: __("Explicit Override only changes this line where a matching Style BOM Override row exists on the Overrides tab, or it behaves the same as Fixed."),
				indicator: "orange"
			});
		}
	},

	varies_by_colour(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.varies_by_colour && row.resolution_rule === "Match garment colour") {
			frappe.model.set_value(cdt, cdn, "resolution_rule", "Fixed");
			frappe.show_alert({
				message: __("Reset Resolution Rule to 'Fixed' since this line no longer varies by colour."),
				indicator: "blue"
			});
		}
		if (row.varies_by_colour && row.resolution_rule === "Fixed") {
			frappe.show_alert({
				message: __("This line is marked as varying by colour but Resolution Rule is still 'Fixed', so it will always use the same Item. Set Resolution Rule to 'Match garment colour', or add Style BOM Override rows for the exceptions."),
				indicator: "orange"
			});
		}
	},

	varies_by_size(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.varies_by_size && row.resolution_rule === "Match garment size") {
			frappe.model.set_value(cdt, cdn, "resolution_rule", "Fixed");
		}
		if (row.varies_by_size) {
			frappe.show_alert({
				message: __("Set a Planning Ratio on each Size (on the Style) for accurate weighted consumption, or add per-size rows in Overrides for exact values - otherwise this gate will block generation."),
				indicator: "blue"
			});
		}
	}
});
