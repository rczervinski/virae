#!/usr/bin/env python3
"""
Module C - The Assembler
Applies edits to a PDF using PyMuPDF with proper redaction and font preservation.
Reads JSON changes from stdin, applies them to the PDF, outputs to a new file.
"""

import sys
import json
import fitz  # PyMuPDF


def find_best_font(page, target_font_name):
    """Find the closest matching font available in the page."""
    # Get fonts used on this page
    page_fonts = page.get_fonts(full=True)
    font_names = [f[3] for f in page_fonts if f[3]]

    # Try exact match first
    for name in font_names:
        if name.lower() == target_font_name.lower():
            return name

    # Try partial match
    target_lower = target_font_name.lower()
    for name in font_names:
        if target_lower in name.lower() or name.lower() in target_lower:
            return name

    # Fallback mapping
    fallback_map = {
        "arial": "helv",
        "helvetica": "helv",
        "times": "tiro",
        "times new roman": "tiro",
        "courier": "cour",
        "courier new": "cour",
    }

    for key, val in fallback_map.items():
        if key in target_lower:
            return val

    return "helv"  # Default fallback


def hex_to_rgb(hex_color):
    """Convert hex color string to RGB tuple (0-1 range)."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return (0, 0, 0)
    r = int(hex_color[0:2], 16) / 255
    g = int(hex_color[2:4], 16) / 255
    b = int(hex_color[4:6], 16) / 255
    return (r, g, b)


def apply_modification(page, mod):
    """Apply a text modification (redact original + insert new text)."""
    x = mod["x"]
    y = mod["y"]
    width = mod.get("width", 200)
    height = mod.get("height", mod.get("fontSize", 12) * 1.4)

    # Create redaction rectangle with padding
    padding = 2
    rect = fitz.Rect(
        x - padding,
        y - padding,
        x + width + padding,
        y + height + padding,
    )

    # Add redaction annotation (white fill)
    page.add_redact_annot(rect, fill=(1, 1, 1))

    return {
        "text": mod.get("newText", ""),
        "x": x,
        "y": y,
        "height": height,
        "fontSize": mod.get("fontSize", 12),
        "fontName": mod.get("fontName", "helv"),
        "fontWeight": mod.get("fontWeight", "normal"),
        "color": mod.get("color", "#000000"),
    }


def apply_addition(page, add):
    """Prepare a text addition."""
    return {
        "text": add.get("text", ""),
        "x": add.get("x", 0),
        "y": add.get("y", 0),
        "fontSize": add.get("fontSize", 16),
        "fontName": add.get("fontName", "helv"),
        "fontWeight": add.get("fontWeight", "normal"),
        "color": add.get("color", "#000000"),
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: pdf_save.py <input_pdf> <output_pdf>"}))
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    # Read changes from stdin
    try:
        changes_json = sys.stdin.read()
        changes = json.loads(changes_json)
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse changes JSON: {str(e)}"}))
        sys.exit(1)

    try:
        doc = fitz.open(input_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {str(e)}"}))
        sys.exit(1)

    try:
        for change in changes:
            page_num = change.get("pageNum", 1) - 1  # 0-indexed
            if page_num < 0 or page_num >= doc.page_count:
                continue

            page = doc[page_num]
            texts_to_insert = []

            # Process modifications (redact + re-insert)
            for mod in change.get("modifications", []):
                text_info = apply_modification(page, mod)
                if text_info["text"].strip():
                    texts_to_insert.append(text_info)

            # Apply all redactions for this page at once
            page.apply_redactions()

            # Now insert text (modifications and additions)
            for mod_text in texts_to_insert:
                text = mod_text["text"]
                font_size = mod_text["fontSize"]
                font_name = find_best_font(page, mod_text["fontName"])
                color = hex_to_rgb(mod_text["color"])

                # Calculate insertion point (PyMuPDF uses top-left coords for text)
                # origin_y from extraction is the baseline, but for modifications
                # we use the bbox top-left y, so we need to offset to baseline
                insert_y = mod_text["y"] + font_size
                insert_x = mod_text["x"]

                lines = text.split("\n")
                for i, line in enumerate(lines):
                    if not line:
                        continue
                    y_pos = insert_y + (i * font_size * 1.3)

                    try:
                        page.insert_text(
                            fitz.Point(insert_x, y_pos),
                            line,
                            fontname=font_name,
                            fontsize=font_size,
                            color=color,
                        )
                    except Exception:
                        # Fallback to helv if font fails
                        page.insert_text(
                            fitz.Point(insert_x, y_pos),
                            line,
                            fontname="helv",
                            fontsize=font_size,
                            color=color,
                        )

            # Process additions
            for add in change.get("additions", []):
                add_info = apply_addition(page, add)
                text = add_info["text"]
                if not text.strip():
                    continue

                font_size = add_info["fontSize"]
                font_name = find_best_font(page, add_info["fontName"])
                color = hex_to_rgb(add_info["color"])

                # For additions, y is in PDF coordinates (bottom-up)
                # PyMuPDF insert_text uses top-down coordinates
                page_height = page.rect.height
                insert_x = add_info["x"]
                insert_y = page_height - add_info["y"] + font_size

                lines = text.split("\n")
                for i, line in enumerate(lines):
                    if not line:
                        continue
                    y_pos = insert_y + (i * font_size * 1.3)

                    try:
                        page.insert_text(
                            fitz.Point(insert_x, y_pos),
                            line,
                            fontname=font_name,
                            fontsize=font_size,
                            color=color,
                        )
                    except Exception:
                        page.insert_text(
                            fitz.Point(insert_x, y_pos),
                            line,
                            fontname="helv",
                            fontsize=font_size,
                            color=color,
                        )

        # Save the modified PDF
        doc.save(output_path, garbage=4, deflate=True)
        doc.close()

        print(json.dumps({"success": True, "output": output_path}))

    except Exception as e:
        doc.close()
        print(json.dumps({"error": f"Failed to apply changes: {str(e)}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
