/**
 * Host half of dsh-let-user-choose.
 *
 * Registers the blocking `let_user_choose` tool and the three browser endpoints
 * on Connection's authenticated `/api` channel. The browser half (client.js)
 * polls the pending endpoint and renders the choice dialog in `shell.overlay`.
 */

import { normalizeArgs } from './lib/args.mjs'
import { API_PATHS, createHub } from './lib/hub.mjs'

const TOOL_NAME = 'let_user_choose'

export const inject = ['agents', 'connection', 'tools']

const PREVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'value'],
  properties: {
    kind: {
      type: 'string',
      enum: ['url', 'path', 'html', 'php'],
      description:
        'url opens an absolute http(s) link; path serves a file inside root; html renders inline HTML; php renders inline PHP or falls back to its source.',
    },
    value: {
      type: 'string',
      description:
        'For url: an absolute http(s) URL. For path: a file path inside root (relative or absolute). For html/php: the source text, size-limited.',
    },
    title: {
      type: 'string',
      description: 'Optional short caption for this preview.',
    },
  },
}

const OPTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label'],
  properties: {
    label: {
      type: 'string',
      description: 'Short label returned in the answer; unique within the question.',
    },
    description: {
      type: 'string',
      description: 'One sentence shown under the label.',
    },
    preview: PREVIEW_SCHEMA,
    correct: {
      type: 'boolean',
      description: 'Marks this option as correct; only meaningful when the request sets test:true.',
    },
    hint: {
      type: 'string',
      description:
        'Optional hint the user can reveal with a "hint" button; answers[].hints reports which options the user peeked at.',
    },

  },
}

const QUESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    id: {
      type: 'string',
      description: 'Stable id echoed in the answer; auto-assigned (q1, q2, ...) when omitted.',
    },
    mode: {
      type: 'string',
      enum: ['single', 'multi', 'fill', 'confirm'],
      description:
        'single = exactly one option; multi = any number of options; fill = a typed answer; confirm = exactly two options with a quick submit.',
    },
    multiSelect: {
      type: 'boolean',
      description: 'When mode is omitted, true means multi and false means single.',
    },
    header: {
      type: 'string',
      description: 'Optional short heading for this question.',
    },
    question: {
      type: 'string',
      description: 'The question shown to the user.',
    },
    detail: {
      type: 'string',
      description: 'Optional supporting text under the question.',
    },
    placeholder: {
      type: 'string',
      description: 'Placeholder for mode "fill".',
    },
    required: {
      type: 'boolean',
      description: 'Whether an answer is required before submitting. Defaults to true.',
    },
    options: {
      type: 'array',
      description:
        '2–12 options for single/multi, exactly 2 for confirm; omit for fill. Labels must be unique and previews are optional.',
      items: OPTION_SCHEMA,
    },
  },
}

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    title: {
      type: 'string',
      description: 'Dialog title. Keep it short.',
    },
    detail: {
      type: 'string',
      description: 'One short paragraph shown under the title.',
    },
    root: {
      type: 'string',
      description:
        'Directory that path previews resolve against and that the preview may serve. Defaults to the session working directory. Relative values resolve from the session working directory.',
    },
    timeoutSeconds: {
      type: 'integer',
      description:
        'How long to wait for the user, in seconds (30–3600). Defaults to the host limit (usually 10 minutes). Omit unless the user asked for a different wait.',
    },
    questions: {
      type: 'array',
      description:
        '1–8 questions shown one step at a time in one dialog; they submit as one answer batch.',
      items: QUESTION_SCHEMA,
    },
    test: {
      type: 'boolean',
      description:
        'Turn the dialog into a quiz: mark the right options with correct:true; the client shows right/wrong marks after submit without revealing the answers, and the result carries score:{correct,total}.',
    },
  },
}

const NOTE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'note'],
  properties: {
    label: { type: 'string', description: 'Option label the note is attached to.' },
    note: { type: 'string', description: 'What the user wrote about that option.' },
  },
}

const ANSWER_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'selected'],
  properties: {
    id: { type: 'string', description: 'Question id.' },
    selected: {
      type: 'array',
      items: { type: 'string' },
      description: 'Chosen option labels; empty for fill-in questions.',
    },
    custom: {
      type: 'string',
      description: 'Typed answer for fill-in questions, or the built-in "Other" text of an option question.',
    },
    skipped: {
      type: 'boolean',
      description: 'True when the user skipped this question; selected is then empty.',
    },
    notes: {
      type: 'array',
      description: 'Optional per-option notes the user attached.',
      items: NOTE_ITEM_SCHEMA,
    },
    hints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Labels of options whose hint the user revealed.',
    },
  },
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: {
      type: 'string',
      enum: ['answered', 'cancelled', 'timeout', 'asked'],
      description: 'Outcome of this call.',
    },
    answers: {
      type: 'array',
      description: 'One item per question, present when status is "answered".',
      items: ANSWER_ITEM_SCHEMA,
    },
    summary: {
      type: 'string',
      description: 'One-line summary of the answers.',
    },
    score: {
      type: 'object',
      additionalProperties: false,
      description: 'Present when the request was a test and the user submitted.',
      properties: {
        correct: { type: 'number', description: 'Number of correctly answered questions.' },
        total: { type: 'number', description: 'Number of graded questions.' },
      },
    },
    hint: {
      type: 'string',
      description: 'Present when status is "timeout".',
    },
    question: {
      type: 'string',
      description: 'The user question, present when status is "asked".',
    },
  },
}

