import argparse
import json
import sys
from pathlib import Path
import fitz

def main():
    parser = argparse.ArgumentParser(description="Profile PDF and detect if it is a scan, text, or mixed document.")
    parser.add_argument("pdf_path", type=str, help="Path to the PDF file")
    args = parser.parse_args()

    pdf_path = Path(args.pdf_path)
    if not pdf_path.exists():
        print(json.dumps({"error": f"File not found: {args.pdf_path}"}))
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {str(e)}"}))
        sys.exit(1)

    pages_info = []
    total_text_chars = 0
    total_text_blocks = 0
    total_text_lines = 0
    total_images = 0
    total_drawings = 0

    scan_pages_count = 0
    text_pages_count = 0
    page_count = len(doc)

    for i in range(page_count):
        page = doc[i]
        page_area = page.rect.width * page.rect.height
        
        # 1. Text info
        text = page.get_text("text").strip()
        text_chars = len(text)
        
        blocks = page.get_text("blocks")
        text_blocks = len([b for b in blocks if b[6] == 0]) # type 0 is text
        
        # count lines
        text_lines = 0
        for b in blocks:
            if b[6] == 0:
                text_lines += len(b[4].split('\n'))
                
        # 2. Image info
        image_list = page.get_images()
        image_count = len(image_list)
        
        max_image_coverage = 0.0
        # Method 1
        try:
            infos = page.get_image_info(xrefs=True)
            for info in infos:
                bbox = info.get("bbox")
                if bbox:
                    w = bbox[2] - bbox[0]
                    h = bbox[3] - bbox[1]
                    max_image_coverage = max(max_image_coverage, (w * h) / page_area)
        except Exception:
            pass
        # Method 2 fallback
        if max_image_coverage == 0.0:
            try:
                for img in image_list:
                    xref = img[0]
                    rects = page.get_image_rects(xref)
                    for r in rects:
                        w = r.x1 - r.x0
                        h = r.y1 - r.y0
                        max_image_coverage = max(max_image_coverage, (w * h) / page_area)
            except Exception:
                pass

        # 3. Drawings info
        try:
            drawings = page.get_drawings()
            drawing_count = len(drawings)
        except Exception:
            drawing_count = 0

        pages_info.append({
            "page": i + 1,
            "textChars": text_chars,
            "textBlocks": text_blocks,
            "textLines": text_lines,
            "imageCount": image_count,
            "maxImageCoverage": max_image_coverage,
            "drawingCount": drawing_count,
            "width": page.rect.width,
            "height": page.rect.height
        })

        total_text_chars += text_chars
        total_text_blocks += text_blocks
        total_text_lines += text_lines
        total_images += image_count
        total_drawings += drawing_count

        is_scan_page = (text_chars < 100) and (max_image_coverage >= 0.8)
        is_text_page = (text_chars >= 100) or (text_lines >= 5)

        if is_scan_page:
            scan_pages_count += 1
        elif is_text_page:
            text_pages_count += 1

    # Classify overall document
    scan_ratio = scan_pages_count / page_count if page_count > 0 else 0.0
    text_ratio = text_pages_count / page_count if page_count > 0 else 0.0

    if scan_ratio >= 0.8:
        content_mode = "scan"
        confidence = scan_ratio
        reason = f"At least 80% (actual {scan_ratio:.1%}) of pages are classified as scans (chars < 100 and image coverage >= 80%)."
    elif text_ratio >= 0.8:
        content_mode = "text"
        confidence = text_ratio
        reason = f"At least 80% (actual {text_ratio:.1%}) of pages are classified as text-based documents."
    else:
        content_mode = "mixed"
        confidence = 1.0 - abs(scan_ratio - text_ratio)
        reason = f"Mixed document (scan pages: {scan_ratio:.1%}, text pages: {text_ratio:.1%})."

    output = {
        "contentMode": content_mode,
        "confidence": confidence,
        "reason": reason,
        "fileSizeBytes": pdf_path.stat().st_size,
        "pageCount": page_count,
        "pages": pages_info,
        "summary": {
            "totalTextChars": total_text_chars,
            "totalTextBlocks": total_text_blocks,
            "totalTextLines": total_text_lines,
            "totalImages": total_images,
            "totalDrawings": total_drawings
        }
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
