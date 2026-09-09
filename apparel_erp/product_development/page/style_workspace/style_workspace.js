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
					<button data-t="info" class="${this.active_tab === "info" ? "on" : ""}">Style information</button>
					<button data-t="colours" class="${this.active_tab === "colours" ? "on" : ""}">Colours &amp; sizes<span class="sw-count">${(s.matrix_items || []).length}</span></button>
					<button data-t="bom" class="${this.active_tab === "bom" ? "on" : ""}">Style BOM</button>
					<button data-t="techpack" class="${this.active_tab === "techpack" ? "on" : ""}">Tech pack</button>
					<button data-t="costing" class="${this.active_tab === "costing" ? "on" : ""}">Costing</button>
					<button data-t="tna" class="${this.active_tab === "tna" ? "on" : ""}">Time &amp; action${this.tna_count ? `<span class="sw-count">${this.tna_count}</span>` : ""}</button>
					<button data-t="jobwork" class="${this.active_tab === "jobwork" ? "on" : ""}">Job work</button>
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
		if (this.active_tab === "info") { $panels.html(this.tpl_info(s)); this.bind_info($panels); }
		else if (this.active_tab === "colours") { $panels.html(this.tpl_colours(s)); this.bind_colours(); }
		else if (this.active_tab === "bom") { this.render_bom_tab($panels); }
		else if (this.active_tab === "techpack") this.render_techpack_tab($panels);
		else if (this.active_tab === "costing") { this.render_costing_tab($panels); }
		else if (this.active_tab === "tna") { this.render_tna_tab($panels); }
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
							${sw_attr_link("Style BOM", "Manage \u2192", () => this.switch_tab("bom"))}
							${sw_attr_link("Costing", "Open \u2192", () => this.switch_tab("costing"))}
						</div>
					</div>
					<div class="sw-card">
						<div class="sw-card-h"><h2>BOM generation</h2></div>
						<div class="sw-card-b">
							<div class="sw-f">
								<label>Generate BOM at</label>
								<select id="swBomStage">
									<option value="Design & Tech Pack" ${(s.bom_generation_stage || "Sampling") === "Design & Tech Pack" ? "selected" : ""}>Design & Tech Pack</option>
									<option value="Costing" ${(s.bom_generation_stage || "Sampling") === "Costing" ? "selected" : ""}>Costing</option>
									<option value="Sampling" ${(s.bom_generation_stage || "Sampling") === "Sampling" ? "selected" : ""}>Sampling</option>
								</select>
							</div>
							<div class="sw-note">The "Generate BOM" action only appears on the tab matching this choice, so the person driving that stage is the one who kicks off the Style BOM.</div>
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

	bind_info($panels) {
		$panels.find("#swBomStage").on("change", (e) => {
			this.save_bom_generation_stage($(e.currentTarget).val());
		});
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

	// ---------- Generate BOM (Design & Tech / Costing / Sampling) ----------
	bom_stage_label() {
		return this.style.bom_generation_stage || "Sampling";
	}

	save_bom_generation_stage(stage, onDone) {
		frappe.dom.freeze("Saving…");
		frappe.call({
			method: "frappe.client.set_value",
			args: { doctype: "Style", name: this.style.name, fieldname: "bom_generation_stage", value: stage },
			callback: () => {
				frappe.dom.unfreeze();
				this.style.bom_generation_stage = stage;
				sw_toast(this.wrapper, `BOM will now be generated at the ${stage} stage.`);
				if (onDone) onDone();
			},
			error: () => frappe.dom.unfreeze()
		});
	}

	generate_bom_button_html(stage) {
		const configured = this.bom_stage_label();
		if (configured !== stage) return "";
		return `<button class="sw-btn sw-btn-pri sw-btn-sm" id="swGenBom" data-stage="${stage}">Generate BOM</button>`;
	}

	generate_bom_hint_html(stage) {
		// Shown on the tabs that are NOT the chosen generation stage, so
		// whoever is on Tech Pack/Costing/Sampling always understands why
		// the "Generate BOM" button isn't sitting in front of them here -
		// the style owner decided it should happen after a different
		// stage, and this links straight to where that choice is made.
		const configured = this.bom_stage_label();
		if (configured === stage) return "";
		return `<span class="sw-pill sw-pill-mut sw-gen-bom-hint" title="Change this on the Style information tab" style="cursor:pointer">BOM generates after ${configured}</span>`;
	}

	bind_generate_bom_button($panels) {
		$panels.find(".sw-gen-bom-hint").on("click", () => this.switch_tab("info"));
		$panels.find("#swGenBom").on("click", (e) => {
			const stage = $(e.currentTarget).data("stage");
			frappe.confirm(
				`Generate the Style BOM for ${this.style.style_no} now, at the ${stage} stage?`,
				() => {
					frappe.dom.freeze("Generating BOM…");
					frappe.call({
						method: "apparel_erp.product_development.doctype.style_bom.style_bom.generate_style_bom_for_stage",
						args: { style: this.style.name, stage },
						callback: (r) => {
							frappe.dom.unfreeze();
							const msg = r.message || {};
							sw_toast(this.wrapper, msg.created ? "Style BOM created." : "Style BOM already exists — opening it.");
							this.switch_tab("bom");
						},
						error: () => frappe.dom.unfreeze()
					});
				}
			);
		});
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
							${this.generate_bom_button_html("Sampling")}
							${this.generate_bom_hint_html("Sampling")}
							<button class="sw-btn sw-btn-pri sw-btn-sm" id="swGenAll">Generate all SKUs</button>
						</div>
					</div>
					<div class="sw-card-b">
						${matrix}
						<div class="sw-note" style="margin-top:12px">SKU codes come from the style, colour and size codes. Generation is gated and happens on the Style BOM document (Style Confirmed, PP approved, Lab Dip approved per colourway) - clicking a pending cell takes you there.</div>
					</div>
				</div>
			</div>
		`;
	}

	bind_colours() {
		const $panels = $(this.wrapper).find("#swPanels");
		this.bind_generate_bom_button($panels);
		$panels.find(".sw-sku[data-item]").on("click", (e) => {
			e.preventDefault();
			frappe.set_route("Form", "Item", $(e.currentTarget).data("item"));
		});
		$panels.find(".sw-sku-gen").on("click", (e) => {
			this.point_to_style_bom_generation();
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
			this.point_to_style_bom_generation();
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

	point_to_style_bom_generation() {
		// Generation now happens on the Style BOM document (gated: Style
		// Confirmed, PP approved, Lab Dip approved per colourway, etc) and
		// covers every approved colourway in one go - not per matrix cell.
		frappe.call({
			method: "apparel_erp.product_development.doctype.style.style.get_latest_style_bom",
			args: { style: this.style.name }
		}).then((r) => {
			if (r.message && r.message.name && !r.message.inherited_from) {
				frappe.set_route("Form", "Style BOM", r.message.name);
			} else {
				frappe.confirm(
					"No Style BOM of its own exists for this Style yet. Create one now?",
					() => frappe.new_doc("Style BOM", { style: this.style.name, bom_type: "Development" })
				);
			}
		});
	}

	// ---------- Style BOM ----------
	render_bom_tab($panels) {
		$panels.html(`<div class="sw-loading">Loading Style BOM…</div>`);
		frappe.call({
			method: "apparel_erp.product_development.doctype.style_bom.style_bom.get_workspace_style_bom",
			args: { style: this.style.name }
		}).then((r) => {
			this.workspace_bom = r.message || {};
			this.paint_bom_tab($panels);
		});
	}

	paint_bom_tab($panels) {
		const bom = this.workspace_bom || {};
		const editable = !!bom.editable;
		const sections = ["Fabric", "Trim", "Packing", "Value-add"];
		const lines = bom.lines || [];
		const grouped = sections.map((sec) => ({
			sec,
			rows: lines.filter((l) => (l.section || "Fabric") === sec)
		})).filter((g) => g.rows.length);
		if (!grouped.length && lines.length) {
			grouped.push({ sec: "Lines", rows: lines });
		}

		let lineTbl;
		if (!lines.length) {
			lineTbl = `<div class="empty" style="padding:16px">No materials yet. Add items to build the Style BOM rule set.</div>`;
		} else {
			lineTbl = `<table><thead><tr>
				<th style="width:34px">#</th><th>Material</th><th style="width:110px">Rule</th>
				<th style="width:70px">UOM</th><th class="num" style="width:90px">Base qty</th>
				<th style="width:100px">Rate</th>${editable ? `<th style="width:36px"></th>` : ""}
				<th style="width:100px">Supplied by</th>
			</tr></thead><tbody>`;
			let n = 0;
			grouped.forEach((g) => {
				const label = g.sec === "Trim" ? "Trims" : g.sec === "Packing" ? "Packaging" : g.sec;
				lineTbl += `<tr class="sw-grp"><td colspan="${editable ? 7 : 6}">${frappe.utils.escape_html(label)}</td></tr>`;
				g.rows.forEach((l) => {
					n += 1;
					const rule = sw_bom_rule(l);
					const supplied = (l.supplied_by || "Us") === "Job Worker"
						? `<span class="pill warn">Job worker</span>`
						: `<span class="pill mut">Us</span>`;
					lineTbl += `<tr>
						<td>${n}</td>
						<td>${frappe.utils.escape_html(l.item_name || l.item || "")}<div class="sw-muted" style="font-size:11px">${frappe.utils.escape_html(l.item || "")}</div></td>
						<td><span class="pill ${rule.cls}">${rule.label}</span></td>
						<td>${frappe.utils.escape_html(l.uom || "")}</td>
						<td class="num">${l.base_consumption != null ? l.base_consumption : ""}</td>
						${editable ? `<td><input class="sw-cell" data-rate-line="${frappe.utils.escape_html(l.line_id || "")}" type="number" step="0.01" min="0" value="${l.rate || 0}"></td>` : `<td>${l.rate || 0}</td>`}
						<td>${supplied}</td>
						${editable ? `<td><span class="sw-x" data-line="${frappe.utils.escape_html(l.line_id || "")}" title="Remove">&times;</span></td>` : ""}
					</tr>`;
				});
			});
			lineTbl += `</tbody></table>`;
		}

		$(this.wrapper).find("#swTabs button[data-t=\"bom\"]").html(
			`Style BOM${lines.length ? `<span class="sw-count">${lines.length}</span>` : ""}`
		);

		const fabricLine = lines.find((l) => l.section === "Fabric") || lines[0];
		const baseFabric = fabricLine ? Number(fabricLine.base_consumption) || 0 : 0;
		const sizes = bom.sizes || this.style.sizes || [];
		const factorRows = sizes.length
			? sizes.map((sz, i) => {
				const factor = Number(sz.consumption_factor != null ? sz.consumption_factor : 1) || 1;
				const code = sz.size_code || sz.size;
				return `<tr>
					<td>${frappe.utils.escape_html(code)}</td>
					<td class="num">${editable
						? `<input class="sw-cell" data-factor-idx="${i}" type="number" step="0.001" min="0" value="${factor}">`
						: factor.toFixed(2)}</td>
					<td class="num">${(baseFabric * factor).toFixed(2)}</td>
				</tr>`;
			}).join("")
			: `<tr><td colspan="3" class="empty">No sizes on this style</td></tr>`;

		const lineById = {};
		lines.forEach((l) => { lineById[l.line_id] = l; });
		const overrides = bom.overrides || [];
		const overrideRows = overrides.length
			? overrides.map((o, i) => {
				const line = lineById[o.line_id] || {};
				const applies = [o.colourway || "All", o.size || "all sizes"].join(" · ");
				const itemLabel = o.item_code
					? `${line.item_name || line.item || ""} → ${o.item_name || o.item_code}`
					: (line.item_name || line.item || o.line_id || "");
				return `<tr>
					<td>${frappe.utils.escape_html(applies)}</td>
					<td>${frappe.utils.escape_html(itemLabel)}</td>
					<td class="num">${o.consumption != null && o.consumption !== "" ? o.consumption : "—"}</td>
					${editable ? `<td><span class="sw-x" data-override-idx="${i}" title="Remove">&times;</span></td>` : ""}
				</tr>`;
			}).join("")
			: `<tr><td colspan="${editable ? 4 : 3}" class="empty">No exceptions</td></tr>`;

		const titleBits = bom.name
			? `${frappe.utils.escape_html(bom.name)} — ${bom.docstatus === 1 ? "Rev " + (bom.version || 1) : "Draft"}`
			: "Style BOM — base";
		const typePill = `<span class="sw-pill ${bom.bom_type === "Bulk" ? "" : "sw-pill-mut"}">${frappe.utils.escape_html(bom.bom_type || "Development")}</span>`;
		const inherited = bom.inherited_from
			? `<div class="sw-note" style="margin:12px 16px 0">Inherited from Base Style <b>${frappe.utils.escape_html(bom.inherited_from)}</b>. Create this style’s own copy to edit.</div>`
			: "";
		const locked = bom.docstatus === 1
			? `<div class="sw-note" style="margin:12px 16px 0">Submitted Style BOMs are read-only. Amend the document to change materials.</div>`
			: "";

		$panels.html(`
			<div class="sw-grid2" style="grid-template-columns:1.55fr 1fr">
				<div class="sw-card">
					<div class="sw-card-h">
						<h2>${titleBits}</h2>
						<div class="right">
							${typePill}
							${editable ? `<button class="sw-btn sw-btn-sm" id="swAddBomItem">+ Add item</button>` : ""}
							${bom.name ? `<button class="sw-btn sw-btn-sm" id="swOpenBomForm">Open form</button>` : ""}
						</div>
					</div>
					${inherited}${locked}
					${lineTbl}
					<div class="sw-card-b">
						<div class="note">This is a <b>Style BOM rule set</b>, not an ERPNext manufacturing BOM. Colour selects the material Item; size selects the quantity. The BOM Generator resolves both only after release.</div>
						${editable ? `<button class="sw-btn sw-btn-pri" id="swSaveBom" style="margin-top:12px">Save Style BOM</button>` : ""}
						${bom.inherited_from ? `<button class="sw-btn sw-btn-pri" id="swForkBom" style="margin-top:12px">Create this style’s BOM</button>` : ""}
					</div>
				</div>
				<div>
					<div class="card">
						<div class="card-h"><h2>Size consumption factors</h2></div>
						<table>
							<thead><tr><th>Size</th><th class="num">Factor</th><th class="num">Fabric</th></tr></thead>
							<tbody>${factorRows}</tbody>
						</table>
					</div>
					<div class="card">
						<div class="card-h">
							<h2>Exceptions</h2>
							<div class="sw-right">${editable ? `<button class="sw-btn sw-btn-sm" id="swAddOverride">+ Add</button>` : ""}</div>
						</div>
						<table>
							<thead><tr><th>Applies to</th><th>Item</th><th class="num">Override</th>${editable ? `<th></th>` : ""}</tr></thead>
							<tbody>${overrideRows}</tbody>
						</table>
						<div class="card-b"><div class="note">Exceptions override the calculated quantity or item for specific colour or size combinations.</div></div>
					</div>
				</div>
			</div>
		`);
		this.bind_bom_tab($panels);
	}

	bind_bom_tab($panels) {
		$panels.find("#swOpenBomForm").on("click", () => {
			if (this.workspace_bom && this.workspace_bom.name) {
				frappe.set_route("Form", "Style BOM", this.workspace_bom.name);
			}
		});
		$panels.find("#swForkBom").on("click", () => {
			frappe.dom.freeze("Copying Style BOM…");
			frappe.call({
				method: "apparel_erp.product_development.doctype.style_bom.style_bom.fork_inherited_style_bom",
				args: { style: this.style.name },
				callback: (r) => {
					frappe.dom.unfreeze();
					this.workspace_bom = r.message;
					this.paint_bom_tab($panels);
					sw_toast(this.wrapper, "Copied. This style now has its own draft Style BOM.");
				},
				error: () => frappe.dom.unfreeze()
			});
		});
		$panels.find("#swAddBomItem").on("click", () => this.prompt_add_bom_item($panels));
		$panels.find("#swAddOverride").on("click", () => this.prompt_add_bom_override($panels));
		$panels.find(".sw-bom-x").on("click", (e) => {
			this.sync_size_factors($panels);
			const id = $(e.currentTarget).data("line");
			this.workspace_bom.lines = (this.workspace_bom.lines || []).filter((l) => l.line_id !== id);
			this.workspace_bom.overrides = (this.workspace_bom.overrides || []).filter((o) => o.line_id !== id);
			this.paint_bom_tab($panels);
		});
		$panels.find("[data-override-idx]").on("click", (e) => {
			this.sync_size_factors($panels);
			const idx = Number($(e.currentTarget).data("override-idx"));
			(this.workspace_bom.overrides || []).splice(idx, 1);
			this.paint_bom_tab($panels);
		});
		$panels.find("#swSaveBom").on("click", () => this.save_workspace_bom($panels));
	}

	sync_size_factors($panels) {
		const bom = this.workspace_bom;
		if (!bom || !bom.sizes) return;
		bom.sizes.forEach((sz, i) => {
			const $inp = $panels.find(`[data-factor-idx="${i}"]`);
			if ($inp.length) sz.consumption_factor = Number($inp.val());
		});
	}

collect_bom_payload($panels) {
		this.sync_size_factors($panels);
		const bom = this.workspace_bom || {};
		const size_factors = (bom.sizes || []).map((sz, i) => {
			const $inp = $panels.find(`[data-factor-idx="${i}"]`);
			return {
				size_code: sz.size_code || sz.size,
				consumption_factor: $inp.length ? Number($inp.val()) : (sz.consumption_factor != null ? sz.consumption_factor : 1)
			};
		});
		// Merge each Rate cell's current value back onto its line, matched by
		// line_id (not row position - grouping/reordering can change that).
		// Previously the typed value was only collected into a separate
		// `rates` array that neither this payload's `lines` nor the server
		// ever read, so price edits here never actually saved.
		const lines = (bom.lines || []).map((l) => {
			const $inp = $panels.find(`[data-rate-line="${l.line_id}"]`);
			return $inp.length ? { ...l, rate: Number($inp.val()) || 0 } : l;
		});
		return {
			bom_type: bom.bom_type || "Development",
			lines,
			overrides: bom.overrides || [],
			size_factors
		};
	}

	save_workspace_bom($panels) {
		frappe.dom.freeze("Saving Style BOM…");
		frappe.call({
			method: "apparel_erp.product_development.doctype.style_bom.style_bom.save_workspace_style_bom",
			args: { style: this.style.name, payload: JSON.stringify(this.collect_bom_payload($panels)) },
			callback: (r) => {
				frappe.dom.unfreeze();
				this.workspace_bom = r.message;
				frappe.call({ method: "frappe.client.get", args: { doctype: "Style", name: this.style.name } }).then((sr) => {
					this.style = sr.message;
					this.paint_bom_tab($(this.wrapper).find("#swPanels"));
					sw_toast(this.wrapper, "Style BOM saved.");
				});
			},
			error: () => frappe.dom.unfreeze()
		});
	}

	prompt_add_bom_item($panels) {
		const d = new frappe.ui.Dialog({
			title: "Add Style BOM item",
			fields: [
				{ fieldname: "item", label: "Item", fieldtype: "Link", options: "Item", reqd: 1 },
				{ fieldname: "section", label: "Section", fieldtype: "Select", options: "Fabric\nTrim\nPacking\nValue-add", default: "Fabric", reqd: 1 },
				{ fieldname: "uom", label: "UOM", fieldtype: "Link", options: "UOM", reqd: 1 },
				{ fieldname: "base_consumption", label: "Base qty", fieldtype: "Float", reqd: 1 },
				{ fieldname: "rule", label: "Rule", fieldtype: "Select", options: "Common\nColour\nSize\nColour × size", default: "Common" },
				{ fieldname: "supplied_by", label: "Supplied by", fieldtype: "Select", options: "Us\nJob Worker", default: "Us" }
			],
			primary_action_label: "Add",
			primary_action: (values) => {
				this.sync_size_factors($panels);
				const flags = sw_rule_to_flags(values.rule);
				this.workspace_bom.lines = this.workspace_bom.lines || [];
				this.workspace_bom.lines.push({
					line_id: "tmp-" + frappe.utils.get_random(8),
					item: values.item,
					item_name: values.item,
					section: values.section,
					uom: values.uom,
					base_consumption: values.base_consumption,
					supplied_by: values.supplied_by,
					...flags
				});
				frappe.db.get_value("Item", values.item, "item_name").then((r) => {
					const last = this.workspace_bom.lines[this.workspace_bom.lines.length - 1];
					if (r.message && r.message.item_name) last.item_name = r.message.item_name;
					this.paint_bom_tab($panels);
				});
				d.hide();
			}
		});
		d.fields_dict.item.df.onchange = () => {
			const item = d.get_value("item");
			if (!item) return;
			frappe.db.get_value("Item", item, "stock_uom").then((r) => {
				if (r.message && r.message.stock_uom && !d.get_value("uom")) {
					d.set_value("uom", r.message.stock_uom);
				}
			});
		};
		d.show();
	}

	prompt_add_bom_override($panels) {
		const lines = this.workspace_bom.lines || [];
		if (!lines.length) {
			frappe.show_alert({ message: "Add BOM items first.", indicator: "orange" });
			return;
		}
		const line_options = lines.map((l) => l.line_id).join("\n");
		const colour_options = ["", ...((this.style.colours || []).map((c) => c.colour_code || c.colour_name))].join("\n");
		const size_options = ["", ...((this.style.sizes || []).map((s) => s.size_code || s.size))].join("\n");
		const d = new frappe.ui.Dialog({
			title: "Add exception",
			fields: [
				{ fieldname: "line_id", label: "BOM line", fieldtype: "Select", options: line_options, reqd: 1 },
				{ fieldname: "colourway", label: "Colourway (blank = all)", fieldtype: "Select", options: colour_options },
				{ fieldname: "size", label: "Size (blank = all)", fieldtype: "Select", options: size_options },
				{ fieldname: "item_code", label: "Override item", fieldtype: "Link", options: "Item" },
				{ fieldname: "consumption", label: "Override qty", fieldtype: "Float" }
			],
			primary_action_label: "Add",
			primary_action: (values) => {
				this.sync_size_factors($panels);
				this.workspace_bom.overrides = this.workspace_bom.overrides || [];
				const line = lines.find((l) => l.line_id === values.line_id) || {};
				this.workspace_bom.overrides.push({
					line_id: values.line_id,
					colourway: values.colourway,
					size: values.size,
					item_code: values.item_code,
					item_name: values.item_code,
					consumption: values.consumption
				});
				d.hide();
				this.paint_bom_tab($panels);
			}
		});
		d.fields_dict.line_id.df.formatter = (value) => {
			const line = lines.find((l) => l.line_id === value);
			return line ? (line.item_name || line.item) : value;
		};
		d.show();
		const $sel = d.fields_dict.line_id.$input;
		if ($sel && $sel.length) {
			$sel.find("option").each(function () {
				const val = $(this).attr("value");
				const line = lines.find((l) => l.line_id === val);
				if (line) $(this).text(line.item_name || line.item || val);
			});
		}
	}

	// ---------- Costing ----------
	render_costing_tab($panels) {
		$panels.html(`<div class="sw-loading">Loading costing…</div>`);
		frappe.call({
			method: "apparel_erp.product_development.doctype.style_cost_sheet.style_cost_sheet.get_workspace_cost_sheet",
			args: { style: this.style.name }
		}).then((r) => {
			this.workspace_cost = r.message || {};
			this.paint_costing_tab($panels);
		});
	}

	paint_costing_tab($panels) {
		const c = this.workspace_cost || {};
		const editable = c.editable !== false;
		const cur = c.currency === "USD" ? "$" : "₹";
		const fmt = (n) => cur + Number(n || 0).toFixed(2);
		const bomLabel = c.bom
			? (c.bom.docstatus === 1 ? `Rev ${String(c.bom.version || 1).padStart(2, "0")}` : "Draft")
			: "—";
		const tpLabel = c.tech_pack ? `v${c.tech_pack.version}` : "—";
		const revLabel = c.revision ? String(c.revision).padStart(2, "0") : "draft";
		const workflowState = c.workflow_state || (c.docstatus === 1 ? "Submitted" : "Draft");
		const statusPillClass = workflowState === "Approved" ? "pill-ok" : (workflowState === "Submitted" ? "pill-info" : "pill-warn");
		const statusLabel = workflowState === "Approved" ? "Approved" : (workflowState === "Submitted" ? "Submitted — awaiting approval" : "Draft");
		const status = `<span class="pill ${statusPillClass}" id="swCostStatus">${statusLabel}</span>`;
		const fabricBasis = c.fabric_qty
			? `${Number(c.fabric_qty).toFixed(2)} × ${fmt(c.fabric_rate)}`
			: "Style BOM fabric lines";
		const selling = Number(c.selling_price || 0);
		const target = Number(c.buyer_target || 0);
		const gapHtml = gap_pill_html(fmt, selling, target);

$panels.html(`
			<div class="sw-grid2" style="grid-template-columns:1.6fr 1fr">
				<div class="card">
					<div class="card-h">
						<h2>Style cost sheet — revision ${revLabel}</h2>
						<div class="right">
							${status}
							${editable ? `<button class="sw-btn sw-btn-sm" id="swRecalcCost">Recalculate</button>` : ""}
						</div>
					</div>
					<table>
						<thead><tr><th>Cost head</th><th>Basis</th><th class="num">Rate</th><th class="num">Amount / pc</th></tr></thead>
						<tbody>
							<tr><td>Main fabric</td><td>${frappe.utils.escape_html(fabricBasis)}</td><td class="num">${c.fabric_rate ? fmt(c.fabric_rate) + " / uom" : "—"}</td><td class="num">${fmt(c.fabric_amount)}</td></tr>
							<tr><td>Trims & packing</td><td>Style BOM ${frappe.utils.escape_html(bomLabel)}</td><td class="num">${editable ? `<a href="#" id="swEditBomRate">Edit in Style BOM →</a>` : "—"}</td><td class="num">${fmt(c.trims_amount)}</td></tr>
							<tr><td>Cut, make & trim</td><td>Approved service rate</td><td class="num">${fmt(c.cmt_rate)} / pc</td><td class="num" id="swCmtAmount">${fmt(c.cmt_amount)}</td></tr>
							<tr><td>Testing & logistics</td><td>Allocated per piece</td><td class="num">—</td><td class="num" id="swTestingAmount">${fmt(c.testing_amount)}</td></tr>
							<tr><td>Extra items</td><td><span id="swExtraCount">${(c.extra_items || []).length}</span> item(s) added below</td><td class="num">—</td><td class="num" id="swExtraTotalAmount">${fmt(c.extra_items_amount)}</td></tr>
							<tr><td>Overhead</td><td>${Number(c.overhead_pct || 0)}% of direct cost</td><td class="num">${Number(c.overhead_pct || 0)}%</td><td class="num" id="swOverheadAmount">${fmt(c.overhead_amount)}</td></tr>
							<tr><td><b>Total cost</b></td><td></td><td></td><td class="num"><b id="swTotalCost">${fmt(c.total_cost)}</b></td></tr>
						</tbody>
					</table>
					<div class="card-b"><div class="note">Costing reads quantities from the selected <b>Style BOM revision</b>. It does not read or create ERPNext Production BOMs during development.</div></div>
				</div>
				<div>
					<div class="card">
						<div class="card-h"><h2>Commercial summary</h2></div>
						<div class="card-b">
							<div class="f"><label>Currency</label>
								<select id="swCostCurrency" ${editable ? "" : "disabled"}>
									<option value="INR" ${c.currency === "INR" ? "selected" : ""}>INR</option>
									<option value="USD" ${c.currency === "USD" ? "selected" : ""}>USD</option>
								</select>
							</div>
							<div class="f"><label>Target margin %</label>
								<input id="swMarginPct" type="number" min="0" max="80" value="${c.target_margin != null ? c.target_margin : 18}" ${editable ? "" : "readonly"}>
							</div>
							<div class="f"><label>CMT / pc</label>
								<input id="swCmtRate" type="number" min="0" step="0.01" value="${c.cmt_rate || 0}" ${editable ? "" : "readonly"}>
							</div>
							<div class="f"><label>Testing & logistics / pc</label>
								<input id="swTesting" type="number" min="0" step="0.01" value="${c.testing_logistics || 0}" ${editable ? "" : "readonly"}>
							</div>
							<div class="f"><label>Overhead %</label>
								<input id="swOverheadPct" type="number" min="0" max="100" step="0.1" value="${c.overhead_pct != null ? c.overhead_pct : 8}" ${editable ? "" : "readonly"}>
							</div>
							<div class="f"><label>Buyer target</label>
								<input id="swBuyerTarget" type="number" min="0" step="0.01" value="${c.buyer_target || 0}" ${editable ? "" : "readonly"}>
							</div>
							<div class="f" style="margin-top:4px">
								<label>Extra items</label>
								<div id="swExtraItems">${extraItemRows(c.extra_items, editable)}</div>
								${editable ? `<button type="button" class="sw-btn sw-btn-sm" id="swAddExtraItem" style="margin-top:6px">+ Add item</button>` : ""}
							</div>
							<div class="attr"><span>Suggested selling price</span><strong id="swSellPrice">${fmt(selling)}</strong></div>
							<div class="attr"><span>Gap to target</span><span id="swGapWrap">${gapHtml}</span></div>
						</div>
					</div>
					<div class="card">
						<div class="card-h">
						<h2>Approval</h2>
						<div class="right">${this.generate_bom_button_html("Costing")}${this.generate_bom_hint_html("Costing")}</div>
					</div>
						<div class="card-b">
							<div class="attr"><span>Uses Tech Pack</span><span>${frappe.utils.escape_html(tpLabel)}</span></div>
							<div class="attr"><span>Uses Style BOM</span><span>${frappe.utils.escape_html(bomLabel)}</span></div>
							<div class="attr"><span>Status</span>${status}</div>
							${editable ? `
								<button class="sw-btn" id="swSaveCost" style="margin-top:12px">Save costing</button>
								<button class="sw-btn sw-btn-pri" id="swApproveCost" style="margin-top:8px">Submit costing</button>
							` : ""}
							${!editable && workflowState === "Submitted" ? `
								<div class="note" style="margin-top:12px">Submitted against the Style BOM and tech pack shown above — awaiting final approval.</div>
								<button class="sw-btn sw-btn-pri" id="swFinalApproveCost" style="margin-top:8px">Approve costing</button>
								<button class="sw-btn sw-btn-sm" id="swAmendCost" style="margin-top:8px">Start new revision</button>
							` : ""}
							${!editable && workflowState === "Approved" ? `
								<div class="note" style="margin-top:12px">Approved against the Style BOM and tech pack shown above.</div>
								<button class="sw-btn sw-btn-sm" id="swAmendCost" style="margin-top:8px">Start new revision</button>
							` : ""}
							${c.name ? `<button class="sw-btn sw-btn-sm" id="swOpenCostForm" style="margin-top:8px">Open cost sheet</button>` : ""}
						</div>
					</div>
				</div>
			</div>
		`);
		this.bind_costing_tab($panels);
	}

	collect_cost_payload($panels) {
		const extra_items = [];
		$panels.find(".sw-extra-row").each((_, el) => {
			const $row = $(el);
			const label = ($row.find(".sw-extra-label").val() || "").trim();
			if (!label) return;
			extra_items.push({
				label,
				amount: Number($row.find(".sw-extra-amount").val()) || 0
			});
		});
		return {
			currency: $panels.find("#swCostCurrency").val(),
			target_margin: Number($panels.find("#swMarginPct").val()),
			cmt_rate: Number($panels.find("#swCmtRate").val()),
			testing_logistics: Number($panels.find("#swTesting").val()),
			overhead_pct: Number($panels.find("#swOverheadPct").val()),
			buyer_target: Number($panels.find("#swBuyerTarget").val()),
			extra_items
		};
	}

	bind_costing_tab($panels) {
		this.bind_generate_bom_button($panels);
		// Extra commercial line items: "+ Add item" appends a blank editable
		// row client-side only (no server round trip needed just to add a
		// row); Save/Recalculate below picks up whatever rows are currently
		// in the DOM via collect_cost_payload and persists the whole set.
		$panels.find("#swAddExtraItem").on("click", () => {
			$panels.find("#swExtraItems").append(extraItemRowHtml({ label: "", amount: 0 }, true));
			this.recalc_costing_preview($panels);
		});
		$panels.on("click", ".sw-extra-remove", (e) => {
			$(e.currentTarget).closest(".sw-extra-row").remove();
			this.recalc_costing_preview($panels);
		});
		// Live preview: every commercial input, and every extra item row,
		// recomputes Overhead/Total/Selling price/Gap instantly in the UI -
		// Save/Recalculate is still what persists it to the Style Cost
		// Sheet, but the numbers on screen no longer wait for a round trip
		// to reflect what's been typed.
		$panels.on("input", "#swCmtRate, #swTesting, #swOverheadPct, #swMarginPct, #swBuyerTarget, .sw-extra-amount, .sw-extra-label", () => {
			this.recalc_costing_preview($panels);
		});
		// Trim/packing prices always live on the Style BOM - editing them
		// here was silently discarded (see style_bom.js history), so always
		// send the user to the Style BOM tab, the single source of truth.
		$panels.find("#swEditBomRate").on("click", (e) => {
			e.preventDefault();
			this.switch_tab("bom");
		});
		$panels.find("#swOpenCostForm").on("click", () => {
			if (this.workspace_cost && this.workspace_cost.name) {
				frappe.set_route("Form", "Style Cost Sheet", this.workspace_cost.name);
			}
		});
		$panels.find("#swRecalcCost, #swSaveCost").on("click", () => {
			frappe.dom.freeze("Saving costing…");
			frappe.call({
				method: "apparel_erp.product_development.doctype.style_cost_sheet.style_cost_sheet.save_workspace_cost_sheet",
				args: { style: this.style.name, payload: JSON.stringify(this.collect_cost_payload($panels)) },
				callback: (r) => {
					frappe.dom.unfreeze();
					this.workspace_cost = r.message;
					this.paint_costing_tab($(this.wrapper).find("#swPanels"));
					sw_toast(this.wrapper, "Cost recalculated from the Style BOM.");
				},
				error: () => frappe.dom.unfreeze()
			});
		});
		$panels.find("#swApproveCost").on("click", () => {
			frappe.confirm("Submit this costing against the current tech pack and Style BOM? It will move to Submitted, awaiting a separate approval.", () => {
				frappe.dom.freeze("Submitting costing…");
				frappe.call({
					method: "apparel_erp.product_development.doctype.style_cost_sheet.style_cost_sheet.save_workspace_cost_sheet",
					args: { style: this.style.name, payload: JSON.stringify(this.collect_cost_payload($panels)) },
					callback: () => {
						frappe.call({
							method: "apparel_erp.product_development.doctype.style_cost_sheet.style_cost_sheet.approve_workspace_cost_sheet",
							args: { style: this.style.name },
							callback: (r) => {
								frappe.dom.unfreeze();
								this.workspace_cost = r.message;
								this.paint_costing_tab($(this.wrapper).find("#swPanels"));
								sw_toast(this.wrapper, "Costing submitted — awaiting approval.");
							},
							error: () => frappe.dom.unfreeze()
						});
					},
					error: () => frappe.dom.unfreeze()
				});
			});
		});
		$panels.find("#swFinalApproveCost").on("click", () => {
			frappe.confirm("Approve this submitted costing?", () => {
				frappe.dom.freeze("Approving costing…");
				frappe.call({
					method: "apparel_erp.product_development.doctype.style_cost_sheet.style_cost_sheet.approve_workspace_cost_sheet_final",
					args: { style: this.style.name },
					callback: (r) => {
						frappe.dom.unfreeze();
						this.workspace_cost = r.message;
						this.paint_costing_tab($(this.wrapper).find("#swPanels"));
						sw_toast(this.wrapper, "Costing approved.");
					},
					error: () => frappe.dom.unfreeze()
				});
			});
		});
		$panels.find("#swAmendCost").on("click", () => {
			frappe.confirm(
				"Start a new draft revision of this costing? The current revision stays as a permanent, read-only record.",
				() => {
					frappe.dom.freeze("Creating new revision…");
					frappe.call({
						method: "apparel_erp.product_development.doctype.style_cost_sheet.style_cost_sheet.amend_workspace_cost_sheet",
						args: { style: this.style.name },
						callback: (r) => {
							frappe.dom.unfreeze();
							this.workspace_cost = r.message;
							this.paint_costing_tab($(this.wrapper).find("#swPanels"));
							sw_toast(this.wrapper, "New draft revision created — edit and submit when ready.");
						},
						error: () => frappe.dom.unfreeze()
					});
				}
			);
		});
	}

	recalc_costing_preview($panels) {
		// Mirrors compute_cost_amounts() in style_cost_sheet.py exactly, so
		// what's shown here before Save matches what the server will store
		// after Save. fabric/trims stay fixed (they come from the Style
		// BOM, not from anything editable in this card); everything else
		// is read straight from the current inputs and extra item rows.
		const c = this.workspace_cost || {};
		const cur = c.currency === "USD" ? "$" : "₹";
		const fmt = (n) => cur + Number(n || 0).toFixed(2);

		const fabric = Number(c.fabric_amount) || 0;
		const trims = Number(c.trims_amount) || 0;
		const cmt = Number($panels.find("#swCmtRate").val()) || 0;
		const testing = Number($panels.find("#swTesting").val()) || 0;
		let extraTotal = 0;
		let extraCount = 0;
		$panels.find(".sw-extra-row").each((_, el) => {
			const $row = $(el);
			const label = ($row.find(".sw-extra-label").val() || "").trim();
			if (!label) return;
			extraCount++;
			extraTotal += Number($row.find(".sw-extra-amount").val()) || 0;
		});
		const overheadPct = Number($panels.find("#swOverheadPct").val()) || 0;
		const overhead = (fabric + trims + cmt + testing + extraTotal) * overheadPct / 100.0;
		const total = fabric + trims + cmt + testing + extraTotal + overhead;
		const margin = Number($panels.find("#swMarginPct").val()) || 0;
		const selling = margin < 100 ? total / (1 - margin / 100.0) : total;
		const target = Number($panels.find("#swBuyerTarget").val()) || 0;

		$panels.find("#swCmtAmount").text(fmt(cmt));
		$panels.find("#swTestingAmount").text(fmt(testing));
		$panels.find("#swExtraCount").text(extraCount);
		$panels.find("#swExtraTotalAmount").text(fmt(extraTotal));
		$panels.find("#swOverheadAmount").text(fmt(overhead));
		$panels.find("#swTotalCost").text(fmt(total));
		$panels.find("#swSellPrice").text(fmt(selling));
		$panels.find("#swGapWrap").html(gap_pill_html(fmt, selling, target));
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

	// ---------- Time & Action ----------
	render_tna_tab($panels) {
		$panels.html(`<div class="sw-loading">Loading time &amp; action…</div>`);
		frappe.call({
			method: "apparel_erp.product_development.doctype.style_tna.style_tna.get_workspace_tna",
			args: { style: this.style.name }
		}).then((r) => {
			this.workspace_tna = r.message || null;
			this.tna_count = this.workspace_tna ? (this.workspace_tna.activities || []).length : 0;
			$(this.wrapper).find(`#swTabs button[data-t="tna"] .sw-count`).remove();
			if (this.tna_count) {
				$(this.wrapper).find(`#swTabs button[data-t="tna"]`).append(`<span class="sw-count">${this.tna_count}</span>`);
			}
			this.paint_tna_tab($panels);
		});
	}

	paint_tna_tab($panels) {
		const t = this.workspace_tna;
		if (!t) {
			$panels.html(`
				<div class="sw-card">
					<div class="sw-card-b">
						<div class="sw-empty">No Time &amp; Action schedule yet for this style.</div>
						<button class="sw-btn sw-btn-pri sw-btn-sm" id="swCreateTna" style="margin-top:10px">Set up T&amp;A schedule</button>
					</div>
				</div>
			`);
			$panels.find("#swCreateTna").on("click", () => this.prompt_create_tna($panels));
			return;
		}

		const statusMap = {
			Done: ["pill-ok", "Done"],
			Late: ["pill-bad", "Late"],
			"At Risk": ["pill-warn", "At risk"],
			Open: ["pill-mut", "Open"]
		};

		const fmtDate = (d) => d ? frappe.datetime.str_to_user(d) : `<span class="sw-empty">—</span>`;

		const rows = t.activities || [];
		let lastGroup = null;
		let rowsHtml = "";
		rows.forEach((r) => {
			if (r.activity_group && r.activity_group !== lastGroup) {
				rowsHtml += `<tr class="sw-grp"><td colspan="8">${frappe.utils.escape_html(r.activity_group)}</td></tr>`;
				lastGroup = r.activity_group;
			}
			const [cls, lbl] = statusMap[r.status] || statusMap.Open;
			const vc = r.variance_days > 0 ? "var(--sw-bad)" : r.variance_days < 0 ? "var(--sw-ok)" : "var(--sw-ink-3)";
			rowsHtml += `
				<tr${r.status === "Late" ? ' style="background:var(--sw-bad-bg)"' : ""}>
					<td>${r.is_milestone ? '<span style="color:var(--sw-warn)">\u25c6</span> ' : ""}${frappe.utils.escape_html(r.activity || "")}</td>
					<td style="color:var(--sw-ink-2)">${frappe.utils.escape_html(r.responsible || "")}</td>
					<td>${fmtDate(r.plan_date)}</td>
					<td>${fmtDate(r.revised_date)}</td>
					<td>${fmtDate(r.actual_date)}</td>
					<td class="num" style="color:${vc}">${r.variance_days > 0 ? "+" : ""}${r.variance_days || 0}</td>
					<td><span class="pill ${cls}">${lbl}</span></td>
					<td><button class="sw-btn sw-btn-sm" data-name="${frappe.utils.escape_html(r.name)}" data-activity="${frappe.utils.escape_html(r.activity || "")}">View</button></td>
				</tr>`;
		});

		$panels.html(`
			<div class="sw-card">
				<div class="sw-card-b">
					<div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap">
						<div>
							<div style="font-size:15px;font-weight:600">${frappe.utils.escape_html(t.po_reference || "No PO reference")}${t.po_qty ? ` · ${Number(t.po_qty).toLocaleString()} pcs` : ""}${t.incoterm ? ` · ${frappe.utils.escape_html(t.incoterm)}` : ""}</div>
							<div style="color:var(--sw-ink-2);font-size:13px;margin-top:2px">${frappe.utils.escape_html(t.template || "")}</div>
						</div>
						<div style="text-align:right">
							<div style="font-size:12px;color:var(--sw-ink-2)">Ex-factory</div>
							<div style="font-size:16px;font-weight:600">${fmtDate(t.ex_factory_date)}</div>
						</div>
					</div>
				</div>
			</div>

			<div class="sw-grid3" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
				<div class="sw-kpi"><div class="lbl">Completed</div><div class="val">${t.kpis.completed}</div></div>
				<div class="sw-kpi"><div class="lbl">On track</div><div class="val">${t.kpis.on_track}</div></div>
				<div class="sw-kpi sw-kpi-warn"><div class="lbl">At risk</div><div class="val">${t.kpis.at_risk}</div></div>
				<div class="sw-kpi sw-kpi-bad"><div class="lbl">Delayed</div><div class="val">${t.kpis.delayed}</div></div>
			</div>

			${t.banner ? `<div class="sw-banner sw-banner-bad"><span>${frappe.utils.escape_html(t.banner)}</span></div>` : ""}

			<div class="sw-card">
				<div class="sw-card-h">
					<h2>Activities</h2>
					<div class="right">
						<button class="sw-btn sw-btn-sm" id="swAddTnaActivity">+ Add activity</button>
						<button class="sw-btn sw-btn-sm" id="swRescheduleTna">Reschedule</button>
					</div>
				</div>
				<table>
					<thead><tr><th style="width:28%">Activity</th><th style="width:12%">Owner</th><th style="width:11%">Plan</th><th style="width:11%">Revised</th><th style="width:11%">Actual</th><th class="num" style="width:8%">Var</th><th style="width:12%">Status</th><th style="width:6%"></th></tr></thead>
					<tbody>${rowsHtml || `<tr><td colspan="8" class="sw-empty">No activities yet.</td></tr>`}</tbody>
				</table>
			</div>
		`);
		this.bind_tna_tab($panels);
	}

	bind_tna_tab($panels) {
		$panels.find("#swAddTnaActivity").on("click", () => this.prompt_add_tna_activity($panels));
		$panels.find("#swRescheduleTna").on("click", () => {
			frappe.confirm(
				"Reschedule downstream activities based on the worst current delay?",
				() => {
					frappe.dom.freeze("Recalculating…");
					frappe.call({
						method: "apparel_erp.product_development.doctype.style_tna.style_tna.reschedule_workspace_tna",
						args: { style: this.style.name },
						callback: (r) => {
							frappe.dom.unfreeze();
							this.workspace_tna = r.message;
							this.paint_tna_tab($panels);
							const msg = r.message || {};
							sw_toast(this.wrapper, msg.shifted
								? `Shifted ${msg.shifted} activity(s) by ${msg.delay_days} day(s).`
								: "No active delay found — nothing to reschedule.");
						},
						error: () => frappe.dom.unfreeze()
					});
				}
			);
		});
		$panels.find("[data-name]").on("click", (e) => {
			const name = $(e.currentTarget).data("name");
			const activity = $(e.currentTarget).data("activity");
			const row = (this.workspace_tna.activities || []).find(r => r.name === name);
			if (!row) return;
			const d = new frappe.ui.Dialog({
				title: activity,
				fields: [
					{ fieldname: "info", fieldtype: "HTML" }
				],
				primary_action_label: row.actual_date ? "Close" : "Mark done today",
				primary_action: () => {
					if (row.actual_date) { d.hide(); return; }
					frappe.dom.freeze("Saving…");
					frappe.call({
						method: "apparel_erp.product_development.doctype.style_tna.style_tna.mark_tna_activity_actual",
						args: { style: this.style.name, activity_name: name },
						callback: (r) => {
							frappe.dom.unfreeze();
							d.hide();
							this.workspace_tna = r.message;
							this.paint_tna_tab($panels);
							sw_toast(this.wrapper, `${activity} marked done.`);
						},
						error: () => frappe.dom.unfreeze()
					});
				}
			});
			const fmtDate = (v) => v ? frappe.datetime.str_to_user(v) : "—";
			d.fields_dict.info.$wrapper.html(`
				<div class="attr"><span>Planned</span><span>${fmtDate(row.plan_date)}</span></div>
				<div class="attr"><span>Revised</span><span>${fmtDate(row.revised_date)}</span></div>
				<div class="attr"><span>Actual</span><span>${fmtDate(row.actual_date)}</span></div>
				<div class="attr"><span>Variance</span><span>${row.variance_days > 0 ? "+" : ""}${row.variance_days || 0} day(s)</span></div>
				${row.source_reference ? `<div class="attr"><span>Source</span><span class="mono">${frappe.utils.escape_html(row.source_reference)}</span></div>` : ""}
			`);
			d.show();
		});
	}

	prompt_create_tna($panels) {
		const d = new frappe.ui.Dialog({
			title: "Set up Time & Action schedule",
			fields: [
				{ fieldname: "po_reference", label: "Buyer PO", fieldtype: "Data" },
				{ fieldname: "po_qty", label: "PO Quantity", fieldtype: "Int" },
				{ fieldname: "incoterm", label: "Incoterm", fieldtype: "Data", default: "FOB" },
				{ fieldname: "template", label: "T&A Template", fieldtype: "Data" },
				{ fieldname: "ex_factory_date", label: "Ex-factory Date", fieldtype: "Date" }
			],
			primary_action_label: "Create",
			primary_action: (values) => {
				frappe.dom.freeze("Creating…");
				frappe.call({
					method: "apparel_erp.product_development.doctype.style_tna.style_tna.create_workspace_tna",
					args: { style: this.style.name, payload: JSON.stringify(values) },
					callback: (r) => {
						frappe.dom.unfreeze();
						d.hide();
						this.workspace_tna = r.message;
						this.paint_tna_tab($panels);
						sw_toast(this.wrapper, "Time & Action schedule created.");
					},
					error: () => frappe.dom.unfreeze()
				});
			}
		});
		d.show();
	}

	prompt_add_tna_activity($panels) {
		const d = new frappe.ui.Dialog({
			title: "Add activity",
			fields: [
				{ fieldname: "activity_group", label: "Group", fieldtype: "Data", description: "e.g. Fabric, Pre-production, Production and shipping" },
				{ fieldname: "activity", label: "Activity", fieldtype: "Data", reqd: 1 },
				{ fieldname: "responsible", label: "Owner", fieldtype: "Data" },
				{ fieldname: "plan_date", label: "Plan date", fieldtype: "Date", reqd: 1 },
				{ fieldname: "is_milestone", label: "Milestone", fieldtype: "Check" }
			],
			primary_action_label: "Add",
			primary_action: (values) => {
				const activities = (this.workspace_tna.activities || []).map(r => ({ ...r }));
				activities.push({
					activity_group: values.activity_group,
					activity: values.activity,
					responsible: values.responsible,
					plan_date: values.plan_date,
					revised_date: values.plan_date,
					is_milestone: values.is_milestone
				});
				frappe.dom.freeze("Saving…");
				frappe.call({
					method: "apparel_erp.product_development.doctype.style_tna.style_tna.save_workspace_tna",
					args: { style: this.style.name, payload: JSON.stringify({ activities }) },
					callback: (r) => {
						frappe.dom.unfreeze();
						d.hide();
						this.workspace_tna = r.message;
						this.tna_count = (this.workspace_tna.activities || []).length;
						this.paint_tna_tab($panels);
						sw_toast(this.wrapper, "Activity added.");
					},
					error: () => frappe.dom.unfreeze()
				});
			}
		});
		d.show();
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
		const trimRows = bomRows.filter(r => r.item_type === "Trim" || r.item_type === "Packaging" || r.item_type === "Packing");

		const bomEditable = !!(styleSnapshot && styleSnapshot.bom_editable);
		const fmtRate = (n) => (n != null && n !== "" ? Number(n).toFixed(2) : "");
		const rateCell = (r) => bomEditable
			? `<input class="sw-cell" data-rate-line="${frappe.utils.escape_html(r.line_id || "")}" type="number" step="0.01" min="0" value="${r.rate || 0}">`
			: fmtRate(r.rate);
		const fabricTbl = fabricRows.length
			? `<table><thead><tr><th>Item</th><th>Composition</th><th class="sw-num">GSM</th><th class="sw-num">Rate</th></tr></thead><tbody>
				${fabricRows.map(r => `<tr><td>${frappe.utils.escape_html(r.item_name || "")}</td><td>${frappe.utils.escape_html(r.composition || "")}</td><td class="sw-num">${frappe.utils.escape_html(r.gsm || "")}</td><td class="sw-num">${rateCell(r)}</td></tr>`).join("")}
			</tbody></table>`
			: `<div class="sw-empty">No Fabric rows on the Style BOM.</div>`;

		const trimTbl = trimRows.length
			? `<table><thead><tr><th>Trim</th><th>UOM</th><th class="sw-num">Base qty</th><th class="sw-num">Rate</th></tr></thead><tbody>
				${trimRows.map(r => `<tr><td>${frappe.utils.escape_html(r.item_name || "")}</td><td>${frappe.utils.escape_html(r.uom || "")}</td><td class="sw-num">${r.base_qty != null ? r.base_qty : ""}</td><td class="sw-num">${rateCell(r)}</td></tr>`).join("")}
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
						${this.generate_bom_button_html("Design & Tech Pack")}
						${this.generate_bom_hint_html("Design & Tech Pack")}
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
					<div class="sw-card-h"><h2>Fabric specification</h2>${bomEditable ? `<div class="sw-right"><button class="sw-btn sw-btn-sm sw-save-bom-rates">Save rates</button></div>` : ""}</div>
					${fabricTbl}
				</div>
				<div class="sw-card">
					<div class="sw-card-h"><h2>Trims &amp; accessories</h2>${bomEditable ? `<div class="sw-right"><button class="sw-btn sw-btn-sm sw-save-bom-rates">Save rates</button></div>` : ""}</div>
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
		this.bind_generate_bom_button($panels);
		$panels.find(".sw-save-bom-rates").on("click", () => this.save_bom_rates_from_techpack($panels));
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

	save_bom_rates_from_techpack($panels) {
		// Writes straight to the Style BOM lines via update_style_bom_rates
		// (same record the BOM tab edits), then re-renders this tab from a
		// fresh server fetch and refreshes any BOM/Costing data already
		// cached in memory - so a price typed here shows up immediately on
		// the other tabs too, not just after they happen to reload later.
		const rates = {};
		$panels.find("[data-rate-line]").each((_, el) => {
			const $el = $(el);
			const lineId = $el.data("rate-line");
			if (lineId) rates[lineId] = Number($el.val()) || 0;
		});
		if (!Object.keys(rates).length) return;

		frappe.dom.freeze("Saving rates…");
		frappe.call({
			method: "apparel_erp.product_development.doctype.style_bom.style_bom.update_style_bom_rates",
			args: { style: this.style.name, rates: JSON.stringify(rates) },
			callback: (r) => {
				frappe.dom.unfreeze();
				if (this.workspace_bom) this.workspace_bom = r.message;
				this.workspace_cost = null;
				this.render_techpack_tab($panels);
				sw_toast(this.wrapper, "Rates saved to the Style BOM.");
			},
			error: () => frappe.dom.unfreeze()
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

function sw_bom_rule(line) {
	if (line.varies_by_colour && line.varies_by_size) return { label: "Colour × size", cls: "sw-pill-warn" };
	if (line.varies_by_colour) return { label: "Colour", cls: "sw-pill-warn" };
	if (line.varies_by_size) return { label: "Size", cls: "sw-pill-warn" };
	return { label: "Common", cls: "sw-pill-ok" };
}

function sw_rule_to_flags(rule) {
	if (rule === "Colour × size") return { varies_by_colour: 1, varies_by_size: 1, resolution_rule: "Match garment colour" };
	if (rule === "Colour") return { varies_by_colour: 1, varies_by_size: 0, resolution_rule: "Match garment colour" };
	if (rule === "Size") return { varies_by_colour: 0, varies_by_size: 1, resolution_rule: "Match garment size" };
	return { varies_by_colour: 0, varies_by_size: 0, resolution_rule: "Fixed" };
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

function extraItemRowHtml(row, editable) {
	// row.name (a saved child row's docname) keys an existing row so a
	// remove click can target it precisely; a freshly-added blank row (no
	// name yet) gets a client-only key instead. Either way collect_cost_
	// payload just reads whatever rows are currently in the DOM.
	const key = row.name || row.key || ("new-" + frappe.utils.get_random(8));
	const label = row.label ? frappe.utils.escape_html(row.label) : "";
	const amount = row.amount != null ? row.amount : "";
	return `<div class="sw-extra-row" data-row-key="${key}" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
		<input type="text" class="sw-cell sw-extra-label" placeholder="e.g. Freight surcharge" value="${label}" style="flex:2" ${editable ? "" : "readonly"}>
		<input type="number" step="0.01" min="0" class="sw-cell sw-extra-amount" placeholder="0.00" value="${amount}" style="flex:1" ${editable ? "" : "readonly"}>
		${editable ? `<button type="button" class="sw-btn sw-btn-sm sw-extra-remove" title="Remove item">×</button>` : ""}
	</div>`;
}

function extraItemRows(items, editable) {
	const rows = items && items.length ? items : [];
	if (!rows.length) {
		return editable ? "" : `<div class="sw-empty">No extra items.</div>`;
	}
	return rows.map(r => extraItemRowHtml(r, editable)).join("");
}

function gap_pill_html(fmt, selling, target) {
	const gap = selling - target;
	return target
		? `<span class="pill ${gap <= 0 ? "pill-ok" : "pill-warn"}" id="swTargetGap">${fmt(Math.abs(gap))} ${gap >= 0 ? "above" : "below"}</span>`
		: `<span class="empty">No buyer target</span>`;
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
.sw-f{margin-bottom:13px}
.sw-f label{display:block;font-size:12px;color:var(--sw-ink-2);margin-bottom:4px}
.sw-f input,.sw-f select{width:100%;padding:7px 10px;border:1px solid var(--sw-line-2);border-radius:var(--sw-r-sm);background:#fff;font-size:13.5px}
.sw-f input:focus,.sw-f select:focus{border-color:var(--sw-accent);outline:none}
.sw-f input[readonly],.sw-f select:disabled{background:#F8FAFC;color:var(--sw-ink-2)}
.sw-cell{width:76px;padding:4px 6px;border:1px solid var(--sw-line-2);border-radius:4px;text-align:right;font:inherit}
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

/* Non-prefixed class names for prototype compatibility */
.pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:500}
.pill-ok{background:var(--sw-ok-bg);color:var(--sw-ok)}
.pill-warn{background:var(--sw-warn-bg);color:var(--sw-warn)}
.pill-info{background:var(--sw-accent-soft);color:var(--sw-accent)}
.pill-bad{background:var(--sw-bad-bg);color:var(--sw-bad)}
.pill-mut{background:#F1F5F9;color:var(--sw-ink-2)}
.sw-kpi{border:1px solid var(--sw-line);border-radius:var(--sw-r);padding:10px 14px;background:#fff}
.sw-kpi .lbl{font-size:11px;color:var(--sw-ink-2);text-transform:uppercase;letter-spacing:.3px}
.sw-kpi .val{font-size:20px;font-weight:600;margin-top:2px}
.sw-kpi-warn{background:var(--sw-warn-bg);border-color:#FDE68A}
.sw-kpi-warn .lbl,.sw-kpi-warn .val{color:var(--sw-warn)}
.sw-kpi-bad{background:var(--sw-bad-bg);border-color:#FCA5A5}
.sw-kpi-bad .lbl,.sw-kpi-bad .val{color:var(--sw-bad)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.empty{color:var(--sw-ink-3);font-size:12px}
.note{background:#F8FAFC;border:1px solid var(--sw-line);border-radius:var(--sw-r-sm);padding:9px 12px;font-size:12px;color:var(--sw-ink-2)}
.right{margin-left:auto;display:flex;gap:7px;align-items:center}
.card{background:var(--sw-card);border:1px solid var(--sw-line);border-radius:var(--sw-r);margin-bottom:14px}
.card-h{padding:11px 15px;border-bottom:1px solid var(--sw-line);display:flex;align-items:center;gap:10px}
.card-h h2{font-size:11.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--sw-ink-2);margin:0}
.card-b{padding:15px}
.f{margin-bottom:13px}
.f label{display:block;font-size:12px;color:var(--sw-ink-2);margin-bottom:4px}
.f input,.f select{width:100%;padding:7px 10px;border:1px solid var(--sw-line-2);border-radius:var(--sw-r-sm);background:#fff;font-size:13.5px}
.f input:focus,.f select:focus{border-color:var(--sw-accent);outline:none}
.f input[readonly],.f select:disabled{background:#F8FAFC;color:var(--sw-ink-2)}
.cell{width:76px;padding:4px 6px;border:1px solid var(--sw-line-2);border-radius:4px;text-align:right;font:inherit}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
@media(max-width:1000px){.grid2,.grid3{grid-template-columns:1fr}}
.attr{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--sw-line);font-size:13px}
.attr:last-child{border:none}
.attr span:first-child{color:var(--sw-ink-2)}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th{text-align:left;font-weight:500;color:var(--sw-ink-2);font-size:11.5px;padding:8px 12px;background:#F8FAFC;border-bottom:1px solid var(--sw-line)}
 td{padding:8px 12px;border-bottom:1px solid var(--sw-line)}
 tr:last-child td{border-bottom:none}
.grp td{background:#F8FAFC;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--sw-ink-2)}
.sw-banner{border-radius:var(--sw-r);padding:10px 14px;font-size:13px;margin-bottom:14px;display:flex;gap:9px;align-items:flex-start}
.sw-banner-bad{background:var(--sw-bad-bg);color:var(--sw-bad);border:1px solid #FCA5A5}
.sw-banner-ok{background:var(--sw-ok-bg);color:var(--sw-ok);border:1px solid #86EFAC}
.pill-ok{background:var(--sw-ok-bg);color:var(--sw-ok)}
.pill-warn{background:var(--sw-warn-bg);color:var(--sw-warn)}
.pill-mut{background:#F1F5F9;color:var(--sw-ink-2)}
.sell-price{color:var(--sw-ok)}
.gap-above{color:var(--sw-ok)}
.gap-below{color:var(--sw-warn)}
`