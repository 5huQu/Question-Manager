# Question Workbench

Question Workbench is a local-first desktop/web tool for slicing PDFs, running OCR, reviewing math questions, and exporting question collections.

The open-source tree intentionally ships without sample papers, OCR outputs, SQLite data, or API keys.

## Requirements

- Node.js 24 or newer.
- Python 3.11 or newer for source development only.
- Optional: XeLaTeX for PDF export.
- Optional: LibreOffice `soffice` for DOCX to PDF conversion.

## Development

```sh
npm install
python -m pip install -r server/python/requirements.txt
npm run dev
```

The frontend runs on `127.0.0.1:5174` and proxies API requests to the local server on `127.0.0.1:8797`.

## Desktop

```sh
npm run desktop
```

The desktop build downloads a pinned private CPython runtime and installs the locked packages from `server/python/runtime-requirements.txt`. End users do not need to install Python or configure `PATH`.

The Electron app starts the local API on a random localhost port and stores runtime data in the platform user data directory. For source development, set `QUESTION_DATA_DIR` to override the runtime data directory.

Build and verify a local unpacked desktop package with:

```sh
npm run pack:desktop
```

The packaging command verifies the bundled interpreter by generating a temporary PDF and running the packaged cutter with a restricted `PATH`.

## Configuration

OCR credentials are private local configuration. Use `.env.example` as a reference, or configure OCR from the app UI.

Useful environment variables:

- `QUESTION_DATA_DIR`: runtime data root for SQLite, uploads, OCR output, figures, and exports.
- `PYTHON_PATH`: Python executable override for source development. Packaged desktop builds always use the bundled runtime.
- `XELATEX_PATH`: XeLaTeX executable path.
- `SOFFICE_PATH`: LibreOffice executable path.
- `OCR_API_BASE_URL`, `OCR_API_KEY`, `OCR_MODEL`: OCR provider settings.

## Verification

```sh
npm run build
npm run test:math-render
npm run test:smoke
npm run verify:python-runtime
```

## Third-Party Licenses

Question Workbench is distributed under the GNU Affero General Public License v3.0 only. Desktop packages include PyMuPDF and are distributed under the AGPL route for that dependency; see `THIRD_PARTY_NOTICES.md`.

## Open-Source Hygiene

Do not commit runtime data or copyrighted materials. The repository ignores local databases, uploaded PDFs, generated figures, OCR drafts, build output, and local secret files.
