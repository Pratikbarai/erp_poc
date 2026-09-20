#!/usr/bin/env python3
"""
Run from the repo root:
    python3 apply_submit_permission_fix.py apparel_erp/product_development/doctype/style_bom/style_bom.py

Exact string replacement (no diff/patch context), applied in two passes:
  1. the "existing submitted BOM" early-return branch
  2. the main post-rename return
Exits non-zero and changes nothing (for a given pass) if the expected old
text isn't found verbatim in the file - safe to re-run.
"""
import sys

PASSES = [
    ('\t\telse:\n\t\t\tfrappe.delete_doc("BOM", bom.name, force=True, ignore_permissions=True)\n\t\t\treturn frappe.get_doc("BOM", new_name)\n', '\t\telse:\n\t\t\tfrappe.delete_doc("BOM", bom.name, force=True, ignore_permissions=True)\n\t\t\texisting_bom = frappe.get_doc("BOM", new_name)\n\t\t\texisting_bom.flags.ignore_permissions = True\n\t\t\treturn existing_bom\n'),
    ('\t_rename_doc_internal(\n\t\t"BOM", bom.name, new_name, force=True, ignore_permissions=True,\n\t\tshow_alert=False, rebuild_search=False,\n\t)\n\treturn frappe.get_doc("BOM", new_name)\n', '\t_rename_doc_internal(\n\t\t"BOM", bom.name, new_name, force=True, ignore_permissions=True,\n\t\tshow_alert=False, rebuild_search=False,\n\t)\n\t# frappe.get_doc fetches a brand-new Document object, which does not carry\n\t# over bom.flags.ignore_permissions from the original insert() call. If a\n\t# caller submits this returned doc, .submit() has no ignore_permissions\n\t# kwarg of its own - it only respects the flag - so without this, submit\n\t# fails with "No permission for BOM" even though insert succeeded fine.\n\tnew_bom = frappe.get_doc("BOM", new_name)\n\tnew_bom.flags.ignore_permissions = True\n\treturn new_bom\n'),

]

def main():
    if len(sys.argv) != 2:
        print("usage: apply_submit_permission_fix.py <path to style_bom.py>")
        sys.exit(1)
    path = sys.argv[1]
    with open(path, "r") as f:
        content = f.read()

    changed = False
    for i, (old, new) in enumerate(PASSES, 1):
        if old not in content:
            print(f"pass {i}: old text not found verbatim - skipping (already applied, or file diverged)")
            continue
        if content.count(old) > 1:
            print(f"pass {i}: old text matched more than once - refusing to guess, skipping")
            continue
        content = content.replace(old, new)
        changed = True
        print(f"pass {i}: applied")

    if not changed:
        print("No changes made.")
        sys.exit(2)

    with open(path, "w") as f:
        f.write(content)
    print("Patched:", path)

if __name__ == "__main__":
    main()
