/**
 * 待答请求表与三条浏览器 HTTP handler。
 *
 * 这里只依赖 WHATWG Request/Response，不 import 任何 DSH 包，所以 selfcheck 可以
 * 直接拿 `new Request(...)` 跑完整链路；index.js 负责把这三个 handler 挂到
 * `ctx.connection.fetch`（自动获得宿主 /api 的认证与 Host/Origin 准入）。
 */

import { randomUUID } from 'node:crypto'

import { CUSTOM_MAX } from './args.mjs'

/** 单个选项备注的长度上限（客户端 textarea 也按这个夹）。 */
const NOTE_MAX = 1000
import { createPreviewSession } from './preview.mjs'

export const API_PATHS = {
  pending: '/api/let-user-choose/pending',
  answer: '/api/let-user-choose/answer',
  hold: '/api/let-user-choose/hold',
  source: '/api/let-user-choose/source',
  settings: '/api/let-user-choose/settings',
  selftest: '/api/let-user-choose/selftest',
}

const ANSWER_BODY_LIMIT = 64 * 1024
const SETTLED_TTL_MS = 5 * 60 * 1000
const PREVIEW_CLOSE_DELAY_MS = 1500
/** 用户移动鼠标取消限时后，Host 仍保留的一小时安全兜底（页面被关掉时不至于永远悬挂）。 */
export const HOLD_SAFETY_MS = 60 * 60 * 1000

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function timeoutResult(timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000))
  const label =
    seconds >= 60 && seconds % 60 === 0
      ? `${seconds / 60} minutes`
      : `${seconds} second${seconds === 1 ? '' : 's'}`
  return {
    status: 'timeout',
    hint: `The user did not answer within ${label}.`,
  }
}

function summarize(answers) {
  const parts = answers.map((answer) => {
    const value =
      answer.skipped === true
        ? '(skipped)'
        : answer.custom !== undefined
          ? answer.custom || '(empty)'
          : answer.selected.length > 0
            ? answer.selected.join(', ')
            : '(none)'
    return `${answer.id}: ${value}`
  })
  return parts.join('; ').slice(0, 400)
}

function grade(spec, answers) {
  let correct = 0
  let total = 0
  for (const question of spec.questions) {
    const answer = answers.find((item) => item.id === question.id)
    if (!answer || answer.skipped === true) continue
    const labels = new Set(
      (question.options || []).filter((option) => option.correct === true).map((option) => option.label),
    )
    if (labels.size === 0) continue
    total++
    if (answer.selected.length === labels.size && answer.selected.every((label) => labels.has(label))) correct++
  }
  return { correct, total }
}

/**
 * 校验浏览器提交的答案，返回按问题顺序排列的规范化答案。
 * @throws {Error} 任何与请求规格不符的答案。
 */
