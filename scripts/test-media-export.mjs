import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import vm from 'node:vm';
import { unzipSync } from 'fflate';
import ts from 'typescript';
import { mediaRoot, readStoredMedia, saveMediaFile } from '../server/utils/localMedia.ts';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
function load(path, overrides = {}, globals = {}) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const context = vm.createContext({ exports: {}, Buffer, URL, AbortSignal, crypto, ...globals, require: id => overrides[id] || require(id) });
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return context.exports;
}
function fixture(responses) {
    const calls = [];
    function request(url, options, callback) {
        const req = new EventEmitter();
        req.setTimeout = () => req;
        req.end = () => queueMicrotask(() => {
            calls.push(url.href);
            options.lookup(url.hostname, { all: true }, (error, addresses) => {
                assert.equal(error, null);
                assert.equal(addresses[0].address, '93.184.216.34');
            });
            if (options.signal?.aborted) {
                req.emit('error', new Error('Aborted'));
                return;
            }
            const next = responses.shift();
            assert.ok(next, 'Unexpected request');
            const response = Readable.from(next.chunks || [next.bytes || Buffer.from('file')]);
            response.statusCode = next.status || 200;
            response.headers = { 'content-type': 'image/png', ...next.headers };
            callback(response);
        });
        return req;
    }
    const media = load('../server/utils/mediaExport.ts', {
        './localMedia': { readStoredMedia },
        'node:dns/promises': { lookup: async (host) => [{ address: host === 'private.test' ? '127.0.0.1' : '93.184.216.34', family: 4 }] },
        'node:https': { request }, 'node:http': { request },
    });
    return { media, calls };
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const item = name => ({ name, url: 'https://media.test/source.png' });
test('ZIP round trip preserves original bytes and distinct Chinese duplicate filenames', async () => {
    const { media } = fixture([{ bytes: png }, { bytes: png }, { bytes: Buffer.from('video'), headers: { 'content-type': 'video/mp4' } }]);
    const output = await media.buildMediaExport({ items: [item('香水'), item('香水'), item('../镜头/1')], name: '产品素材.zip' });
    assert.equal(output.filename, '产品素材.zip');
    assert.equal(output.mime, 'application/zip');
    const files = unzipSync(output.bytes);
    assert.deepEqual(Object.keys(files), ['香水.png', '香水 (2).png', '_镜头_1.mp4']);
    assert.deepEqual(Buffer.from(files['香水.png']), png);
    assert.deepEqual(Buffer.from(files['香水 (2).png']), png);
    assert.equal(Buffer.from(files['_镜头_1.mp4']).toString(), 'video');
});
test('single-file export returns unmodified media with its original extension', async () => {
    const { media } = fixture([{ bytes: png }]);
    const output = await media.buildMediaExport({ items: [item('Bottle.png')], format: 'file' });
    assert.deepEqual(output.bytes, png);
    assert.equal(output.filename, 'Bottle.png');
});
test('validates count, single-file mode, private addresses and redirect targets', async () => {
    const { media, calls } = fixture([{ status: 302, headers: { location: 'http://private.test/secret' } }]);
    for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1'])
        assert.equal(media.isPublicExportAddress(address), false, address);
    assert.equal(media.isPublicExportAddress('8.8.8.8'), true);
    assert.equal(media.isPublicExportAddress('2606:4700:4700::1111'), true);
    assert.equal(media.mediaExportSchema.safeParse({ items: [] }).success, false);
    assert.equal(media.mediaExportSchema.safeParse({ items: Array(101).fill(item('x')) }).success, false);
    assert.equal(media.mediaExportSchema.safeParse({ items: [item('a'), item('b')], format: 'file' }).success, false);
    await assert.rejects(media.downloadExportMedia('https://media.test/redirect'), /public address/);
    assert.equal(calls.length, 1);
    await assert.rejects(media.downloadExportMedia('file:///tmp/secret'), /Unsupported/);
});
test('rejects oversized streamed bodies, failed downloads and cancellation without partial ZIPs', async () => {
    const { media } = fixture([{ chunks: [Buffer.alloc(3), Buffer.alloc(3)] }, { status: 404 }]);
    await assert.rejects(media.downloadExportMedia('https://media.test/large', 5), /size limit/);
    await assert.rejects(media.buildMediaExport({ items: [item('missing')] }), /404/);
    await assert.rejects(media.buildMediaExport({ items: [item('cancelled')] }, AbortSignal.abort()), /abort/i);
});
test('agent resolves only successful session assets and uploads the ZIP result', async () => {
    const { media } = fixture([{ bytes: png }]);
    const uploads = [];
    const agent = load('../server/agent/exportZip.ts', {
        '../utils/mediaExport': media,
        '../utils/localMedia': { saveMediaFile: async (...args) => { uploads.push(args); return 'https://storage.test/export.zip'; } },
    });
    const images = [{ id: 'bottle', name: '香水', url: item('').url, status: 'success' }, { id: 'pending', status: 'generating', url: '' }];
    assert.throws(() => agent.resolveZipExport('{"assets":["https://unknown.test/x"],"name":"x"}', images), /not available/);
    assert.throws(() => agent.resolveZipExport('{"assets":["pending"],"name":"x"}', images), /not available/);
    const input = agent.resolveZipExport('{"assets":["bottle"],"name":"素材"}', images);
    const result = await agent.exportSessionZip(input);
    assert.equal(result.url, 'https://storage.test/export.zip');
    assert.equal(result.filename, '素材.zip');
    assert.equal(result.count, 1);
    assert.equal(uploads[0][2], 'application/zip');
    assert.deepEqual(Buffer.from(unzipSync(uploads[0][1])['香水.png']), png);
});
test('HTTP export works without login and only exports local media', async () => {
    let downloaded = false;
    const headers = {};
    const { media } = fixture([]);
    const handler = load('../server/api/media/export.post.ts', {
        '../../utils/mediaExport': { ...media, buildMediaExport: async () => { downloaded = true; return { bytes: png, filename: '香水.png', mime: 'image/png' }; } },
        '../../utils/sqlite': { connectDatabase: async () => { } },
        '../../models/generationJob': { GenerationJob: { find: filter => { assert.equal(Object.keys(filter).some(key => /workspace|user|owner/i.test(key)), false); return { select: () => ({ lean: async () => [] }) }; } } },
        '../../models/agentChat': { AgentChat: { find: filter => { assert.equal(Object.keys(filter).some(key => /workspace|user|owner/i.test(key)), false); return { select: () => ({ lean: async () => [{ images: [{ url: item('').url, status: 'success' }] }] }) }; } } },
    }, {
        defineEventHandler: fn => fn,
        readBody: async (event) => event,
        createError: options => Object.assign(new Error(options.statusMessage), options),
        setHeader: (_event, key, value) => { headers[key] = value; },
    }).default;
    await assert.rejects(handler({ items: [{ url: 'https://unknown.test/a', name: 'a' }] }), { statusCode: 403 });
    assert.equal(downloaded, false);
    assert.deepEqual(await handler({ items: [item('香水')], format: 'file' }), png);
    assert.equal(headers['Content-Type'], 'image/png');
    assert.match(headers['Content-Disposition'], /filename\*=UTF-8''%E9/);
});
test('agent dispatcher executes export_zip and returns its link without a generation confirmation', async () => {
    const source = ts.createSourceFile('loop.ts', readFileSync(new URL('../server/agent/loop.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'dispatchToolCalls');
    assert.ok(fn);
    const results = [];
    const events = [];
    const session = { images: [], quality: 'economy' };
    const context = vm.createContext({
        requireSession: () => session,
        findAgentModelTool: () => null,
        selectedModelIds: () => [],
        GENERATE_IMAGE_TOOL: 'generate_image', REMOVE_BACKGROUND_TOOL: 'remove_background', GENERATE_VIDEO_TOOL: 'generate_video', CONCAT_VIDEO_TOOL: 'concat_videos', ASK_USER_TOOL: 'ask_user', EXPORT_ZIP_TOOL: 'export_zip',
        resolveZipExport: () => ({ items: [item('Bottle')], name: 'assets' }),
        exportSessionZip: async (_input) => { return { ok: true, url: 'https://storage.test/archive.zip' }; },
        sessionWantsStop: () => false,
        appendToolResult: (_session, callId, result) => results.push({ callId, result: JSON.parse(result) }),
        queueGenerationWork: () => assert.fail('Export must not queue generation'),
    });
    vm.runInContext(ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    await context.dispatchToolCalls('session', [{ id: 'export-call', function: { name: 'export_zip', arguments: '{}' } }], event => events.push(event));
    assert.deepEqual(results, [{ callId: 'export-call', result: { ok: true, url: 'https://storage.test/archive.zip' } }]);
    assert.deepEqual(events.map(event => event.status), ['start', 'end']);
});
test('local media exports to ZIP without an HTTP download', async () => {
    const key = 'tests/' + crypto.randomUUID() + '.png';
    try {
        const url = await saveMediaFile(key, png, 'image/png');
        const { media, calls } = fixture([]);
        const output = await media.buildMediaExport({ items: [{ url, name: 'Local image' }], name: 'local' });
        assert.deepEqual(Buffer.from(unzipSync(output.bytes)['Local image.png']), png);
        assert.equal(calls.length, 0);
    }
    finally {
        await rm(join(mediaRoot(), key), { force: true });
    }
});
