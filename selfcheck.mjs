/**
 * 无依赖自检：node selfcheck.mjs
 *
 * 覆盖参数归一化、预览服务的路径/MIME/PHP 分支、以及 hub 的完整 HTTP 链路
 * （pending → answer / cancel / timeout / abort → 结算），不需要启动 DSH。
 */

import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isInside, normalizeArgs } from './lib/args.mjs'
import { createHub, validateAnswers, API_PATHS } from './lib/hub.mjs'
import { createPreviewSession } from './lib/preview.mjs'

const cleanup = new Set()
process.on('exit', () => {
  for (const dir of cleanup) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

async function makeTemp(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanup.add(dir)
  return dir
}

const tests = []
function test(name, fn) {
  tests.push({ name, fn })
}

function expectArgsError(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'expected Error')
    assert.match(error.message, pattern)
    return true
  })
}

function specWith({ cwd = '/tmp', ...overrides } = {}, options = {}) {
  return normalizeArgs(
    {
      questions: [
        {
          question: 'Pick one',
          options: [{ label: 'A' }, { label: 'B' }],
          ...overrides,
        },
      ],
    },
    { cwd, maxInlineBytes: 65536, ...options },
  )
}

async function fetchResult(url, init) {
  const response = await fetch(url, init)
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    text: await response.text(),
  }
}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

test('args: defaults (single, q1, required, root=cwd)', () => {
  const spec = specWith({})
  assert.equal(spec.questions[0].mode, 'single')
  assert.equal(spec.questions[0].id, 'q1')
  assert.equal(spec.questions[0].required, true)
  assert.equal(spec.rootAbs, '/tmp')
})

test('args: multiSelect true means multi', () => {
  const spec = specWith({ multiSelect: true })
  assert.equal(spec.questions[0].mode, 'multi')
})

test('args: explicit mode wins over multiSelect', () => {
  const spec = specWith({ mode: 'single', multiSelect: true })
  assert.equal(spec.questions[0].mode, 'single')
})

test('args: duplicate labels rejected', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        { questions: [{ question: 'x', options: [{ label: 'A' }, { label: 'A' }] }] },
        { cwd: '/tmp' },
      ),
    /unique/,
  )
})

test('args: confirm requires exactly two options', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        {
          questions: [
            { mode: 'confirm', question: 'x', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] },
          ],
        },
        { cwd: '/tmp' },
      ),
    /exactly two/,
  )
})

test('args: fill rejects options', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        { questions: [{ mode: 'fill', question: 'x', options: [{ label: 'A' }] }] },
        { cwd: '/tmp' },
      ),
    /fill/,
  )
})

test('args: unknown preview kind rejected', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        {
          questions: [
            {
              question: 'x',
              options: [
                { label: 'A', preview: { kind: 'video', value: 'x' } },
                { label: 'B' },
              ],
            },
          ],
        },
        { cwd: '/tmp' },
      ),
    /kind/,
  )
})

test('args: non-http url rejected', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        {
          questions: [
            {
              question: 'x',
              options: [
                { label: 'A', preview: { kind: 'url', value: 'ftp://example.com/x' } },
                { label: 'B' },
              ],
            },
          ],
        },
        { cwd: '/tmp' },
      ),
    /http/,
  )
})

test('args: path escaping root rejected', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        {
          questions: [
            {
              question: 'x',
              options: [
                { label: 'A', preview: { kind: 'path', value: '../outside.html' } },
                { label: 'B' },
              ],
            },
          ],
        },
        { cwd: '/tmp/root', maxInlineBytes: 65536 },
      ),
    /escapes the preview root/,
  )
})

test('args: inline source over maxInlineBytes rejected', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        {
          questions: [
            {
              question: 'x',
              options: [
                { label: 'A', preview: { kind: 'html', value: 'x'.repeat(200) } },
                { label: 'B' },
              ],
            },
          ],
        },
        { cwd: '/tmp', maxInlineBytes: 100 },
      ),
    /maxInlineBytes/,
  )
})