export function validateAnswers(spec, input) {
  if (!Array.isArray(input)) throw new Error('answers must be an array')
  const byId = new Map()
  for (const item of input) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('each answer must be an object')
    }
    if (typeof item.id !== 'string' || item.id === '') {
      throw new Error('each answer needs a non-empty string id')
    }
    if (byId.has(item.id)) throw new Error(`duplicate answer for question "${item.id}"`)
    byId.set(item.id, item)
  }
  if (byId.size !== spec.questions.length) {
    throw new Error('answers must name each question of this request exactly once')
  }

  const out = []
  for (const question of spec.questions) {
    const item = byId.get(question.id)
    if (!item) throw new Error(`missing answer for question "${question.id}"`)
    if (item.custom !== undefined && typeof item.custom !== 'string') {
      throw new Error(`answer "${question.id}".custom must be a string`)
    }

    let selected = []
    if (item.selected !== undefined) {
      if (!Array.isArray(item.selected) || item.selected.some((label) => typeof label !== 'string')) {
        throw new Error(`answer "${question.id}".selected must be an array of strings`)
      }
      if (new Set(item.selected).size !== item.selected.length) {
        throw new Error(`answer "${question.id}".selected contains a duplicate label`)
      }
      selected = item.selected
    }

    if (item.skipped !== undefined && typeof item.skipped !== 'boolean') {
      throw new Error(`answer "${question.id}".skipped must be a boolean`)
    }
    if (item.skipped === true) {
      if (selected.length > 0) {
        throw new Error(`answer "${question.id}" is skipped; do not send selected labels`)
      }
      if (typeof item.custom === 'string' && item.custom.trim() !== '') {
        throw new Error(`answer "${question.id}" is skipped; do not send custom text`)
      }
      if (item.notes !== undefined) {
        throw new Error(`answer "${question.id}" is skipped; do not send notes`)
      }
      out.push({ id: question.id, selected: [], skipped: true })
      continue
    }

    if (question.mode === 'fill') {
      if (item.notes !== undefined) {
        throw new Error(`question "${question.id}" is fill-in; notes belong to options`)
      }
      if (selected.length > 0) {
        throw new Error(`question "${question.id}" is fill-in; do not send selected labels`)
      }
      const custom = (item.custom ?? '').trim()
      if (custom.length > CUSTOM_MAX) {
        throw new Error(`answer "${question.id}".custom must be at most ${CUSTOM_MAX} characters`)
      }
      if (question.required && custom === '') {
        throw new Error(`question "${question.id}" is required`)
      }
      out.push({ id: question.id, selected: [], custom })
      continue
    }

    const labels = new Set(question.options.map((option) => option.label))
    for (const label of selected) {
      if (!labels.has(label)) {
        throw new Error(`question "${question.id}" has no option labeled ${JSON.stringify(label)}`)
      }
    }

    // Built-in "其他" box: any option question may carry free text as an extra answer.
    const custom = typeof item.custom === 'string' ? item.custom.trim() : ''
    if (custom.length > CUSTOM_MAX) {
      throw new Error(`answer "${question.id}".custom must be at most ${CUSTOM_MAX} characters`)
    }

    let hints
    if (item.hints !== undefined) {
      if (!Array.isArray(item.hints) || item.hints.some((entry) => typeof entry !== 'string')) {
        throw new Error(`answer "${question.id}".hints must be an array of labels`)
      }
      const hintLabels = new Set(
        question.options.filter((option) => option.hint).map((option) => option.label),
      )
      for (const label of item.hints) {
        if (!hintLabels.has(label)) {
          throw new Error(`question "${question.id}" has no hint on option ${JSON.stringify(label)}`)
        }
      }
      const unique = [...new Set(item.hints)]
      if (unique.length > 0) hints = unique
    }

    let notes
    if (item.notes !== undefined) {
      if (!Array.isArray(item.notes)) {
        throw new Error(`answer "${question.id}".notes must be an array`)
      }
      const seenNotes = new Set()
      notes = []
      for (const entry of item.notes) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new Error(`answer "${question.id}".notes entries must be objects`)
        }
        if (typeof entry.label !== 'string' || typeof entry.note !== 'string') {
          throw new Error(`answer "${question.id}".notes entries need string label and note`)
        }
        if (seenNotes.has(entry.label)) {
          throw new Error(`answer "${question.id}".notes has a duplicate note for ${JSON.stringify(entry.label)}`)
        }
        seenNotes.add(entry.label)
        if (!labels.has(entry.label)) {
          throw new Error(
            `question "${question.id}" has no option labeled ${JSON.stringify(entry.label)} to note`,
          )
        }
        const note = entry.note.trim()
        if (note.length > NOTE_MAX) {
          throw new Error(`answer "${question.id}".notes note must be at most ${NOTE_MAX} characters`)
        }
        if (note !== '') notes.push({ label: entry.label, note })
      }
      if (notes.length === 0) notes = undefined
    }

    if (question.mode === 'multi') {
      if (question.required && selected.length === 0 && custom === '') {
        throw new Error(`question "${question.id}" requires at least one selection`)
      }
      out.push({
        id: question.id,
        selected: [...selected],
        ...(custom !== '' ? { custom } : {}),
        ...(hints ? { hints } : {}),
        ...(notes ? { notes } : {}),
      })
      continue
    }

    if (selected.length > 1) {
      throw new Error(`question "${question.id}" accepts a single selection`)
    }
    if (question.required && selected.length === 0 && custom === '') {
      throw new Error(`question "${question.id}" requires a selection`)
    }
    out.push({
      id: question.id,
      selected: [...selected],
      ...(custom !== '' ? { custom } : {}),
      ...(hints ? { hints } : {}),
      ...(notes ? { notes } : {}),
    })
  }
  return out
}

function previewToView(preview, requestId, optionKey) {
  if (preview.kind === 'source') {
    return {
      kind: 'source',
      language: preview.language,
      title: preview.title ?? null,
      url: `${API_PATHS.source}?requestId=${encodeURIComponent(requestId)}&option=${encodeURIComponent(optionKey)}`,
    }
  }
  return {
    kind: 'frame',
    url: preview.url,
    external: preview.external === true,
    executed: preview.executed === true,
    title: preview.title ?? null,
  }
}

