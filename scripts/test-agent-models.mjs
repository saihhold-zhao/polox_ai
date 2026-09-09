import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
function load(relative, mocks = {}, globals = {}) {
    const cache = new Map();
    function moduleAt(file) {
        if (cache.has(file))
            return cache.get(file);
        const module = { exports: {} };
        cache.set(file, module.exports);
        const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
        vm.runInNewContext(code, {
            module,
            URL,
            Error,
            exports: module.exports,
            fetch,
            AbortSignal,
            setTimeout,
            structuredClone,
            createError: details => Object.assign(new Error(details.statusMessage), details),
            ...globals,
            require: (id) => {
                if (id.endsWith('/serviceSettings')) return {readServiceSettings: () => ({falKey:'test-key',openRouterKey:'test-key',openRouterModel:'test-model'})};
                if (id in mocks)
                    return mocks[id];
                if (id.startsWith('.') || id.startsWith('~~/')) {
                    const target = id.startsWith('~~/') ? resolve(root, id.slice(3)) : resolve(dirname(file), id);
                    return target.endsWith('.json') ? JSON.parse(readFileSync(target, 'utf8')) : moduleAt(`${target}.ts`);
                }
                return require(id);
            },
        }, { filename: file });
        return module.exports;
    }
    return moduleAt(resolve(root, relative));
}
const registry = load('shared/utils/agentModels.ts');
const session = () => ({ id: 'session', projectId: 'project', quality: 'custom', messages: [], images: [] });
const source = 'https://example.com/source.png';
function validInput(model) {
    const schema = model.schema.components.schemas.Input;
    const raw = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.default !== undefined && prop.default !== '' && !(Array.isArray(prop.default) && !prop.default.length)) {
            raw[key] = prop.default;
        }
        else if ((schema.required || []).includes(key)) {
            if (key === 'prompt')
                raw[key] = 'A quiet lake at sunset with a small sailboat';
            else if (key === 'regions')
                raw[key] = [[10, 20, 500, 600]];
            else if (prop.type === 'array')
                raw[key] = [source];
            else if (key.includes('url'))
                raw[key] = source;
            else if (prop.enum)
                raw[key] = prop.enum[0];
            else if (prop.type === 'boolean')
                raw[key] = true;
            else if (prop.type === 'integer' || prop.type === 'number')
                raw[key] = prop.minimum || 1;
        }
    }
    // Reference models require at least one source across optional media arrays.
    if (model.task === 'Reference to Video')
        raw[schema.properties.image_urls ? 'image_urls' : 'reference_image_urls'] = [source];
    if (model.id === 'minimax-h3/image-to-video')
        raw.image_url = source;
    return raw;
}
const emitted = [];
let slotArgs;
let storedJob = { createdAt: new Date(), updatedAt: new Date(), resultAssets: [], state: 'success', providerTaskId: 'provider', resultUrls: ['https://example.com/result-a.png', 'https://example.com/result-b.png'] };
const api = load('server/agent/models.ts', {
    './httpError': { toUpstreamApiError: error => error },
    './session': { persistNow: () => { }, upsertImage: (s, image) => { s.images = [image, ...s.images.filter(item => item.id !== image.id)]; } },
    './slots': { acquireGenerationSlot: async (args) => { slotArgs = args; return { queued: false }; } },
    '../models/generationJob': { GenerationJob: { findOne: async () => storedJob } },
    '../utils/generationPipeline': { refreshGenerationJob: async (job) => job },
    '../utils/videoDuration': { measureReferenceVideoSeconds: async (urls) => ({ durations: urls.map(() => 5), total: urls.length * 5 }), referenceVideoDurationLimits: () => ({ minEach: 1, maxEach: 30, maxTotal: 30 }) },
}, { console });
test('every website model has a unique valid tool and matching required parameters', () => {
    const website = load('shared/constants/aiModels.ts').AI_MODELS;
    assert.equal(registry.AGENT_MODELS.length, website.length + 2);
    assert.equal(new Set(registry.registeredModelTools.map(tool => tool.function.name)).size, registry.AGENT_MODELS.length);
    for (const model of website) {
        const tool = registry.registeredModelTools.find(tool => tool.function.name === registry.agentModelToolName(model.id));
        assert.match(tool.function.name, /^[\w-]{1,64}$/);
        assert.deepEqual(JSON.parse(JSON.stringify(tool.function.required || tool.function.parameters.required)), JSON.parse(JSON.stringify(model.schema.components.schemas.Input.required || [])));
        for (const key of Object.keys(model.schema.components.schemas.Input.properties))
            assert.ok(key in tool.function.parameters.properties);
    }
});
for (const model of registry.AGENT_MODELS.filter(model => model.id !== 'image-text-editor')) {
    test(`${model.id}: validated parameters preserve the correct model identity`, async () => {
        const args = await api.prepareModelGeneration(registry.agentModelToolName(model.id), JSON.stringify(validInput(model)), session());
        assert.equal(args.modelId, model.id);
        if (model.task === 'Image to Image')
            assert.ok(args.inputUrls.includes(source), 'All model-specific image fields must be retained for preview and input checks');
        assert.equal(api.modelConfirmation(args).params.modelId, model.id);
    });
}
test('missing source media is rejected before any generation', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'gpt-image-2-image-to-image');
    const raw = validInput(model);
    delete raw.image_urls;
    await assert.rejects(api.prepareModelGeneration(registry.agentModelToolName(model.id), JSON.stringify(raw), session()), /required property 'image_urls'/);
});
test('defaults fill settings but never fabricate required media', () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'gpt-image-2-text-to-image');
    const input = registry.validateAgentModelInput(model, { prompt: 'A quiet lake at sunset' });
    assert.equal(input.image_size, model.schema.components.schemas.Input.properties.image_size.default);
    assert.throws(() => registry.validateAgentModelInput(model, { prompt: 'A lake', quality: 'unsupported' }), /allowed values/);
    assert.throws(() => registry.validateAgentModelInput(model, { prompt: 'A lake', invented: true }), /additional properties/);
});
test('mention roundtrip preserves exact model task and deduplicates badges', () => {
    const model = registry.AGENT_MODELS[0];
    const text = `${registry.modelMention(model)} ${registry.modelMention(model)} Make a picture`;
    assert.deepEqual(Array.from(registry.readModelMentions(text)), [model.id]);
    assert.equal(registry.stripModelMentions(text), 'Make a picture');
});
test('a selected model cannot be silently substituted; other-category prerequisites remain possible', async () => {
    const chosen = registry.AGENT_MODELS.find(model => model.id === 'gpt-image-2-text-to-image');
    const wrong = registry.AGENT_MODELS.find(model => model.id === 'nano-banana-2-text-to-image');
    const s = session();
    s.messages = [{ role: 'user', content: registry.modelMention(chosen) }];
    await assert.rejects(api.prepareModelGeneration(registry.agentModelToolName(wrong.id), JSON.stringify(validInput(wrong)), s), /exact model/);
});
test('session media IDs resolve to real URLs and invalid IDs fail', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'gpt-image-2-image-to-image');
    const s = session();
    s.images = [{ id: 'image-1', kind: 'still', status: 'success', url: source }];
    const raw = { ...validInput(model), image_urls: ['image-1'] };
    const args = await api.prepareModelGeneration(registry.agentModelToolName(model.id), JSON.stringify(raw), s);
    assert.equal(args.input.image_urls[0], source);
    raw.image_urls = ['missing-image'];
    await assert.rejects(api.prepareModelGeneration(registry.agentModelToolName(model.id), JSON.stringify(raw), s), /Missing media/);
});
test('registered generation uses normal provider pipeline and preserves every output', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'gpt-image-2-text-to-image');
    const s = session();
    const args = await api.prepareModelGeneration(registry.agentModelToolName(model.id), JSON.stringify(validInput(model)), s);
    const result = JSON.parse(await api.runModelGeneration(s, 'call-1', args, event => emitted.push(event)));
    assert.equal(slotArgs.meta.modelId, model.id);
    assert.equal(slotArgs.meta.requestModel, 'openai/gpt-image-2');
    assert.equal(slotArgs.meta.modelInput.prompt, args.input.prompt);
    assert.equal(result.urls.length, 2);
    assert.equal(s.images.filter(image => image.status === 'success').length, 2);
    assert.ok(s.images.every(image => image.modelId === model.id));
});
test('provider terminal failure produces a failed result, not a success', async () => {
    const model = registry.AGENT_MODELS[0];
    const s = session();
    const args = await api.prepareModelGeneration(registry.agentModelToolName(model.id), JSON.stringify(validInput(model)), s);
    storedJob = { state: 'fail', failMsg: 'Provider rejected request', resultUrls: [] };
    const result = JSON.parse(await api.runModelGeneration(s, 'call-fail', args, () => { }));
    assert.equal(result.ok, false);
    assert.match(s.images[0].error, /Provider rejected/);
});
function loopHarness(responses, initial, prose = {}) {
    const events = [];
    const s = { ...session(), confirmPolicy: 'always', pendingConfirmation: null, pendingChoice: null, ...initial };
    let registered;
    const generationRequests = [];
    const llmRequests = [];
    const detectionRequests = [];
    const mocks = Object.fromEntries(['./concat', './fal', './modelGeneration', './restore', './resume', './slots', '../utils/agentChats'].map(id => [id, {}]));
    const loop = load('server/agent/loop.ts', {
        ...mocks,
        '../utils/agentChats': { snapshotAgentChatFromService: async () => { } },
        './models': { ...api, runModelGeneration: async (_session, callId, args) => {
                generationRequests.push({ callId, args });
                const failed = Boolean(s.failLayerUrl && (args.input.image_url === s.failLayerUrl || args.input.image_urls?.includes(s.failLayerUrl)));
                s.images.push({ id: callId, modelId: args.modelId, status: failed ? 'fail' : 'success', error: failed ? 'Image dimensions are too small' : '', url: failed ? '' : `https://example.com/${callId}.png` });
                return JSON.stringify(failed ? { ok: false, error: 'Image dimensions are too small' } : { ok: true, model: args.modelId, urls: [`https://example.com/${callId}.png`] });
            } },
        './session': { requireLoadedSession: async () => s, choiceAlreadyAnswered: () => false, confirmationAlreadyStarted: () => false, requireSession: () => s, touch: () => { }, refreshSessionPrompt: () => { }, persistNow: () => { } },
        './title': { summarizeSessionTitle: async () => '' },
        '../utils/sqlite': { connectDatabase: async () => { } },
        './llm': {
            completeText: async (options) => {
                detectionRequests.push(options);
                const imageUrl = options.messages[1].content[0].image_url.url;
                return JSON.stringify([{ original: imageUrl === source ? 'Hello' : 'CAFE', location: 'center' }]);
            },
            assembleToolCalls: calls => calls,
            streamChat: async (options) => {
                llmRequests.push(options);
                registered = options.tools;
                options.onDelta({ ...prose, toolCalls: responses.shift() || [] });
            },
        },
    }, { crypto, AbortController, console });
    return { s, events, generationRequests, llmRequests, detectionRequests, choice: body => loop.handleChoice(s.id, body, event => events.push(event)), confirm: body => loop.handleConfirm(s.id, body, event => events.push(event)), run: () => loop.runAgentLoop(s.id, event => events.push(event)), tools: () => registered };
}
function call(model, raw, id = 'tool-1') {
    return { id, type: 'function', function: { name: registry.agentModelToolName(model.id), arguments: JSON.stringify(raw) } };
}
test('Agent loop queues the exact selected model and full parameters for confirmation before spending', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'blackforestlabs/flux-3/text-to-video');
    const h = loopHarness([[call(model, validInput(model))]], { messages: [{ role: 'user', content: registry.modelMention(model) }] });
    await h.run();
    assert.equal(h.s.pendingConfirmation.payload.params.modelId, model.id);
    assert.equal(h.s.pendingConfirmation.payload.jobs[0].modelName, model.name);
    assert.ok(h.s.pendingConfirmation.payload.params.modelInput.prompt);
    assert.equal(h.s.pendingConfirmation.items[0].tool, registry.agentModelToolName(model.id));
    assert.ok(h.tools().some(tool => tool.function.name === registry.agentModelToolName(model.id)));
    assert.ok(!h.tools().some(tool => tool.function.name === 'generate_video'));
});
test('missing required media returns to the Agent for clarification without a generation confirmation', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'gpt-image-2-image-to-image');
    const raw = validInput(model);
    delete raw.image_urls;
    const h = loopHarness([[call(model, raw)], [{ id: 'ask-1', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [{ id: 'source', prompt: 'Which existing image should I edit?', options: [{ id: 'last', label: 'The previous result' }, { id: 'custom', label: 'Other', allow_custom: true }] }] }) } }]]);
    await h.run();
    assert.equal(h.s.pendingConfirmation, null);
    assert.equal(h.s.pendingChoice.payload.questions[0].id, 'source');
    assert.match(h.s.messages.find(message => message.role === 'tool').content, /required property/);
});
test('tool planning is collapsed and saved separately from a terminal answer', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'blackforestlabs/flux-3/text-to-video');
    const h = loopHarness([[call(model, validInput(model))]], {}, { content: 'I will plan this generation.' });
    await h.run();
    assert.ok(h.events.some(event => event.type === 'text_replace' && event.delta === '<think>I will plan this generation.</think>'));
    assert.ok(h.s.messages.some(message => message.tool_calls && message.content === '<think>I will plan this generation.</think>'));
    const answer = loopHarness([[]], {}, { reasoning: 'Check the input.', content: 'Please attach an image.' });
    await answer.run();
    assert.equal(answer.s.messages.at(-1).content, '<think>Check the input.</think>Please attach an image.');
});
test('multiple layer selections prepare distinct source jobs with their own confirmed boxes', async () => {
    const s = session();
    const urls = [source, 'https://example.com/second.png'];
    const boxes = [[[10, 20, 500, 600]], [[100, 200, 800, 900], [0, 0, 100, 100]]];
    s.images = urls.map((url, i) => ({ id: `source-${i}`, url, status: 'success', kind: 'still' }));
    s.messages = [
        { role: 'user', content: '@[Image Layer Splitter](model:image-layer-splitter)' },
        ...urls.map((imageUrl, i) => ({ role: 'tool', content: JSON.stringify({ ok: true, answers: [{ questionId: 'layer_selection_method', optionId: 'draw_boxes', imageUrl, regions: boxes[i] }] }) })),
    ];
    const tool = registry.agentModelToolName('image-layer-splitter');
    for (const refs of [urls, ['source-0', 'source-1']]) {
        const jobs = await Promise.all(refs.map(image_url => api.prepareModelGeneration(tool, JSON.stringify({ image_url, regions: [[0, 0, 1000, 1000]] }), s)));
        for (const [i, job] of jobs.entries()) {
            assert.equal(job.input.image_url, urls[i]);
            assert.deepEqual([...job.input.prompt.matchAll(/<bbox>(.*?)<\/bbox>/g)].map(match => match[1].split(' ').map(Number)), boxes[i]);
            assert.deepEqual(Array.from(job.inputUrls), [urls[i]]);
            assert.equal(api.modelConfirmation(job).inputUrls[0], urls[i]);
        }
    }
    await assert.rejects(api.prepareModelGeneration(tool, '{}', s), /source image with confirmed boxes/);
    await assert.rejects(api.prepareModelGeneration(tool, JSON.stringify({ image_url: 'https://example.com/unconfirmed.png', regions: boxes[0] }), s), /source image with confirmed boxes/);
    s.messages.pop();
    const single = await api.prepareModelGeneration(tool, '{}', s);
    assert.equal(single.input.image_url, source);
});
test('text editor requires confirmed user edits and maps them to direct full-image GPT editing', async () => {
    const s = session();
    await assert.rejects(api.prepareModelGeneration('model_image_text_editor', JSON.stringify({ image_url: source }), s), /confirm edits/);
    const textEdit = { imageUrl: source, lines: [{ original: 'Hello', text: '你好', location: 'upper left' }] };
    s.images = [{ id: 'upload', status: 'success', kind: 'upload', url: source }];
    s.messages = [{ role: 'tool', content: JSON.stringify({ ok: true, textEdit }) }];
    for (const quality of ['economy', 'high', 'hobby', 'custom']) {
        s.quality = quality;
        const args = await api.prepareModelGeneration('model_image_text_editor', JSON.stringify({ image_url: 'ignored-model-url' }), s);
        assert.equal(args.modelId, 'gpt-image-2-image-to-image');
        assert.equal(args.input.image_size, 'auto');
        assert.equal(api.modelConfirmation(args).modelName, 'GPT Image 2');
        assert.equal(args.requestModel, 'openai/gpt-image-2/edit');
        assert.equal(args.input.quality, 'high');
        assert.equal(args.input.image_urls[0], source);
        assert.equal(args.input._textEdit, undefined);
        assert.match(args.input.prompt, /At "upper left", change "Hello" to "你好"/);
    }
});
for (const confirmPolicy of ['always', 'auto']) {
    test(`confirming two drawn images dispatches both jobs under ${confirmPolicy} policy`, async () => {
        const imageSelections = [
            { imageUrl: source, regions: [[0, 0, 100, 100]] },
            { imageUrl: 'https://example.com/second.png', regions: [[100, 100, 500, 500], [500, 500, 900, 900]] },
        ];
        const payload = { id: 'choice-batch', questions: [{ id: 'layer_selection_method', options: [{ id: 'draw_boxes', label: 'Draw boxes' }] }] };
        const h = loopHarness([], {
            confirmPolicy,
            images: imageSelections.map((selection, i) => ({ id: `source-${i}`, url: selection.imageUrl, status: 'success', kind: 'still' })),
            messages: [{ role: 'user', content: '@[Image Layer Splitter](model:image-layer-splitter)' }],
            pendingChoice: { payload, items: [{ toolCallId: 'ask-boxes', tool: 'ask_user' }] },
        });
        await h.choice({ action: 'submit', choiceId: payload.id, answers: [{ questionId: 'layer_selection_method', optionId: 'draw_boxes', imageSelections }] });
        const confirmation = h.events.find(event => event.type === 'confirmation').confirmation;
        assert.equal(confirmation.count, 2);
        assert.deepEqual(Array.from(confirmation.jobs, job => job.inputUrls[0]), imageSelections.map(selection => selection.imageUrl));
        if (confirmPolicy === 'always') {
            assert.equal(h.tools(), undefined, 'No LLM call may drop a confirmed image');
            const pending = h.s.pendingConfirmation;
            assert.equal(pending.items.length, 2);
            await h.confirm({ action: 'confirm', confirmationId: pending.payload.id, params: pending.payload.params });
        }
        else {
            assert.equal(h.s.pendingConfirmation, null);
        }
        assert.equal(h.generationRequests.length, 2);
        assert.equal(new Set(h.generationRequests.map(request => request.callId)).size, 2);
        assert.deepEqual(h.generationRequests.map(request => request.args.input.image_url), imageSelections.map(selection => selection.imageUrl));
    });
}
test('a partial layer failure cannot trigger a second split, even if the summary model calls tools', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'image-layer-splitter');
    const imageSelections = [source, 'https://example.com/small.png', 'https://example.com/room.png'].map(imageUrl => ({ imageUrl, regions: [[0, 0, 300, 300]] }));
    const payload = { id: 'partial', questions: [{ id: 'layer_selection_method', options: [{ id: 'draw_boxes', label: 'Draw boxes' }] }] };
    const repeated = imageSelections.map((selection, i) => call(model, { image_url: selection.imageUrl, regions: selection.regions }, `unwanted-${i}`));
    const h = loopHarness([repeated], {
        confirmPolicy: 'auto',
        failLayerUrl: imageSelections[1].imageUrl,
        images: imageSelections.map((selection, i) => ({ id: `upload-${i}`, url: selection.imageUrl, status: 'success', kind: 'upload' })),
        messages: [{ role: 'user', content: '@[Image Layer Splitter](model:image-layer-splitter)' }],
        pendingChoice: { payload, items: [{ toolCallId: 'ask-partial', tool: 'ask_user' }] },
    }, { content: 'Two images succeeded; the small image failed.' });
    await h.choice({ action: 'submit', choiceId: payload.id, answers: [{ questionId: 'layer_selection_method', optionId: 'draw_boxes', imageSelections }] });
    assert.equal(h.generationRequests.length, 3);
    assert.equal(h.s.pendingConfirmation, null);
    assert.equal(h.llmRequests.length, 1);
    assert.equal(h.llmRequests[0].disableTools, true);
    assert.ok(!h.s.messages.some(message => message.internal && JSON.stringify(message.content).includes('Retry only')));
    assert.ok(!h.s.messages.some(message => message.tool_calls?.some(tool => tool.id.startsWith('unwanted-'))));
    assert.equal(h.s.images.filter(image => image.modelId === model.id && image.status === 'success').length, 2);
});
test('text submission queues GPT directly and saves a full-image edit without a second planning call', async () => {
    const textEdit = { imageUrl: source, lines: [{ original: 'Hello', text: 'Hello', location: 'upper left' }, { original: 'Keep', text: 'Keep', location: 'bottom' }] };
    const h = loopHarness([], {
        confirmPolicy: 'always',
        images: [{ id: 'upload', url: source, status: 'success', kind: 'upload' }],
        messages: [{ role: 'user', content: '@[Image Text Editor](model:image-text-editor)' }],
        pendingChoice: { payload: { id: 'edit', textEdit, questions: [] }, items: [{ toolCallId: 'detect', tool: 'model_image_text_editor' }] },
    });
    await h.choice({ choiceId: 'edit', action: 'submit', answers: [{ questionId: 'image_text_editor', textLines: [{ ...textEdit.lines[0], text: '你好' }, textEdit.lines[1]] }] });
    assert.equal(h.llmRequests.length, 0);
    const pending = h.s.pendingConfirmation;
    assert.equal(pending.payload.count, 1);
    assert.equal(pending.payload.jobs[0].modelName, 'GPT Image 2');
    const args = JSON.parse(pending.items[0].argsJson);
    assert.equal(args.modelId, 'gpt-image-2-image-to-image');
    assert.match(args.input.prompt, /At "upper left", change "Hello" to "你好"/);
    assert.doesNotMatch(args.input.prompt, /"Keep"|bbox|coordinates|crop/);
    assert.equal(args.input._textEdit, undefined);
    await h.confirm({ confirmationId: pending.payload.id, action: 'confirm', params: pending.payload.params });
    assert.equal(h.generationRequests.length, 1);
    assert.equal(h.llmRequests[0].disableTools, true);
});
for (const confirmPolicy of ['always', 'auto']) {
    test(`multi-image text edits create one GPT job per changed source under ${confirmPolicy} policy`, async () => {
        const textEdits = [source, 'https://example.com/cup.png', 'https://example.com/unchanged.png'].map((imageUrl, index) => ({ imageUrl, lines: [{ original: `Original ${index}`, text: `Original ${index}`, location: `location ${index}` }] }));
        const changed = textEdits.slice(0, 2).map((edit, index) => ({ ...edit, lines: [{ ...edit.lines[0], text: `Replacement ${index}` }] }));
        const model = registry.AGENT_MODELS.find(model => model.id === 'image-text-editor');
        const h = loopHarness([[call(model, { image_url: source }, 'unwanted-repeat')]], {
            confirmPolicy,
            images: textEdits.map((edit, index) => ({ id: `upload-${index}`, url: edit.imageUrl, kind: 'upload', status: 'success' })),
            messages: [{ role: 'user', content: registry.modelMention(model) }],
            pendingChoice: { payload: { id: 'batch-edit', textEdits, questions: [] }, items: [{ toolCallId: 'detect-batch', tool: 'model_image_text_editor' }] },
        });
        await h.choice({ choiceId: 'batch-edit', action: 'submit', answers: [{ questionId: 'image_text_editor', textEdits: changed }] });
        const confirmation = h.events.find(event => event.type === 'confirmation').confirmation;
        assert.equal(confirmation.count, 2);
        assert.ok(confirmation.jobs.every(job => job.modelName === 'GPT Image 2'));
        assert.deepEqual(Array.from(confirmation.jobs, job => job.inputUrls[0]), changed.map(edit => edit.imageUrl));
        if (confirmPolicy === 'always') {
            assert.equal(h.llmRequests.length, 0);
            const pending = h.s.pendingConfirmation;
            await h.confirm({ confirmationId: pending.payload.id, action: 'confirm', params: pending.payload.params });
        }
        assert.equal(h.generationRequests.length, 2);
        assert.equal(new Set(h.generationRequests.map(request => request.callId)).size, 2);
        h.generationRequests.forEach(({ args }, index) => {
            assert.deepEqual(Array.from(args.input.image_urls), [changed[index].imageUrl]);
            assert.match(args.input.prompt, new RegExp(`At "location ${index}", change "Original ${index}" to "Replacement ${index}"`));
            assert.doesNotMatch(args.input.prompt, new RegExp(`Original ${1 - index}`));
        });
        assert.equal(h.s.images.filter(image => image.modelId === 'gpt-image-2-image-to-image' && image.status === 'success').length, 2);
        assert.equal(h.s.pendingConfirmation, null);
        assert.equal(h.llmRequests.length, 1);
        assert.equal(h.llmRequests[0].disableTools, true);
        assert.ok(!h.s.messages.some(message => message.tool_calls?.some(tool => tool.id === 'unwanted-repeat')));
    });
}
test('a confirmed batch cannot borrow another image draft, including when only one image changed', async () => {
    const s = session();
    s.images = [{ id: 'upload', url: source, kind: 'upload', status: 'success' }];
    s.messages = [{ role: 'tool', content: JSON.stringify({ ok: true, textEdits: [{ imageUrl: source, lines: [{ original: 'Hello', text: 'Hi', location: 'top' }] }] }) }];
    await assert.rejects(api.prepareModelGeneration('model_image_text_editor', JSON.stringify({ image_url: 'https://example.com/other.png' }), s), /confirm edits/);
    const args = await api.prepareModelGeneration('model_image_text_editor', JSON.stringify({ image_url: 'upload' }), s);
    assert.equal(args.input.image_urls[0], source);
});
test('multiple editor tool calls open one card and detect each attachment only once', async () => {
    const model = registry.AGENT_MODELS.find(model => model.id === 'image-text-editor');
    const urls = [source, 'https://example.com/cup.png'];
    const h = loopHarness([[call(model, { image_url: urls[1] }, 'detect-last'), call(model, { image_url: urls[0] }, 'detect-first')]], {
        images: urls.map((url, index) => ({ id: `upload-${index}`, url, kind: 'upload', status: 'success' })),
        messages: [{ role: 'user', content: [{ type: 'text', text: registry.modelMention(model) }, ...urls.map(url => ({ type: 'image_url', image_url: { url } }))] }],
    });
    await h.run();
    assert.deepEqual(h.detectionRequests.map(request => request.messages[1].content[0].image_url.url), urls);
    assert.equal(h.events.filter(event => event.type === 'choice').length, 1);
    assert.equal(h.s.pendingChoice.items.length, 1);
    assert.deepEqual(Array.from(h.s.pendingChoice.payload.textEdits, edit => edit.imageUrl), urls);
    assert.equal(h.generationRequests.length, 0);
    const textEdits = h.s.pendingChoice.payload.textEdits.map(edit => ({ ...edit, lines: edit.lines.map(line => ({ ...line, text: `${line.text}!` })) }));
    await h.choice({ choiceId: h.s.pendingChoice.payload.id, action: 'submit', answers: [{ questionId: 'image_text_editor', textEdits }] });
    assert.equal(h.s.pendingConfirmation.items.length, 2);
    assert.equal(h.detectionRequests.length, 2, 'Submission must not detect again');
});
