import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { aggregate, Query, updateOne } from 'mingo'

// Query expressions operate on local documents. Persistence and atomic writes use SQLite.
type RecordData = Record<string, any>
export type StoredDocument<T> = T & { _id: string, save: () => Promise<StoredDocument<T>>, deleteOne: () => Promise<void>, toObject: () => T & { _id: string }, markModified: (path: string) => void, set: (path: string, value: unknown) => void }
let database: DatabaseSync | undefined
let databasePath = resolve('.data/polox.sqlite')
export function configureDatabase(path: string) {
  closeDatabase()
  databasePath = path
}
let lastIdTime = 0
const collections = new Set<string>()
const initializers = new Map<string, () => DatabaseSync>()

export function connectDatabase() {
  if (database)
    return database
  const path = databasePath
  if (path !== ':memory:')
    mkdirSync(dirname(path), { recursive: true })
  database = new DatabaseSync(path)
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  try {
    migrateLocalData(database)
    migrateGenerationMetadata(database)
  }
  catch (error) {
    database.close()
    database = undefined
    throw error
  }
  return database
}

// Compatibility only: remove obsolete identity fields from earlier local versions.
export function stripLegacyScope(record: Record<string, any>) {
  for (const field of ['workspaceId', 'ownerWorkspaceId', 'userId', 'ownerUserId', 'tenantId'])
    delete record[field]
  if (record.runtime && typeof record.runtime === 'object')
    stripLegacyScope(record.runtime)
  return record
}

function migrateLocalData(db: DatabaseSync) {
  if (Number(db.prepare('PRAGMA user_version').get()?.user_version) >= 1)
    return
  db.exec('BEGIN IMMEDIATE')
  try {
    const names = new Set(db.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all().map(row => row.name))
    // Replace identity-based indexes before removing their fields.
    for (const index of db.prepare('SELECT name, sql FROM sqlite_master WHERE type = \'index\' AND tbl_name IN (\'projects\', \'canvas_layouts\')').all()) {
      if (String(index.sql).includes('workspaceId'))
        db.exec(`DROP INDEX "${String(index.name).replaceAll('"', '""')}"`)
    }
    let defaultFound = false
    for (const table of ['projects', 'generation_jobs', 'agent_chats', 'agent_history', 'canvas_layouts']) {
      if (!names.has(table))
        continue
      const update = db.prepare(`UPDATE "${table}" SET body = ? WHERE id = ?`)
      for (const row of db.prepare(`SELECT id, body FROM "${table}" ORDER BY id`).all()) {
        const data = stripLegacyScope(JSON.parse(String(row.body)))
        // Preserve every project; retain one default after combining old scopes.
        if (table === 'projects' && data.isDefault) {
          data.isDefault = !defaultFound
          defaultFound = true
        }
        update.run(JSON.stringify(data), String(row.id))
      }
    }
    db.exec('PRAGMA user_version = 1; COMMIT')
  }
  catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// Compatibility only: strip obsolete accounting fields from saved local documents.
export function stripLegacyAccounting(value: any): any {
  if (Array.isArray(value)) {
    for (const item of value)
      stripLegacyAccounting(item)
  }
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (/^(?:credits(?:Quoted|Charged|Consumed|Refunded|RefundedAt)?|creditStatus|creditRefundReason|confirmationCredits|layerBillingSettled)$/.test(key))
        delete value[key]
      else
        stripLegacyAccounting(value[key])
    }
  }
  return value
}

