import type { DatabaseMigration } from '../migrator.js'

export const printTemplatesMigration: DatabaseMigration = {
  version: 8,
  name: 'print_templates',
  description: 'Persist reusable teaching-document header and footer templates.',
  fingerprint: 'print-templates-v1',
  up(database) {
    database.exec(`
      CREATE TABLE print_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        options_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_print_templates_updated ON print_templates(updated_at DESC, id ASC);
    `)
  },
}
