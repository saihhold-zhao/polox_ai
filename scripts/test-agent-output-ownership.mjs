import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { confirmationMedia, reconcileConfirmationStates } from '../app/utils/agentConfirmationState.ts';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function compile(source, values = {}) {
    const context = vm.createContext({ crypto, ...values });
    vm.runInContext(ts.transpileModule(source.replaceAll('export function', 'function'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    return context;
}
test('history attaches generated media to its tool call, never to later URL mentions', () => {
    const source = read('../server/agent/session.ts');
    const context = compile(source.slice(source.indexOf('function flattenContent('), source.indexOf('function httpUrlsFromArgs(')), {
        isInternalAgentChatText: () => false,
        publicAgentChatText: text => text,
    });
    const images = [{ id: 'old', url: 'https://example.com/old.png' }, { id: 'new', url: 'https://example.com/new.mp4' }, { id: 'upload', kind: 'upload', url: 'https://example.com/ref.png' }];
    const rows = context.visibleTranscript([
        { role: 'user', content: [{ type: 'image_url', image_url: { url: images[2].url } }] },
        { role: 'assistant', content: '', tool_calls: [{ id: 'old' }] },
        { role: 'user', content: 'Make a new clip' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'new' }] },
        { role: 'assistant', content: `Here is the old poster: ${images[0].url}` },
    ], images);
    assert.deepEqual(Array.from(rows[0].imageIds), ['upload']);
    assert.deepEqual(Array.from(rows[1].imageIds), ['old']);
    assert.deepEqual(Array.from(rows[3].imageIds), ['new']);
    assert.equal(rows[4].imageIds, undefined);
});
test('catch-up is explicitly marked and updates assets without appending old thumbnails', () => {
    const loop = read('../server/agent/loop.ts');
    const emitted = [];
    const server = compile(loop.slice(loop.indexOf('function emitSessionCatchUp('), loop.indexOf('export async function handleStop(')));
    server.emitSessionCatchUp({ images: [{ id: 'old', status: 'success', url: 'https://example.com/old.png' }] }, event => emitted.push(event));
    assert.equal(emitted[0].replay, true);
    const source = read('../app/composables/useAgentLab.ts');
    const start = source.indexOf('  function applyEventToState(');
    const context = compile(source.slice(start, source.indexOf('\n  function applyEvent(', start)), {

        persistCanvasResults: async () => { },
        confirmationMedia,
        reconcileConfirmationStates,
    });
    const state = { messages: [{ role: 'assistant', content: 'Latest reply' }], images: [] };
    context.applyEventToState(emitted[0], state);
    assert.equal(state.images.length, 1);
    assert.equal(state.messages[0].imageIds, undefined);
    context.applyEventToState({ type: 'image', image: { id: 'new', status: 'generating' } }, state);
    assert.deepEqual(Array.from(state.messages[0].imageIds), ['new']);
    context.applyEventToState({ type: 'image', image: { id: 'new', status: 'success' } }, state);
    assert.deepEqual(Array.from(state.messages[0].imageIds), ['new']);
});
test('legacy snapshots retain stable identities across loads without collapsing repeated user turns', async () => {
    const { createHash } = await import('node:crypto');
    const source = read('../server/agent/session.ts');
    const context = compile(source.slice(source.indexOf('function restoreHistoryIds('), source.indexOf('function hydrateLoaded(')), { createHash });
    const snapshot = { id: 'session', updatedAt: 123, messages: [{ role: 'user', content: 'Continue' }, { role: 'user', content: 'Continue' }] };
    const first = structuredClone(snapshot);
    const second = structuredClone(snapshot);
    context.restoreHistoryIds(first);
    context.restoreHistoryIds(second);
    assert.deepEqual(first, second);
    assert.notEqual(first.messages[0].historyId, first.messages[1].historyId);
    context.restoreHistoryIds(first);
    assert.deepEqual(first, second);
});
test('late SSE assets return to their owning card after another batch or final reply has appeared', () => {
    const source = read('../app/composables/useAgentLab.ts');
    const start = source.indexOf('  function applyEventToState(');
    const context = compile(source.slice(start, source.indexOf('\n  function applyEvent(', start)), {

        persistCanvasResults: async () => { },
        confirmationMedia,
        reconcileConfirmationStates,
    });
    const card = id => ({ id, role: 'assistant', content: '', confirmation: { id, jobs: [{ id: `${id}-job` }] }, confirmationState: 'confirmed' });
    const state = { messages: [card('first'), card('second'), { id: 'done', role: 'assistant', content: 'Done' }], images: [] };
    context.applyEventToState({ type: 'image', image: { id: 'first-job', status: 'generating' } }, state);
    assert.deepEqual(Array.from(state.messages[0].imageIds), ['first-job']);
    assert.equal(state.messages[1].imageIds, undefined);
    assert.equal(state.messages[2].imageIds, undefined);
});
