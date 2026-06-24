#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
import fitz

def main():
    parser = argparse.ArgumentParser(description="Crop and render PDF page coordinates to PNG review figures.")
    parser.add_argument("--pdf", required=True, help="Path to input PDF file")
    parser.add_argument("--crops-json-file", required=True, help="Path to JSON file containing crops config")
    parser.add_argument("--dpi", type=int, default=180, help="DPI for rendering clip")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    json_path = Path(args.crops_json_file)

    if not pdf_path.exists():
        print(json.dumps({"error": f"PDF file not found: {args.pdf}"}))
        sys.exit(1)
    if not json_path.exists():
        print(json.dumps({"error": f"JSON crops file not found: {args.crops_json_file}"}))
        sys.exit(1)

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            crops = json.load(f)
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse JSON crops: {str(e)}"}))
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {str(e)}"}))
        sys.exit(1)

    zoom = args.dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    results = []

    for crop in crops:
        crop_id = crop.get("id")
        page_num = int(crop.get("page", 1))
        bbox = crop.get("bbox", {})
        output_path = Path(crop.get("output_path"))

        if page_num < 1 or page_num > len(doc):
            results.append({"id": crop_id, "error": f"Page number {page_num} out of range [1, {len(doc)}]"})
            continue

        try:
            page = doc[page_num - 1]
            w_pdf = page.rect.width
            h_pdf = page.rect.height

            # Support normalized coordinates in 0-1 range
            x0 = float(bbox.get("x", bbox.get("x0", 0.0))) * w_pdf
            y0 = float(bbox.get("y", bbox.get("y0", 0.0))) * h_pdf
            w_seg = float(bbox.get("width", bbox.get("w", bbox.get("x1", 0.0) - bbox.get("x0", 0.0)))) * w_pdf
            h_seg = float(bbox.get("height", bbox.get("h", bbox.get("y1", 0.0) - bbox.get("y0", 0.0)))) * h_pdf
            x1 = x0 + w_seg
            y1 = y0 + h_seg

            # Add safety margin (4pt) and constrain to page bounds
            clip = fitz.Rect(
                max(0.0, x0 - 4.0),
                max(0.0, y0 - 4.0),
                min(w_pdf, x1 + 4.0),
                min(h_pdf, y1 + 4.0)
            )

            output_path.parent.mkdir(parents=True, exist_ok=True)
            pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
            pix.save(str(output_path))
            results.append({"id": crop_id, "status": "success"})
        except Exception as e:
            results.append({"id": crop_id, "error": str(e)})

    doc.close()
    print(json.dumps({"results": results}))

if __name__ == "__main__":
    main()
