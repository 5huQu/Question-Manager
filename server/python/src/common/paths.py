from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ROOT = Path(os.getenv("QUESTION_PYTHON_DATA_DIR", PROJECT_ROOT))
INPUT_DIR = PROJECT_ROOT / "input" / "pdfs"
OUTPUT_DIR = DATA_ROOT / "output"
PAGES_DIR = OUTPUT_DIR / "pages"
AUTO_CUTS_DIR = OUTPUT_DIR / "auto_cuts"
RESULTS_PATH = OUTPUT_DIR / "cut_results.json"


def ensure_output_dirs() -> None:
    for path in (OUTPUT_DIR, PAGES_DIR, AUTO_CUTS_DIR):
        path.mkdir(parents=True, exist_ok=True)
