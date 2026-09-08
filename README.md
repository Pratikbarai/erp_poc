# Apparel ERP - Product Development (Frappe v16)

Custom Frappe v16 app implementing an Apparel PLM flow:

- **Style** - master style record (Style Information / Colours & Sizes / Style BOM / Matrix / REST API tabs)
- **Design Tech Pack** - linked 1:1 to a Style; every common field (Style No, Name, Customer,
  Designer, Colours, Sizes, BOM/Trims, key attributes, image) is fetched read-only from the Style,
  so nothing is re-typed. Adds Design Sketch, Measurements (S/M/L/XL pivot grid), Construction
  Details, Reference Images, Attachments, Activity Log, Next Action (assign + Send for Sampling).
- **Size** - master list (S, M, L, XL...) with a `size_code` used to build SKUs
- Child tables: `Style Colour`, `Style Size` (also the source of the Sizes `Table MultiSelect`),
  `Style BOM Item`, `Style Matrix Item`, `Tech Pack Measurement`, `Tech Pack Reference Image`,
  `Tech Pack Attachment`

## What it does

1. **Multi-select sizes -> size table -> matrix.** The `sizes` field on Style is a `Table
   MultiSelect` against `Style Size` - picking sizes *is* the size table. On save,
   `Style.validate()` creates one placeholder row per active Colour x Size combination in
   `matrix_items`.
2. **Click a matrix cell -> generate SKU + BOM -> redirect.** The Matrix tab renders an HTML
   grid (`style.js -> render_matrix`). Clicking an ungenerated cell calls the whitelisted
   `apparel_erp.product_development.doctype.style.style.generate_sku`, which creates an `Item`
   (SKU = `STYLE_NO-COLOUR_CODE-SIZE_CODE`) with the style image attached, builds a base `BOM`
   from the Style's BOM table, links both back on the matrix row, then redirects straight into
   the new `Item` form.
3. **Image preview, not a link.** `style_image` (and the generated Item's `image`) use
   `Attach Image`, which previews inline in Frappe by default, and is set as each doctype's
   `image_field`.
4. **REST API tab** on Style shows the live `/api/resource/Style/<name>` endpoint, a ready-to-use
   cURL example, and the CRUD + `generate_sku` method URLs, with a Copy button.
5. **Design Tech Pack** pulls Colourways / Size Range / Fabric & Trims live from the linked
   Style (`get_style_snapshot`) rather than duplicating the data - edit them once, on the Style.
   A stage tab strip (Style Overview / Design & Tech Pack / BOM / Samples / ...) mirrors the
   original design; only the first two are wired up, the rest are placeholders you can build the
   same way.
6. **Development Workflow stepper** on the Style (`development_stage` field + a clickable bubble
   stepper: Style Created -> Design & Tech Pack -> Sampling -> Fit Approval -> Proto Approval ->
   Production). Advances automatically when a Design Tech Pack is created and when it's sent for
   sampling; any stage can also be set manually by clicking its bubble.
7. **Style image gallery** - a compact thumbnail strip under the main Style Image. Click a
   thumbnail to make it the main image, use the `+` tile to upload more, backed by the
   `Style Gallery Image` child table.
8. **Size Chart** - attach a PDF/image on the Style (`size_chart`); a "Size Chart" button appears
   next to the Size Range on both the Style and the Design Tech Pack (fetched read-only there too).
9. **Real Activity Log** on Design Tech Pack - `get_activity_feed` merges user Comments with a
   plain-English reading of Frappe's own Version log (field changes, rows added/removed), so
   "Updated Measurements", "Set Front Sketch" etc. show up automatically, not just manual notes.
10. **Attachments as cards** - a custom grid with a file-type icon, name, size and a remove button
    per file (backed by `Tech Pack Attachment`, extended with `file_type`/`file_size`), plus an
    "Add File" tile using Frappe's native uploader.
11. **Status dropdown** - "Mark as Completed" is the primary action; a "Set Status" button group
    next to it lets you jump straight to any status (Style: Draft/Active/On Hold/Discontinued,
    Tech Pack: Not Started/In Progress/Completed).
12. **Print Format** - a ready-to-use "Tech Pack Sheet" Jinja print format ships as a fixture
    (`fixtures/print_format.json`) and installs automatically on `bench migrate`, so "Preview
    Tech Pack (PDF)" renders a real formatted sheet (header, sketch, measurements, construction,
    reference images) instead of Frappe's generic default layout.

