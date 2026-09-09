import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, after } from 'node:test'
import { configureDatabase, closeDatabase, defineCollection } from '../server/utils/sqlite.ts'

const dir = mkdtempSync(join(tmpdir(), 'polox-sqlite-'))
configureDatabase(join(dir, 'test.sqlite'))
const Projects = defineCollection('test_projects', () => ({ name: '', isDefault: false }), [{ fields: ['isDefault'], where: "json_extract(body, '$.isDefault') = 1" }])
const Jobs = defineCollection('test_jobs', () => ({ state: 'queued', attempts: 0, images: [], runtime: {} }), [{ fields: ['taskId'] }])
after(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }) })

test('SQLite persists documents, dates and project edits across connection restarts', async () => {
  const project = await Projects.create({ name: 'Local project', isDefault: true })
  assert.ok(project.createdAt instanceof Date)
  project.name = 'Renamed project'
  await project.save()
  closeDatabase()
  const saved = await Projects.findById(project._id)
  assert.equal(saved.name, 'Renamed project')
  assert.ok(saved.createdAt instanceof Date)
  await assert.rejects(Projects.create({ isDefault: true }), /UNIQUE/)
})

test('SQLite atomic claims give a queued task to one worker and preserve updates', async () => {
  const job = await Jobs.create({ taskId: 'atomic' })
  const claims = await Promise.all(Array.from({ length: 12 }, () => Jobs.findOneAndUpdate({ _id: job._id, state: 'queued' }, { $set: { state: 'generating' }, $inc: { attempts: 1 } }, { new: true })))
  assert.equal(claims.filter(Boolean).length, 1)
  const a = await Jobs.findById(job._id)
  const b = await Jobs.findById(job._id)
  a.runtime = { messages: [{ role: 'assistant', content: 'Persisted' }] }
  await a.save()
  b.state = 'success'
  await b.save()
  const saved = await Jobs.findById(job._id)
  assert.equal(saved.attempts, 1)
  assert.equal(saved.runtime.messages[0].content, 'Persisted')
  assert.equal(saved.state, 'success')
})

test('history upsert, projection, cursor pagination and aggregation remain consistent', async () => {
  for (let i = 0; i < 5; i++) {
    await Jobs.updateOne({ taskId: `history-${i}` }, { $set: { images: [{ url: `${i}-a` }, { url: `${i}-b` }], state: 'success' }, $setOnInsert: { attempts: i } }, { upsert: true })
  }
  await Jobs.updateOne({ taskId: 'history-0' }, { $setOnInsert: { attempts: 99 } }, { upsert: true })
  assert.equal((await Jobs.findOne({ taskId: 'history-0' })).attempts, 0)
  const page = await Jobs.find({ taskId: /^history-/ }).sort({ _id: -1 }).limit(2)
  const older = await Jobs.find({ taskId: /^history-/, _id: { $lt: page.at(-1)._id } }).sort({ _id: -1 })
  assert.equal(older.length, 3)
  const projected = await Jobs.findOne({ taskId: 'history-2' }, { images: { $slice: [1, 1] } })
  assert.deepEqual(projected.images, [{ url: '2-b' }])
  const grouped = await Jobs.aggregate([{ $match: { taskId: /^history-/ } }, { $group: { _id: '$state', count: { $sum: 1 } } }])
  assert.deepEqual(grouped, [{ _id: 'success', count: 5 }])
  const pending = await Jobs.findOne({ taskId: 'history-0' }).select('taskId')
  pending.taskId = 'history-renamed'
  await pending.save()
  assert.equal((await Jobs.findById(pending._id)).images.length, 2)
})

test('failed writes roll back and deletion persists', async () => {
  const job = await Jobs.create({ taskId: 'unique' })
  await assert.rejects(Jobs.updateOne({ _id: job._id }, { $set: { taskId: 'atomic' } }), /UNIQUE/)
  assert.equal((await Jobs.findById(job._id)).taskId, 'unique')
  await job.deleteOne()
  assert.equal(await Jobs.findById(job._id), null)
})
