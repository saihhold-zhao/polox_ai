import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const bin = '/tmp/codex-canvas-npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64'
const run = (...args) => execFileSync(bin, args[0] === 'mouse' && args[1] === 'move' ? args.map((v, i) => i > 1 ? String(Math.round(Number(v))) : v) : args, { encoding: 'utf8' })
const evaluate = script => JSON.parse(run('eval', script, '--json')).data.result
const state = JSON.parse(await fs.readFile('/tmp/canvas-v2-test-state.json', 'utf8'))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function saved() {
  for (let i = 0; i < 40; i++) {
    if (evaluate('document.querySelectorAll("article").length === 2 && [...document.querySelectorAll("[role=status]")].some(e => e.textContent.trim() === "Saved")')) return
    await pause(250)
  }
  throw new Error('Canvas did not finish saving')
}
const geometry = () => evaluate('(()=>{ const a = document.querySelector("article"); const m = new DOMMatrixReadOnly(getComputedStyle(a).transform); const v = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".canvas-surface > div")).transform); return {x:m.m41,y:m.m42,width:parseFloat(a.style.width),height:parseFloat(a.style.height),camera:{x:v.m41,y:v.m42,zoom:v.a},rect:a.getBoundingClientRect().toJSON()}})()')
await fetch(`http://localhost:3100/api/projects/${state.projectId}/canvas`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', cookie: state.cookie },
  body: JSON.stringify({ nodes: [{ id: 'canvas-fixture-0:0', x: 0, y: 0, width: 280, height: 310 }, { id: 'canvas-fixture-1:0', x: 320, y: 0, width: 280, height: 310 }], camera: { x: 40, y: 50, zoom: 0.85 }, nextSlot: 2, version: Date.now() * 1000 }),
})
run('reload')
await saved()
const before = geometry()
run('mouse', 'move', String(before.rect.x + 60), String(before.rect.y + 60))
run('mouse', 'down')
run('mouse', 'up')
assert.equal(evaluate('document.querySelectorAll(".canvas-resize").length'), 4)
const handle = evaluate('document.querySelector(".canvas-resize-se").getBoundingClientRect().toJSON()')
run('mouse', 'move', String(handle.x + handle.width / 2), String(handle.y + handle.height / 2))
run('mouse', 'down')
run('mouse', 'move', String(handle.x + handle.width / 2 + 85), String(handle.y + handle.height / 2 + 94))
run('mouse', 'up')
await saved()
const resized = geometry()
assert.ok(resized.width > before.width + 50)
assert.ok(Math.abs(resized.x - before.x) < 0.01)
assert.ok(Math.abs(resized.y - before.y) < 0.01)
assert.ok(Math.abs(resized.width / resized.height - before.width / before.height) < 1e-5)
run('mouse', 'move', String(resized.rect.x + 60), String(resized.rect.y + 60))
run('mouse', 'down')
run('mouse', 'move', String(resized.rect.x + 190), String(resized.rect.y + 120))
run('mouse', 'up')
await saved()
const moved = geometry()
assert.ok(moved.x > resized.x + 50)
run('find', 'role', 'button', 'click', '--name', 'Zoom in')
await saved()
const final = geometry()
const database = evaluate(`fetch('/api/projects/${state.projectId}/canvas/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:['canvas-fixture-0:0']})}).then(r=>r.json())`)
assert.ok(Math.abs(database.nodes[0].x - final.x) < 0.01)
assert.ok(Math.abs(database.nodes[0].width - final.width) < 0.01)
assert.ok(Math.abs(database.camera.zoom - final.camera.zoom) < 0.0001)
evaluate(`localStorage.removeItem('canvas-layout:${state.projectId}')`)
run('reload')
await saved()
const restored = geometry()
for (const field of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored[field] - final[field]) < 0.01, field)
assert.deepEqual(restored.camera, final.camera)
evaluate(`document.querySelectorAll('[aria-label="View details"]')[1].click()`)
assert.ok(evaluate('document.querySelector("[role=dialog]")?.innerText.includes("Generation details")'))
assert.ok(evaluate('document.querySelector("[role=dialog]")?.innerText.includes("A failed image generation")'))
run('press', 'Escape')
const current = geometry()
run('mouse', 'move', String(current.rect.x + 40), String(current.rect.y + 40))
run('mouse', 'down')
run('mouse', 'up')
run('screenshot', '/tmp/canvas-v2-verified.png')
console.log('PASS: four handles, proportional corner resize, drag, zoom, database coordinates/dimensions, reload after clearing local cache, failed-result details')
console.log(JSON.stringify({saved:{x:final.x,y:final.y,width:final.width,height:final.height,camera:final.camera},restored:{x:restored.x,y:restored.y,width:restored.width,height:restored.height,camera:restored.camera}}))
