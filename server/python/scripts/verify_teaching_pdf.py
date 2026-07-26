#!/usr/bin/env python3
"""
Verify a Chromium-generated PDF for TeachingDocument export.

Usage:
    python3 verify_teaching_pdf.py <pdf_path> [--expected-pages N]

Checks:
- File exists and size > minimum
- PDF can be opened
- Page count matches expected (if provided)
- Each page is A4 (within tolerance)
- No trailing blank pages (heuristic: very low text + no images)
- Each page is readable

Exit codes:
    0 = all checks passed
    1 = verification failed (details in JSON stdout)
    2 = usage error
"""
import json
import os
import sys

MIN_FILE_SIZE = 1024  # bytes
A4_WIDTH_PT = 595.276  # 210mm in points
A4_HEIGHT_PT = 841.890  # 297mm in points
SIZE_TOLERANCE_PT = 2.0


def verify(pdf_path: str, expected_pages: int = 0) -> dict:
    result = {
        "success": False,
        "pdfPath": pdf_path,
        "expectedPages": expected_pages,
        "actualPages": 0,
        "fileSize": 0,
        "checks": [],
        "errors": [],
    }

    # Check file exists
    if not os.path.isfile(pdf_path):
        result["errors"].append(f"File not found: {pdf_path}")
        return result

    file_size = os.path.getsize(pdf_path)
    result["fileSize"] = file_size
    if file_size < MIN_FILE_SIZE:
        result["errors"].append(f"File too small: {file_size} bytes < {MIN_FILE_SIZE}")
        return result
    result["checks"].append("file_exists_and_sized")

    # Open PDF
    try:
        import fitz  # PyMuPDF
    except ImportError:
        result["errors"].append("PyMuPDF (fitz) not available")
        return result

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        result["errors"].append(f"Cannot open PDF: {e}")
        return result
    result["checks"].append("pdf_openable")

    # Page count
    actual_pages = doc.page_count
    result["actualPages"] = actual_pages
    if expected_pages > 0 and actual_pages != expected_pages:
        result["errors"].append(
            f"Page count mismatch: expected {expected_pages}, got {actual_pages}"
        )
    elif expected_pages > 0:
        result["checks"].append("page_count_matches")

    # Page sizes
    size_ok = True
    for i in range(actual_pages):
        page = doc[i]
        rect = page.rect
        w, h = rect.width, rect.height
        if abs(w - A4_WIDTH_PT) > SIZE_TOLERANCE_PT or abs(h - A4_HEIGHT_PT) > SIZE_TOLERANCE_PT:
            size_ok = False
            result["errors"].append(
                f"Page {i+1} size {w:.1f}x{h:.1f}pt is not A4 "
                f"(expected ~{A4_WIDTH_PT:.1f}x{A4_HEIGHT_PT:.1f}pt)"
            )
    if size_ok and actual_pages > 0:
        result["checks"].append("all_pages_a4")

    # Trailing blank page detection (heuristic)
    if expected_pages > 0 and actual_pages > expected_pages:
        last_page = doc[actual_pages - 1]
        text = last_page.get_text().strip()
        images = last_page.get_images()
        if len(text) < 10 and len(images) == 0:
            result["errors"].append("Trailing blank page detected")

    # Each page readable
    readable = True
    for i in range(actual_pages):
        try:
            _ = doc[i].get_text()
        except Exception:
            readable = False
            result["errors"].append(f"Page {i+1} is not readable")
    if readable and actual_pages > 0:
        result["checks"].append("all_pages_readable")

    doc.close()
    result["success"] = len(result["errors"]) == 0
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Verify teaching document PDF export")
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument("--expected-pages", type=int, default=0, help="Expected page count (0 = skip check)")
    args = parser.parse_args()

    if not args.pdf_path:
        print(json.dumps({"error": "Usage: verify_teaching_pdf.py <pdf_path> [--expected-pages N]"}))
        sys.exit(2)

    result = verify(args.pdf_path, args.expected_pages)
    # Also output a top-level warnings array for Electron integration
    result["warnings"] = result["errors"]
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
