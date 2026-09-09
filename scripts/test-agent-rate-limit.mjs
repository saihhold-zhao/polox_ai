import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../server/utils/agentRateLimit.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
test('status polling does not consume generation quota; both buckets stay limited and expire', () => {
    let now = 1000;
    const context = vm.createContext({ exports: {}, Date: { now: () => now }, createError: data => Object.assign(new Error(data.statusMessage), data) });
    vm.runInContext(code, context);
    const { assertAgentRateLimit } = context.exports;
    for (let i = 0; i < 240; i++)
        assertAgentRateLimit('GET');
    assert.throws(() => assertAgentRateLimit('HEAD'), { statusCode: 429 });
    for (let i = 0; i < 40; i++)
        assertAgentRateLimit('POST');
    assert.throws(() => assertAgentRateLimit('POST'), { statusCode: 429 });
    assert.throws(() => assertAgentRateLimit('POST'), { statusCode: 429 });
    now += 60000;
    assert.doesNotThrow(() => assertAgentRateLimit('GET'));
    assert.doesNotThrow(() => assertAgentRateLimit('POST'));
});
test('429 pauses automatic confirmations until Retry-After without saving an error turn', async () => {
    const { isAgentTransientMessage } = await import('../shared/utils/agentHistoryVisibility.ts');
    const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('agent.ts', source, ts.ScriptTarget.Latest, true);
    const functions = [];
    const names = ['parseError', 'maybeAutoApprove', 'setLabError', 'appendErrorMessage'];
    function visit(node) {
        if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
            functions.push(node.getText(tree));
        ts.forEachChild(node, visit);
    }
    visit(tree);
    let now = 1000;
    let confirmations = 0;
    const context = vm.createContext({
        Date: { now: () => now }, agentWriteRetryAt: 0,
        stopping: { value: false },
        confirmation: { value: { id: 'batch', params: {} } }, sessionId: { value: 'session' }, autoApprovingIds: new Set(),
        shouldAutoApprove: () => true, resolveConfirmation: async () => { confirmations++; },
        isAgentTransientMessage, agentRecoveryNotice: value => value,
        error: { value: '' }, messages: { value: [] }, readErrorText: payload => payload.statusMessage,
    });
    vm.runInContext(ts.transpile(functions.join('\n'), { target: ts.ScriptTarget.ES2022 }), context);
    const message = await context.parseError({ status: 429, headers: new Headers({ 'retry-after': '60' }), json: async () => ({ statusMessage: 'Too many Agent Lab requests. Wait a moment and try again.' }) });
    context.setLabError(message, true);
    assert.equal(context.messages.value.length, 0);
    assert.equal(context.error.value, message);
    for (let retry = 0; retry < 5; retry++)
        await context.maybeAutoApprove();
    assert.equal(confirmations, 0);
    now += 60000;
    await context.maybeAutoApprove();
    assert.equal(confirmations, 1);
});
