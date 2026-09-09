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
            exports: module.exports,
            fetch,
            AbortSignal,
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
const model = 'image-layer-splitter';
function service(globals = {}, mocks = {}) {
    return load('server/utils/imageLayerSplitter.ts', { '../models/generationJob': {}, ...mocks }, globals);
}
const layer = (index, width, height) => ({ z_index: index, image: { url: `https://example.com/${index}.png`, width, height } });
test('output layers stay ordered', async () => {
    const result = await service().readLayerResult({ layers: [layer(1, 10, 10), layer(0, 2048, 2048)] });
    assert.equal(result.width, 2048);
    assert.equal(result.urls[0], 'https://example.com/0.png');
    await assert.rejects(() => service().readLayerResult({ layers: [layer(1, 10, 10), layer(1, 10, 10)] }));
});
test('missing dimensions do not trigger a download', async () => {
    const result = await service({ fetch: async () => { throw new Error('Must not fetch image dimensions'); } }).readLayerResult({ layers: [layer(0), layer(1)] });
});
test('server forces highest resolution, fast processing, and empty default prompt', () => {
    const input = service().sanitizeImageLayerInput({ image_url: ['https://example.com/input.png'], prompt: 'user override', image_size: 'auto_1K', enhance_prompt_mode: 'standard', basePixels: 1, layerCount: 2, enable_safety_checker: false, sync_mode: true });
    assert.equal(input.image_size, 'auto_2K');
    assert.equal(input.enhance_prompt_mode, 'fast');
    assert.equal(input.prompt, '');
    assert.equal(input.enable_safety_checker, true);
    assert.equal(input.basePixels, undefined);
    assert.equal(input.sync_mode, undefined);
});
test('selection coordinates generate the English prompt without forwarding UI fields', () => {
    const input = service().sanitizeImageLayerInput({ image_url: 'https://example.com/input.png', regions: [[100, 200, 400, 500], [500, 0, 1000, 1000]] });
    assert.match(input.prompt, /<bbox>100 200 400 500<\/bbox>/);
    assert.match(input.prompt, /<bbox>500 0 1000 1000<\/bbox>/);
    assert.match(input.prompt, /transparent PNG layer/);
    assert.equal(input.regions, undefined);
    for (const regions of [[[400, 200, 100, 500]], [[0, 0, 1001, 500]], [[0, 0, 0, 500]], [[0, 0, 3.5, 500]], ['bad'], Array.from({ length: 17 }).fill([0, 0, 100, 100])])
        assert.throws(() => service().sanitizeImageLayerInput({ image_url: 'https://example.com/input.png', regions }));
});
test('drag coordinates normalize reversed gestures and clamp to the image', () => {
    const { imageLayerRegionFromPoints } = load('shared/utils/imageLayerSplitter.ts');
    assert.equal(JSON.stringify(imageLayerRegionFromPoints({ x: 800, y: 750 }, { x: 100, y: 200 })), '[100,200,800,750]');
    assert.equal(JSON.stringify(imageLayerRegionFromPoints({ x: -20, y: 10.6 }, { x: 1010, y: 2000 })), '[0,11,1000,1000]');
});
test('Fal integration submits the private endpoint and preserves every output layer', async () => {
    const layerApi = service();
    let submitted = '';
    const api = load('server/utils/falGenerate.ts', {
        './generationJobs': { isProviderStarted: () => true, jobProviderId: () => 'provider-id' },
        './httpError': { toUpstreamApiError: error => error },
        './falFiles': { prepareFalFiles: async input => input },
    './generationResults': { mergeSourceUrls: (job, urls) => { job.sourceUrls = urls; } },
    }, {
        useRuntimeConfig: () => ({ apiKeys: { fal: 'test-key' } }),
        $fetch: async (url, options) => {
            if (options.method === 'POST') {
                submitted = url;
                return { request_id: 'provider-id' };
            }
            if (url.endsWith('/status'))
                return { status: 'COMPLETED' };
            return { layers: [layer(0, 2048, 2048), layer(1, 32, 32), layer(2, 64, 64)] };
        },
    });
    assert.equal(api.isFalGenerateModel(model), true);
    await api.createFalTask(layerApi.IMAGE_LAYER_SPLITTER_ENDPOINT, { image_url: 'https://example.com/input.png' });
    assert.equal(submitted, `https://queue.fal.run/${layerApi.IMAGE_LAYER_SPLITTER_ENDPOINT}`);
    const job = { model, state: 'generating', requestBody: { model: layerApi.IMAGE_LAYER_SPLITTER_ENDPOINT }, resultUrls: [], save: async () => { } };
    await api.syncJobFromFal(job);
    assert.equal(job.sourceUrls.length, 3);
    assert.equal(JSON.parse(job.resultJson).layers.length, 3);
    assert.equal(job.state, 'archiving');
    const bboxJob = { ...job, state: 'generating',  };
    await api.syncJobFromFal(bboxJob);
    assert.equal(bboxJob.sourceUrls.length, 3);
});
