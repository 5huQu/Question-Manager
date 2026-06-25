import { db } from './connection.js'
import { nowIso } from '../utils/ids.js'
import {
  backfillExportRecordFileSizes,
  clearMismatchedExportRecordItems,
  backfillExportRecordItems,
} from './backfill.js'

/**
 * Ensure a column exists on a table. If the column is missing, it is added
 * using the provided SQL column definition.
 */
export function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/**
 * Ensure the full database schema exists. Creates all tables, indices,
 * runs migration columns, backfills, and creates the default 'basket' collection.
 *
 * Tables:
 * - pdf_slicer_batches
 * - pdf_slicer_runs
 * - source_documents
 * - ocr_documents
 * - question_candidates
 * - question_bank_items
 * - pdf_slicer_solution_items
 * - pdf_slicer_review_items
 * - question_bank_collections
 * - question_bank_collection_items
 * - question_bank_export_records
 */
export function ensureSchema() {
  const questionColumns = db.prepare("PRAGMA table_info(question_bank_items)").all() as Array<{ name: string }>
  if (questionColumns.length && !questionColumns.some((item) => item.name === 'stem_markdown')) {
    db.exec(`
      DROP TABLE IF EXISTS question_bank_collection_items;
      DROP TABLE IF EXISTS question_bank_items;
      DROP TABLE IF EXISTS pdf_slicer_solution_items;
    `)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pdf_slicer_batches (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      material_type TEXT NOT NULL DEFAULT 'unknown',
      workflow_mode TEXT NOT NULL DEFAULT 'single',
      workflow_status TEXT NOT NULL DEFAULT 'ready',
      created_at TEXT NOT NULL,
      uploaded_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_runs (
      run_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      upload_mode TEXT NOT NULL DEFAULT 'single_pdf',
      paper_title TEXT NOT NULL DEFAULT '',
      pdf_name TEXT NOT NULL,
      pdf_path TEXT NOT NULL,
      source_file_name TEXT NOT NULL DEFAULT '',
      source_file_kind TEXT NOT NULL DEFAULT 'pdf',
      material_type TEXT NOT NULL DEFAULT 'unknown',
      file_role TEXT NOT NULL DEFAULT 'full',
      stage TEXT NOT NULL DEFAULT '高三',
      classification_confidence REAL NOT NULL DEFAULT 0,
      classification_reasons_json TEXT NOT NULL DEFAULT '[]',
      run_dir TEXT NOT NULL,
      document_diagnostics_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      slice_status TEXT NOT NULL,
      slice_error TEXT NOT NULL DEFAULT '',
      quick_review_status TEXT NOT NULL DEFAULT 'pending',
      total_questions INTEGER NOT NULL DEFAULT 0,
      approved_questions INTEGER NOT NULL DEFAULT 0,
      unreviewed_questions INTEGER NOT NULL DEFAULT 0,
      ocr_status TEXT NOT NULL,
      ocr_error TEXT NOT NULL DEFAULT '',
      ocr_started_at TEXT NOT NULL DEFAULT '',
      ocr_finished_at TEXT NOT NULL DEFAULT '',
      ocr_provider TEXT NOT NULL DEFAULT '',
      ocr_external_uid TEXT NOT NULL DEFAULT '',
      ocr_provider_phase TEXT NOT NULL DEFAULT '',
      ocr_provider_progress INTEGER NOT NULL DEFAULT 0,
      ocr_provider_result_path TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (batch_id) REFERENCES pdf_slicer_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_bank_items (
      id TEXT PRIMARY KEY,
      serial_no INTEGER NOT NULL,
      question_no TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '高三',
      question_type TEXT NOT NULL DEFAULT '',
      difficulty_score INTEGER NOT NULL DEFAULT 0,
      difficulty_score_10 INTEGER NOT NULL DEFAULT 0,
      difficulty_label TEXT NOT NULL DEFAULT '',
      chapter TEXT NOT NULL DEFAULT '',
      knowledge_points_json TEXT NOT NULL DEFAULT '[]',
      solution_methods_json TEXT NOT NULL DEFAULT '[]',
      source_title TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      paper_title TEXT NOT NULL DEFAULT '',
      batch_name TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '数学',
      paper_kind TEXT NOT NULL DEFAULT 'unknown',
      exam_year INTEGER NOT NULL DEFAULT 0,
      source_org TEXT NOT NULL DEFAULT '',
      import_source_id TEXT NOT NULL DEFAULT '',
      bank_status TEXT NOT NULL DEFAULT 'ready',
      stem_markdown TEXT NOT NULL DEFAULT '',
      answer_text TEXT NOT NULL DEFAULT '',
      analysis_markdown TEXT NOT NULL DEFAULT '',
      search_text TEXT NOT NULL DEFAULT '',
      slice_image_path TEXT NOT NULL DEFAULT '',
      figures_json TEXT NOT NULL DEFAULT '[]',
      source_run_id TEXT NOT NULL DEFAULT '',
      source_solution_run_id TEXT NOT NULL DEFAULT '',
      merge_status TEXT NOT NULL DEFAULT '',
      merge_note TEXT NOT NULL DEFAULT '',
      format_review_required INTEGER NOT NULL DEFAULT 0,
      format_review_reasons_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_solution_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      question_no TEXT NOT NULL DEFAULT '',
      answer_text TEXT NOT NULL DEFAULT '',
      analysis_markdown TEXT NOT NULL DEFAULT '',
      figures_json TEXT NOT NULL DEFAULT '[]',
      source_image_path TEXT NOT NULL DEFAULT '',
      match_status TEXT NOT NULL DEFAULT 'pending',
      matched_question_id TEXT NOT NULL DEFAULT '',
      match_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES pdf_slicer_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (source_run_id) REFERENCES pdf_slicer_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_annotation_sessions (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      source_profile_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finalized_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_annotation_regions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      question_key TEXT NOT NULL DEFAULT '',
      question_label TEXT NOT NULL DEFAULT '',
      question_keys_json TEXT NOT NULL DEFAULT '[]',
      segments_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      original_file_name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      file_type TEXT NOT NULL DEFAULT 'pdf',
      page_count INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'uploaded',
      province TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      paper_title TEXT NOT NULL DEFAULT '',
      batch_name TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '高三',
      subject TEXT NOT NULL DEFAULT '数学',
      paper_kind TEXT NOT NULL DEFAULT 'unknown',
      exam_year INTEGER NOT NULL DEFAULT 0,
      source_org TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ocr_documents (
      id TEXT PRIMARY KEY,
      source_document_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      raw_result_path TEXT NOT NULL DEFAULT '',
      markdown_path TEXT NOT NULL DEFAULT '',
      blocks_json_path TEXT NOT NULL DEFAULT '',
      assets_json_path TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_candidates (
      id TEXT PRIMARY KEY,
      source_document_id TEXT NOT NULL,
      ocr_document_id TEXT NOT NULL DEFAULT '',
      question_no TEXT NOT NULL DEFAULT '',
      stem_markdown TEXT NOT NULL DEFAULT '',
      answer_text TEXT NOT NULL DEFAULT '',
      analysis_markdown TEXT NOT NULL DEFAULT '',
      question_type TEXT NOT NULL DEFAULT '',
      difficulty_score_10 INTEGER NOT NULL DEFAULT 0,
      difficulty_label TEXT NOT NULL DEFAULT '',
      knowledge_points_json TEXT NOT NULL DEFAULT '[]',
      solution_methods_json TEXT NOT NULL DEFAULT '[]',
      figures_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'needs_review',
      province TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      paper_title TEXT NOT NULL DEFAULT '',
      batch_name TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '高三',
      subject TEXT NOT NULL DEFAULT '数学',
      paper_kind TEXT NOT NULL DEFAULT 'unknown',
      exam_year INTEGER NOT NULL DEFAULT 0,
      source_org TEXT NOT NULL DEFAULT '',
      committed_question_id TEXT NOT NULL DEFAULT '',
      committed_at TEXT NOT NULL DEFAULT '',
      issues_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pdf_slicer_review_items (
      result_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      question_label TEXT NOT NULL,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      page_image_path TEXT NOT NULL DEFAULT '',
      auto_image_path TEXT NOT NULL DEFAULT '',
      bbox_json TEXT NOT NULL DEFAULT '{}',
      segments_json TEXT NOT NULL DEFAULT '[]',
      text_regions_json TEXT NOT NULL DEFAULT '[]',
      figures_json TEXT NOT NULL DEFAULT '[]',
      glm_figure_bindings_json TEXT NOT NULL DEFAULT '{}',
      review_status TEXT NOT NULL DEFAULT 'pending_review',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES pdf_slicer_runs(run_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_bank_collections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_bank_collection_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(collection_id, question_id),
      FOREIGN KEY (collection_id) REFERENCES question_bank_collections(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES question_bank_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS question_bank_export_records (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      collection_id TEXT NOT NULL DEFAULT '',
      run_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT '',
      variant TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL DEFAULT '[]',
      content_length INTEGER NOT NULL DEFAULT 0,
      question_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'succeeded',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON pdf_slicer_runs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_ocr_status ON pdf_slicer_runs(ocr_status);
    CREATE INDEX IF NOT EXISTS idx_qb_updated_at ON question_bank_items(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_review_run ON pdf_slicer_review_items(run_id, result_id);
    CREATE INDEX IF NOT EXISTS idx_qb_export_records_created_at ON question_bank_export_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qb_export_records_collection ON question_bank_export_records(collection_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_qb_export_records_run ON question_bank_export_records(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_documents_updated_at ON source_documents(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_documents_status ON source_documents(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ocr_documents_source ON ocr_documents(source_document_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_question_candidates_source ON question_candidates(source_document_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_question_candidates_ocr ON question_candidates(ocr_document_id, question_no);
    CREATE INDEX IF NOT EXISTS idx_question_candidates_status ON question_candidates(status, updated_at DESC);
  `)

  // -- Migration columns for pdf_slicer_runs --
  ensureColumn('pdf_slicer_runs', 'paper_title', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_batches', 'title', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_batches', 'material_type', "TEXT NOT NULL DEFAULT 'unknown'")
  ensureColumn('pdf_slicer_batches', 'workflow_mode', "TEXT NOT NULL DEFAULT 'single'")
  ensureColumn('pdf_slicer_batches', 'workflow_status', "TEXT NOT NULL DEFAULT 'ready'")
  ensureColumn('pdf_slicer_runs', 'material_type', "TEXT NOT NULL DEFAULT 'unknown'")
  ensureColumn('pdf_slicer_runs', 'file_role', "TEXT NOT NULL DEFAULT 'full'")
  ensureColumn('pdf_slicer_runs', 'stage', "TEXT NOT NULL DEFAULT '高三'")
  ensureColumn('pdf_slicer_runs', 'classification_confidence', "REAL NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'classification_reasons_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('pdf_slicer_runs', 'document_diagnostics_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('pdf_slicer_runs', 'ocr_provider', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'ocr_external_uid', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'ocr_provider_phase', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'ocr_provider_progress', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'ocr_provider_result_path', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'rules_version', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'rules_hash', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_runs', 'rules_fallback_used', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('pdf_slicer_runs', 'rules_warnings_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_items', 'knowledge_points_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_items', 'solution_methods_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_items', 'difficulty_score_10', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_bank_items', 'difficulty_label', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'format_review_required', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_bank_items', 'format_review_reasons_json', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn('question_bank_items', 'source_solution_run_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'merge_status', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'merge_note', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'stem_markdown', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'answer_text', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'analysis_markdown', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('source_documents', 'province', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('source_documents', 'city', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('source_documents', 'paper_title', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('source_documents', 'batch_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('source_documents', 'stage', "TEXT NOT NULL DEFAULT '高三'")
  ensureColumn('source_documents', 'subject', "TEXT NOT NULL DEFAULT '数学'")
  ensureColumn('source_documents', 'paper_kind', "TEXT NOT NULL DEFAULT 'unknown'")
  ensureColumn('source_documents', 'exam_year', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('source_documents', 'source_org', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_candidates', 'province', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_candidates', 'city', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_candidates', 'paper_title', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_candidates', 'batch_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_candidates', 'stage', "TEXT NOT NULL DEFAULT '高三'")
  ensureColumn('question_candidates', 'subject', "TEXT NOT NULL DEFAULT '数学'")
  ensureColumn('question_candidates', 'paper_kind', "TEXT NOT NULL DEFAULT 'unknown'")
  ensureColumn('question_candidates', 'exam_year', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_candidates', 'source_org', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'province', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'city', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'paper_title', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'batch_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'subject', "TEXT NOT NULL DEFAULT '数学'")
  ensureColumn('question_bank_items', 'paper_kind', "TEXT NOT NULL DEFAULT 'unknown'")
  ensureColumn('question_bank_items', 'exam_year', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_bank_items', 'source_org', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'import_source_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_candidates', 'committed_question_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_candidates', 'committed_at', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_items', 'search_text', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_solution_items', 'answer_text', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_solution_items', 'analysis_markdown', "TEXT NOT NULL DEFAULT ''")
  db.exec('CREATE INDEX IF NOT EXISTS idx_qb_format_review ON question_bank_items(format_review_required, updated_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_solution_items_batch ON pdf_slicer_solution_items(batch_id, source_run_id, question_no)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_solution_items_status ON pdf_slicer_solution_items(match_status, updated_at DESC)')
  ensureColumn('question_bank_collections', 'subtitle', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('question_bank_collections', 'kind', "TEXT NOT NULL DEFAULT 'paper'")
  ensureColumn('question_bank_collections', 'status', "TEXT NOT NULL DEFAULT 'draft'")
  ensureColumn('question_bank_collections', 'total_score', "REAL NOT NULL DEFAULT 0")
  ensureColumn('question_bank_collections', 'time_limit', "INTEGER NOT NULL DEFAULT 0")
  ensureColumn('question_bank_collections', 'export_format', "TEXT NOT NULL DEFAULT 'markdown'")
  ensureColumn('question_bank_export_records', 'items_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('question_bank_collection_items', 'score', "REAL NOT NULL DEFAULT 0")
  ensureColumn('question_bank_collection_items', 'section_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('pdf_slicer_review_items', 'segments_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('pdf_slicer_review_items', 'text_regions_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('pdf_slicer_review_items', 'figures_json', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('pdf_slicer_review_items', 'glm_figure_bindings_json', "TEXT NOT NULL DEFAULT '{}'")

  // -- Data migration: backfill titles --
  db.prepare("UPDATE pdf_slicer_runs SET paper_title = pdf_name WHERE TRIM(paper_title) = ''").run()
  db.prepare("UPDATE pdf_slicer_batches SET title = id WHERE TRIM(title) = ''").run()
  db.prepare(`
    UPDATE question_bank_items
    SET source_title = COALESCE(
      (SELECT NULLIF(paper_title, '') FROM pdf_slicer_runs WHERE run_id = question_bank_items.source_run_id),
      source_title
    )
    WHERE source_run_id != ''
  `).run()

  // -- Backfill export records --
  backfillExportRecordFileSizes()
  clearMismatchedExportRecordItems()
  backfillExportRecordItems()

  // -- Ensure default 'basket' collection --
  if (!db.prepare('SELECT id FROM question_bank_collections WHERE id = ?').get('basket')) {
    const now = nowIso()
    db.prepare(`
      INSERT INTO question_bank_collections
        (id, title, subtitle, description, kind, status, total_score, time_limit, export_format, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('basket', '试题篮', '', '默认试题篮', 'basket', 'draft', 0, 0, 'markdown', now, now)
  } else {
    db.prepare("UPDATE question_bank_collections SET kind = 'basket', title = COALESCE(NULLIF(title, ''), '试题篮') WHERE id = 'basket'").run()
  }
}
