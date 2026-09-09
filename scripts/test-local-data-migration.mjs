import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { configureDatabase, closeDatabase, connectDatabase, defineCollection, stripLegacyAccounting, stripLegacyScope } from '../server/utils/sqlite.ts'

test('existing data becomes one local installation without losing projects or conversation history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polox-local-migration-'))
  const path = join(dir, 'old.sqlite')
  configureDatabase(path)
  const old = new DatabaseSync(path)
  for (const name of ['projects', 'agent_chats', 'canvas_layouts'])
    old.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, body TEXT NOT NULL)`)
  old.exec('CREATE UNIQUE INDEX projects_unique_0 ON projects (json_extract(body, \'$.workspaceId\'), json_extract(body, \'$.isDefault\')) WHERE json_extract(body, \'$.isDefault\') = 1')
  old.exec('CREATE UNIQUE INDEX canvas_layouts_unique_0 ON canvas_layouts (json_extract(body, \'$.workspaceId\'), json_extract(body, \'$.projectId\'), json_extract(body, \'$.assetId\'))')
  for (const id of ['first', 'second']) {
    old.prepare('INSERT INTO projects VALUES (?, ?)').run(id, JSON.stringify({ _id: id, workspaceId: id, isDefault: true, name: id }))
    old.prepare('INSERT INTO agent_chats VALUES (?, ?)').run(id, JSON.stringify({ _id: id, sessionId: id, workspaceId: id, projectId: id, creditsCharged: 12, messages: [{ role: 'user', content: id }], runtime: { ownerWorkspaceId: id, messages: [{ role: 'user', content: id }] } }))
    old.prepare('INSERT INTO canvas_layouts VALUES (?, ?)').run(id, JSON.stringify({ _id: id, workspaceId: id, projectId: id, assetId: 'image', x: 42 }))
  }
  old.close()
  try {
    const Projects = defineCollection('projects', () => ({}), [{ fields: ['isDefault'], where: 'json_extract(body, \'$.isDefault\') = 1' }])
    const Chats = defineCollection('agent_chats', () => ({}))
    const Canvas = defineCollection('canvas_layouts', () => ({}), [{ fields: ['projectId', 'assetId'] }])
    assert.equal(await Projects.countDocuments({}), 2)
    assert.equal(await Projects.countDocuments({ isDefault: true }), 1)
    await assert.rejects(Projects.create({ isDefault: true }), /UNIQUE/)
    for (const id of ['first', 'second']) {
      const chat = await Chats.findById(id)
      assert.equal(chat.workspaceId, undefined)
      assert.equal(chat.creditsCharged, undefined)
      assert.equal(chat.runtime.ownerWorkspaceId, undefined)
      assert.equal(chat.messages[0].role, 'user')
      assert.equal(chat.messages[0].content, id)
      assert.equal((await Canvas.findOne({ projectId: id })).x, 42)
    }
    closeDatabase()
    assert.equal(await Projects.countDocuments({}), 2)
    assert.equal(Number(connectDatabase().prepare('PRAGMA user_version').get().user_version), 2)
    assert.deepEqual(stripLegacyScope({ ownerWorkspaceId: 'old', userId: 'old', messages: [{ role: 'user', content: 'hello' }] }), { messages: [{ role: 'user', content: 'hello' }] })
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('obsolete accounting metadata is removed without changing prompts or generation settings', () => {
  const record = { creditsCharged: 12, input: { prompt: 'a credit card on a desk', duration: 10 }, runtime: { pendingConfirmation: { credits: 4, params: { resolution: '720p' } } }, messages: [{ confirmationCredits: 4, content: 'Keep this message' }] }
  assert.deepEqual(stripLegacyAccounting(record), { input: { prompt: 'a credit card on a desk', duration: 10 }, runtime: { pendingConfirmation: { params: { resolution: '720p' } } }, messages: [{ content: 'Keep this message' }] })
})
