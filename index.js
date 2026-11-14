/**
 * Host half of dsh-let-user-choose.
 *
 * Registers the blocking `let_user_choose` tool and the three browser endpoints
 * on Connection's authenticated `/api` channel. The browser half (client.js)
 * polls the pending endpoint and renders the choice dialog in `shell.overlay`.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { normalizeArgs, setToolLabel } from './lib/args.mjs'
import { API_PATHS, createHub } from './lib/hub.mjs'

const TOOL_NAME = 'let_user_choose'
/** 设置页里保存的参数覆盖值，落在 DSH 家目录，重启后照样生效 */
const OVERRIDE_FILE = 'dsh-visual-option.json'
/** 只能从设置页改的三项（其余开关需要重启，不在 GUI 里动） */
const EDITABLE_KEYS = ['timeoutMs', 'maxInlineBytes', 'phpBinary']
/** replace 模式下顶替内置的 `ask_user_question`，让按工具名识别的插件照常触发 */
const ASK_USER_QUESTION = 'ask_user_question'

const PROMPT_SECTION = 'plugin:dsh-visual-option'
/** 落在工具区（TOOL_REPORT 之后、TOOL_COMPUTER_USE 之前） */
const PROMPT_ORDER = 2950
/**
 * 工具选择引导。只写「什么时候用哪个」和「什么时候必须给预览」，
 * 参数细节留在 schema 里，不在这里重复。replace 模式下只有一个提问工具，
 * 就把「优先用谁」换成「这个工具怎么带预览」。
 */
function guidanceFor(toolName) {
  const previewRules = `只要选项差别靠文字说不清——布局、配色、UI 方案、报错现场、数据结构、长代码差异、任何"看一眼才明白"的东西——就必须给对应选项加内联 HTML 预览：

  preview: { kind: 'html', value: '<完整可渲染的 HTML 源码>' }

真实网页用 kind: 'url'，本地文件用 kind: 'path'。不要只写文字描述就让用户自己想象`

  if (toolName === ASK_USER_QUESTION) {
    return `本机装了 dsh-visual-option，内置的 ask_user_question 已由它的弹窗版本接管：选项可带 url / 本地路径 / 内联 HTML·PHP 预览，还能写备注、点提示、测验判分

${previewRules}`
  }

  return `本机装了 dsh-visual-option：let_user_choose 是阻塞式选择弹窗，选项可带 url / 本地路径 / 内联 HTML·PHP 预览，还能写备注、点提示、测验判分

需要用户做选择时默认用它，而不是 ask_user_question——除非确有特殊需要（只要一批纯文字的长问答、要按时间等待的挂起提问、或者根本不在主会话）

${previewRules}`
}

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

