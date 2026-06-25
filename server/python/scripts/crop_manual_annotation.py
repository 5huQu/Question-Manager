import argparse
import json
import sys
from pathlib import Path
import fitz

def _stitch_pixmaps(pixmaps: list[fitz.Pixmap]) -> fitz.Pixmap:
    width = max(pixmap.width for pixmap in pixmaps)
    height = sum(pixmap.height for pixmap in pixmaps)
    temp_doc = fitz.open()
    page = temp_doc.new_page(width=width, height=height)

    cursor_y = 0.0
    for pixmap in pixmaps:
        page.insert_image(
            fitz.Rect(0.0, cursor_y, pixmap.width, cursor_y + pixmap.height),
            pixmap=pixmap,
        )
        cursor_y += pixmap.height

    stitched = page.get_pixmap(alpha=False)
    temp_doc.close()
    return stitched

def main():
    parser = argparse.ArgumentParser(description="Crop and stitch manual PDF annotations.")
    parser.add_argument("--pdf", type=str, required=True, help="Path to input PDF file")
    parser.add_argument("--regions-json-file", type=str, required=True, help="Path to JSON file containing regions list")
    parser.add_argument("--output-dir", type=str, required=True, help="Directory to save cropped PNGs")
    parser.add_argument("--dpi", type=int, default=180, help="DPI for rendering clip (default: 180)")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    json_path = Path(args.regions_json_file)
    output_dir = Path(args.output_dir)

    if not pdf_path.exists():
        print(json.dumps({"error": f"PDF file not found: {args.pdf}"}))
        sys.exit(1)
    if not json_path.exists():
        print(json.dumps({"error": f"JSON file not found: {args.regions_json_file}"}))
        sys.exit(1)

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            regions = json.load(f)
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse JSON regions: {str(e)}"}))
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {str(e)}"}))
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    zoom = args.dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    results = []

    for region in regions:
        region_id = region.get("id")
        kind = region.get("kind")
        q_key = region.get("question_key")
        segments = region.get("segments", [])

        if not segments:
            continue

        pixmaps = []
        cropped_segments = []

        try:
            for seg in segments:
                page_num = int(seg.get("page", 1))
                if page_num < 1 or page_num > len(doc):
                    continue

                page = doc[page_num - 1]
                w_pdf = page.rect.width
                h_pdf = page.rect.height

                # Convert normalized to absolute PDF points
                x0 = float(seg.get("x", 0.0)) * w_pdf
                y0 = float(seg.get("y", 0.0)) * h_pdf
                w_seg = float(seg.get("width", 0.0)) * w_pdf
                h_seg = float(seg.get("height", 0.0)) * h_pdf
                x1 = x0 + w_seg
                y1 = y0 + h_seg

                # Add safety padding (4pt) and constrain to page rect
                clip = fitz.Rect(
                    max(0.0, x0 - 4.0),
                    max(0.0, y0 - 4.0),
                    min(w_pdf, x1 + 4.0),
                    min(h_pdf, y1 + 4.0)
                )
                if clip.x1 <= clip.x0 or clip.y1 <= clip.y0:
                    raise ValueError(
                        f"Invalid crop rectangle on page {page_num}: "
                        f"x={seg.get('x')}, y={seg.get('y')}, "
                        f"width={seg.get('width')}, height={seg.get('height')}"
                    )

                # Store absolute bounding box for reference
                cropped_segments.append({
                    "page": page_num,
                    "bbox": [clip.x0, clip.y0, clip.x1, clip.y1]
                })

                pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
                pixmaps.append(pix)

            if not pixmaps:
                continue

            # Stitch if multiple segments
            if len(pixmaps) == 1:
                final_pix = pixmaps[0]
            else:
                final_pix = _stitch_pixmaps(pixmaps)

            # Generate filename
            if kind == "question":
                filename = f"question_{q_key}_{region_id}.png"
            elif kind == "solution":
                filename = f"solution_{q_key}_{region_id}.png"
            else:
                filename = f"shared_answer_{q_key}_{region_id}.png"

            dest_path = output_dir / filename
            final_pix.save(str(dest_path))

            # Calculate overall bbox (union of all segments, or first segment as bounding box)
            # In manual annotation, we save segments to segments_json, and use a bounding box representation for backwards compatibility.
            # We can calculate union bbox of absolute coords if on the same page.
            first_bbox = cropped_segments[0]["bbox"] if cropped_segments else [0.0, 0.0, 0.0, 0.0]

            results.append({
                "regionId": region_id,
                "kind": kind,
                "questionKey": q_key,
                "imagePath": str(dest_path),
                "segments": cropped_segments,
                "firstBbox": first_bbox
            })

        except Exception as e:
            # We skip failed regions but log them inside error
            results.append({
                "regionId": region_id,
                "error": str(e)
            })

    doc.close()
    print(json.dumps({"results": results}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
