import argparse
import sys
from pathlib import Path
import fitz

def main():
    parser = argparse.ArgumentParser(description="Render a single PDF page to a PNG image.")
    parser.add_argument("pdf_path", type=str, help="Path to the PDF file")
    parser.add_argument("page_num", type=int, help="Page number (1-indexed)")
    parser.add_argument("output_path", type=str, help="Output PNG path")
    parser.add_argument("--dpi", type=int, default=150, help="DPI for rendering (default: 150)")
    args = parser.parse_args()

    pdf_path = Path(args.pdf_path)
    output_path = Path(args.output_path)

    if not pdf_path.exists():
        print(f"Error: File not found: {args.pdf_path}", file=sys.stderr)
        sys.exit(1)

    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Error: Failed to open PDF: {str(e)}", file=sys.stderr)
        sys.exit(1)

    if args.page_num < 1 or args.page_num > len(doc):
        print(f"Error: Page number {args.page_num} out of bounds (1..{len(doc)})", file=sys.stderr)
        sys.exit(1)

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        page = doc[args.page_num - 1]
        zoom = args.dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        pix.save(str(output_path))
        print(f"Successfully rendered page {args.page_num} of {pdf_path} to {output_path}")
    except Exception as e:
        print(f"Error: Failed to render page: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