test('args: timeoutSeconds range enforced', () => {
  expectArgsError(
    () => normalizeArgs({ timeoutSeconds: 29, questions: [{ question: 'x', options: [{ label: 'A' }, { label: 'B' }] }] }, { cwd: '/tmp' }),
    /between 30 and 3600/,
  )
  const spec = normalizeArgs(
    { timeoutSeconds: 30, questions: [{ question: 'x', options: [{ label: 'A' }, { label: 'B' }] }] },
    { cwd: '/tmp' },
  )
  assert.equal(spec.timeoutSeconds, 30)
})

test('args: duplicate question id rejected', () => {
  expectArgsError(
    () =>
      normalizeArgs(
        {
          questions: [
            { id: 'same', question: 'x', options: [{ label: 'A' }, { label: 'B' }] },
            { id: 'same', question: 'y', options: [{ label: 'A' }, { label: 'B' }] },
          ],
        },
        { cwd: '/tmp' },
      ),
    /duplicates/,
  )
})

test('args: unknown top-level field rejected', () => {
  expectArgsError(
    () => normalizeArgs({ questions: [{ question: 'x', options: [{ label: 'A' }, { label: 'B' }] }], extra: 1 }, { cwd: '/tmp' }),
    /unknown field "extra"/,
  )
})

test('args: relative root resolves from cwd', () => {
  const spec = normalizeArgs(
    {
      root: 'sub',
      questions: [
        {
          question: 'x',
          options: [
            { label: 'A', preview: { kind: 'path', value: 'a.html' } },
            { label: 'B' },
          ],
        },
      ],
    },
    { cwd: '/tmp/root' },
  )
  assert.equal(spec.rootAbs, '/tmp/root/sub')
  assert.equal(spec.questions[0].options[0].preview.abs, '/tmp/root/sub/a.html')
})

test('args: isInside helper', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true)
  assert.equal(isInside('/a/b', '/a/b'), true)
  assert.equal(isInside('/a/b', '/a/bc'), false)
  assert.equal(isInside('/a/b', '/a'), false)
})

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

async function tree() {
  const base = await makeTemp('luc-test-')
  const root = join(base, 'root')
  await mkdir(join(root, 'sub'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><link rel="stylesheet" href="/sub/style.css"><h1>hi</h1>')
  await writeFile(join(root, 'sub', 'style.css'), 'body{color:red}')
  await writeFile(join(root, 'sub', 'page.html'), '<h1>page</h1>')
  await writeFile(join(base, 'outside.txt'), 'TOP_SECRET')
  await symlink(join(base, 'outside.txt'), join(root, 'link.txt'))
  await writeFile(join(root, 'hello.php'), '<?php echo "PHP"; ?>')
  return { base, root }
}

function specForTree(root) {
  return normalizeArgs(
    {
      root,
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: { kind: 'path', value: 'index.html' } },
            { label: 'B', preview: { kind: 'path', value: 'sub/page.html' } },
          ],
        },
      ],
    },
    { cwd: root, maxInlineBytes: 65536 },
  )
}

test('preview: serves files, MIME, HEAD and rejects traversal/symlink', async () => {
  const { root } = await tree()
  const session = await createPreviewSession(specForTree(root), { phpBinary: '' })
  try {
    const view = session.options.get('0:0')
    assert.equal(view.kind, 'frame')
    const page = await fetchResult(view.url)
    assert.equal(page.status, 200)
    assert.match(page.type, /text\/html/)
    assert.match(page.text, /hi/)

    const css = await fetchResult(`${session.baseUrl}/sub/style.css`)
    assert.equal(css.status, 200)
    assert.match(css.type, /text\/css/)
    assert.equal(css.text, 'body{color:red}')

    const head = await fetch(`${session.baseUrl}/index.html`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')

    const traversal = await fetchResult(`${session.baseUrl}/..%2Foutside.txt`)
    assert.equal(traversal.status, 404)

    const symlink = await fetchResult(`${session.baseUrl}/link.txt`)
    assert.equal(symlink.status, 404)

    const missing = await fetchResult(`${session.baseUrl}/missing.html`)
    assert.equal(missing.status, 404)
  } finally {
    await session.close()
  }
})

test('preview: closed session refuses connections', async () => {
  const { root } = await tree()
  const session = await createPreviewSession(specForTree(root), { phpBinary: '' })
  const url = session.options.get('0:0').url
  await session.close()
  await assert.rejects(fetch(url))
})

test('preview: missing file fails before the dialog', async () => {
  const { root } = await tree()
  const spec = normalizeArgs(
    {
      root,
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: { kind: 'path', value: 'nope.html' } },
            { label: 'B' },
          ],
        },
      ],
    },
    { cwd: root },
  )
  await assert.rejects(createPreviewSession(spec, { phpBinary: '' }), /does not exist/)
})