function buildView(requestId, spec, sessionId, preview, expiresAt) {
  return {
    id: requestId,
    sessionId,
    title: spec.title ?? null,
    detail: spec.detail ?? null,
    test: spec.test === true,
    expiresAt,
    timeoutCancelled: false,
    questions: spec.questions.map((question, questionIndex) => ({
      id: question.id,
      mode: question.mode,
      header: question.header ?? null,
      question: question.question,
      detail: question.detail ?? null,
      placeholder: question.placeholder ?? null,
      required: question.required,
      options: question.options.map((option, optionIndex) => {
        const optionKey = `${questionIndex}:${optionIndex}`
        const view = preview.options.get(optionKey)
        return {
          label: option.label,
          description: option.description ?? null,
          preview: view ? previewToView(view, requestId, optionKey) : null,
          hint: option.hint ?? null,
          ...(spec.test === true ? { correct: option.correct === true } : {}),
        }
      }),
    })),
  }
}

/**
 * @param {{ config: { timeoutMs: number, maxInlineBytes: number, phpBinary: string }, toolName?: string }} options
 */
export function createHub({ config, toolName = 'let_user_choose' }) {
  /** @type {Map<string, any>} */
  const pending = new Map()
  /** sessionId -> requestId，包括“预览还在起”的预留 */
  const bySession = new Map()
  /** requestId -> settled 时间，用于把重复提交区分成 409 而不是 404 */
  const settledIds = new Map()
  let disposed = false

  function pruneSettled() {
    const cutoff = Date.now() - SETTLED_TTL_MS
    for (const [id, at] of settledIds) {
      if (at < cutoff) settledIds.delete(id)
    }
  }

  function settle(entry, result, { immediate = false } = {}) {
    if (entry.settled) return
    entry.settled = true
    if (entry.timer) clearTimeout(entry.timer)
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort)
    }
    pending.delete(entry.requestId)
    if (bySession.get(entry.sessionId) === entry.requestId) bySession.delete(entry.sessionId)
    settledIds.set(entry.requestId, Date.now())
    entry.resolve(result)
    const closePreview = () => {
      entry.preview.close().catch(() => {})
    }
    if (immediate) {
      closePreview()
    } else {
      const timer = setTimeout(closePreview, PREVIEW_CLOSE_DELAY_MS)
      timer.unref?.()
    }
  }

  async function createRequest({ spec, sessionId, timeoutMs, signal }) {
    if (spec.test === true) {
      for (const question of spec.questions) {
        if (!question.options || question.options.length === 0) {
          throw new Error(`test question "${question.id}" needs at least two options`)
        }
        if (!question.options.some((option) => option.correct === true)) {
          throw new Error(`test question "${question.id}" needs at least one correct option`)
        }
      }
    }
    if (disposed) throw new Error(`${toolName}: this plugin is shutting down; try again after it restarts`)
    if (signal?.aborted) return { status: 'cancelled' }
    if (bySession.has(sessionId)) {
      throw new Error(
        `${toolName}: another choice is already waiting for an answer in this session; finish or cancel it before asking again`,
      )
    }

    const requestId = randomUUID()
    bySession.set(sessionId, requestId)

    let preview
    try {
      preview = await createPreviewSession(spec, { phpBinary: config.phpBinary })
    } catch (error) {
      if (bySession.get(sessionId) === requestId) bySession.delete(sessionId)
      throw error
    }

    if (disposed || signal?.aborted) {
      if (bySession.get(sessionId) === requestId) bySession.delete(sessionId)
      await preview.close().catch(() => {})
      return { status: 'cancelled' }
    }

    const expiresAt = Date.now() + timeoutMs
    const view = buildView(requestId, spec, sessionId, preview, expiresAt)

    let resolveRequest
    const done = new Promise((resolve) => {
      resolveRequest = resolve
    })

    const entry = {
      requestId,
      sessionId,
      spec,
      view,
      preview,
      settled: false,
      timer: null,
      signal,
      onAbort: null,
      resolve: resolveRequest,
    }
    pending.set(requestId, entry)

    entry.timer = setTimeout(() => settle(entry, timeoutResult(timeoutMs)), timeoutMs)
    entry.timer.unref?.()

    if (signal) {
      entry.onAbort = () => settle(entry, { status: 'cancelled' })
      signal.addEventListener('abort', entry.onAbort, { once: true })
      if (signal.aborted) entry.onAbort()
    }

    return done
  }

  async function handlePending(request) {
    try {
      const url = new URL(request.url)
      const session = url.searchParams.get('session') ?? ''
      if (session === '' || session.length > 200) {
        return json({ ok: false, error: 'bad_session' }, 400)
      }
      const requestId = bySession.get(session)
      const entry = requestId ? pending.get(requestId) : undefined
      return json({ ok: true, now: Date.now(), toolName, requests: entry ? [entry.view] : [] })
    } catch {
      return json({ ok: false, error: 'internal' }, 500)
    }
  }

  async function handleAnswer(request) {
    let text
    try {
      text = await request.text()
    } catch {
      return json({ ok: false, error: 'bad_body' }, 400)
    }
    if (text.length > ANSWER_BODY_LIMIT) {
      return json({ ok: false, error: 'body_too_large' }, 413)
    }
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return json({ ok: false, error: 'bad_json' }, 400)
    }
    const requestId = body && typeof body.requestId === 'string' ? body.requestId : ''
    const action = body ? body.action : ''
    if (requestId === '' || (action !== 'submit' && action !== 'cancel' && action !== 'ask')) {
      return json({ ok: false, error: 'bad_request' }, 400)
    }

    const entry = pending.get(requestId)
    if (!entry) {
      pruneSettled()
      if (settledIds.has(requestId)) return json({ ok: false, error: 'settled' }, 409)
      return json({ ok: false, error: 'not_found' }, 404)
    }

    if (action === 'cancel') {
      settle(entry, { status: 'cancelled' })
      return json({ ok: true })
    }

    if (action === 'ask') {
      const question = typeof body.question === 'string' ? body.question.trim() : ''
      if (question === '') {
        return json({ ok: false, error: 'invalid', message: 'question is required' }, 409)
      }
      if (question.length > 4000) {
        return json({ ok: false, error: 'invalid', message: 'question is too long' }, 409)
      }
      settle(entry, { status: 'asked', question })
      return json({ ok: true })
    }

    let answers
    try {
      answers = validateAnswers(entry.spec, body.answers)
    } catch (error) {
      return json({ ok: false, error: 'invalid', message: String(error?.message ?? error) }, 409)
    }
    settle(entry, {
      status: 'answered',
      answers,
      summary: summarize(answers),
      ...(entry.spec.test === true ? { score: grade(entry.spec, answers) } : {}),
    })
    return json({ ok: true })
  }

  async function handleHold(request) {
    let text
    try {
      text = await request.text()
    } catch {
      return json({ ok: false, error: 'bad_body' }, 400)
    }
    if (text.length > 4096) return json({ ok: false, error: 'body_too_large' }, 413)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return json({ ok: false, error: 'bad_json' }, 400)
    }
    const requestId = body && typeof body.requestId === 'string' ? body.requestId : ''
    if (requestId === '') return json({ ok: false, error: 'bad_request' }, 400)

    const entry = pending.get(requestId)
    if (!entry) {
      pruneSettled()
      if (settledIds.has(requestId)) return json({ ok: false, error: 'settled' }, 409)
      return json({ ok: false, error: 'not_found' }, 404)
    }

    // 用户移动鼠标 = 还坐在屏幕前：放弃原来的等待上限，改为一小时安全兜底。
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    entry.view.expiresAt = null
    entry.view.timeoutCancelled = true
    entry.timer = setTimeout(() => settle(entry, timeoutResult(HOLD_SAFETY_MS)), HOLD_SAFETY_MS)
    entry.timer.unref?.()
    return json({ ok: true })
  }

  async function handleSource(request) {
    const url = new URL(request.url)
    const requestId = url.searchParams.get('requestId') ?? ''
    const option = url.searchParams.get('option') ?? ''
    const entry = pending.get(requestId)
    if (!entry) {
      return new Response('not found', {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      })
    }
    const source = entry.preview.sources.get(option)
    if (!source) {
      return new Response('not found', {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      })
    }
    const body = source.truncated
      ? `${source.body}\n\n/* … source truncated (${source.body.length} bytes shown) … */`
      : source.body
    return new Response(body, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const entry of [...pending.values()]) {
      settle(entry, { status: 'cancelled' }, { immediate: true })
    }
    pending.clear()
    bySession.clear()
    settledIds.clear()
  }

  return {
    createRequest,
    handlePending,
    handleAnswer,
    handleHold,
    handleSource,
    dispose,
    getConfig() {
      return { ...config }
    },
    replaceConfig(next) {
      Object.assign(config, next)
    },
    get pendingCount() {
      return pending.size
    },
  }
}