function migrateGenerationMetadata(db: DatabaseSync) {
  if (Number(db.prepare('PRAGMA user_version').get()?.user_version) >= 2)
    return
  db.exec('BEGIN IMMEDIATE')
  try {
    const names = new Set(db.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all().map(row => row.name))
    for (const table of ['generation_jobs', 'agent_chats', 'agent_history']) {
      if (!names.has(table))
        continue
      const update = db.prepare(`UPDATE "${table}" SET body = ? WHERE id = ?`)
      for (const row of db.prepare(`SELECT id, body FROM "${table}"`).all()) {
        const data = stripLegacyAccounting(JSON.parse(String(row.body)))
        update.run(JSON.stringify(data), String(row.id))
      }
    }
    db.exec('PRAGMA user_version = 2; COMMIT')
  }
  catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function closeDatabase() {
  database?.close()
  database = undefined
  collections.clear()
}

export function isDocumentId(value: string) {
  return /^[a-f0-9]{24}$/.test(value)
}

function newId() {
  lastIdTime = Math.max(Date.now() * 1000, lastIdTime + 1)
  return lastIdTime.toString(16).padStart(14, '0') + randomBytes(5).toString('hex')
}

function encode(value: any): any {
  if (value instanceof Date)
    return { $date: value.toISOString() }
  if (Array.isArray(value))
    return value.map(encode)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]))
  return value
}

function decode(value: any): any {
  if (Array.isArray(value))
    return value.map(decode)
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$date === 'string')
      return new Date(value.$date)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]))
  }
  return value
}

function transaction<T>(action: () => T): T {
  const db = connectDatabase()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  }
  catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function readAll(name: string): RecordData[] {
  initializers.get(name)?.()
  if (!collections.has(name))
    return []
  return connectDatabase().prepare(`SELECT body FROM "${name}"`).all().map(row => decode(JSON.parse(String(row.body))))
}
const queryOptions = { collectionResolver: readAll, scriptEnabled: false }

class LocalQuery<T> implements PromiseLike<T> {
  private sorting: RecordData = {}
  private offset = 0
  private maximum = 0
  private projection?: RecordData
  private result?: Promise<T>
  constructor(private read: (sort: RecordData, projection?: RecordData) => any, private many: boolean) {}
  sort(value: RecordData | string) {
    this.sorting = typeof value === 'string' ? Object.fromEntries(value.split(/\s+/).map(key => [key.replace(/^-/, ''), key.startsWith('-') ? -1 : 1])) : value
    return this
  }

  skip(value: number) { this.offset = value; return this }
  limit(value: number) { this.maximum = value; return this }
  // Projection is applied before hydration; save() merges only edited fields.
  select(fields: string | RecordData) {
    this.projection = typeof fields === 'string' ? Object.fromEntries(fields.split(/\s+/).filter(Boolean).map(field => [field.replace(/^[-+]/, ''), field.startsWith('-') ? 0 : 1])) : fields
    return this
  }

  lean<R = T>() { return this as unknown as LocalQuery<R> }
  exec(): Promise<T> {
    this.result ??= Promise.resolve().then(() => {
      const result = this.read(this.sorting, this.projection)
      if (!this.many)
        return result
      let rows = result.slice(this.offset)
      if (this.maximum > 0)
        rows = rows.slice(0, this.maximum)
      return rows
    })
    return this.result
  }

