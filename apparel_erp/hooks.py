app_name = "apparel_erp"
app_title = "Apparel ERP"
app_publisher = "Your Company"
app_description = "Apparel PLM - Styles, Colour x Size matrix, auto SKU + BOM generation, Design & Tech Pack"
app_email = "admin@example.com"
app_license = "MIT"
app_version = "0.0.1"
required_apps = ["frappe"]

# Light navy/blue theming applied to standard desk forms (Style, Design Tech Pack, etc.)
app_include_css = "/assets/apparel_erp/css/apparel_theme.css"

# Doctype JS injected into forms
doctype_js = {
    "Style": "apparel_erp/product_development/doctype/style/style.js",
    "Design Tech Pack": "apparel_erp/product_development/doctype/design_tech_pack/design_tech_pack.js",
    "Style BOM": "apparel_erp/product_development/doctype/style_bom/style_bom.js"
}

# Data records shipped with the app - installed/updated on `bench migrate`
fixtures = [
    {"doctype": "Print Format", "filters": [["name", "=", "Tech Pack Sheet"]]},
    {"doctype": "Custom Field", "filters": [["dt", "=", "BOM"], ["fieldname", "in", ["custom_style", "custom_style_bom", "custom_style_bom_version", "custom_colourway"]]]}
]

# Generated BOMs are read-only forever (spec section 7.1). Enforced here at
# the permission layer, not just by hiding the edit button in the UI - a
# merchandiser editing a generated BOM directly is exactly the
# sixteen-copies problem the whole model exists to avoid. The generator
# itself sets frappe.flags.in_style_bom_generation while it builds/submits,
# so this only blocks *manual* edits after the fact.
doc_events = {
    "BOM": {
        "validate": "apparel_erp.product_development.doctype.style_bom.style_bom.guard_generated_bom_readonly"
    }
}

