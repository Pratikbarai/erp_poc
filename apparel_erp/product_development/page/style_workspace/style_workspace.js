// Style Workspace — a custom navy-themed Page that mirrors the style-screen-prototype.html
// look & feel, wired to the real Style / Design Tech Pack doctypes in this app.
//
// Route:  #style-workspace                -> picker (search a style)
//         #style-workspace/KT-SS26-001    -> that style's workspace

frappe.pages["style-workspace"].on_page_load = function (wrapper) {
	new StyleWorkspace(wrapper);
};

frappe.pages["style-workspace"].on_page_show = function (wrapper) {
	if (wrapper.style_workspace) wrapper.style_workspace.route_changed();
};

const SW_STAGES = [
	"Style Created",
	"Design & Tech Pack",
	"Sampling",
	"Fit Approval",
	"Proto Approval",
	"Production"
];

class StyleWorkspace {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Style Workspace",
			single_column: true
		});
		wrapper.style_workspace = this;
		inject_sw_css();
		this.active_tab = "info";
		this.render_shell();
		this.route_changed();
	}

	route_changed() {
		const parts = frappe.get_route(); // ["style-workspace", "KT-SS26-001"]
		const style_no = parts[1];
		if (style_no) {
			this.load_style(style_no);
		} else {
			this.show_picker();
		}
	}

	render_shell() {
		const $body = $(this.page.body);
		$body.empty();
		$body.append(`
			<div class="sw-app">
				<aside class="sw-side">
					<div class="sw-brand">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M12 2 8 6l4 3 4-3-4-4zM4 9l4-3 4 3v13H4V9zM20 9l-4-3-4 3v13h8V9z"/>
						</svg>
						Apparel ERP
					</div>
					<nav class="sw-nav" id="swNav"></nav>
				</aside>
				<div class="sw-main">
					<div class="sw-top">
						<div class="sw-crumb" id="swCrumb">Product development <span>/</span> Styles</div>
						<div class="sw-search-wrap">
							<input class="sw-search" id="swSearch" placeholder="Search a style no. or name…" autocomplete="off">
							<div class="sw-search-results" id="swSearchResults"></div>
						</div>
						<div class="sw-avatar">${frappe.avatar ? "" : (frappe.session.user_fullname || "U").split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase()}</div>
					</div>
					<div id="swContent"></div>
				</div>
			</div>
			<div class="sw-scrim" id="swScrim"></div>
			<div class="sw-drawer" id="swDrawer">
				<div class="sw-drawer-h"><h3 id="swDTitle"></h3><button class="sw-btn sw-btn-sm" id="swDClose" style="margin-left:auto">Close</button></div>
				<div class="sw-drawer-b" id="swDBody"></div>
			</div>
			<div class="sw-toast" id="swToast"></div>
		`);

		this.render_nav();
		this.bind_search();

		$body.find("#swScrim, #swDClose").on("click", () => this.close_drawer());
	}

	render_nav() {
		const items = [
			{ label: "Dashboard", route: null, disabled: true },
			{ label: "Product development", route: "style-workspace", on: true },
			{ label: "Styles", route: "List/Style" },
			{ label: "Samples", disabled: true },
			{ label: "Tech packs", route: "List/Design Tech Pack" },
			{ sep: true },
			{ label: "Time & action", disabled: true },
			{ label: "Purchasing", disabled: true },
			{ label: "Job work", disabled: true },
			{ label: "Inventory", route: "List/Item" },
			{ label: "Production", route: "List/BOM" },
			{ label: "Quality", disabled: true },
			{ sep: true },
			{ label: "Reports", disabled: true },
			{ label: "Settings", route: "workspaces" }
		];
		const html = items.map(it => {
			if (it.sep) return `<div class="sw-sep"></div>`;
			if (it.disabled) return `<a class="sw-disabled" title="No doctype wired up yet">${it.label} <span class="sw-soon">soon</span></a>`;
			return `<a href="#${it.route}" class="${it.on ? "on" : ""}">${it.label}</a>`;
		}).join("");
		this.wrapper.querySelector("#swNav").innerHTML = html;
	}

	bind_search() {
		const $input = $(this.wrapper).find("#swSearch");
		const $results = $(this.wrapper).find("#swSearchResults");
		let timer;
		$input.on("input", () => {
			clearTimeout(timer);
			const term = $input.val().trim();
			if (!term) { $results.hide().empty(); return; }
			timer = setTimeout(() => {
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Style",
						filters: [["style_no", "like", `%${term}%`]],
						or_filters: [["style_name", "like", `%${term}%`]],
						fields: ["name", "style_no", "style_name", "status"],
						limit: 8
					}
				}).then(r => {
					const rows = r.message || [];
					if (!rows.length) {
						$results.html(`<div class="sw-search-empty">No styles found</div>`).show();
						return;
					}
					$results.html(rows.map(s =>
						`<div class="sw-search-row" data-name="${frappe.utils.escape_html(s.name)}">
							<b>${frappe.utils.escape_html(s.style_no)}</b>
							<span>${frappe.utils.escape_html(s.style_name || "")}</span>
						</div>`
					).join("")).show();
					$results.find(".sw-search-row").on("click", function () {
						frappe.set_route("style-workspace", $(this).data("name"));
						$results.hide().empty();
						$input.val("");
					});
				});
			}, 250);
		});
		$(document).on("click.sw-search", (e) => {
			if (!$(e.target).closest(".sw-search-wrap").length) $results.hide();
		});
	}

	show_picker() {
		$(this.wrapper).find("#swCrumb").text("Product development / Styles");
		$(this.wrapper).find("#swContent").html(`
			<div class="sw-picker">
				<h2>Pick a style</h2>
				<p class="sw-muted">Search above, or choose one below.</p>
				<div id="swPickerList" class="sw-picker-list"></div>
			</div>
		`);
		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "Style", fields: ["name", "style_no", "style_name", "status", "development_stage"], limit_page_length: 20, order_by: "modified desc" }
		}).then(r => {
			const rows = r.message || [];
			const $list = $(this.wrapper).find("#swPickerList");
			if (!rows.length) {
				$list.html(`<div class="sw-empty">No styles yet. <a href="#Form/Style/new">Create one</a>.</div>`);
				return;
			}
			$list.html(rows.map(s => `
				<div class="sw-picker-row" data-name="${frappe.utils.escape_html(s.name)}">
					<div>
						<b>${frappe.utils.escape_html(s.style_no)}</b>
						<div class="sw-muted">${frappe.utils.escape_html(s.style_name || "")}</div>
					</div>
					<span class="sw-pill ${sw_status_pill(s.status)}">${s.status || "Not Started"}</span>
				</div>`).join(""));
			$list.find(".sw-picker-row").on("click", function () {
				frappe.set_route("style-workspace", $(this).data("name"));
			});
		});
	}

	load_style(style_no) {
		$(this.wrapper).find("#swContent").html(`<div class="sw-loading">Loading ${frappe.utils.escape_html(style_no)}…</div>`);
		frappe.call({ method: "frappe.client.get", args: { doctype: "Style", name: style_no } })
			.then(r => {
				if (!r.message) {
					$(this.wrapper).find("#swContent").html(`<div class="sw-empty">Style "${frappe.utils.escape_html(style_no)}" not found.</div>`);
					return;
				}
				this.style = r.message;
				$(this.wrapper).find("#swCrumb").html(
					`Product development <span>/</span> Styles <span>/</span> <b>${frappe.utils.escape_html(this.style.style_no)}</b>`
				);
				this.render_style();
			});
	}

	render_style() {
		const s = this.style;
		const $content = $(this.wrapper).find("#swContent");
		$content.html(`
			<div class="sw-head">
				<div class="sw-head-row">
					<div>
						<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
							<h1>${frappe.utils.escape_html(s.style_no)}</h1>
							<span class="sw-pill ${sw_status_pill(s.status)}"><span class="sw-dot"></span>${s.status || "Not Started"}</span>
							<span class="sw-pill sw-pill-mut">${s.development_stage || "Style Created"}</span>
						</div>
						<div class="sw-sub">${frappe.utils.escape_html(s.style_name || "")} ${s.customer_brand ? " · " + frappe.utils.escape_html(s.customer_brand) : ""} ${s.season ? " · " + frappe.utils.escape_html(s.season) : ""}</div>
					</div>
					<div class="sw-head-actions">
						<button class="sw-btn" id="swOpenForm">Open full form</button>
						<button class="sw-btn sw-btn-pri" id="swOpenTechpack">Design & tech pack</button>
					</div>
				</div>
				<div class="sw-tabs" id="swTabs">
					<button data-t="info" class="on">Style information</button>
					<button data-t="colours">Colours &amp; sizes<span class="sw-count">${(s.matrix_items || []).length}</span></button>
					<button data-t="bom">Style BOM<span class="sw-count">${(s.bom_items || []).length}</span></button>
					<button data-t="techpack">Tech pack</button>
					<button data-t="tna">Time &amp; action</button>
					<button data-t="jobwork">Job work</button>
				</div>
			</div>
			<div class="sw-body" id="swPanels"></div>
		`);

		$content.find("#swOpenForm").on("click", () => frappe.set_route("Form", "Style", s.name));
		$content.find("#swOpenTechpack").on("click", () => this.open_tech_pack());
		$content.find("#swTabs button").on("click", (e) => {
			$content.find("#swTabs button").removeClass("on");
			$(e.currentTarget).addClass("on");
			this.active_tab = $(e.currentTarget).data("t");
			this.render_panel();
		});

		this.render_panel();
	}

	render_panel() {
		const s = this.style;
		const $panels = $(this.wrapper).find("#swPanels");
		if (this.active_tab === "info") $panels.html(this.tpl_info(s));
		else if (this.active_tab === "colours") { $panels.html(this.tpl_colours(s)); this.bind_colours(); }
		else if (this.active_tab === "bom") { $panels.html(this.tpl_bom(s)); this.bind_bom(); }
		else if (this.active_tab === "techpack") this.render_techpack_tab($panels);
		else if (this.active_tab === "tna") $panels.html(this.tpl_preview_tab(
			"Time & action isn't wired to a doctype yet.",
			"This tab shows sample TNA data purely so the layout matches the prototype. Add a Time & Action doctype (activity, planned/revised/actual dates, variance, status) and this page can render live rows the same way the Colours & Sizes tab does."
		));
		else if (this.active_tab === "jobwork") $panels.html(this.tpl_preview_tab(
			"Job work isn't wired to a doctype yet.",
			"This tab is a styled placeholder. Add a Job Work / Subcontracting doctype and this page can show real cut plans, dispatch, and receipts here."
		));
	}

	// ---------- Style information ----------
	tpl_info(s) {
		return `
			<div class="sw-grid2">
				<div class="sw-card">
					<div class="sw-card-h"><h2>Style information</h2></div>
					<div class="sw-card-b">
						<div class="sw-grid2" style="gap:14px">
							<div>
								${sw_attr("Style no", s.style_no)}
								${sw_attr("Style name", s.style_name)}
								${s.base_style ? sw_attr_link("Base style", s.base_style, () => frappe.set_route("style-workspace", s.base_style)) : ""}
								${sw_attr("Product type", s.product_type)}
								${sw_attr("Category", s.category)}
								${sw_attr("Season", s.season)}
							</div>
							<div>
								${sw_attr("Customer / brand", s.customer_brand)}
								${sw_attr("Designer", s.designer)}
								${sw_attr("Merchandiser", s.merchandiser)}
								${sw_attr("Country of origin", s.country_of_origin)}
								${sw_attr("Launch date", frappe.datetime.str_to_user(s.launch_date))}
							</div>
						</div>
						${s.description ? `<p style="margin-top:10px;color:var(--sw-ink-2);font-size:13.5px">${frappe.utils.escape_html(s.description)}</p>` : ""}
					</div>
				</div>
				<div>
					<div class="sw-card">
						<div class="sw-card-h"><h2>Style attributes</h2></div>
						<div class="sw-card-b">
							${sw_attr("Fit", s.fit)}
							${sw_attr("Sleeve", s.sleeve)}
							${sw_attr("Placket", s.placket)}
							${sw_attr("Collar", s.collar)}
							${sw_attr("Gender", s.gender)}
							${sw_attr("Fabric type", s.fabric_type)}
						</div>
					</div>
					<div class="sw-card">
						<div class="sw-card-h"><h2>Linked records</h2></div>
						<div class="sw-card-b">
							${sw_attr_link("Item template", s.style_no, () => frappe.set_route("Form", "Item", s.style_no))}
							${sw_attr_link("Variants", `${(s.matrix_items || []).filter(m => m.item).length} generated of ${(s.matrix_items || []).length}`, () => this.switch_tab("colours"))}
							${sw_attr_link("BOM items", `${(s.bom_items || []).length} base rows`, () => this.switch_tab("bom"))}
						</div>
					</div>
				</div>
			</div>
			<div class="sw-card">
				<div class="sw-card-h"><h2>Development workflow</h2><div class="sw-right"><span class="sw-pill sw-pill-mut">Stage ${SW_STAGES.indexOf(s.development_stage || "Style Created") + 1} of ${SW_STAGES.length}</span></div></div>
				<div class="sw-card-b"><div class="sw-flow" id="swFlow">${this.tpl_flow(s)}</div></div>
			</div>
		`;
	}

	tpl_flow(s) {
		const current = s.development_stage || "Style Created";
		const idx = SW_STAGES.indexOf(current);
		return SW_STAGES.map((stage, i) => {
			const state = i < idx ? "done" : i === idx ? "now" : "wait";
			const col = { done: "#15803D", now: "#2563EB", wait: "#CBD5E1" }[state];
			return `${i ? '<div class="sw-arrow">&rarr;</div>' : ""}
				<div class="sw-step">
					<div class="sw-bub" data-stage="${stage}" style="background:${col}">${state === "done" ? "\u2713" : i + 1}</div>
					<div class="sw-nm" ${state === "now" ? 'style="color:#2563EB"' : ""}>${stage}</div>
					<small>${state === "done" ? "Done" : state === "now" ? "In progress" : "Pending"}</small>
				</div>`;
		}).join("");
	}

	switch_tab(t) {
		this.active_tab = t;
		$(this.wrapper).find(`#swTabs button[data-t="${t}"]`).trigger("click");
	}

	// ---------- Colours & sizes ----------
	tpl_colours(s) {
		const colours = (s.colours || []).filter(c => (c.status || "Active") === "Active");
		const sizes = s.sizes || [];
		let matrix = `<div class="sw-empty">Add colours and sizes on the full form, then come back here.</div>`;
		if (colours.length && sizes.length) {
			matrix = `<table class="sw-matrix"><thead><tr><th>Colour</th>${sizes.map(sz => `<th>${frappe.utils.escape_html(sz.size_code || sz.size)}</th>`).join("")}</tr></thead><tbody>`;
			colours.forEach(c => {
				const ccode = c.colour_code || c.colour_name;
				matrix += `<tr><td class="sw-rowh">${c.swatch ? `<span class="sw-swatch" style="background:${c.swatch}"></span> ` : ""}${frappe.utils.escape_html(c.colour_name)}</td>`;
				sizes.forEach(sz => {
						const scode = sz.size_code || ((s.matrix_items || []).find(m => m.size === sz.size)?.size_code) || sz.size;
					const row = (s.matrix_items || []).find(m => m.colour_code === ccode && m.size_code === scode);
					if (row && (row.item || row.sku || row.bom)) {
							matrix += `<td><a href="#" class="sw-sku ${row.item ? "" : "sw-sku-unlinked"}" data-item="${frappe.utils.escape_html(row.item || "")}">${frappe.utils.escape_html(row.sku || row.item || row.bom)}</a><button class="sw-status sw-matrix-status" data-row="${frappe.utils.escape_html(row.name)}">${frappe.utils.escape_html(row.status || "Active")}</button></td>`;
					} else if (row) {
							matrix += `<td><button class="sw-sku sw-sku-gen" data-colour="${frappe.utils.escape_html(ccode)}" data-size="${frappe.utils.escape_html(scode)}">+ Generate</button><span class="sw-status">${frappe.utils.escape_html(row.status || "Not Generated")}</span></td>`;
					} else {
						matrix += `<td class="sw-empty">—</td>`;
					}
				});
				matrix += `</tr>`;
			});
			matrix += `</tbody></table>`;
		}

		return `
			<div class="sw-grid3" style="grid-template-columns:240px 240px 1fr">
				<div class="sw-card">
					<div class="sw-card-h"><h2>Colours</h2><div class="sw-right"><button class="sw-btn sw-btn-sm" id="swAddColour">+ Add</button></div></div>
					<div class="sw-card-b">
						${colours.length ? colours.map((c, i) => `
							<div class="sw-chip-row">
								${c.swatch ? `<span class="sw-swatch" style="background:${c.swatch}"></span>` : ""}
								<span>${frappe.utils.escape_html(c.colour_name)}</span>
								<span class="sw-muted" style="margin-left:auto">${frappe.utils.escape_html(c.colour_code || "")}</span>
								<span class="sw-x" data-idx="${i}" title="Remove">&times;</span>
							</div>`).join("") : `<div class="sw-empty">No colours yet.</div>`}
					</div>
				</div>
				<div class="sw-card">
					<div class="sw-card-h"><h2>Sizes</h2><div class="sw-right"><button class="sw-btn sw-btn-sm" id="swAddSize">+ Add</button></div></div>
					<div class="sw-card-b">
						${sizes.length ? sizes.map((sz, i) => `
							<div class="sw-chip-row"><span>${frappe.utils.escape_html(sz.size_code || sz.size)}</span><span class="sw-x" data-idx="${i}" title="Remove" style="margin-left:auto">&times;</span></div>`).join("") : `<div class="sw-empty">No sizes yet.</div>`}
					</div>
				</div>
				<div class="sw-card">
					<div class="sw-card-h">
						<h2>Colour × size matrix</h2>
						<div class="sw-right">
							<button class="sw-btn sw-btn-pri sw-btn-sm" id="swGenAll">Generate all SKUs</button>
						</div>
					</div>
					<div class="sw-card-b">
						${matrix}
						<div class="sw-note" style="margin-top:12px">SKU codes come from the style, colour and size codes. Generating creates a real Item + BOM in the background — this calls the same server method as the full form.</div>
					</div>
				</div>
			</div>
		`;
	}

	bind_colours() {
		const $panels = $(this.wrapper).find("#swPanels");
		$panels.find(".sw-sku[data-item]").on("click", (e) => {
			e.preventDefault();
			frappe.set_route("Form", "Item", $(e.currentTarget).data("item"));
		});
		$panels.find(".sw-sku-gen").on("click", (e) => {
			const colour_code = $(e.currentTarget).data("colour");
			const size_code = $(e.currentTarget).data("size");
			this.generate_sku(colour_code, size_code);
		});
		$panels.find(".sw-matrix-status").on("click", (e) => {
			const matrix_item = $(e.currentTarget).data("row");
			const current_status = $(e.currentTarget).text();
			const dialog = new frappe.ui.Dialog({
				title: __("Set Matrix Item Status"),
				fields: [{ fieldname: "status", fieldtype: "Select", label: __("Status"), options: "Active\nDrop\nOn Hold", default: current_status }],
				primary_action_label: __("Save"),
				primary_action: (values) => {
					frappe.call({
						method: "apparel_erp.product_development.doctype.style.style.set_matrix_item_status",
						args: { style: this.style.name, matrix_item, status: values.status },
						callback: () => {
							dialog.hide();
							this.load_style(this.style.name);
						}
					});
				}
			});
			dialog.show();
		});
		$panels.find("#swGenAll").on("click", () => {
			const pending = (this.style.matrix_items || []).filter(m => m.status !== "Active" || !m.item);
			if (!pending.length) { sw_toast(this.wrapper, "All SKUs are already generated."); return; }
			frappe.confirm(`Generate ${pending.length} pending SKUs and BOMs?`, () => {
				this.generate_sku(pending[0].colour_code, pending[0].size_code, true);
			});
		});

		$panels.find("#swAddColour").on("click", () => this.add_colour());
		$panels.find("#swAddSize").on("click", () => this.add_size());

		$panels.find(".sw-card:first .sw-x").on("click", (e) => {
			const idx = $(e.currentTarget).data("idx");
			const colours = (this.style.colours || []).filter(c => (c.status || "Active") === "Active");
			const row = colours[idx];
			frappe.confirm(`Remove colour "${row.colour_name}"? Any SKUs already generated for it are left untouched.`, () => {
				this.style.colours = this.style.colours.filter(c => c !== row);
				this.save_and_refresh("colours");
			});
		});
		$panels.find(".sw-card:eq(1) .sw-x").on("click", (e) => {
			const idx = $(e.currentTarget).data("idx");
			const row = (this.style.sizes || [])[idx];
			frappe.confirm(`Remove size "${row.size_code || row.size}"? Any SKUs already generated for it are left untouched.`, () => {
				this.style.sizes = this.style.sizes.filter(s => s !== row);
				this.save_and_refresh("colours");
			});
		});
	}

	add_colour() {
		frappe.prompt(
			[
				{ fieldname: "colour_name", label: "Colour Name", fieldtype: "Data", reqd: 1 },
				{ fieldname: "colour_code", label: "Colour Code", fieldtype: "Data", reqd: 1 },
				{ fieldname: "swatch", label: "Swatch", fieldtype: "Color" }
			],
			(values) => {
				this.style.colours = this.style.colours || [];
				this.style.colours.push({ colour_name: values.colour_name, colour_code: values.colour_code, swatch: values.swatch, status: "Active" });
				this.save_and_refresh("colours");
			},
			"Add colour",
			"Add"
		);
	}

	add_size() {
		frappe.prompt(
			[{ fieldname: "size", label: "Size", fieldtype: "Link", options: "Size", reqd: 1 }],
			(values) => {
				frappe.db.get_value("Size", values.size, "size_code").then(r => {
					this.style.sizes = this.style.sizes || [];
					if (this.style.sizes.some(s => s.size === values.size)) {
						frappe.show_alert({ message: "That size is already on this style.", indicator: "orange" });
						return;
					}
					this.style.sizes.push({ size: values.size, size_code: (r.message && r.message.size_code) || values.size, sequence: this.style.sizes.length });
					this.save_and_refresh("colours");
				});
			},
			"Add size",
			"Add"
		);
	}

	// Saves the in-memory this.style (with local edits already applied) back to
	// the server, reloads it fresh, and switches to the given tab.
	save_and_refresh(tab) {
		frappe.dom.freeze("Saving…");
		frappe.call({
			method: "frappe.client.save",
			args: { doc: this.style },
			callback: (r) => {
				frappe.dom.unfreeze();
				sw_toast(this.wrapper, "Saved.");
				this.load_style(this.style.name);
				if (tab) setTimeout(() => this.switch_tab(tab), 50);
			},
			error: () => frappe.dom.unfreeze()
		});
	}

	generate_sku(colour_code, size_code, is_bulk) {
		frappe.dom.freeze(is_bulk ? "Generating all pending SKUs…" : "Generating SKU & BOM…");
		frappe.call({
			method: "apparel_erp.product_development.doctype.style.style.generate_sku",
			args: { style: this.style.name, colour_code, size_code, generate_all: is_bulk ? 1 : 0 },
			callback: (r) => {
				frappe.dom.unfreeze();
				if (r.message && r.message.item) {
					sw_toast(this.wrapper, `Generated ${r.message.generated_count || 1} SKU(s), each with ${r.message.material_count || 0} BOM material(s).`);
					this.load_style(this.style.name);
					setTimeout(() => this.switch_tab("colours"), 50);
				}
			},
			error: () => frappe.dom.unfreeze()
		});
	}

	// ---------- Style BOM ----------
	tpl_bom(s) {
		const rows = s.bom_items || [];
		let tbl = `<table><thead><tr><th style="width:34px">#</th><th>Type</th><th>Item</th><th style="width:70px">UOM</th><th class="sw-num" style="width:80px">Base qty</th><th style="width:80px">Tolerance</th><th style="width:36px"></th></tr></thead><tbody>`;
		rows.forEach((r, i) => {
			const item_label = r.raw_material
				? `${r.item_name || "Item"} (${r.raw_material})`
				: r.item_name || "";
			tbl += `<tr><td>${i + 1}</td><td>${frappe.utils.escape_html(r.item_type || "")}</td><td>${frappe.utils.escape_html(item_label)}</td><td>${frappe.utils.escape_html(r.uom || "")}</td><td class="sw-num">${r.base_qty != null ? r.base_qty : ""}</td><td>${frappe.utils.escape_html(r.tolerance || "")}</td><td><span class="sw-x sw-bom-x" data-idx="${i}" title="Remove">&times;</span></td></tr>`;
		});
		tbl += `</tbody></table>`;
		if (!rows.length) tbl = `<div class="sw-empty">No BOM items on this style yet.</div>`;

		return `
			<div class="sw-grid2" style="grid-template-columns:1.5fr 1fr">
				<div class="sw-card">
					<div class="sw-card-h"><h2>Style BOM — base</h2><div class="sw-right"><button class="sw-pill sw-pill-mut sw-version-button" id="swBomVersion" title="View BOM version history">v${frappe.utils.escape_html(s.bom_version || "1.0")}</button><button class="sw-btn sw-btn-sm" id="swAddBom">+ Add item</button></div></div>
					${tbl}
					<div class="sw-card-b"><div class="sw-note">Quantities are base quantities for this style. Per-size consumption factors aren't modelled in this schema yet — the prototype's factor table is illustrative only.</div></div>
				</div>
				<div class="sw-card">
					<div class="sw-card-h"><h2>Sizes on this style</h2></div>
					<table>
						<thead><tr><th>Size</th><th class="sw-num">Sequence</th></tr></thead>
						<tbody>${(s.sizes || []).map(sz => `<tr><td>${frappe.utils.escape_html(sz.size_code || sz.size)}</td><td class="sw-num">${sz.sequence != null ? sz.sequence : ""}</td></tr>`).join("") || `<tr><td colspan="2" class="sw-empty">No sizes</td></tr>`}</tbody>
					</table>
				</div>
			</div>
		`;
	}

	bind_bom() {
		const $panels = $(this.wrapper).find("#swPanels");
		$panels.find("#swBomVersion").on("click", () => this.show_version_history(
			"BOM Version History",
			"apparel_erp.product_development.doctype.style.style.get_bom_version_history",
			{ style: this.style.name }
		));
		$panels.find("#swAddBom").on("click", () => this.add_bom_item());
		$panels.find(".sw-bom-x").on("click", (e) => {
			const idx = $(e.currentTarget).data("idx");
			const row = (this.style.bom_items || [])[idx];
			frappe.confirm(`Remove "${row.item_name}" from the BOM?`, () => {
				this.style.bom_items = this.style.bom_items.filter(r => r !== row);
				this.save_and_refresh("bom");
			});
		});
	}

	add_bom_item() {
		let selected_item_code = null;
		const dialog = new frappe.ui.Dialog({
			title: "Add BOM item",
			fields: [
				{ fieldname: "item_type", label: "Item Type", fieldtype: "Select", options: "Fabric\nTrim\nPackaging", reqd: 1 },
				{ fieldname: "item_name", label: "Item Name / Description", fieldtype: "Link", options: "Item", reqd: 1, description: "Select an existing Item, or type a new name to create it." },
				{ fieldname: "uom", label: "UOM", fieldtype: "Link", options: "UOM", reqd: 1 },
				{ fieldname: "base_qty", label: "Base Qty", fieldtype: "Float", reqd: 1 },
				{ fieldname: "tolerance", label: "Tolerance", fieldtype: "Data" },
				{ fieldname: "composition", label: "Composition", fieldtype: "Data" },
				{ fieldname: "gsm", label: "GSM", fieldtype: "Data" }
			],
			primary_action_label: "Add",
			primary_action: (values) => {
				const add_row = (item_data, item_code) => {
					this.style.bom_items = this.style.bom_items || [];
					this.style.bom_items.push({
						...values,
						raw_material: item_code || "",
						item_name: item_data.item_name || values.item_name,
						uom: values.uom || item_data.stock_uom
					});
					dialog.hide();
					this.save_and_refresh("bom");
				};

				const existing_item = selected_item_code || values.item_name;
				frappe.db.get_value("Item", existing_item, ["name", "item_name", "stock_uom", "description", "item_group"]).then(r => {
					if (r.message && r.message.name) {
						add_row(r.message, r.message.name);
						return;
					}
					frappe.confirm(`Create Item "${values.item_name}"?`, () => {
						frappe.call({
							method: "apparel_erp.product_development.doctype.style.style.create_bom_item",
							args: { item_name: values.item_name, item_type: values.item_type, uom: values.uom },
							callback: (response) => add_row(response.message, response.message.name)
						});
					});
				});
			}
		});

		dialog.fields_dict.item_name.$input.on("change", () => {
			const item_code = dialog.get_value("item_name");
			selected_item_code = null;
			if (!item_code) return;
			frappe.db.get_value("Item", item_code, ["item_name", "stock_uom", "description", "item_group"]).then(r => {
				if (!r.message) return;
				selected_item_code = item_code;
				dialog.set_value("item_name", r.message.item_name || item_code);
				dialog.set_value("uom", r.message.stock_uom || "");
				dialog.set_value("description", r.message.description || "");
				dialog.set_value("item_type", this.get_bom_item_type(r.message.item_group));
			});
		});
		dialog.show();
	}

	get_bom_item_type(item_group) {
		const group = (item_group || "").toLowerCase();
		if (group.includes("fabric")) return "Fabric";
		if (group.includes("pack")) return "Packaging";
		return "Trim";
	}

	// ---------- Tech pack ----------
	open_tech_pack() {
		frappe.db.get_value("Design Tech Pack", { style: this.style.name }, "name").then(r => {
			if (r.message && r.message.name) {
				frappe.set_route("Form", "Design Tech Pack", r.message.name);
			} else {
				frappe.new_doc("Design Tech Pack", { style: this.style.name });
			}
		});
	}

	render_techpack_tab($panels) {
		$panels.html(`<div class="sw-loading">Loading tech pack…</div>`);
		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "Design Tech Pack", filters: { style: this.style.name }, fields: ["name"], limit: 1 }
		}).then(r => {
			if (!r.message || !r.message.length) {
				$panels.html(`
					<div class="sw-card"><div class="sw-card-b">
						<div class="sw-empty">No Design Tech Pack linked to this style yet.</div>
						<button class="sw-btn sw-btn-pri" style="margin-top:10px" id="swCreateTP">Create Design Tech Pack</button>
					</div></div>
				`);
				$panels.find("#swCreateTP").on("click", () => this.open_tech_pack());
				return;
			}
			Promise.all([
				frappe.call({ method: "frappe.client.get", args: { doctype: "Design Tech Pack", name: r.message[0].name } }),
				frappe.call({
					method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.get_style_snapshot",
					args: { style: this.style.name }
				})
			]).then(([techPack, snapshot]) => this.tpl_techpack($panels, techPack.message, snapshot.message));
		});
	}

	tpl_techpack($panels, tp, styleSnapshot) {
		const sizes = [...new Set((tp.measurements || []).map(m => m.size))];
		const points = [...new Set((tp.measurements || []).map(m => m.measurement_point))];
		let pom = `<div class="sw-empty">No measurement points yet.</div>`;
		if (points.length) {
			pom = `<table><thead><tr><th>POM</th>${sizes.map(sz => `<th class="sw-num">${frappe.utils.escape_html(sz)}</th>`).join("")}</tr></thead><tbody>`;
			points.forEach(p => {
				pom += `<tr><td>${frappe.utils.escape_html(p)}</td>`;
				sizes.forEach(sz => {
					const m = (tp.measurements || []).find(x => x.measurement_point === p && x.size === sz);
					pom += `<td class="sw-num">${m ? m.value : ""}</td>`;
				});
				pom += `</tr>`;
			});
			pom += `</tbody></table>`;
		}

		// Fabric / trims specification is drawn from the real Style BOM rows —
		// there's no separate table for it on Design Tech Pack.
		const bomRows = (styleSnapshot && styleSnapshot.bom_items) || this.style.bom_items || [];
		const fabricRows = bomRows.filter(r => r.item_type === "Fabric");
		const trimRows = bomRows.filter(r => r.item_type === "Trim" || r.item_type === "Packaging");

		const fabricTbl = fabricRows.length
			? `<table><thead><tr><th>Item</th><th>Composition</th><th class="sw-num">GSM</th></tr></thead><tbody>
				${fabricRows.map(r => `<tr><td>${frappe.utils.escape_html(r.item_name || "")}</td><td>${frappe.utils.escape_html(r.composition || "")}</td><td class="sw-num">${frappe.utils.escape_html(r.gsm || "")}</td></tr>`).join("")}
			</tbody></table>`
			: `<div class="sw-empty">No Fabric rows on the Style BOM.</div>`;

		const trimTbl = trimRows.length
			? `<table><thead><tr><th>Trim</th><th>UOM</th><th class="sw-num">Base qty</th></tr></thead><tbody>
				${trimRows.map(r => `<tr><td>${frappe.utils.escape_html(r.item_name || "")}</td><td>${frappe.utils.escape_html(r.uom || "")}</td><td class="sw-num">${r.base_qty != null ? r.base_qty : ""}</td></tr>`).join("")}
			</tbody></table>`
			: `<div class="sw-empty">No Trim/Packaging rows on the Style BOM.</div>`;

		const refImages = tp.reference_images || [];
		const attachments = tp.attachments || [];
		const callouts = tp.callouts || [];
		const frontCallouts = callouts.filter(c => (c.sketch || "Front") === "Front");
		const backCallouts = callouts.filter(c => c.sketch === "Back");

		$panels.html(`
			<div class="sw-card">
				<div class="sw-card-h">
					<h2>Tech pack</h2>
					<div class="sw-right">
						<button class="sw-pill sw-pill-mut sw-version-button" id="swTechPackVersion" title="View Tech Pack version history">${frappe.utils.escape_html(tp.tech_pack_version || "v1")}</button>
						<button class="sw-btn sw-btn-sm" id="swDownloadPdf">Download PDF</button>
						<button class="sw-btn sw-btn-sm" id="swOpenTPForm">Open full tech pack</button>
					</div>
				</div>
				<div class="sw-card-b">
					<div class="sw-banner sw-banner-ok"><span>Status: ${frappe.utils.escape_html(tp.status || "Not Started")}${tp.last_updated_on ? " · last updated " + frappe.datetime.str_to_user(tp.last_updated_on) : ""}</span></div>
				</div>
			</div>
			<div class="sw-grid2" style="grid-template-columns:1.1fr 1fr">
				<div class="sw-card">
					<div class="sw-card-h"><h2>Front sketch &amp; callouts</h2><div class="sw-right"><button class="sw-btn sw-btn-sm" id="swAddCalloutFront">+ Add callout</button></div></div>
					<div class="sw-card-b">
						${tp.front_sketch
								? `<div class="sw-flat-wrap" id="swFrontWrap"><img src="${tp.front_sketch}" draggable="false">${frontCallouts.map(c => `<button class="sw-pin" style="left:${c.x}%;top:${c.y}%" data-n="${c.sequence}">${c.sequence}</button>`).join("")}</div>`
							: `<div class="sw-empty">No front sketch uploaded — upload one on the full tech pack form first.</div>`}
							${tp.back_sketch ? `<div class="sw-sketch-block"><div class="sw-sketch-label">Back sketch <button class="sw-btn sw-btn-sm" id="swAddCalloutBack">+ Add callout</button></div><div class="sw-flat-wrap" id="swBackWrap"><img src="${tp.back_sketch}" draggable="false">${backCallouts.map(c => `<button class="sw-pin" style="left:${c.x}%;top:${c.y}%" data-n="${c.sequence}">${c.sequence}</button>`).join("")}</div></div>` : ""}
					</div>
				</div>
				<div class="sw-card">
					<div class="sw-card-h"><h2>Construction callouts</h2></div>
					<div class="sw-card-b" id="swCalloutList" style="padding:8px">
						${callouts.length ? callouts.map(c => `
							<div class="sw-callout-row" data-n="${c.sequence}">
								<span class="sw-n">${c.sequence}</span><span>${frappe.utils.escape_html(c.text)}</span>
								<button class="sw-btn sw-btn-sm sw-edit-callout" data-name="${frappe.utils.escape_html(c.name || "")}">Edit</button>
								<button class="sw-btn sw-btn-sm sw-delete-callout" data-name="${frappe.utils.escape_html(c.name || "")}" title="Delete callout">Delete</button>
							</div>`).join("") : `<div class="sw-empty" style="padding:8px">No callouts yet — add one from the sketch.</div>`}
					</div>
				</div>
			</div>
			<div class="sw-card">
				<div class="sw-card-h"><h2>Construction details</h2></div>
				<div class="sw-card-b">
					${sw_attr("Seam type", tp.seam_type)}
					${sw_attr("Stitch per inch", tp.stitch_per_inch)}
					${sw_attr("Seam allowance", tp.seam_allowance)}
					${sw_attr("Overlock", tp.overlock)}
					${sw_attr("Top stitch", tp.top_stitch)}
				</div>
			</div>
			<div class="sw-card">
				<div class="sw-card-h"><h2>Measurements — points of measure</h2><div class="sw-right"><button class="sw-btn sw-btn-sm" id="swUploadMeasurements">Upload Excel/CSV</button><button class="sw-btn sw-btn-sm" id="swOpenTPMeasurements">Manual entry</button></div></div>
				${pom}
			</div>
			<div class="sw-grid2">
				<div class="sw-card">
					<div class="sw-card-h"><h2>Fabric specification</h2></div>
					${fabricTbl}
				</div>
				<div class="sw-card">
					<div class="sw-card-h"><h2>Trims &amp; accessories</h2></div>
					${trimTbl}
				</div>
			</div>
			<div class="sw-grid2">
				<div class="sw-card">
					<div class="sw-card-h"><h2>Reference images</h2><div class="sw-right"><button class="sw-btn sw-btn-sm" id="swAddReferenceImage">+ Add image</button></div></div>
					<div class="sw-card-b" style="display:flex;gap:8px;flex-wrap:wrap">
						${refImages.length ? refImages.map(ri => `<img src="${ri.image}" title="${frappe.utils.escape_html(ri.label || "")}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--sw-line)">`).join("") : `<div class="sw-empty">No reference images.</div>`}
					</div>
				</div>
				<div class="sw-card">
					<div class="sw-card-h"><h2>Attachments</h2></div>
					<div class="sw-card-b">
						${attachments.length ? attachments.map(a => `<div class="sw-attr"><span><a href="${a.file}" target="_blank">${frappe.utils.escape_html(a.file_name || a.file)}</a></span><span class="sw-muted">${frappe.utils.escape_html(a.remark || "")}</span></div>`).join("") : `<div class="sw-empty">No attachments.</div>`}
					</div>
				</div>
			</div>
		`);
		this.tp = tp;
		$panels.find("#swOpenTPForm").on("click", () => frappe.set_route("Form", "Design Tech Pack", tp.name));
		$panels.find("#swOpenTPMeasurements").on("click", () => frappe.set_route("Form", "Design Tech Pack", tp.name));
		$panels.find("#swUploadMeasurements").on("click", () => this.upload_measurements());
		$panels.find("#swTechPackVersion").on("click", () => this.show_version_history(
			"Tech Pack Version History",
			"apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.get_version_history",
			{ name: tp.name }
		));
		$panels.find("#swDownloadPdf").on("click", () => {
			const url = `/printview?doctype=${encodeURIComponent("Design Tech Pack")}&name=${encodeURIComponent(tp.name)}&format=${encodeURIComponent("Tech Pack Sheet")}&no_letterhead=0`;
			window.open(url, "_blank");
		});
		$panels.find("#swAddReferenceImage").on("click", () => this.add_reference_image());

		[
			{ wrapper: "#swFrontWrap", button: "#swAddCalloutFront", sketch: "Front" },
			{ wrapper: "#swBackWrap", button: "#swAddCalloutBack", sketch: "Back" }
		].forEach(({ wrapper, button, sketch }) => {
			const $wrap = $panels.find(wrapper);
			$panels.find(button).on("click", (e) => {
				if (!$wrap.length) {
					frappe.show_alert({ message: `Upload a ${sketch.toLowerCase()} sketch before adding a callout.`, indicator: "orange" });
					return;
				}
				const adding = $wrap.toggleClass("adding").hasClass("adding");
				$(e.currentTarget).text(adding ? "Click the sketch…" : "+ Add callout");
			});
			$wrap.on("click", (e) => {
				if (!$wrap.hasClass("adding") || $(e.target).hasClass("sw-pin")) return;
				const rect = $wrap[0].getBoundingClientRect();
				const x = ((e.clientX - rect.left) / rect.width) * 100;
				const y = ((e.clientY - rect.top) / rect.height) * 100;
				frappe.prompt(
					[{ fieldname: "text", label: "Construction note", fieldtype: "Data", reqd: 1 }],
					(values) => {
						this.tp.callouts = this.tp.callouts || [];
						const next_n = this.tp.callouts.reduce((max, row) => Math.max(max, row.sequence || 0), 0) + 1;
						this.tp.callouts.push({ sequence: next_n, text: values.text, sketch, x: x.toFixed(2), y: y.toFixed(2) });
						this.save_techpack_and_refresh();
					},
					"Add callout",
					"Add"
				);
				$wrap.removeClass("adding");
				$panels.find(button).text("+ Add callout");
			});
		});
		const select_callout = (n) => {
			$panels.find(".sw-pin").toggleClass("on", false);
			$panels.find(`.sw-pin[data-n="${n}"]`).addClass("on");
			$panels.find(".sw-callout-row").toggleClass("on", false);
			$panels.find(`.sw-callout-row[data-n="${n}"]`).addClass("on");
		};
		$panels.find(".sw-pin").on("click", (e) => select_callout($(e.currentTarget).data("n")));
		$panels.find(".sw-callout-row").on("click", (e) => select_callout($(e.currentTarget).data("n")));
		$panels.find(".sw-edit-callout").on("click", (e) => {
			e.stopPropagation();
			const name = $(e.currentTarget).data("name");
			const callout = this.tp.callouts.find(row => row.name === name);
			if (callout) this.edit_callout(callout);
		});
		$panels.find(".sw-delete-callout").on("click", (e) => {
			e.stopPropagation();
			const name = $(e.currentTarget).data("name");
			const callout = this.tp.callouts.find(row => row.name === name);
			if (!callout) return;
			frappe.confirm("Delete this callout?", () => {
				this.tp.callouts = this.tp.callouts.filter(row => row !== callout);
				this.save_techpack_and_refresh();
			});
		});
	}

	edit_callout(callout) {
		frappe.prompt(
			[
				{ fieldname: "text", label: "Construction note", fieldtype: "Data", reqd: 1, default: callout.text },
				{ fieldname: "sketch", label: "Sketch", fieldtype: "Select", options: "Front\nBack", default: callout.sketch || "Front" },
				{ fieldname: "x", label: "X (% from left)", fieldtype: "Float", default: callout.x },
				{ fieldname: "y", label: "Y (% from top)", fieldtype: "Float", default: callout.y }
			],
			(values) => {
				Object.assign(callout, values);
				this.save_techpack_and_refresh();
			},
			"Edit callout",
			"Save"
		);
	}

	add_reference_image() {
		frappe.prompt(
			[{ fieldname: "label", label: "Image label", fieldtype: "Data", reqd: 1 }],
			(values) => {
				new frappe.ui.FileUploader({
					doctype: "Design Tech Pack",
					docname: this.tp.name,
					on_success: (file) => {
						this.tp.reference_images = this.tp.reference_images || [];
						this.tp.reference_images.push({ label: values.label, image: file.file_url });
						this.save_techpack_and_refresh();
					}
				});
			},
			"Add reference image",
			"Upload"
		);
	}

	upload_measurements() {
		new frappe.ui.FileUploader({
			doctype: "Design Tech Pack",
			docname: this.tp.name,
			allow_multiple: false,
			on_success: (file) => {
				frappe.call({
					method: "apparel_erp.product_development.doctype.design_tech_pack.design_tech_pack.parse_measurements_sheet",
					args: { name: this.tp.name, file_url: file.file_url },
					freeze: true,
					freeze_message: "Reading measurement sheet..."
				}).then((parsed) => {
					if (!parsed.message) return;
					this.tp.measurements = parsed.message;
					frappe.call({
						method: "frappe.client.save",
						args: { doc: this.tp },
						freeze: true,
						freeze_message: "Saving measurements..."
					}).then((saved) => {
						this.tp = saved.message;
						const $panels = $(this.wrapper).find("#swPanels");
						this.tpl_techpack($panels, this.tp, this.style);
						frappe.show_alert({
							message: `Imported ${parsed.message.length} measurement row(s).`,
							indicator: "green"
						});
					});
				});
			}
		});
	}

	show_version_history(title, method, args) {
		frappe.call({ method, args }).then(r => {
			const history = r.message || [];
			const format_value = (value) => {
				if (value === null || value === undefined || value === "") return "Empty";
				if (typeof value === "object") return Object.entries(value)
					.map(([key, item]) => `${key.replaceAll("_", " ")}: ${format_value(item)}`)
					.join(", ");
				return String(value);
			};
			const format_change = (change) => {
				const field = (change.field || "Field").replaceAll("_", " ");
				if (change.detail) {
					const action = change.detail[0] || "Updated";
					const details = change.detail.slice(1).map(format_value).join("; ");
					return `<div class="sw-history-change"><span class="sw-history-action">${frappe.utils.escape_html(action)}</span><span>${frappe.utils.escape_html(field)}</span>${details ? `<span class="sw-history-detail">${frappe.utils.escape_html(details)}</span>` : ""}</div>`;
				}
				return `<div class="sw-history-change"><span>${frappe.utils.escape_html(field)}</span><span class="sw-history-old">${frappe.utils.escape_html(format_value(change.old))}</span><span class="sw-history-arrow">&rarr;</span><span class="sw-history-new">${frappe.utils.escape_html(format_value(change.new))}</span></div>`;
			};
			const body = history.length ? `<div class="sw-history-list">${history.map(entry => `
				<div class="sw-history-entry">
					<div class="sw-history-entry-head"><strong>${frappe.utils.escape_html(entry.version || "Revision")}</strong><span>${frappe.utils.escape_html(frappe.datetime.str_to_user(entry.creation))}</span><span>by ${frappe.utils.escape_html(entry.owner || "Unknown user")}</span></div>
					<div>${(entry.changes || []).map(format_change).join("")}</div>
				</div>`).join("")}</div>` : `<div class="sw-empty">No tracked previous versions yet.</div>`;
			const styled_body = `${body}<style>
				.sw-history-entry{border:1px solid var(--sw-line);border-radius:6px;padding:12px 14px;margin-bottom:10px;background:var(--card-bg,#fff)}
				.sw-history-entry-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}.sw-history-entry-head span{color:var(--text-muted);font-size:12px}
				.sw-history-change{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--sw-line);text-transform:capitalize}.sw-history-action{font-size:11px;font-weight:600;color:var(--primary)}
				.sw-history-old{color:var(--text-muted)}.sw-history-new{font-weight:600}.sw-history-arrow{color:var(--text-muted)}.sw-history-detail{color:var(--text-muted);font-size:12px}
			</style>`;
			frappe.msgprint({ title, message: styled_body, wide: true });
		});
	}

	save_techpack_and_refresh() {
		frappe.dom.freeze("Saving callout…");
		frappe.call({
			method: "frappe.client.save",
			args: { doc: this.tp },
			callback: (r) => {
				frappe.dom.unfreeze();
				sw_toast(this.wrapper, "Callout saved.");
				const $panels = $(this.wrapper).find("#swPanels");
				this.tpl_techpack($panels, r.message);
			},
			error: () => frappe.dom.unfreeze()
		});
	}

	// ---------- generic preview tab (tna / jobwork) ----------
	tpl_preview_tab(title, body) {
		return `
			<div class="sw-banner sw-banner-bad">
				<span><b>${title}</b> ${body}</span>
			</div>
			<div class="sw-card">
				<div class="sw-card-b">
					<div class="sw-empty">This tab intentionally shows nothing live — connect a doctype to bring it to life, following the same pattern as the Colours &amp; Sizes and Tech pack tabs on this page.</div>
				</div>
			</div>
		`;
	}

	close_drawer() {
		$(this.wrapper).find("#swDrawer").removeClass("on");
		$(this.wrapper).find("#swScrim").removeClass("on");
	}
}

