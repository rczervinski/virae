#!/usr/bin/env python3
"""
Module A - The Detective
Extracts text with full font metadata from a PDF using PyMuPDF (fitz).
Returns JSON with per-page text blocks including font_name, font_size, color, coordinates.
"""

import sys
import json
import fitz  # PyMuPDF


def extract_fonts_info(doc):
    """Extract embedded font names from the document."""
    fonts = set()
    for page_num in range(doc.page_count):
        page = doc[page_num]
        font_list = page.get_fonts(full=True)
        for f in font_list:
            # f = (xref, ext, type, basefont, name, encoding, ...)
            if f[3]:
                fonts.add(f[3])
    return list(fonts)


def color_to_hex(color_int):
    """Convert a fitz color integer to hex string."""
    if color_int is None:
        return "#000000"
    if isinstance(color_int, (list, tuple)):
        if len(color_int) == 3:
            r, g, b = color_int
            return "#{:02x}{:02x}{:02x}".format(
                int(r * 255), int(g * 255), int(b * 255)
            )
        return "#000000"
    return "#000000"


def extract_page(page, page_num):
    """Extract text blocks with font metadata from a single page."""
    blocks = []
    text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)

    page_width = page.rect.width
    page_height = page.rect.height

    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:  # text block only
            continue

        for line in block.get("lines", []):
            line_spans = []
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text.strip():
                    continue

                font_name = span.get("font", "Helvetica")
                font_size = round(span.get("size", 12), 2)
                color_int = span.get("color", 0)

                # Convert color integer to hex
                if isinstance(color_int, int):
                    r = (color_int >> 16) & 0xFF
                    g = (color_int >> 8) & 0xFF
                    b = color_int & 0xFF
                    color_hex = "#{:02x}{:02x}{:02x}".format(r, g, b)
                else:
                    color_hex = "#000000"

                bbox = span.get("bbox", [0, 0, 0, 0])
                origin = span.get("origin", [bbox[0], bbox[3]])

                flags = span.get("flags", 0)
                is_bold = bool(flags & 2**4)  # bit 4 = bold
                is_italic = bool(flags & 2**1)  # bit 1 = italic

                line_spans.append({
                    "text": text,
                    "font_name": font_name,
                    "font_size": font_size,
                    "color": color_hex,
                    "bold": is_bold,
                    "italic": is_italic,
                    "x": round(bbox[0], 2),
                    "y": round(bbox[1], 2),
                    "x2": round(bbox[2], 2),
                    "y2": round(bbox[3], 2),
                    "origin_x": round(origin[0], 2),
                    "origin_y": round(origin[1], 2),
                    "width": round(bbox[2] - bbox[0], 2),
                    "height": round(bbox[3] - bbox[1], 2),
                })

            if line_spans:
                # Group spans into a line block
                line_x = min(s["x"] for s in line_spans)
                line_y = min(s["y"] for s in line_spans)
                line_x2 = max(s["x2"] for s in line_spans)
                line_y2 = max(s["y2"] for s in line_spans)
                line_text = "".join(s["text"] for s in line_spans)

                # Use the dominant span's font info
                dominant = max(line_spans, key=lambda s: len(s["text"]))

                blocks.append({
                    "text": line_text,
                    "spans": line_spans,
                    "font_name": dominant["font_name"],
                    "font_size": dominant["font_size"],
                    "color": dominant["color"],
                    "bold": dominant["bold"],
                    "italic": dominant["italic"],
                    "x": round(line_x, 2),
                    "y": round(line_y, 2),
                    "width": round(line_x2 - line_x, 2),
                    "height": round(line_y2 - line_y, 2),
                    "origin_x": dominant["origin_x"],
                    "origin_y": dominant["origin_y"],
                })

    return {
        "pageNum": page_num + 1,
        "width": round(page_width, 2),
        "height": round(page_height, 2),
        "blocks": blocks,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pdf_extract.py <pdf_path>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {str(e)}"}))
        sys.exit(1)

    result = {
        "pageCount": doc.page_count,
        "fonts": extract_fonts_info(doc),
        "pages": [],
    }

    for i in range(doc.page_count):
        page = doc[i]
        page_data = extract_page(page, i)
        result["pages"].append(page_data)

    doc.close()
    print(json.dumps(result))


if __name__ == "__main__":
    main()