test('preview: inline html is served at a token URL', async () => {
  const { root } = await tree()
  const spec = normalizeArgs(
    {
      root,
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: { kind: 'html', value: '<h1>inline</h1>' } },
            { label: 'B' },
          ],
        },
      ],
    },
    { cwd: root },
  )
  const session = await createPreviewSession(spec, { phpBinary: '' })
  try {
    const view = session.options.get('0:0')
    assert.equal(view.kind, 'frame')
    const page = await fetchResult(view.url)
    assert.equal(page.status, 200)
    assert.match(page.text, /inline/)
  } finally {
    await session.close()
  }
})

test('preview: php falls back to source when disabled', async () => {
  const { root } = await tree()
  const spec = normalizeArgs(
    {
      root,
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: { kind: 'path', value: 'hello.php' } },
            { label: 'B', preview: { kind: 'php', value: '<?php echo "INLINE"; ?>' } },
          ],
        },
      ],
    },
    { cwd: root },
  )
  const session = await createPreviewSession(spec, { phpBinary: '' })
  try {
    assert.equal(session.options.get('0:0').kind, 'source')
    assert.equal(session.options.get('0:1').kind, 'source')
    assert.match(session.sources.get('0:0').body, /PHP/)
    assert.match(session.sources.get('0:1').body, /INLINE/)
  } finally {
    await session.close()
  }
})

test('preview: fake php binary executes inline and file php', async () => {
  const { base, root } = await tree()
  const fakePhp = join(base, 'fake-php')
  await writeFile(fakePhp, '#!/bin/sh\necho "<h1>executed</h1>"\n')
  await chmod(fakePhp, 0o755)

  const spec = normalizeArgs(
    {
      root,
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: { kind: 'php', value: '<?php echo 1; ?>' } },
            { label: 'B', preview: { kind: 'path', value: 'hello.php' } },
          ],
        },
      ],
    },
    { cwd: root },
  )
  const session = await createPreviewSession(spec, { phpBinary: fakePhp })
  try {
    const inline = session.options.get('0:0')
    assert.equal(inline.kind, 'frame')
    assert.equal(inline.executed, true)
    assert.match((await fetchResult(inline.url)).text, /executed/)

    const file = session.options.get('0:1')
    assert.equal(file.kind, 'frame')
    assert.equal(file.executed, true)
    assert.match((await fetchResult(file.url)).text, /executed/)
  } finally {
    await session.close()
  }
})

test('preview: php binary that does not exist falls back to source', async () => {
  const { root } = await tree()
  const spec = normalizeArgs(
    {
      root,
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: { kind: 'php', value: '<?php echo 1; ?>' } },
            { label: 'B' },
          ],
        },
      ],
    },
    { cwd: root },
  )
  const session = await createPreviewSession(spec, { phpBinary: join(root, 'missing-php') })
  try {
    assert.equal(session.options.get('0:0').kind, 'source')
  } finally {
    await session.close()
  }
})

// ---------------------------------------------------------------------------
// hub
// ---------------------------------------------------------------------------

function hubConfig(overrides = {}) {
  return { timeoutMs: 60000, maxInlineBytes: 65536, phpBinary: '', ...overrides }
}

function pendingRequest(url) {
  return new Request(url)
}