function sw_status_pill(status) {
	if (status === "Completed") return "sw-pill-ok";
	if (status === "In Progress") return "sw-pill-warn";
	return "sw-pill-mut";
}

function sw_attr(label, value) {
	return `<div class="sw-attr"><span>${label}</span><span>${value ? frappe.utils.escape_html(String(value)) : '<span class="sw-empty">—</span>'}</span></div>`;
}

function sw_attr_link(label, value, onClick) {
	const id = "sw-lnk-" + frappe.utils.get_random(6);
	setTimeout(() => $(`#${id}`).on("click", (e) => { e.preventDefault(); onClick(); }), 0);
	return `<div class="sw-attr"><span>${label}</span><a href="#" id="${id}">${frappe.utils.escape_html(String(value))}</a></div>`;
}

function sw_toast(wrapper, msg) {
	const $t = $(wrapper).find("#swToast");
	$t.text(msg).addClass("on");
	clearTimeout($t.data("tt"));
	$t.data("tt", setTimeout(() => $t.removeClass("on"), 3200));
}

function inject_sw_css() {
	if (document.getElementById("sw-workspace-css")) return;
	const style = document.createElement("style");
	style.id = "sw-workspace-css";
	style.textContent = SW_CSS;
	document.head.appendChild(style);
}