function buildTool(ctx, config, hub, toolName) {
  return {
    name: toolName,
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
      if (!agent) throw new Error(`${toolName} requires a live session`)
      // 0.2.2 起 agents 服务没有 roots()，改用注册表身份 + session 头的 origin 判定
      if (ctx.agents.get(agent.id) !== agent) {
        throw new Error(`${toolName} requires the exact live calling agent`)
      }
      if (agent.session?.header?.origin === 'subagent') {
        throw new Error(
          `${toolName} is only available from the main session; a subagent cannot ask the user to choose`,
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

function responseJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function overridePath() {
  const home =
    typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
      ? process.env.DSH_HOME
      : join(homedir(), '.dsh')
  return join(home, OVERRIDE_FILE)
}

export function loadOverrides() {
  try {
    const raw = JSON.parse(readFileSync(overridePath(), 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

function saveOverrides(values) {
  const path = overridePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, `${JSON.stringify(values, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
    return true
  } catch {
    return false
  }
}

function pickEditable(config) {
  const out = {}
  for (const key of EDITABLE_KEYS) out[key] = config[key]
  return out
}

const DEMO_CARDS = {
  html: (title, body) =>
    `<html><body style="margin:0;font:14px/1.6 system-ui;background:#0f1115;color:#e6e8ee;padding:18px"><div style="font-weight:600;margin-bottom:8px">${title}</div>${body}</body></html>`,
}

/** 设置页「发起测试」用的样例参数，五种模式各一份 */
export function selftestArgs(mode) {
  const cardA = DEMO_CARDS.html(
    '方案 A',
    '<div style="border:1px solid #2a303c;border-radius:12px;padding:12px">圆角 · 间距大 · 柔和</div>',
  )
  const cardB = DEMO_CARDS.html(
    '方案 B',
    '<div style="border:1px solid #2a303c;padding:12px">直角 · 信息密度高</div>',
  )
  const base = {
    title: '设置页测试',
    detail: '这是设置页发起的自测请求，没有人等它的结果，答题或取消都会正常收尾',
  }
  if (mode === 'multi') {
    return {
      ...base,
      questions: [
        {
          id: 'q1',
          mode: 'multi',
          question: '多选：这次要验哪些点',
          options: [
            { label: '预览渲染', preview: { kind: 'html', value: cardA, title: '方案 A' } },
            { label: '备注与提示', hint: '点这里能看到提示文字' },
            { label: '跳过与其他' },
          ],
        },
      ],
    }
  }
  if (mode === 'confirm') {
    return {
      ...base,
      questions: [
        {
          id: 'q1',
          mode: 'confirm',
          question: '确认：这个弹窗工作正常吗',
          options: [{ label: '正常' }, { label: '不正常' }],
        },
      ],
    }
  }
  if (mode === 'fill') {
    return {
      ...base,
      questions: [{ id: 'q1', mode: 'fill', question: '填空：随便写点什么', placeholder: '在这里输入' }],
    }
  }
  if (mode === 'quiz') {
    return {
      ...base,
      test: true,
      questions: [
        {
          id: 'q1',
          question: '测验：提交后只显示对错和得分',
          options: [
            { label: '正确答案', correct: true },
            { label: '错误答案' },
          ],
        },
      ],
    }
  }
  return {
    ...base,
    questions: [
      {
        id: 'q1',
        question: '单选：哪张卡片更好看',
        options: [
          { label: '方案 A', preview: { kind: 'html', value: cardA, title: '方案 A' } },
          { label: '方案 B', preview: { kind: 'html', value: cardB, title: '方案 B' } },
        ],
      },
    ],
  }
}

export function normalizeConfig(raw) {
  const phpBinary = raw && typeof raw.phpBinary === 'string' ? raw.phpBinary.trim() : ''
  return {
    timeoutMs: clampInteger(raw?.timeoutMs, 600000, 5000, 3600000),
    maxInlineBytes: clampInteger(raw?.maxInlineBytes, 65536, 1024, 1048576),
    phpBinary,
    replaceAskUserQuestion: raw?.replaceAskUserQuestion === true,
  }
}

/** 工具名撞车（内置 ask_user_question 还在）时返回 false，由调用方退回自己的名字。 */
function registerTool(ctx, config, hub, toolName) {
  try {
    ctx.tools.register(buildTool(ctx, config, hub, toolName))
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[dsh-visual-option] cannot register tool "${toolName}": ${reason}`)
    return false
  }
}

export function apply(ctx, config) {
  const resolved = normalizeConfig({ ...config, ...loadOverrides() })
  const preferredName = resolved.replaceAskUserQuestion ? ASK_USER_QUESTION : TOOL_NAME
  let toolName = preferredName
  const hub = createHub({ config: resolved, toolName })
  setToolLabel(toolName)

  ctx.effect(() => () => hub.dispose(), 'let-user-choose: settle pending calls on unload')

  if (!registerTool(ctx, resolved, hub, preferredName) && preferredName !== TOOL_NAME) {
    console.warn(
      `[dsh-visual-option] replaceAskUserQuestion is on but the built-in ask_user_question row is still enabled; ` +
        `disable it in the profile patch (- id: tool-ask-user / disabled: true) and restart, keeping "${TOOL_NAME}" for now`,
    )
    toolName = TOOL_NAME
    registerTool(ctx, resolved, hub, TOOL_NAME)
  }

  // 引导放在系统提示词里：告诉模型优先用本工具，讲不清的地方必须配内联 HTML 预览
  const guidance = guidanceFor(toolName)
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(
      () =>
        promptCtx.systemPrompt.section({
          name: PROMPT_SECTION,
          order: PROMPT_ORDER,
          text: guidance,
        }),
      'let-user-choose: prefer this tool over ask_user_question',
    )
  })

  /** 设置页读写：GET 回当前生效值，POST 落盘并即时生效 */
  const handleSettings = async (request) => {
    if (request.method === 'GET') {
      return responseJson({ ok: true, config: hub.getConfig(), overrides: loadOverrides() })
    }
    let body
    try {
      body = await request.json()
    } catch {
      return responseJson({ ok: false, error: 'bad_body' }, 400)
    }
    if (!body || body.confirm !== true) return responseJson({ ok: false, error: 'confirm_required' }, 400)
    const patch = {}
    for (const key of EDITABLE_KEYS) {
      if (body[key] !== undefined) patch[key] = body[key]
    }
    const next = normalizeConfig({ ...hub.getConfig(), ...patch })
    if (!saveOverrides(pickEditable(next))) return responseJson({ ok: false, error: 'save_failed' }, 500)
    hub.replaceConfig(next)
    return responseJson({ ok: true, config: hub.getConfig() })
  }

  /** 设置页「发起测试」：在该会话里造一次真实请求，没人等结果，答完即收尾 */
  const handleSelftest = async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return responseJson({ ok: false, error: 'bad_body' }, 400)
    }
    if (!body || body.confirm !== true) return responseJson({ ok: false, error: 'confirm_required' }, 400)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (sessionId === '') return responseJson({ ok: false, error: 'session_required' }, 400)
    const mode = typeof body.mode === 'string' ? body.mode : 'single'
    let spec
    try {
      spec = normalizeArgs(selftestArgs(mode), {
        cwd: process.cwd(),
        maxInlineBytes: hub.getConfig().maxInlineBytes,
      })
    } catch (error) {
      return responseJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400)
    }
    hub
      .createRequest({ spec, sessionId, timeoutMs: 5 * 60 * 1000 })
      .catch((error) => console.warn('[dsh-visual-option] self test failed:', error))
    return responseJson({ ok: true })
  }

  const routes = [
    { path: API_PATHS.pending, methods: ['GET'], requestBody: 'buffered', fetch: hub.handlePending },
    { path: API_PATHS.answer, methods: ['POST'], requestBody: 'buffered', fetch: hub.handleAnswer },
    { path: API_PATHS.hold, methods: ['POST'], requestBody: 'buffered', fetch: hub.handleHold },
    { path: API_PATHS.source, methods: ['GET'], requestBody: 'buffered', fetch: hub.handleSource },
    { path: API_PATHS.settings, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: handleSettings },
    { path: API_PATHS.selftest, methods: ['POST'], requestBody: 'buffered', fetch: handleSelftest },
  ]
  for (const route of routes) {
    ctx.connection.fetch.register(route)
  }
}