function answerRequest(body) {
  return new Request('http://127.0.0.1:3080' + API_PATHS.answer, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function pendingFor(hub, session) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await hub.handlePending(
      pendingRequest(`http://127.0.0.1:3080${API_PATHS.pending}?session=${session}`),
    )
    const data = await response.json()
    if (data.requests.length > 0) return data
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('pending request did not appear')
}

test('hub: pending -> answer round trip', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const promise = hub.createRequest({ spec, sessionId: 's1', timeoutMs: 30000 })
  try {
    const pending = await pendingFor(hub, 's1')
    assert.equal(pending.ok, true)
    assert.equal(pending.requests.length, 1)
    const requestId = pending.requests[0].id

    const invalid = await hub.handleAnswer(answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: ['C'] }] }))
    assert.equal(invalid.status, 409)

    const ok = await hub.handleAnswer(answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: ['A'] }] }))
    assert.equal(ok.status, 200)
    const result = await promise
    assert.equal(result.status, 'answered')
    assert.deepEqual(result.answers, [{ id: 'q1', selected: ['A'] }])
    assert.equal(result.summary, 'q1: A')

    const settled = await hub.handleAnswer(answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: ['A'] }] }))
    assert.equal(settled.status, 409)

    const empty = await (await hub.handlePending(pendingRequest(`http://127.0.0.1:3080${API_PATHS.pending}?session=s1`))).json()
    assert.deepEqual(empty.requests, [])
  } finally {
    hub.dispose()
  }
})

test('hub: same-session busy', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const first = hub.createRequest({ spec, sessionId: 's1', timeoutMs: 30000 })
  await assert.rejects(hub.createRequest({ spec, sessionId: 's1', timeoutMs: 30000 }), /already waiting/)
  const pending = await pendingFor(hub, 's1')
  await hub.handleAnswer(answerRequest({ requestId: pending.requests[0].id, action: 'cancel', answers: [] }))
  assert.equal((await first).status, 'cancelled')
  hub.dispose()
})

test('hub: cancel', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const promise = hub.createRequest({ spec, sessionId: 's2', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's2')
  const response = await hub.handleAnswer(answerRequest({ requestId: pending.requests[0].id, action: 'cancel', answers: [] }))
  assert.equal(response.status, 200)
  assert.equal((await promise).status, 'cancelled')
  hub.dispose()
})

test('hub: hold cancels the timeout', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const promise = hub.createRequest({ spec, sessionId: 's8', timeoutMs: 300 })
  const pending = await pendingFor(hub, 's8')
  const requestId = pending.requests[0].id
  const holdRequest = () =>
    new Request('http://127.0.0.1:3080' + API_PATHS.hold, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId }),
    })
  const hold = await hub.handleHold(holdRequest())
  assert.equal(hold.status, 200)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const held = await pendingFor(hub, 's8')
  assert.equal(held.requests[0].timeoutCancelled, true)
  assert.equal(held.requests[0].expiresAt, null)
  await hub.handleAnswer(answerRequest({ requestId, action: 'cancel', answers: [] }))
  assert.equal((await promise).status, 'cancelled')
  const late = await hub.handleHold(holdRequest())
  assert.equal(late.status, 409)
  hub.dispose()
})

test('hub: timeout', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const result = await hub.createRequest({ spec, sessionId: 's3', timeoutMs: 80 })
  assert.equal(result.status, 'timeout')
  assert.match(result.hint, /did not answer/)
  hub.dispose()
})

test('hub: abort signal settles as cancelled', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const controller = new AbortController()
  const promise = hub.createRequest({ spec, sessionId: 's4', timeoutMs: 30000, signal: controller.signal })
  controller.abort()
  assert.equal((await promise).status, 'cancelled')
  hub.dispose()
})

test('hub: dispose settles everything', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const promise = hub.createRequest({ spec, sessionId: 's5', timeoutMs: 30000 })
  hub.dispose()
  assert.equal((await promise).status, 'cancelled')
})

