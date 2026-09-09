import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function harness(fail = false) {
    const writes = [];
    const source = readFileSync(new URL('../server/agent/upload.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
    const context = vm.createContext({ exports: {}, uploadFalFile: async () => 'https://cdn.fal.media/upload.png', crypto: { randomUUID: () => 'unique-upload' }, saveMediaFile: async (...args) => {
            writes.push(args);
            if (fail)
                throw new Error('local storage unavailable');
            return `https://media.example.com/${args[0]}`;
        } });
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    return { upload: context.exports.uploadAgentImage, writes };
}
test('Agent uploads the original bytes to local storage and returns a fal CDN URL', async () => {
    const h = harness();
    const bytes = new Uint8Array([1, 2, 3]);
    const url = await h.upload('session-1', { bytes, mime: 'image/png' });
    assert.equal(url, 'https://cdn.fal.media/upload.png');
    assert.equal(h.writes[0][1], bytes);
    assert.equal(h.writes[0][2], 'image/png');
});
test('invalid files never reach storage', async () => {
    const h = harness();
    for (const file of [{ bytes: new Uint8Array(1), mime: 'text/html' }, { bytes: new Uint8Array(), mime: 'image/png' }, { bytes: new Uint8Array(10 * 1024 * 1024 + 1), mime: 'image/png' }])
        await assert.rejects(h.upload('session-1', file));
    assert.equal(h.writes.length, 0);
});
test('local storage failure is surfaced without another upload destination', async () => {
    const h = harness(true);
    await assert.rejects(h.upload('session-1', { bytes: new Uint8Array(1), mime: 'image/png' }), /local storage unavailable/);
    assert.equal(h.writes.length, 1);
});
test('upload handler records the fal CDN URL as the session attachment', async () => {
    const source = readFileSync(new URL('../server/agent/loop.ts', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('loop.ts', source, ts.ScriptTarget.Latest, true);
    const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleUpload');
    const session = { id: 'session' };
    let recorded;
    const h = harness();
    const context = vm.createContext({ exports: {}, uploadFalFile: async () => 'https://cdn.fal.media/upload.png', crypto: { randomUUID: () => 'image-id' }, resolveChatSession: async () => session, uploadAgentImage: h.upload, upsertImage: (target, image) => { assert.equal(target, session); recorded = image; } });
    vm.runInContext(ts.transpileModule(fn.getText(tree), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    const response = await context.exports.handleUpload(session.id, { bytes: new Uint8Array([1]), fileName: 'original.png', mime: 'image/png' });
    assert.equal(response.image.url, 'https://cdn.fal.media/upload.png');
    assert.equal(recorded.url, response.image.url);
    assert.equal(recorded.kind, 'upload');
});
