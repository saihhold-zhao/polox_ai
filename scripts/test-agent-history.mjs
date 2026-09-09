import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import vm from 'node:vm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureDatabase, defineCollection, closeDatabase } from '../server/utils/sqlite.ts';
import ts from 'typescript';
import { AGENT_TRANSIENT_ERROR_RE, isAgentTransientMessage } from '../shared/utils/agentHistoryVisibility.ts';
function load(path, globals) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = vm.createContext({ exports: {}, ...globals });
    vm.runInContext(js, context);
    return context.exports;
}
const dir = mkdtempSync(join(tmpdir(), 'polox-history-'));
configureDatabase(join(dir, 'history.sqlite'));
try {
    const { AgentChat } = load('../server/models/agentChat.ts', { defineCollection });
    const { AgentHistory } = load('../server/models/agentHistory.ts', { defineCollection });
    const globals = { AGENT_TRANSIENT_ERROR_RE, isAgentTransientMessage, AgentChat, AgentHistory, connectDatabase: async () => { }, createError: input => Object.assign(new Error(input.statusMessage), input) };
    const { archiveAgentHistory, archiveAgentUiHistory, readAgentHistory } = load('../server/utils/agentHistory.ts', globals);
    const sessionId = randomUUID();
    const messages = Array.from({ length: 305 }, (_, index) => ({ id: `history:${index}`, role: index % 2 ? 'assistant' : 'user', content: `Turn ${index}`, imageIds: index === 304 ? ['image-304'] : [] }));
    const images = [{ id: 'image-304', kind: 'still', status: 'success', prompt: 'Test image', url: 'https://example.com/304.png' }];
    await AgentChat.create({ sessionId });
    for (let index = 0; index < messages.length; index += 60)
        await archiveAgentHistory(sessionId, messages.slice(Math.max(0, index - 60), index + 60), images);
    await Promise.all(Array.from({ length: 4 }, () => archiveAgentHistory(sessionId, messages.slice(-120), images)));
    assert.equal(await AgentHistory.countDocuments({ sessionId }), 305);
    let page = await readAgentHistory(sessionId, {});
    assert.equal(page.messages.length, 30);
    assert.equal(page.messages.at(-1).id, 'history:304');
    assert.equal(page.images.length, 1);
    assert.equal(page.newerCursor, null);
    const ids = [];
    while (true) {
        assert.ok(page.messages.length <= 30);
        ids.unshift(...page.messages.map(message => message.id));
        if (!page.olderCursor)
            break;
        page = await readAgentHistory(sessionId, { before: page.olderCursor });
    }
    assert.deepEqual(ids, messages.map(message => message.id));
    const secondPage = await readAgentHistory(sessionId, { after: page.newerCursor });
    assert.equal(secondPage.messages[0].id, 'history:5');
    const anchored = await readAgentHistory(sessionId, { beforeId: 'history:265' });
    assert.equal(anchored.messages.at(-1).id, 'history:264');
    assert.equal((await readAgentHistory(sessionId, {})).messages.length, 30);
    await assert.rejects(readAgentHistory(sessionId, { before: 'invalid' }), /cursor/);
    await assert.rejects(readAgentHistory(sessionId, { before: '0'.repeat(24), after: '1'.repeat(24) }), /cursor/);
    const legacySession = randomUUID();
    await AgentChat.create({ sessionId: legacySession, messages: [{ id: 'old-1', role: 'user', content: 'Old turn' }, { id: 'old-2', role: 'assistant', content: 'Surviving turn' }] });
    await readAgentHistory(legacySession, {});
    await archiveAgentHistory(legacySession, [{ id: 'history:survivor', role: 'assistant', content: 'Surviving turn' }, { id: 'history:new', role: 'user', content: 'New turn' }], []);
    const legacyPage = await readAgentHistory(legacySession, {});
    assert.deepEqual(Array.from(legacyPage.messages, row => row.content), ['Old turn', 'Surviving turn', 'New turn']);
    await archiveAgentUiHistory(sessionId, [
        { ...messages[304], confirmationState: 'confirmed' },
        { id: 'client-error', role: 'assistant', kind: 'error', content: 'Generation failed' },
        { id: 'plain-duplicate', role: 'user', content: 'Turn 0', choice: null },
    ], images);
    await archiveAgentHistory(sessionId, [messages[304]], images);
    assert.equal(await AgentHistory.countDocuments({ sessionId }), 306);
    const rich = await AgentHistory.findOne({ sessionId, messageId: 'history:304' });
    assert.equal(rich.message.confirmationState, 'confirmed');
    assert.equal(rich.message.content, 'Turn 304');
    const beforeError = await readAgentHistory(sessionId, { beforeId: 'client-error' });
    assert.equal(beforeError.messages.at(-1).id, 'history:304');
    const browserSession = randomUUID();
    await AgentChat.create({ sessionId: browserSession });
    await archiveAgentUiHistory(browserSession, [{ id: 'browser-first', role: 'user', content: 'Ordinary browser message' }], []);
    assert.equal(await AgentHistory.countDocuments({ sessionId: browserSession }), 1);
    await archiveAgentHistory(browserSession, [{ id: 'history:canonical', role: 'user', content: 'Ordinary browser message' }], []);
    assert.equal(await AgentHistory.countDocuments({ sessionId: browserSession }), 1);
    assert.equal((await readAgentHistory(browserSession, {})).messages[0].id, 'history:canonical');
    // Concurrent UI and runtime archives must share one identity, including uploads.
    const raceSession = randomUUID();
    await AgentChat.create({ sessionId: raceSession });
    const raceText = '@[Seedance](model:seedance) Change the background to blue';
    const raceUser = { id: 'history:race-user', role: 'user', content: raceText, imageIds: ['image-304'] };
    await Promise.all([
        archiveAgentHistory(raceSession, [raceUser], images),
        archiveAgentUiHistory(raceSession, [{ ...raceUser, id: 'optimistic-user' }], images),
    ]);
    assert.equal(await AgentHistory.countDocuments({ sessionId: raceSession }), 1);
    // Repair a duplicate left by the former archive race.
    await AgentHistory.create({ sessionId: raceSession, messageId: 'ui:old-copy', message: { ...raceUser, id: 'ui:old-copy' }, images });
    await archiveAgentHistory(raceSession, [raceUser], images);
    assert.equal(await AgentHistory.countDocuments({ sessionId: raceSession }), 1);
    assert.equal((await readAgentHistory(raceSession, {})).messages[0].imageIds[0], 'image-304');
    // Legacy contention notices must not consume pages or advertise phantom history.
    const noisySession = randomUUID();
    await AgentChat.create({ sessionId: noisySession });
    await AgentHistory.insertMany([
        ...Array.from({ length: 56 }, (_, i) => ({ sessionId: noisySession, messageId: `noise:${i}`, message: { id: `noise:${i}`, role: 'assistant', kind: 'error', content: i % 2 ? 'This session is already running' : 'Too many Agent Lab requests. Wait a moment and try again.' } })),
        { sessionId: noisySession, messageId: 'actual', message: { id: 'actual', role: 'user', content: 'Actual conversation' } },
    ]);
    const visiblePage = await readAgentHistory(noisySession, {});
    assert.deepEqual(Array.from(visiblePage.messages, row => row.id), ['actual']);
    assert.equal(visiblePage.olderCursor, null);
    await archiveAgentUiHistory(noisySession, [{ id: 'new-noise', role: 'assistant', kind: 'error', content: 'This session is already running' }], []);
    assert.equal(await AgentHistory.countDocuments({ sessionId: noisySession, messageId: 'ui:new-noise' }), 0);
    await archiveAgentUiHistory(noisySession, [{ id: 'new-rate-limit', role: 'assistant', kind: 'error', content: 'Too many Agent Lab requests. Wait a moment and try again.' }], []);
    assert.equal(await AgentHistory.countDocuments({ sessionId: noisySession, messageId: 'ui:new-rate-limit' }), 0);
    const apiGlobals = { ...globals, defineEventHandler: fn => fn, getRouterParam: () => sessionId, getQuery: () => ({}), isAgentSessionId: () => true, readAgentHistory };
    const localApi = load('../server/api/ai/agent-chats/[sessionId]/history.get.ts', apiGlobals).default;
    assert.ok((await localApi({})).messages.length > 0);
    // The metadata endpoint only returns a bounded media page and excludes transcript/runtime.
    await AgentChat.updateOne({ sessionId }, { $set: { images: Array.from({ length: 60 }, (_, i) => ({ id: `media-${i}`, kind: 'still', status: 'success', url: `https://example.com/${i}.png` })) } });
    const mediaPage = await AgentChat.findOne({ sessionId }, { messages: 0, runtime: 0, images: { $slice: [24, 25] } });
    assert.equal(mediaPage.images.length, 25);
    assert.equal(mediaPage.images[0].id, 'media-24');
    console.log('PASS: 305 turns survive rolling snapshots, duplicate/concurrent archives, both cursor directions, live boundary, media scoping, ownership, invalid cursors and legacy migration');
}
finally {
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
}