test('hub: source endpoint serves php source', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = normalizeArgs(
    {
      root,
      questions: [
        {
          question: 'Pick',
          options: [
            { label: 'A', preview: { kind: 'php', value: '<?php echo "SOURCE"; ?>' } },
            { label: 'B' },
          ],
        },
      ],
    },
    { cwd: root },
  )
  const promise = hub.createRequest({ spec, sessionId: 's6', timeoutMs: 30000 })
  try {
    const pending = await pendingFor(hub, 's6')
    const preview = pending.requests[0].questions[0].options[0].preview
    assert.equal(preview.kind, 'source')
    const response = await hub.handleSource(new Request('http://127.0.0.1:3080' + preview.url))
    assert.equal(response.status, 200)
    assert.match(await response.text(), /SOURCE/)
    await hub.handleAnswer(answerRequest({ requestId: pending.requests[0].id, action: 'cancel', answers: [] }))
    await promise
  } finally {
    hub.dispose()
  }
})

test('hub: option notes round trip and validation', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = specForTree(root)
  const promise = hub.createRequest({ spec, sessionId: 's9', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's9')
  const requestId = pending.requests[0].id

  const bad = await hub.handleAnswer(
    answerRequest({
      requestId,
      action: 'submit',
      answers: [{ id: 'q1', selected: ['A'], notes: [{ label: 'Z', note: 'x' }] }],
    }),
  )
  assert.equal(bad.status, 409)

  const ok = await hub.handleAnswer(
    answerRequest({
      requestId,
      action: 'submit',
      answers: [{ id: 'q1', selected: ['A'], notes: [{ label: 'A', note: ' 更简洁 ' }, { label: 'B', note: '  ' }] }],
    }),
  )
  assert.equal(ok.status, 200)
  const result = await promise
  assert.deepEqual(result.answers, [{ id: 'q1', selected: ['A'], notes: [{ label: 'A', note: '更简洁' }] }])
  hub.dispose()
})

test('hub: other text answers an option question', async () => {
  const hub = createHub({ config: hubConfig() })
  const spec = normalizeArgs(
    {
      questions: [
        {
          id: 'q1',
          mode: 'single',
          question: 'Pick',
          required: true,
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    },
    { cwd: '/tmp' },
  )
  const promise = hub.createRequest({ spec, sessionId: 's-other', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's-other')
  const requestId = pending.requests[0].id

  const empty = await hub.handleAnswer(
    answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: [] }] }),
  )
  assert.equal(empty.status, 409)

  const ok = await hub.handleAnswer(
    answerRequest({
      requestId,
      action: 'submit',
      answers: [{ id: 'q1', selected: [], custom: ' 都不对，做成杂志风 ' }],
    }),
  )
  assert.equal(ok.status, 200)
  const result = await promise
  assert.deepEqual(result.answers, [{ id: 'q1', selected: [], custom: '都不对，做成杂志风' }])
  hub.dispose()
})

test('hub: skipped answers pass required questions', async () => {
  const hub = createHub({ config: hubConfig() })
  const spec = normalizeArgs(
    {
      questions: [
        {
          id: 'q1',
          mode: 'single',
          question: 'Pick',
          required: true,
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    },
    { cwd: '/tmp' },
  )
  const promise = hub.createRequest({ spec, sessionId: 's-skip', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's-skip')
  const requestId = pending.requests[0].id

  const conflicting = await hub.handleAnswer(
    answerRequest({
      requestId,
      action: 'submit',
      answers: [{ id: 'q1', selected: ['A'], skipped: true }],
    }),
  )
  assert.equal(conflicting.status, 409)

  const ok = await hub.handleAnswer(
    answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: [], skipped: true }] }),
  )
  assert.equal(ok.status, 200)
  const result = await promise
  assert.deepEqual(result.answers, [{ id: 'q1', selected: [], skipped: true }])
  hub.dispose()
})

test('hub: test mode exposes correct flags and scores answers', async () => {
  const hub = createHub({ config: hubConfig() })
  const spec = normalizeArgs(
    {
      test: true,
      questions: [
        {
          id: 'q1',
          mode: 'single',
          question: '2 + 2 ?',
          options: [{ label: '3' }, { label: '4', correct: true }],
        },
      ],
    },
    { cwd: '/tmp' },
  )
  const promise = hub.createRequest({ spec, sessionId: 's-test', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's-test')
  assert.equal(pending.requests[0].test, true)
  assert.equal(pending.requests[0].questions[0].options[1].correct, true)
  const requestId = pending.requests[0].id
  const ok = await hub.handleAnswer(
    answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: ['4'] }] }),
  )
  assert.equal(ok.status, 200)
  const result = await promise
  assert.deepEqual(result.score, { correct: 1, total: 1 })
  hub.dispose()
})

