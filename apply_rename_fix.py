#!/usr/bin/env python3
"""
Run from the repo root:
    python3 apply_rename_fix.py apparel_erp/product_development/doctype/style_bom/style_bom.py

Does an exact string replacement of _rename_to_production_name -- no diff/patch
context to get wrong. Exits non-zero and changes nothing if the old text
isn't found verbatim (so it's safe to re-run / won't silently no-op).
"""
import sys

OLD = 'def _rename_to_production_name(bom, new_name):\n\tif new_name == bom.name:\n\t\treturn bom\n\t# Every other write in this generation flow runs with\n\t# ignore_permissions=True (the user triggering "Generate" often has\n\t# create rights on Style BOM without also having direct write/rename\n\t# rights on ERPNext\'s core BOM doctype) - the rename step was the one\n\t# place that got missed, causing "You need write permission on BOM\n\t# ... to rename" even though the BOM had just been inserted fine.\n\tfrappe.rename_doc("BOM", bom.name, new_name, force=True)\n\treturn frappe.get_doc("BOM", new_name)\n'
NEW = 'def _rename_to_production_name(bom, new_name):\n\tif new_name == bom.name:\n\t\treturn bom\n\t# Every other write in this generation flow runs with\n\t# ignore_permissions=True (the user triggering "Generate" often has\n\t# create rights on Style BOM without also having direct write/rename\n\t# rights on ERPNext\'s core BOM doctype) - the rename step was the one\n\t# place that got missed, causing "You need write permission on BOM\n\t# ... to rename" even though the BOM had just been inserted fine.\n\t# frappe.rename_doc (this alias) is the *whitelisted* wrapper and does\n\t# not accept ignore_permissions on v16 - use the internal implementation.\n\tfrom frappe.model.rename_doc import rename_doc as _rename_doc_internal\n\n\texisting_status = frappe.db.get_value("BOM", new_name, "docstatus")\n\tif existing_status is not None:\n\t\t# Something already occupies new_name - don\'t let rename_doc treat\n\t\t# this as a merge; that path checks write permission on the target\n\t\t# doc regardless of ignore_permissions (frappe/frappe#28595).\n\t\tif existing_status == 0:\n\t\t\tfrappe.delete_doc("BOM", new_name, force=True, ignore_permissions=True)\n\t\telse:\n\t\t\tfrappe.delete_doc("BOM", bom.name, force=True, ignore_permissions=True)\n\t\t\treturn frappe.get_doc("BOM", new_name)\n\n\t_rename_doc_internal(\n\t\t"BOM", bom.name, new_name, force=True, ignore_permissions=True,\n\t\tshow_alert=False, rebuild_search=False,\n\t)\n\treturn frappe.get_doc("BOM", new_name)\n'

def main():
    if len(sys.argv) != 2:
        print("usage: apply_rename_fix.py <path to style_bom.py>")
        sys.exit(1)
    path = sys.argv[1]
    with open(path, "r") as f:
        content = f.read()
    if OLD not in content:
        print("ERROR: expected old function text not found verbatim in", path)
        print("File may already be patched, or has diverged further. No changes made.")
        sys.exit(2)
    if content.count(OLD) > 1:
        print("ERROR: old function text matched more than once - refusing to guess. No changes made.")
        sys.exit(3)
    content = content.replace(OLD, NEW)
    with open(path, "w") as f:
        f.write(content)
    print("Patched:", path)

if __name__ == "__main__":
    main()