  then<A = T, B = never>(resolve?: ((value: T) => A | PromiseLike<A>) | null, reject?: ((reason: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec().then(resolve, reject)
  }
}

export function defineCollection<T extends object>(name: string, defaults: () => Partial<T>, unique: Array<{ fields: string[], where?: string }> = [], prepare?: (data: T) => void) {
  if (!/^[a-z_]+$/.test(name))
    throw new Error('Invalid collection name')
  function ensure() {
    const db = connectDatabase()
    if (!collections.has(name)) {
      db.exec(`CREATE TABLE IF NOT EXISTS "${name}" (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)))`)
      unique.forEach((index, i) => {
        const fields = index.fields.map(field => `json_extract(body, '$.${field}')`).join(', ')
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "${name}_unique_${i}" ON "${name}" (${fields}) ${index.where ? `WHERE ${index.where}` : ''}`)
      })
      collections.add(name)
    }
    return db
  }
  initializers.set(name, ensure)
  function persist(data: RecordData) {
    prepare?.(data as T)
    ensure().prepare(`INSERT INTO "${name}" (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body`).run(data._id, JSON.stringify(encode(data)))
  }
  function rows(filter: RecordData, sorting: RecordData = {}, projection?: RecordData) {
    ensure()
    const slices = Object.entries(projection || {}).filter(([, value]) => value && typeof value === 'object' && '$slice' in value)
    const fields = projection ? Object.fromEntries(Object.entries(projection).filter(([, value]) => !(value && typeof value === 'object' && '$slice' in value))) : undefined
    const cursor = new Query(structuredClone(filter), queryOptions).find(readAll(name), fields && Object.keys(fields).length ? fields : undefined)
    const result = (Object.keys(sorting).length ? cursor.sort(sorting) : cursor).all() as RecordData[]
    for (const row of result) {
      for (const [key, value] of slices) {
        const spec = value.$slice
        if (Array.isArray(row[key]))
          row[key] = Array.isArray(spec) ? row[key].slice(spec[0], spec[0] + spec[1]) : spec < 0 ? row[key].slice(spec) : row[key].slice(0, spec)
      }
    }
    return result
  }
  function wrap(data: RecordData): StoredDocument<T> {
    return new LocalDocument(data, true) as unknown as StoredDocument<T>
  }
  function mutate(filter: RecordData, modifier: RecordData | RecordData[], options: RecordData = {}, many = false) {
    ensure()
    return transaction(() => {
      let matches = rows(filter, options.sort)
      if (!many)
        matches = matches.slice(0, 1)
      const inserting = !matches.length && options.upsert
      if (inserting) {
        const seed = Object.fromEntries(Object.entries(filter).filter(([key, value]) => !key.startsWith('$') && (typeof value !== 'object' || value === null)))
        matches = [{ ...defaults(), ...seed, _id: seed._id || newId(), createdAt: new Date() }]
      }
      let modifiedCount = 0
      const documents = matches.map((doc) => {
        const before = structuredClone(doc)
        let changes = modifier
        if (!Array.isArray(modifier)) {
          const { $setOnInsert, ...other } = modifier
          if (inserting && $setOnInsert)
            Object.assign(doc, structuredClone($setOnInsert))
          changes = other
        }
        const list = [doc]
        if (Object.keys(changes).length)
          updateOne(list, {}, changes as any, { arrayFilters: options.arrayFilters }, queryOptions)
        const updated = list[0]!
        if (!isDeepStrictEqual(before, updated) || inserting) {
          updated.updatedAt = new Date()
          persist(updated)
          modifiedCount++
        }
        return wrap(options.returnDocument === 'before' || options.new === false ? before : updated)
      })
      return { documents, matchedCount: inserting ? 0 : matches.length, modifiedCount, upsertedCount: inserting ? 1 : 0 }
    })
  }
  class LocalDocument {
    [key: string]: any
    private original!: RecordData
    constructor(input: RecordData = {}, stored = false) {
      Object.assign(this, stored ? input : { ...defaults(), ...input, _id: input._id || newId(), createdAt: new Date(), updatedAt: new Date() })
      Object.defineProperty(this, 'original', { value: structuredClone(this.toObject()), writable: true, enumerable: false })
    }

    toObject(): T & { _id: string } { return Object.fromEntries(Object.entries(this)) as T & { _id: string } }
    markModified(_path: string) {}
    set(path: string, value: unknown) {
      const data = [this.toObject()]
      updateOne(data, {}, { $set: { [path]: value } } as any)
      Object.assign(this, data[0])
    }

    async save() {
      ensure()
      transaction(() => {
        const current = rows({ _id: this._id })[0]
        const data = this.toObject()
        const merged: RecordData = current || data
        if (current) {
          for (const key of new Set([...Object.keys(this.original), ...Object.keys(data)])) {
            if (!isDeepStrictEqual(this.original[key], (data as RecordData)[key])) {
              if (key in data)
                merged[key] = (data as RecordData)[key]
              else delete merged[key]
            }
          }
        }
        merged.updatedAt = new Date()
        persist(merged)
        Object.assign(this, merged)
        this.original = structuredClone(merged)
      })
      return this as unknown as StoredDocument<T>
    }

    async deleteOne() { await LocalDocument.deleteOne({ _id: this._id }) }
    static collection = { name }
    static find(filter: RecordData = {}, projection?: RecordData) { return new LocalQuery<StoredDocument<T>[]>((sort, fields) => rows(filter, sort, fields || projection).map(wrap), true) }
    static findOne(filter: RecordData = {}, projection?: RecordData) {
      return new LocalQuery<StoredDocument<T> | null>((sort, fields) => {
        const doc = rows(filter, sort, fields || projection)[0]
        return doc ? wrap(doc) : null
      }, false)
    }

    static findById(id: unknown) { return this.findOne({ _id: String(id) }) }
    static async findByIdAndDelete(id: unknown) {
      const doc = await this.findById(id)
      if (doc)
        await this.deleteOne({ _id: String(id) })
      return doc
    }

    static async insertMany(items: Partial<T>[]) {
      const documents = []
      for (const data of items) documents.push(await this.create(data))
      return documents
    }

    static async create(data: Partial<T>) { return new LocalDocument(data).save() }
    static async countDocuments(filter: RecordData = {}) { return rows(filter).length }
    static async exists(filter: RecordData) { return rows(filter).length > 0 }
    static async distinct(field: string, filter: RecordData = {}) { return [...new Set(rows(filter).map(row => row[field]))] }
    static findOneAndUpdate(filter: RecordData, update: RecordData | RecordData[], options: RecordData = {}) {
      return new LocalQuery<StoredDocument<T> | null>(sort => mutate(filter, update, { ...options, sort: options.sort || sort }).documents[0] || null, false)
    }

    static findByIdAndUpdate(id: unknown, update: RecordData, options: RecordData = {}) { return this.findOneAndUpdate({ _id: String(id) }, update, options) }
    static async updateOne(filter: RecordData, update: RecordData | RecordData[], options: RecordData = {}) { return mutate(filter, update, options) }
    static async updateMany(filter: RecordData, update: RecordData | RecordData[], options: RecordData = {}) { return mutate(filter, update, options, true) }
    static async deleteOne(filter: RecordData) {
      ensure()
      return transaction(() => {
        const doc = rows(filter)[0]
        if (doc)
          ensure().prepare(`DELETE FROM "${name}" WHERE id = ?`).run(doc._id)
        return { deletedCount: doc ? 1 : 0 }
      })
    }

    static async deleteMany(filter: RecordData) {
      ensure()
      return transaction(() => {
        const matches = rows(filter)
        const statement = ensure().prepare(`DELETE FROM "${name}" WHERE id = ?`)
        matches.forEach(doc => statement.run(doc._id))
        return { deletedCount: matches.length }
      })
    }

    static async aggregate<R = RecordData>(pipeline: RecordData[]): Promise<R[]> {
      ensure()
      return aggregate(readAll(name), structuredClone(pipeline), queryOptions) as R[]
    }

    static async bulkWrite(operations: RecordData[], _options: RecordData = {}) {
      let modifiedCount = 0
      for (const op of operations) {
        if (op.updateOne)
          modifiedCount += (await this.updateOne(op.updateOne.filter, op.updateOne.update, op.updateOne)).modifiedCount
        else if (op.updateMany)
          modifiedCount += (await this.updateMany(op.updateMany.filter, op.updateMany.update, op.updateMany)).modifiedCount
        else if (op.deleteOne)
          await this.deleteOne(op.deleteOne.filter)
        else throw new Error('Unsupported SQLite batch operation')
      }
      return { modifiedCount }
    }
  }
  return LocalDocument
}