test('hub: option hints are reported back', async () => {
  const hub = createHub({ config: hubConfig() })
  const spec = normalizeArgs(
    {
      questions: [
        {
          id: 'q1',
          mode: 'single',
          question: 'Pick',
          options: [{ label: 'A', hint: 'look closer' }, { label: 'B', hint: 'different idea' }],
        },
      ],
    },
    { cwd: '/tmp' },
  )
  const promise = hub.createRequest({ spec, sessionId: 's-hint', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's-hint')
  assert.equal(pending.requests[0].questions[0].options[0].hint, 'look closer')
  const requestId = pending.requests[0].id

  const bad = await hub.handleAnswer(
    answerRequest({
      requestId,
      action: 'submit',
      answers: [{ id: 'q1', selected: ['A'], hints: ['Z'] }],
    }),
  )
  assert.equal(bad.status, 409)

  const ok = await hub.handleAnswer(
    answerRequest({
      requestId,
      action: 'submit',
      answers: [{ id: 'q1', selected: ['A'], hints: ['A', 'A'] }],
    }),
  )
  assert.equal(ok.status, 200)
  const result = await promise
  assert.deepEqual(result.answers, [{ id: 'q1', selected: ['A'], hints: ['A'] }])
  hub.dispose()
})

test('hub: ask action returns the question instead of answers', async () => {
  const hub = createHub({ config: hubConfig() })
  const spec = normalizeArgs(
    {
      questions: [
        {
          id: 'q1',
          mode: 'single',
          question: 'Pick',
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    },
    { cwd: '/tmp' },
  )
  const promise = hub.createRequest({ spec, sessionId: 's-ask', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's-ask')
  const requestId = pending.requests[0].id

  const empty = await hub.handleAnswer(answerRequest({ requestId, action: 'ask', question: '   ' }))
  assert.equal(empty.status, 409)

  const ok = await hub.handleAnswer(answerRequest({ requestId, action: 'ask', question: ' 哪个更稳？ ' }))
  assert.equal(ok.status, 200)
  const result = await promise
  assert.equal(result.status, 'asked')
  assert.equal(result.question, '哪个更稳？')
  hub.dispose()
})

test('hub: fill rejects option notes', () => {
  const spec = normalizeArgs(
    { questions: [{ mode: 'fill', question: 'Name?' }] },
    { cwd: '/tmp' },
  )
  assert.throws(
    () => validateAnswers(spec, [{ id: 'q1', selected: [], custom: 'Ada', notes: [{ label: 'A', note: 'x' }] }]),
    /fill-in/,
  )
})

test('hub: fill answers carry custom text', async () => {
  const { root } = await tree()
  const hub = createHub({ config: hubConfig() })
  const spec = normalizeArgs(
    {
      root,
      questions: [
        {
          mode: 'fill',
          question: 'Name?',
          options: undefined,
        },
      ],
    },
    { cwd: root },
  )
  const promise = hub.createRequest({ spec, sessionId: 's7', timeoutMs: 30000 })
  const pending = await pendingFor(hub, 's7')
  const requestId = pending.requests[0].id
  const empty = await hub.handleAnswer(answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: [] }] }))
  assert.equal(empty.status, 409)
  const ok = await hub.handleAnswer(
    answerRequest({ requestId, action: 'submit', answers: [{ id: 'q1', selected: [], custom: ' Ada ' }] }),
  )
  assert.equal(ok.status, 200)
  const result = await promise
  assert.deepEqual(result.answers, [{ id: 'q1', selected: [], custom: 'Ada' }])
  hub.dispose()
})

test('hub: validateAnswers rejects duplicates and unknown ids', () => {
  const spec = specWith({})
  assert.throws(() => validateAnswers(spec, []), /exactly once/)
  assert.throws(
    () => validateAnswers(spec, [{ id: 'q1', selected: [] }, { id: 'other', selected: ['A'] }]),
    /exactly once/,
  )
  assert.throws(() => validateAnswers(spec, [{ id: 'q1', selected: ['A', 'A'] }]), /duplicate/)
})

