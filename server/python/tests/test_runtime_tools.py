from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]


class RuntimeToolsTest(unittest.TestCase):
    def test_render_and_crop_v2_pdf_tools(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf_path = root / "input.pdf"
            rendered = root / "page.png"
            output = root / "crops"
            regions = root / "regions.json"

            document = fitz.open()
            page = document.new_page()
            page.insert_text((72, 72), "1. Runtime smoke test")
            document.save(pdf_path)
            document.close()

            subprocess.run([
                sys.executable, str(ROOT / "scripts" / "render_pdf_page.py"),
                str(pdf_path), "1", str(rendered), "--dpi", "72",
            ], check=True, capture_output=True, text=True)
            self.assertTrue(rendered.exists())

            regions.write_text(json.dumps([{
                "id": "region-1",
                "kind": "question",
                "question_key": "1",
                "segments": [{"page": 1, "x": 0, "y": 0, "width": 0.8, "height": 0.5}],
            }]), encoding="utf-8")
            result = subprocess.run([
                sys.executable, str(ROOT / "scripts" / "crop_manual_annotation.py"),
                "--pdf", str(pdf_path), "--regions-json-file", str(regions),
                "--output-dir", str(output), "--dpi", "72",
            ], check=True, capture_output=True, text=True)
            payload = json.loads(result.stdout)
            self.assertEqual(len(payload["results"]), 1)
            self.assertTrue(Path(payload["results"][0]["imagePath"]).exists())


if __name__ == "__main__":
    unittest.main()
