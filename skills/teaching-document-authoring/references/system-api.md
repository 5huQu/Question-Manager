# System API reference

Read this reference before using the teaching-document endpoints. The API owns persistence and validation; never write `data/question.sqlite` or document asset paths directly.

## Base URL and authentication

Use `${QUESTION_API_BASE_URL:-http://127.0.0.1:8797}`. In `trusted-desktop` and disabled development modes, the local API is already authorized. In `single-admin` mode, use a user-provided authenticated cookie jar and the CSRF token from `GET /api/auth/state`:

```sh
API_BASE="${QUESTION_API_BASE_URL:-http://127.0.0.1:8797}"
curl --fail --cookie "$QUESTION_API_COOKIE_JAR" "$API_BASE/api/auth/state"
```

For every state-changing request in `single-admin` mode, also supply `Origin: $API_BASE` and `X-QM-CSRF: $QUESTION_API_CSRF_TOKEN`. Keep secret environment values out of commands, source files, and output. Do not automate a login unless credentials were explicitly and safely supplied for that task.

## Document lifecycle

Create a new document without content first, so uploaded assets have a document owner:

```http
POST /api/teaching-documents
Content-Type: application/json

{ "title": "函数单调性", "documentType": "lecture" }
```

The `201` response contains `id`, `revision: 1`, `content`, `assets`, and `issues`. Valid document types are `lecture`, `worksheet`, and `exam`.

Read a document before updating it:

```http
GET /api/teaching-documents/:id
```

Save the complete content with its latest revision:

```http
PATCH /api/teaching-documents/:id
Content-Type: application/json

{
  "expectedRevision": 1,
  "title": "函数单调性",
  "content": { "version": 1, "documentType": "lecture", "title": "函数单调性", "metadata": {}, "content": [] }
}
```

Each successful update increments `revision`. A `409` response with `error: "revision_conflict"` includes `expectedRevision`, `actualRevision`, and `current`. Stop, re-read, and report the conflict; never overwrite it.

List or duplicate only when the task requires it:

```http
GET  /api/teaching-documents
POST /api/teaching-documents/:id/duplicate
```

Do not call document or asset delete endpoints as part of normal authoring.

## Assets and TikZ

Upload each image after creation and before the content patch:

```sh
curl --fail -X POST "$API_BASE/api/teaching-documents/$DOCUMENT_ID/assets" \
  -F 'file=@diagram.png;type=image/png'
```

The endpoint accepts validated PNG, JPEG, WebP, and SVG files, returning an asset object such as:

```json
{ "id": "tdasset_…", "documentId": "tdoc_…", "url": "/files/data/teaching-documents/…", "width": 1200, "height": 800 }
```

Persist only the returned `asset.id` in `documentAsset` references. Do not invent a storage path from `url`.

Render source-controlled diagrams through:

```http
POST /api/teaching-documents/:id/tikz/render
Content-Type: application/json

{ "source": "\\begin{tikzpicture} … \\end{tikzpicture}" }
```

Use `result.asset.id` as the `svgAssetId` and the same ID in a `documentAsset` figure only when the chosen block needs an ordinary figure reference.

## Question-bank references

Read only. Search first, then fetch each selected record:

```http
GET /api/question-bank/items?q=%E5%AF%BC%E6%95%B0&page=1&pageSize=20
GET /api/question-bank/items/:questionId
```

Verify the ID, stem, type, and status match the intended material. Persist it as `{ "type": "question", "id": "…", "questionId": "…" }` inside the document. Do not create, patch, classify, crop, upload, or delete question-bank items from this Skill.

## Errors and final check

- `400`: malformed request or invalid upload; fix the request before retrying.
- `401` / `403`: authentication, origin, or CSRF failure; obtain an authorized session instead of weakening security.
- `404`: document, asset, or question does not exist; do not leave a dangling reference.
- `422 teaching_document_validation_failed`: inspect `issues`, repair the JSON, rerun preflight, and retry.
- `409 revision_conflict`: re-read and report; do not retry the stale payload.

After a write, `GET /api/teaching-documents/:id` and verify the returned revision, `content`, `assets`, and `issues`. Error-level `issues` make the draft unsuccessful.