/** 假 ctx：只提供 apply() 真正用到的那几个能力。 */
function makePluginCtx({ sections, tools, taken = [] }) {
  const disposers = []
  const ctx = {
    tools: {
      register(tool) {
        if (taken.includes(tool.name)) throw new Error(`tool "${tool.name}" is already registered`)
        tools.push(tool)
      },
    },
    connection: { fetch: { register() {} } },
    agents: { get: () => undefined, roots: () => [] },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
    inject(_deps, callback) {
      callback({
        effect: ctx.effect,
        systemPrompt: {
          section(section) {
            sections.push(section)
            return () => {}
          },
        },
      })
    },
  }
  return { ctx, disposers }
}

test('apply: registers the tool and one system-prompt guidance section', async () => {
  const { apply, normalizeConfig } = await import('./index.js')
  const sections = []
  const tools = []
  const { ctx, disposers } = makePluginCtx({ sections, tools })

  apply(ctx, {})

  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'let_user_choose')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'plugin:dsh-visual-option')
  assert.ok(Number.isFinite(sections[0].order))
  assert.match(sections[0].text, /ask_user_question/)
  assert.match(sections[0].text, /kind: 'html'/)
  assert.match(sections[0].text, /let_user_choose/)
  assert.equal(normalizeConfig({}).replaceAskUserQuestion, false)
  assert.equal(normalizeConfig({ replaceAskUserQuestion: true }).replaceAskUserQuestion, true)
  for (const dispose of disposers) dispose()
})

test('apply: replace mode falls back to let_user_choose when the built-in is still there', async () => {
  const { apply } = await import('./index.js')
  const sections = []
  const tools = []
  const { ctx, disposers } = makePluginCtx({ sections, tools, taken: ['ask_user_question'] })

  apply(ctx, { replaceAskUserQuestion: true })

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['let_user_choose'],
  )
  assert.equal(sections.length, 1)
  for (const dispose of disposers) dispose()
})

test('apply: replace mode registers ask_user_question when the name is free', async () => {
  const { apply } = await import('./index.js')
  const sections = []
  const tools = []
  const { ctx, disposers } = makePluginCtx({ sections, tools })

  apply(ctx, { replaceAskUserQuestion: true })

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['ask_user_question'],
  )
  for (const dispose of disposers) dispose()
})

test('settings: every self-test fixture normalizes for its mode', async () => {
  const { selftestArgs } = await import('./index.js')
  const modes = ['single', 'multi', 'confirm', 'fill', 'quiz']
  for (const mode of modes) {
    const spec = normalizeArgs(selftestArgs(mode), { cwd: '/tmp', maxInlineBytes: 65536 })
    assert.equal(spec.questions.length, 1, mode)
    if (mode === 'quiz') {
      assert.equal(spec.test, true)
      assert.ok(spec.questions[0].options.some((option) => option.correct === true))
    }
    if (mode === 'confirm') assert.equal(spec.questions[0].mode, 'confirm')
    if (mode === 'fill') assert.equal(spec.questions[0].mode, 'fill')
    if (mode === 'multi') assert.equal(spec.questions[0].mode, 'multi')
  }
})

test('settings: overrides round-trip through DSH_HOME', async () => {
  const dir = await makeTemp('luc-settings-')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const mod = await import('./index.js')
    assert.deepEqual(mod.loadOverrides(), {})
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'dsh-visual-option.json'), JSON.stringify({ timeoutMs: 123000 }), 'utf8')
    assert.equal(mod.loadOverrides().timeoutMs, 123000)
    const merged = mod.normalizeConfig({ ...mod.loadOverrides() })
    assert.equal(merged.timeoutMs, 123000)
    assert.equal(merged.maxInlineBytes, 65536)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

// ---------------------------------------------------------------------------

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error && error.stack ? error.stack : error)
  }
}

console.log(`\n${tests.length - failed}/${tests.length} passed`)
if (failed > 0) process.exitCode = 1