## Repo layout

```
apparel_erp/                      <- repo root (this is what you push to GitHub)
  apparel_erp/                    <- python module
    hooks.py
    modules.txt
    product_development/
      doctype/
        size/
        style/
        style_colour/
        style_size/
        style_matrix_item/
        style_bom_item/
        design_tech_pack/
        tech_pack_measurement/
        tech_pack_reference_image/
        tech_pack_attachment/
  pyproject.toml
  setup.py
  requirements.txt
  license.txt
  README.md
```

## Deploy via GitHub

### 1. Push this code to a GitHub repo

```bash
cd apparel_erp                 # the folder containing pyproject.toml / setup.py
git init
git add .
git commit -m "Initial commit: Apparel ERP Product Development app"
git branch -M main
git remote add origin https://github.com/<your-org>/apparel_erp.git
git push -u origin main
```

### 2. Install it on your bench from GitHub

```bash
# from your frappe-bench directory
bench get-app apparel_erp https://github.com/<your-org>/apparel_erp.git

bench --site your-site.local install-app apparel_erp
bench --site your-site.local migrate
bench build --app apparel_erp     # bundles style.js / design_tech_pack.js
bench restart                     # or: bench start, if running in dev mode
```

If the repo is private, either use an SSH remote
(`git@github.com:<your-org>/apparel_erp.git`) with a deploy key on the bench server, or a
personal access token in the HTTPS URL
(`https://<token>@github.com/<your-org>/apparel_erp.git`).

To pin a branch/tag: `bench get-app apparel_erp https://github.com/<your-org>/apparel_erp.git --branch main`

### 3. First-time setup in the app

1. Create a few `Size` records (S / M / L / XL ...) with `size_code`.
2. Create a `Style`: fill Style Information, add Colours (with `colour_code` + swatch), pick
   Sizes, add BOM lines (Fabric/Trim/Packaging), Save.
3. Open the **Matrix** tab, click a cell -> SKU (`Item`) + `BOM` are created, you're redirected
   into the Item.
4. From the Style form, click **Design & Tech Pack** to create/open its linked tech pack. Fill
   in the sketch, measurements, construction details, reference images, attachments - the header
   fields are already populated from the Style.
5. Use **Send for Sampling** / **Mark as Completed** to move it along, and **Preview Tech Pack
   (PDF)** once you've set up a Print Format for `Design Tech Pack`.

## Updating after a git push

```bash
bench get-app apparel_erp --branch main   # re-pulls latest from GitHub
bench --site your-site.local migrate
bench build --app apparel_erp
bench restart
```

## Known simplifications / next steps

Everything shown on the **Style Overview** and **Design & Tech Pack** screens is now implemented.
What's intentionally still out of scope (these are separate future screens, not part of either
of these two pages):

- The BOM/Samples/Costing/Fit Approval/Proto Approval/Production tabs on the Design Tech Pack's
  stage strip are stubbed as disabled placeholders - each would be its own doctype following the
  same "fetch common data from Style, add stage-specific fields" pattern used here.
- `generate_sku()` auto-creates simple placeholder component Items for any Fabric/Trim/Packaging
  BOM line not yet linked to a real raw-material Item (via `raw_material` on `Style BOM Item`) -
  link real items there for accurate costing before using the generated BOMs in production.
- The rest of the app's left sidebar (Dashboard, Samples, BOM, Costing, Purchasing, Inventory,
  Sales, Production, Quality, Reports as full modules) isn't built - only Product Development ->
  Styles exists.
