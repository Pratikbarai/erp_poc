frappe.ui.form.on("Style Cost Sheet", {
	refresh(frm) {
		if (frm.doc.style) {
			frm.add_custom_button(__("Open Style Workspace"), () => {
				frappe.set_route("style-workspace", frm.doc.style);
			});
		}
	}
});
