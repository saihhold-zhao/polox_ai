import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileConfirmationStates } from '../app/utils/agentConfirmationState.ts';
import { isAgentTransientMessage } from '../shared/utils/agentHistoryVisibility.ts';
import { isAgentDisconnectError, recoverAgentTranscript } from '../shared/utils/agentRecovery.ts';
const create = row => ({ ...row, id: crypto.randomUUID() });
test('recognizes browser network error spellings without hiding tool failures', () => {
    for (const text of ['network error', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Failed to fetch', 'network request failed'])
        assert.equal(isAgentDisconnectError(new Error(text)), true);
    assert.equal(isAgentDisconnectError('Invalid generation parameters'), false);
});
test('recovers final concat reply, preserving cards and completing interrupted text once', () => {
    const local = [
        { id: 'u', role: 'user', content: 'Make a movie', imageIds: ['upload'] },
        { id: 'a', role: 'assistant', content: 'I will generate the clips.', confirmation: { id: 'confirm' } },
        { id: 'media', role: 'assistant', content: '', imageIds: ['clip1', 'clip2'] },
        { id: 'partial', role: 'assistant', content: 'All four clips' },
        { id: 'error', role: 'assistant', content: 'network error', kind: 'error' },
    ];
    const remote = [
        { role: 'user', content: 'Make a movie', imageIds: ['upload'] },
        { role: 'assistant', content: 'I will generate the clips.' },
        { role: 'assistant', content: 'All four clips generated. Stitching now.' },
        { role: 'assistant', content: 'Your final film: https://example.com/concat.mp4' },
    ];
    const merged = recoverAgentTranscript(local, remote, create);
    assert.equal(merged.length, 5);
    assert.equal(merged[1].confirmation.id, 'confirm');
    assert.deepEqual(merged[2].imageIds, ['clip1', 'clip2']);
    assert.equal(merged[3].id, 'partial');
    assert.equal(merged[4].content, remote[3].content);
    assert.deepEqual(recoverAgentTranscript(merged, remote, create), merged);
    assert.equal(local[3].content, 'All four clips');
});
test('keeps repeated user turns distinct and retains genuine errors', () => {
    const remote = [
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'First result' },
        { role: 'user', content: 'Continue' },
        { role: 'assistant', content: 'Second result' },
    ];
    const local = remote.slice(0, 3).map(create);
    local.push({ id: 'err', role: 'assistant', kind: 'error', content: 'Invalid generation parameters' });
    const merged = recoverAgentTranscript(local, remote, create);
    assert.equal(merged.filter(m => m.role === 'user').length, 2);
    assert.equal(merged.filter(m => m.kind === 'error').length, 1);
    assert.deepEqual(recoverAgentTranscript(merged, remote, create), merged);
});
test('completed snapshot restores chat, concat thumbnail, stale choices, and idle state', async () => {
    const { readFileSync } = await import('node:fs');
    const { default: ts } = await import('typescript');
    const { default: vm } = await import('node:vm');
    const { ref, computed } = await import('vue');
    const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8');
    const start = source.indexOf('  async function hydrateServer()');
    const end = source.indexOf('\n  function patchStoredAgent', start);
    const run = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const messages = ref([
        { id: 'u', role: 'user', content: 'Make a movie' },
        { id: 'a', role: 'assistant', content: 'Generating clips.', confirmationState: 'pending', choiceState: 'pending', choiceAnswers: [{ text: 'Forest' }] },
        { id: 'e', role: 'assistant', content: 'network error', kind: 'error' },
    ]);
    const choice = ref({ id: 'old-question' });
    const confirmation = ref({ id: 'old-generation-card', approvedBy: 'agent' });
    const context = vm.createContext({
        crypto,
        messages,
        choice,
        confirmation,
        recoverAgentTranscript,
        reconcileConfirmationStates,
        isAgentTransientMessage,
        agentWriteRetryAt: 0,

        isDisconnectError: isAgentDisconnectError,
        sessionId: ref('test-session'),
        activeAgentId: ref('test-agent'),
        streamEpoch: 0,
        activeTurns: 0,
        baseUrl: '/api/agent',
        agentTitle: ref('Movie'),
        titleSource: ref('auto'),
        images: ref([]),
        status: ref('thinking'),
        pending: ref(true),
        queueNotice: ref(''),
        stopping: ref(false),
        error: ref('network error'),
        waitingForUser: computed(() => Boolean(choice.value || (confirmation.value && confirmation.value.approvedBy !== 'agent'))),
        shouldAutoApprove: card => card?.approvedBy === 'agent',
        unionSessionImages: (_local, remote) => remote,
        syncLabBusyFromImages: () => { },
        fetch: async () => ({ ok: true, json: async () => ({
                busy: false,
                pendingChoice: null,
                pendingConfirmation: null,
                messages: [{ role: 'user', content: 'Make a movie' }, { role: 'assistant', content: 'Generating clips.' }, { role: 'assistant', content: 'Done: https://example.com/concat.mp4', imageIds: ['concat'] }],
                images: [
                    { id: 'concat', kind: 'video', videoMode: 'concat', status: 'success', url: 'https://example.com/concat.mp4' },
                    { id: 'unlinked-old', kind: 'still', status: 'success', url: 'https://example.com/old.png' },
                ],
            }) }),
    });
    vm.runInContext(run, context);
    await context.hydrateServer();
    assert.equal(messages.value.at(-1).content, 'Done: https://example.com/concat.mp4');
    assert.equal(messages.value.at(-1).imageIds[0], 'concat');
    assert.equal(messages.value.some(message => message.imageIds?.includes('unlinked-old')), false, 'Old unlinked assets must remain in the canvas without being appended to the latest turn');
    assert.equal(messages.value[1].choiceState, 'answered');
    assert.equal(context.status.value, 'idle');
    assert.equal(context.pending.value, false);
    assert.equal(context.error.value, '');
    assert.equal(choice.value, null);
    assert.equal(confirmation.value, null);
    assert.equal(messages.value[1].confirmationState, 'cancelled');
    const component = readFileSync(new URL('../app/components/agent-lab/AgentLabChat.vue', import.meta.url), 'utf8');
    const lockStart = component.indexOf('const composerLocked = computed(');
    const lockEnd = component.indexOf('const agentRunning', lockStart);
    context.computed = computed;
    context.props = { pending: context.pending.value, status: context.status.value, confirmationOpen: false, choiceOpen: false };
    vm.runInContext(component.slice(lockStart, lockEnd), context);
    assert.equal(vm.runInContext('composerLocked.value', context), false, 'Finished chat must accept another message');
    await context.hydrateServer();
    assert.equal(messages.value.length, 3);
});
test('SSE heartbeats keep idle work alive and are cleaned up on cancellation', async () => {
    const { readFileSync } = await import('node:fs');
    const { default: ts } = await import('typescript');
    const { default: vm } = await import('node:vm');
    let tick;
    let cleared = false;
    let finish;
    const context = vm.createContext({
        TextEncoder,
        ReadableStream,
        setInterval: (callback) => { tick = callback; return 1; },
        clearInterval: () => { cleared = true; },
    });
    const source = readFileSync(new URL('../server/agent/sse.ts', import.meta.url), 'utf8')
        .replace(/^import .*$/gm, '')
        .replaceAll('export function', 'function');
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const stream = context.createAgentEventStream(() => new Promise((resolve) => { finish = resolve; }));
    const reader = stream.getReader();
    tick();
    const chunk = await reader.read();
    assert.equal(new TextDecoder().decode(chunk.value), ': heartbeat\n\n');
    await reader.cancel();
    assert.equal(cleared, true);
    finish();
});
test('refresh merges richer card history instead of replacing it with longer plain text history', () => {
    const rich = [
        { id: 'u', role: 'user', content: 'Movie', imageIds: ['upload'] },
        { id: 'a', role: 'assistant', content: 'Choose a style', choice: { id: 'choice' }, choiceState: 'answered', choiceAnswers: [{ text: 'Anime' }] },
        { id: 'c', role: 'assistant', content: '', confirmation: { id: 'generation' }, confirmationState: 'confirmed', resolvedParams: { resolution: '480p' }, imageIds: ['clip'] },
    ];
    const plain = [
        { role: 'user', content: 'Movie' },
        { role: 'assistant', content: 'Choose a style' },
        { role: 'assistant', content: 'Stitching' },
        { role: 'assistant', content: 'Done' },
    ];
    for (const [left, right] of [[rich, plain], [plain.map(create), rich]]) {
        const merged = recoverAgentTranscript(left, right, create);
        assert.equal(merged.find(m => m.choice)?.choiceState, 'answered');
        assert.equal(merged.find(m => m.confirmation)?.resolvedParams.resolution, '480p');
        assert.ok(merged.some(m => m.content === 'Done'));
        assert.deepEqual(recoverAgentTranscript(merged, right, create), merged);
    }
    const stale = rich.map(row => ({ ...row, choiceState: row.choice ? 'pending' : undefined }));
    assert.equal(recoverAgentTranscript(rich, stale, create).find(m => m.choice).choiceState, 'answered');
});
test('archive sanitizer and database schema retain cards, answers, and resolved parameters', async () => {
    const { readFileSync } = await import('node:fs');
    const { default: ts } = await import('typescript');
    const { default: vm } = await import('node:vm');
    const { defineCollection } = await import('../server/utils/sqlite.ts');
    const modelSource = readFileSync(new URL('../server/models/agentChat.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
    const modelContext = vm.createContext({ exports: {}, defineCollection });
    vm.runInContext(ts.transpileModule(modelSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, modelContext);
    const { AgentChat } = modelContext.exports;
    const source = readFileSync(new URL('../server/utils/agentChats.ts', import.meta.url), 'utf8');
    const begin = source.indexOf('function cardRecord(');
    const end = source.indexOf('\nfunction sanitizeImages', begin);
    const context = vm.createContext({ crypto, isAgentTransientMessage, MAX_MESSAGES: 120, MAX_IDS: 16, MAX_CONTENT: 4000, clip: (value, max) => String(value || '').slice(0, max) });
    vm.runInContext(ts.transpileModule(source.slice(begin, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    const original = { id: 'msg', role: 'assistant', content: 'Choose', choice: { id: 'pick', questions: [] }, choiceState: 'answered', choiceAnswers: [{ questionId: 'q', text: 'Anime' }], confirmation: { id: 'generation', params: { resolution: '480p' } }, confirmationState: 'confirmed', resolvedParams: { resolution: '720p' } };
    const sanitized = context.sanitizeMessages([original]);
    const document = new AgentChat({ sessionId: 'test', messages: sanitized });
    const saved = document.toObject().messages[0];
    assert.equal(saved.choice.id, 'pick');
    assert.equal(saved.choiceState, 'answered');
    assert.equal(saved.choiceAnswers[0].text, 'Anime');
    assert.equal(saved.confirmation.id, 'generation');
    assert.equal(saved.resolvedParams.resolution, '720p');
});
test('temporary server failures show a refresh hint and remain recoverable', async () => {
    const { agentRecoveryNotice, isAgentDisconnectError } = await import('../shared/utils/agentRecovery.ts');
    for (const message of ['Server Error', 'Internal Server Error', '502 Bad Gateway', '503 Service Unavailable']) {
        assert.equal(isAgentDisconnectError(message), true);
        const notice = agentRecoveryNotice(message);
        assert.match(notice, /refresh the page/);
        assert.equal(isAgentDisconnectError(notice), true);
    }
    assert.equal(agentRecoveryNotice('Invalid generation parameters'), 'Invalid generation parameters');
});
test('legacy busy notices do not crowd out real conversation during recovery', () => {
    const errors = Array.from({ length: 56 }, (_, i) => ({ id: `error-${i}`, role: 'assistant', kind: 'error', content: 'This session is already running' }));
    const real = { id: 'real', role: 'user', content: 'Keep this conversation' };
    const merged = recoverAgentTranscript([...errors, real], [...errors, real], create);
    assert.deepEqual(merged.map(row => row.id), ['real']);
});
test('rate limit notices are removed from old snapshots and never grow on repeated refresh', () => {
    const notice = 'Too many Agent Lab requests. Wait a moment and try again.';
    const local = [
        { id: 'error1', role: 'assistant', kind: 'error', content: notice },
        { id: 'error2', role: 'assistant', kind: 'error', content: notice },
        { id: 'working', role: 'assistant', content: 'Generating videos', confirmation: { id: 'batch' }, confirmationState: 'confirmed' },
    ];
    const remote = local.map(row => ({ ...row, id: `ui:${row.id}` }));
    let merged = local;
    for (let refresh = 0; refresh < 5; refresh++)
        merged = recoverAgentTranscript(merged, remote, row => ({ ...row }));
    assert.equal(merged.length, 1);
    assert.equal(merged[0].confirmation.id, 'batch');
    assert.equal(merged[0].confirmationState, 'confirmed');
    assert.equal(isAgentTransientMessage({ kind: 'error', content: notice }), true);
    assert.equal(isAgentTransientMessage({ role: 'user', content: notice }), false);
});
test('persisted genuine errors merge by archive identity without duplicating or swallowing later errors', () => {
    let local = [{ id: 'e1', role: 'assistant', kind: 'error', content: 'Invalid generation parameters' }];
    const remote = [
        { ...local[0], id: 'ui:e1' },
        { id: 'ui:e2', role: 'assistant', kind: 'error', content: 'Invalid generation parameters' },
    ];
    for (let refresh = 0; refresh < 5; refresh++)
        local = recoverAgentTranscript(local, remote, row => ({ ...row }));
    assert.equal(local.length, 2);
});
test('polling merges tool outputs into their confirmation card without inserting duplicate rows', () => {
    const local = [
        { id: 'u', role: 'user', content: 'Make six shots' },
        { id: 'stills', role: 'assistant', content: '', confirmation: { id: 'c-still', jobs: [{ id: 's1' }, { id: 's2' }] }, imageIds: ['s2', 's1'] },
        { id: 'duplicate', role: 'assistant', content: '', imageIds: ['s1', 's2'] },
        { id: 'videos', role: 'assistant', content: '', confirmation: { id: 'c-video', jobs: [{ id: 'v1' }, { id: 'v2' }] }, confirmationState: 'confirmed' },
        { id: 'done', role: 'assistant', content: 'Done' },
    ];
    const remote = [
        { id: 'history:u', role: 'user', content: 'Make six shots' },
        { id: 'history:stills', role: 'assistant', content: '<think>Generate the stills</think>', imageIds: ['s1', 's2'] },
        { id: 'history:videos', role: 'assistant', content: '<think>Animate the stills</think>', imageIds: ['v1', 'v2'] },
        { id: 'history:done', role: 'assistant', content: 'Done' },
    ];
    const merged = recoverAgentTranscript(local, remote, create);
    assert.deepEqual(merged.map(item => item.id), remote.map(item => item.id));
    assert.equal(merged[1].confirmation.id, 'c-still');
    assert.equal(merged[2].confirmation.id, 'c-video');
    assert.equal(merged[2].confirmationState, 'confirmed');
    assert.deepEqual(merged[2].imageIds, ['v1', 'v2']);
    assert.deepEqual(recoverAgentTranscript(merged, remote, create), merged);
    assert.deepEqual(local[2].imageIds, ['s1', 's2']);
});
test('identical thinking text in different batches does not attach outputs to the wrong card', () => {
    const local = ['first', 'second'].map(id => ({ id, role: 'assistant', content: 'Generating', confirmation: { id, jobs: [{ id: `${id}-job` }] } }));
    const remote = [{ id: 'history:second', role: 'assistant', content: 'Generating', imageIds: ['second-job'] }];
    const merged = recoverAgentTranscript(local, remote, create);
    assert.equal(merged[0].imageIds, undefined);
    assert.deepEqual(merged[1].imageIds, ['second-job']);
    assert.equal(merged[1].confirmation.id, 'second');
});
