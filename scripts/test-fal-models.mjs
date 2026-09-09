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
const { sanitizeFalInput, falEndpoint } = load('server/utils/falInput.ts');
const { AI_MODELS } = load('shared/constants/aiModels.ts');
const { FAL_ENDPOINTS } = load('shared/constants/falEndpoints.ts');
for (const model of AI_MODELS.filter(model => FAL_ENDPOINTS[model.id])) {
 test(`${model.id}: official payload validates and maps to fal`, () => {
  const input = { prompt: 'A blue ceramic cup on a wooden table' };
  for (const key of model.schema.components.schemas.Input.required || []) {
   if (key === 'prompt') continue;
   const prop = model.schema.components.schemas.Input.properties[key];
   input[key] = prop.type === 'array' ? ['https://example.com/source.png'] : 'https://example.com/source.png';
  }
  const payload = sanitizeFalInput(model.id, input);
  assert.equal(falEndpoint(model.id, payload), FAL_ENDPOINTS[model.id]);
  assert.equal(payload.prompt, input.prompt);
  assert.throws(() => sanitizeFalInput(model.id, {...input, invented: true}), /additional properties/);
 });
}
test('legacy video recovery converts empty optional media and duration', () => {
 const input = sanitizeFalInput('bytedance/seedance-2-text-to-video', {prompt: 'A cup', duration: 4, reference_image_urls: [], reference_video_urls: [], first_frame_url: undefined});
 assert.equal(input.duration, '4');
 assert.equal('reference_image_urls' in input, false);
});
test('custom image sizes and multiple outputs are retained', () => {
 const input = sanitizeFalInput('gpt-image-2-text-to-image', {prompt: 'A cup', image_size: {width: 1536, height: 1024}, num_images: 3});
 assert.equal(input.image_size.width, 1536);
 assert.equal(input.num_images, 3);
});

test('local generation inputs upload once and remote URLs remain intact', async () => {
 let uploads = 0;
 const api = load('server/utils/falFiles.ts', {
  './localMedia': {readStoredMedia: async url => url.startsWith('http://localhost:3001/media/') ? {bytes: new Uint8Array([1,2,3]), mime:'image/png'} : null},
  '@fal-ai/client': {createFalClient: () => ({storage:{upload: async file => { uploads++; assert.equal(file.type,'image/png'); return 'https://cdn.fal.media/copied.png'; }}})},
 }, {File, useRuntimeConfig: () => ({apiKeys:{fal:'test-key'}})});
 const prepared = await api.prepareFalFiles({image_urls:['http://localhost:3001/media/a.png', 'https://example.com/b.png'], image_url:'http://localhost:3001/media/a.png', prompt:'Keep this prompt'});
 assert.deepEqual(Array.from(prepared.image_urls), ['https://cdn.fal.media/copied.png', 'https://example.com/b.png']);
 assert.equal(prepared.image_url, 'https://cdn.fal.media/copied.png');
 assert.equal(prepared.prompt, 'Keep this prompt');
 assert.equal(uploads, 1);
});
