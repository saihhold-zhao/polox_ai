import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { textEditPrompt, validateTextEditAnswer, validateTextEditAnswers, validateTextLines } from '../shared/utils/imageTextEditor.ts';
function loadFunction(file, name, context) {
    const path = new URL(file, import.meta.url);
    const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(fn, name);
    vm.runInContext(ts.transpileModule(fn.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const imageUrl = 'https://example.com/original.png';
const lines = [
    { original: 'Hello', text: '你好', location: 'upper left' },
    { original: 'Keep', text: 'Keep', location: 'bottom right' },
];
const edit = { imageUrl, lines };
test('strict validation preserves literal text, allows deletion, rejects malformed and forged edits', () => {
    assert.deepEqual(validateTextLines(lines), lines);
    assert.equal(validateTextLines([{ ...lines[0], text: '' }])[0].text, '');
    for (const location of ['', null, 'x'.repeat(301)])
        assert.throws(() => validateTextLines([{ ...lines[0], location }]));
    assert.throws(() => validateTextEditAnswer(edit, [{ ...lines[0], location: 'forged' }, lines[1]], [imageUrl]), /match/);
    assert.throws(() => validateTextEditAnswer(edit, lines, []), /source image/);
    assert.throws(() => validateTextEditAnswer(edit, [{ ...lines[0], original: 'Forged' }, lines[1]], [imageUrl]), /match/);
    assert.throws(() => validateTextEditAnswer(edit, lines.map(line => ({ ...line, text: line.original })), [imageUrl]), /Change at least/);
    const prompt = textEditPrompt(lines);
    assert.match(prompt, /supplied original image/);
    assert.match(prompt, /"Hello" to "你好"/);
    assert.doesNotMatch(prompt, /"Keep"/);
});
test('HTTP choice roundtrip validates source and approximate descriptions and cancellation cannot authorize generation', () => {
    const context = vm.createContext({ validateTextEditAnswer, validateTextEditAnswers });
    loadFunction('../server/agent/router.ts', 'parseChoiceBody', context);
    loadFunction('../server/agent/loop.ts', 'formatChoiceResult', context);
    const payload = { id: 'card', textEdit: edit, questions: [] };
    const body = context.parseChoiceBody({ choiceId: 'card', action: 'submit', answers: [{ questionId: 'image_text_editor', textLines: lines }] });
    const result = JSON.parse(context.formatChoiceResult(payload, body, [imageUrl]));
    assert.deepEqual(result.textEdit, edit);
    assert.throws(() => context.formatChoiceResult(payload, body, []), /source image/);
    const cancelled = JSON.parse(context.formatChoiceResult(payload, { action: 'skip' }, [imageUrl]));
    assert.equal(cancelled.skipped, true);
    assert.equal(cancelled.textEdit, undefined);
});
test('provider receives full original, without private compositing metadata', async () => {
    let request;
    const context = vm.createContext({
        asRecord: value => value,
        isProviderStarted: () => false,
        createFalTask: async (model, input) => { request = { model, input }; return { requestId: 'provider-id' }; },
    });
    loadFunction('../server/utils/generationQueue.ts', 'startProviderTask', context);
    await context.startProviderTask({ provider: 'fal', model: 'gpt-image-2-image-to-image', input: { input_urls: [imageUrl], prompt: textEditPrompt(lines) }, save: async () => { } });
    assert.deepEqual(request.input.input_urls, [imageUrl]);
    assert.equal(request.input._textEdit, undefined);
});
test('archive saves the provider image unchanged without downloading the original', async () => {
    const stored = [];
    const context = vm.createContext({
        migrateLegacySourceUrls: () => { },
        needsArchive: () => true,
        MAX_ARCHIVE_ATTEMPTS: 12,
        isVideoJob: () => false,
        downloadSource: async (url) => ({ buffer: url, contentType: 'image/jpeg', extension: 'jpg' }),
        saveMediaFile: async (key, bytes, type) => { stored.push({ key, bytes, type }); return 'https://media.example.com/final.png'; },
        isStoredMediaUrl: url => url.startsWith('https://media.example.com/'),
        dispatchQueuedJobs: async () => { },
        syncAgentRuntimeFromJob: async () => { },
    });
    loadFunction('../server/utils/generationPipeline.ts', 'archiveJob', context);
    const job = { taskId: 'task', state: 'moderating', archiveAttempts: 0, input: { input_urls: [imageUrl] }, resultAssets: [{ sourceUrl: 'https://example.com/generated.png', status: 'pending' }], save: async () => { }, markModified: () => { } };
    await context.archiveJob(job);
    assert.equal(job.state, 'success');
    assert.equal(job.resultUrls[0], 'https://media.example.com/final.png');
    assert.equal(stored[0].bytes, 'https://example.com/generated.png');
    assert.equal(stored[0].type, 'image/jpeg');
    job.state = 'archiving';
    await context.archiveJob(job);
    assert.equal(stored.length, 1);
});
test('LLM detection transcribes every line with approximate locations and no replacement authorization', async () => {
    let request;
    let response = JSON.stringify([{ original: 'Hello', location: 'upper left', text: 'Unrequested edit', bbox: [1, 2, 3, 4] }, { original: 'Keep', location: 'bottom right' }]);
    const context = vm.createContext({
        AbortSignal,
        falReadableUrl: async url => url,
        validateTextLines,
        resolveSessionUrl: () => ({ url: imageUrl }),
        completeText: async (options) => { request = options; return response; },
    });
    loadFunction('../server/agent/imageTextEditor.ts', 'detectTextSource', context);
    loadFunction('../server/agent/imageTextEditor.ts', 'detectImageText', context);
    const session = { images: [{ url: imageUrl, kind: 'upload', status: 'success' }] };
    const card = await context.detectImageText('{}', session);
    assert.equal(request.messages[1].content[0].image_url.url, imageUrl);
    assert.equal(card.textEdit.lines.length, 2);
    assert.equal(card.textEdit.lines[0].text, 'Hello');
    assert.equal(card.textEdit.lines[0].location, 'upper left');
    assert.equal(card.textEdit.lines[0].bbox, undefined);
    response = '[]';
    await assert.rejects(context.detectImageText('{}', session), /No readable text/);
    await assert.rejects(context.detectImageText('{}', { images: [] }), /Upload a source image/);
});
test('batch choice roundtrip binds each draft to its own detected source and rejects duplicate or forged images', () => {
    const second = { imageUrl: 'https://example.com/second.png', lines: [{ original: 'CAFE', text: '茶馆', location: 'center' }] };
    const broken = { imageUrl: 'https://example.com/broken.png', lines: [], detectionError: 'No text' };
    const detected = [edit, second, broken];
    const urls = detected.map(item => item.imageUrl);
    const context = vm.createContext({ validateTextEditAnswer, validateTextEditAnswers });
    loadFunction('../server/agent/router.ts', 'parseChoiceBody', context);
    loadFunction('../server/agent/loop.ts', 'formatChoiceResult', context);
    const body = context.parseChoiceBody({ choiceId: 'batch', action: 'submit', answers: [{ questionId: 'image_text_editor', textEdits: [second, edit] }] });
    assert.deepEqual(JSON.parse(context.formatChoiceResult({ textEdits: detected }, body, urls)).textEdits, [second, edit]);
    assert.deepEqual(validateTextEditAnswers(detected, [second], urls), [second], 'Unchanged images may be excluded');
    for (const incoming of [[], [edit, edit], [broken], [{ ...edit, imageUrl: 'https://example.com/unrelated.png' }], [{ ...second, lines }], [{ ...edit, lines: lines.map(line => ({ ...line, text: line.original })) }]])
        assert.throws(() => validateTextEditAnswers(detected, incoming, urls));
    assert.throws(() => validateTextEditAnswers(detected, [second], [imageUrl]), /source image/);
    assert.equal(JSON.parse(context.formatChoiceResult({ textEdits: detected }, { action: 'skip' }, urls)).textEdits, undefined);
});
test('multi-image detection covers current attachments once in upload order and isolates failures', async () => {
    const urls = ['https://example.com/first.png', 'https://example.com/empty.png', imageUrl];
    const requests = [];
    const context = vm.createContext({
        AbortSignal,
        falReadableUrl: async url => url, validateTextLines,
        resolveSessionUrl: () => ({ url: imageUrl }),
        completeText: async (options) => {
            const url = options.messages[1].content[0].image_url.url;
            requests.push(url);
            return url === urls[1] ? '[]' : JSON.stringify([{ original: url === imageUrl ? 'CAFE' : 'Hello', location: 'center' }]);
        },
    });
    loadFunction('../server/agent/imageTextEditor.ts', 'detectTextSource', context);
    loadFunction('../server/agent/imageTextEditor.ts', 'detectImageText', context);
    const imagePart = url => ({ type: 'image_url', image_url: { url } });
    const session = {
        images: [...urls, 'https://example.com/history.png'].map(url => ({ url, kind: 'upload', status: 'success' })),
        messages: [{ role: 'user', content: [imagePart('https://example.com/history.png')] }, { role: 'user', content: [...urls, imageUrl].map(imagePart) }, { role: 'user', internal: true, content: 'Internal continuation' }],
    };
    const card = await context.detectImageText('{}', session);
    assert.deepEqual(requests, urls);
    assert.deepEqual(Array.from(card.textEdits, item => item.imageUrl), urls);
    assert.equal(card.textEdits[0].lines[0].original, 'Hello');
    assert.match(card.textEdits[1].detectionError, /No readable text/);
    assert.equal(card.textEdits[2].lines[0].original, 'CAFE');
});
