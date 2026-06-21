import { DatabaseSync } from 'node:sqlite'
import { sqlitePath } from '../config.js'

export const db = new DatabaseSync(sqlitePath)
db.exec('PRAGMA foreign_keys = ON')

export function closeDatabase() {
  db.close()
}