const SW_CSS = `
.sw-app{--sw-navy:#0F172A;--sw-navy-2:#1E293B;--sw-navy-3:#334155;--sw-accent:#2563EB;--sw-accent-soft:#EFF6FF;
  --sw-bg:#F1F5F9;--sw-card:#FFFFFF;--sw-line:#E2E8F0;--sw-line-2:#CBD5E1;--sw-ink:#0F172A;--sw-ink-2:#475569;--sw-ink-3:#94A3B8;
  --sw-ok:#15803D;--sw-ok-bg:#DCFCE7;--sw-warn:#B45309;--sw-warn-bg:#FEF3C7;--sw-bad:#B91C1C;--sw-bad-bg:#FEE2E2;--sw-r:8px;--sw-r-sm:6px;
  display:flex;min-height:70vh;background:var(--sw-bg);color:var(--sw-ink);font-size:14px;line-height:1.5;margin:-15px -15px 0;border-radius:var(--sw-r);overflow:hidden}
.sw-app *{box-sizing:border-box}
.sw-app button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
.sw-app a{color:var(--sw-accent);text-decoration:none;cursor:pointer}
.sw-side{width:210px;background:var(--sw-navy);color:#CBD5E1;flex-shrink:0}
.sw-brand{padding:18px 16px;font-size:15px;font-weight:600;color:#fff;display:flex;align-items:center;gap:9px;border-bottom:1px solid var(--sw-navy-2)}
.sw-nav{padding:10px 0}
.sw-nav a{display:flex;align-items:center;gap:8px;padding:9px 16px;color:#94A3B8;font-size:13px;text-decoration:none}
.sw-nav a:hover{background:var(--sw-navy-2);color:#E2E8F0}
.sw-nav a.on{background:var(--sw-accent);color:#fff;font-weight:500}
.sw-nav a.sw-disabled{color:#475569;cursor:not-allowed}
.sw-soon{font-size:9px;background:var(--sw-navy-2);padding:1px 5px;border-radius:8px;margin-left:auto}
.sw-sep{height:1px;background:var(--sw-navy-2);margin:10px 16px}
.sw-main{flex:1;min-width:0;display:flex;flex-direction:column}
.sw-top{height:50px;background:var(--sw-card);border-bottom:1px solid var(--sw-line);display:flex;align-items:center;gap:16px;padding:0 18px}
.sw-crumb{font-size:13px;color:var(--sw-ink-3)}
.sw-crumb b{color:var(--sw-ink);font-weight:500}
.sw-search-wrap{margin-left:auto;position:relative}
.sw-search{width:260px;border:1px solid var(--sw-line);border-radius:var(--sw-r-sm);padding:6px 11px;font-size:13px;background:#F8FAFC}
.sw-search-results{position:absolute;top:34px;right:0;width:280px;background:#fff;border:1px solid var(--sw-line);border-radius:var(--sw-r-sm);box-shadow:0 8px 24px rgba(15,23,42,.12);z-index:40;display:none;max-height:260px;overflow:auto}
.sw-search-row{padding:8px 12px;font-size:13px;border-bottom:1px solid var(--sw-line);cursor:pointer;display:flex;flex-direction:column}
.sw-search-row:hover{background:var(--sw-accent-soft)}
.sw-search-row span{color:var(--sw-ink-2);font-size:12px}
.sw-search-empty{padding:10px 12px;font-size:12.5px;color:var(--sw-ink-3)}
.sw-avatar{width:28px;height:28px;border-radius:50%;background:#0D9488;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:600}
.sw-head{background:var(--sw-card);border-bottom:1px solid var(--sw-line);padding:16px 18px 0}
.sw-head-row{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
.sw-head h1{font-size:21px;font-weight:600;letter-spacing:-.2px;margin:0}
.sw-sub{color:var(--sw-ink-2);font-size:13px;margin-top:2px}
.sw-head-actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.sw-btn{padding:7px 13px;border-radius:var(--sw-r-sm);border:1px solid var(--sw-line-2);background:#fff;font-size:13px;font-weight:500}
.sw-btn:hover{background:#F8FAFC;border-color:var(--sw-ink-3)}
.sw-btn-pri{background:var(--sw-accent);border-color:var(--sw-accent);color:#fff}
.sw-btn-pri:hover{background:#1D4ED8}
.sw-btn-sm{padding:4px 9px;font-size:12px}
.sw-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:500}
.sw-pill-ok{background:var(--sw-ok-bg);color:var(--sw-ok)}
.sw-pill-warn{background:var(--sw-warn-bg);color:var(--sw-warn)}
.sw-pill-bad{background:var(--sw-bad-bg);color:var(--sw-bad)}
.sw-pill-mut{background:#F1F5F9;color:var(--sw-ink-2)}
.sw-dot{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}
.sw-tabs{display:flex;gap:2px;margin-top:14px;overflow-x:auto}
.sw-tabs button{padding:9px 14px;font-size:13px;color:var(--sw-ink-2);border-bottom:2px solid transparent;white-space:nowrap}
.sw-tabs button:hover{color:var(--sw-ink)}
.sw-tabs button.on{color:var(--sw-accent);border-bottom-color:var(--sw-accent);font-weight:500}
.sw-count{background:#F1F5F9;color:var(--sw-ink-2);border-radius:10px;padding:0 6px;font-size:10.5px;margin-left:5px}
.sw-body{padding:18px 18px 50px;flex:1;overflow:auto}
.sw-card{background:var(--sw-card);border:1px solid var(--sw-line);border-radius:var(--sw-r);margin-bottom:14px}
.sw-card-h{padding:11px 15px;border-bottom:1px solid var(--sw-line);display:flex;align-items:center;gap:10px}
.sw-card-h h2{font-size:11.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--sw-ink-2);margin:0}
.sw-right{margin-left:auto;display:flex;gap:7px;align-items:center}
.sw-card-b{padding:15px}
.sw-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.sw-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
@media(max-width:1000px){.sw-grid2,.sw-grid3{grid-template-columns:1fr}}
.sw-attr{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--sw-line);font-size:13px}
.sw-attr:last-child{border:none}
.sw-attr span:first-child{color:var(--sw-ink-2)}
.sw-app table{width:100%;border-collapse:collapse;font-size:13px}
.sw-app th{text-align:left;font-weight:500;color:var(--sw-ink-2);font-size:11.5px;padding:8px 12px;background:#F8FAFC;border-bottom:1px solid var(--sw-line)}
.sw-app td{padding:8px 12px;border-bottom:1px solid var(--sw-line)}
.sw-app tr:last-child td{border-bottom:none}
.sw-grp td{background:#F8FAFC;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--sw-ink-2)}
.sw-num{text-align:right;font-variant-numeric:tabular-nums}
.sw-swatch{width:22px;height:22px;border-radius:5px;border:1px solid var(--sw-line-2);display:inline-block;vertical-align:middle}
.sw-chip-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--sw-line);border-radius:var(--sw-r-sm);margin-bottom:6px;background:#fff}
.sw-x{color:var(--sw-ink-3);font-size:16px;line-height:1;cursor:pointer}
.sw-x:hover{color:var(--sw-bad)}
.sw-bom-x{display:inline-block}
.sw-matrix{border-collapse:collapse}
.sw-matrix td,.sw-matrix th{text-align:center;border:1px solid var(--sw-line);padding:7px 6px}
.sw-matrix .sw-rowh{text-align:left;background:#F8FAFC;font-weight:500}
.sw-sku{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--sw-accent);cursor:pointer;display:inline-block}
.sw-sku:hover{text-decoration:underline}
.sw-sku-gen{color:var(--sw-ink-3);border:1px dashed var(--sw-line-2);border-radius:5px;padding:3px 7px}
.sw-empty{color:var(--sw-ink-3);font-size:12px}
.sw-note{background:#F8FAFC;border:1px solid var(--sw-line);border-radius:var(--sw-r-sm);padding:9px 12px;font-size:12px;color:var(--sw-ink-2)}
.sw-banner{border-radius:var(--sw-r);padding:10px 14px;font-size:13px;margin-bottom:14px;display:flex;gap:9px;align-items:flex-start}
.sw-banner-bad{background:var(--sw-bad-bg);color:var(--sw-bad);border:1px solid #FCA5A5}
.sw-banner-ok{background:var(--sw-ok-bg);color:var(--sw-ok);border:1px solid #86EFAC}
.sw-flow{display:flex;align-items:flex-start;overflow-x:auto;padding:4px 0}
.sw-step{text-align:center;min-width:110px;flex:1}
.sw-bub{width:32px;height:32px;border-radius:50%;margin:0 auto 6px;display:grid;place-items:center;font-size:13px;font-weight:600;color:#fff}
.sw-step small{display:block;color:var(--sw-ink-3);font-size:11px}
.sw-nm{font-size:12px;font-weight:500}
.sw-arrow{flex:0 0 22px;height:32px;display:grid;place-items:center;color:var(--sw-line-2)}
.sw-picker{padding:20px}
.sw-picker h2{margin:0 0 4px}
.sw-muted{color:var(--sw-ink-2);font-size:13px}
.sw-picker-list{margin-top:14px;display:flex;flex-direction:column;gap:8px;max-width:520px}
.sw-picker-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#fff;border:1px solid var(--sw-line);border-radius:var(--sw-r-sm);cursor:pointer}
.sw-picker-row:hover{border-color:var(--sw-accent)}
.sw-loading{padding:30px;color:var(--sw-ink-3);font-size:13px}
.sw-flat-wrap{position:relative;background:#F8FAFC;border:1px solid var(--sw-line);border-radius:var(--sw-r);overflow:hidden}
.sw-flat-wrap img{width:100%;display:block;user-select:none}
.sw-flat-wrap.adding{cursor:crosshair}
.sw-pin{position:absolute;width:22px;height:22px;border-radius:50%;background:#0D9488;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:600;transform:translate(-50%,-50%);cursor:pointer;border:2px solid #fff}
.sw-pin:hover,.sw-pin.on{background:#0F766E;transform:translate(-50%,-50%) scale(1.15)}
.sw-callout-row{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:var(--sw-r-sm);cursor:pointer;font-size:13px}
.sw-callout-row:hover,.sw-callout-row.on{background:var(--sw-accent-soft)}
.sw-callout-row .sw-n{width:20px;height:20px;border-radius:50%;background:#0D9488;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:600;flex-shrink:0}
.sw-scrim{position:fixed;inset:0;background:rgba(15,23,42,.35);display:none;z-index:150}
.sw-scrim.on{display:block}
.sw-drawer{position:fixed;top:0;right:0;width:400px;max-width:92vw;height:100vh;background:#fff;z-index:151;transform:translateX(100%);transition:transform .22s ease;display:flex;flex-direction:column}
.sw-drawer.on{transform:none}
.sw-drawer-h{padding:14px 16px;border-bottom:1px solid var(--sw-line);display:flex;align-items:center}
.sw-drawer-b{padding:16px;overflow-y:auto;flex:1}
.sw-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--sw-navy);color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:160;opacity:0;transition:all .25s}
.sw-toast.on{transform:translateX(-50%);opacity:1}
`;