const DESCRIPTION = [
  'Ask the user to choose between 2+ previews, and wait for their answer.',
  '',
  'Use it when the decision needs to be seen rather than described: two page variants, a local HTML file, external links, or inline HTML/PHP drafts. Questions can be single-choice, multi-choice, fill-in, or confirm, and several questions submit together.',
  '',
  'The user may attach an optional note to any option; notes arrive in answers[].notes as {label, note}.',
  '',
  'Every option question has a small built-in "Other / 其他" input: if the user types there, the text arrives as answers[].custom and counts as an answer even when no option is selected.',
  '',
  'The user can hit "Ask / 提问" in any mode: the dialog closes and returns {status:"asked", question} instead of an answer. Answer that question in the chat, then ask again if you still need a choice.',
  '',
  'Questions are shown one step at a time (progress n/m). Every question can be skipped (answers[].skipped). Set test:true and mark options with correct:true to run a quiz: the client shows right/wrong marks after submit without revealing the correct answers, and the result carries score:{correct,total}.',
  '',
  'The call blocks until the user answers, cancels, or the wait ends. Returns {status:"answered", answers:[{id, selected, custom, notes}], summary} or {status:"cancelled"|"timeout"}. PHP previews show source unless the host has a PHP binary configured; never assume the PHP ran.',
].join('\n')

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function renderValue(value) {
  if (value.status === 'answered') {
    const lines = (value.answers ?? []).map((answer) => {
      const selectedText =
        answer.skipped === true
          ? '(skipped)'
          : answer.selected.length > 0
            ? answer.selected.join(', ')
            : '(none)'
      const shown =
        answer.custom !== undefined && answer.custom !== ''
          ? answer.selected.length > 0
            ? `${selectedText}（其他：${answer.custom}）`
            : answer.custom
          : answer.custom === ''
            ? '(empty)'
            : selectedText
      const hintLine =
        (answer.hints ?? []).length > 0 ? `  - hints used: ${answer.hints.join(', ')}` : null
      const noteLines = (answer.notes ?? []).map(
        (entry) => `  - note on ${entry.label}: ${entry.note}`,
      )
      return [`- ${answer.id}: ${shown}`, ...(hintLine ? [hintLine] : []), ...noteLines].join('\n')
    })
    return `User answered:\n${lines.join('\n')}`
  }
  if (value.status === 'cancelled') return 'The user cancelled the choice.'
  if (value.status === 'asked') {
    return `The user asked a question instead: ${value.question}\nAnswer it in the chat, then ask again if the choice is still needed.`
  }
  return `The user did not answer in time.${value.hint ? ` ${value.hint}` : ''}`
}

function buildTool(ctx, config, hub) {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: renderValue(value) }]
      },
      presentationMeta(_args, value) {
        return { status: value.status, summary: value.summary ?? '' }
      },
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (!agent) throw new Error('let_user_choose requires a live session')
      if (ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)) {
        throw new Error(
          'let_user_choose is only available from the main session; a subagent cannot ask the user to choose',
        )
      }
      const cwd = agent.session?.header?.cwd
      const spec = normalizeArgs(args, { cwd, maxInlineBytes: config.maxInlineBytes })
      const timeoutMs =
        spec.timeoutSeconds === undefined ? config.timeoutMs : spec.timeoutSeconds * 1000
      return hub.createRequest({ spec, sessionId: agent.id, timeoutMs, signal: exec.signal })
    },
    presentCall(args) {
      const title =
        args && typeof args === 'object' && typeof args.title === 'string' && args.title.trim() !== ''
          ? `Ask user to choose: ${truncate(args.title.trim(), 80)}`
          : 'Ask user to choose'
      return { card: 'generic', title, kind: 'other' }
    },
    presentResult(_args, result) {
      const meta = result && typeof result === 'object' ? result.meta : undefined
      const status = meta && typeof meta === 'object' ? meta.status : undefined
      if (status === 'answered') {
        const summary = typeof meta.summary === 'string' && meta.summary !== '' ? `: ${truncate(meta.summary, 80)}` : ''
        return { card: 'generic', title: `User answered${summary}` }
      }
      if (status === 'cancelled') return { card: 'generic', title: 'User cancelled' }
      if (status === 'timeout') return { card: 'generic', title: 'Choice timed out' }
      return undefined
    },
  }
}

function clampInteger(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function normalizeConfig(raw) {
  const phpBinary = raw && typeof raw.phpBinary === 'string' ? raw.phpBinary.trim() : ''
  return {
    timeoutMs: clampInteger(raw?.timeoutMs, 600000, 5000, 3600000),
    maxInlineBytes: clampInteger(raw?.maxInlineBytes, 65536, 1024, 1048576),
    phpBinary,
  }
}

export function apply(ctx, config) {
  const resolved = normalizeConfig(config)
  const hub = createHub({ config: resolved })

  ctx.effect(() => () => hub.dispose(), 'let-user-choose: settle pending calls on unload')
  ctx.tools.register(buildTool(ctx, resolved, hub))

  const routes = [
    { path: API_PATHS.pending, methods: ['GET'], requestBody: 'buffered', fetch: hub.handlePending },
    { path: API_PATHS.answer, methods: ['POST'], requestBody: 'buffered', fetch: hub.handleAnswer },
    { path: API_PATHS.hold, methods: ['POST'], requestBody: 'buffered', fetch: hub.handleHold },
    { path: API_PATHS.source, methods: ['GET'], requestBody: 'buffered', fetch: hub.handleSource },
  ]
  for (const route of routes) {
    ctx.connection.fetch.register(route)
  }
}
