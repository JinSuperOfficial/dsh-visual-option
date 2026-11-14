/**
 * `let_user_choose` 的模型参数归一化与校验。
 *
 * 纯逻辑：只做字符串/形状/路径字面量层面的检查，不触碰文件系统。
 * 文件是否存在、是否真在 root 内（含 symlink）由 preview.mjs 在起预览服务前
 * 再次核实。抛出的 Error 会作为标准工具错误回给模型，所以文案要可操作。
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'

export const MODES = new Set(['single', 'multi', 'fill', 'confirm'])
export const PREVIEW_KINDS = new Set(['url', 'path', 'html', 'php'])

/** 模型可自定义填空答案的长度上限（hub 校验答案时也用）。 */
export const CUSTOM_MAX = 4000

export const LIMITS = {
  questions: 8,
  options: 12,
  hint: 500,
  title: 200,
  detail: 4000,
  header: 100,
  question: 2000,
  placeholder: 200,
  label: 200,
  description: 1000,
}

/** 参数错误的统一前缀，方便模型辨认这是本工具的参数问题。 */
function fail(path, message) {
  throw new Error(`let_user_choose: ${path} ${message}`)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertObject(value, path) {
  if (!isObject(value)) fail(path, 'must be an object')
}

function assertKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(path, `has unknown field "${key}" (allowed: ${allowed.join(', ')})`)
  }
}

function readString(value, path, { required = false, max = 0 } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(path, 'is required')
    return undefined
  }
  if (typeof value !== 'string') fail(path, 'must be a string')
  const text = value.trim()
  if (text === '') {
    if (required) fail(path, 'must not be empty')
    return undefined
  }
  if (max > 0 && text.length > max) fail(path, `must be at most ${max} characters`)
  return text
}

function readBoolean(value, path, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
  return value
}

function readInteger(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(path, `must be an integer between ${min} and ${max}`)
  }
  return value
}

export function isInside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function normalizePreview(preview, path, { rootAbs, maxInlineBytes }) {
  assertObject(preview, path)
  assertKeys(preview, ['kind', 'value', 'title'], path)
  if (typeof preview.kind !== 'string' || !PREVIEW_KINDS.has(preview.kind)) {
    fail(`${path}.kind`, 'must be one of "url", "path", "html", "php"')
  }
  const title = readString(preview.title, `${path}.title`, { max: 120 })
  if (typeof preview.value !== 'string' || preview.value.length === 0) {
    fail(`${path}.value`, 'must be a non-empty string')
  }

  if (preview.kind === 'url') {
    let url
    try {
      url = new URL(preview.value)
    } catch {
      fail(`${path}.value`, 'must be an absolute http(s) URL')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      fail(`${path}.value`, 'must use http or https')
    }
    return { kind: 'url', value: url.href, title }
  }

  if (preview.kind === 'path') {
    if (preview.value.includes('\u0000')) fail(`${path}.value`, 'must not contain NUL')
    if (!rootAbs) {
      fail(`${path}.value`, 'needs a root or a session working directory to resolve against')
    }
    const abs = isAbsolute(preview.value) ? resolve(preview.value) : resolve(rootAbs, preview.value)
    if (!isInside(rootAbs, abs)) fail(`${path}.value`, `escapes the preview root ${rootAbs}`)
    return { kind: 'path', value: preview.value, title, abs }
  }

  // html / php：内联源码。按 UTF-8 字节数限制，避免一个参数把上下文/内存撑爆。
  if (Buffer.byteLength(preview.value, 'utf8') > maxInlineBytes) {
    fail(`${path}.value`, `is larger than maxInlineBytes (${maxInlineBytes} bytes)`)
  }
  return { kind: preview.kind, value: preview.value, title }
}

function normalizeOption(option, path, { labels, rootAbs, maxInlineBytes }) {
  assertObject(option, path)
  assertKeys(option, ['label', 'description', 'preview', 'correct', 'hint'], path)
  const label = readString(option.label, `${path}.label`, { required: true, max: LIMITS.label })
  if (labels.has(label)) fail(`${path}.label`, `must be unique; "${label}" is already used by another option`)
  labels.add(label)
  const description = readString(option.description, `${path}.description`, { max: LIMITS.description })
  const preview =
    option.preview === undefined
      ? undefined
      : normalizePreview(option.preview, `${path}.preview`, { rootAbs, maxInlineBytes })
  if (option.correct !== undefined && typeof option.correct !== 'boolean') {
    fail(`${path}.correct`, 'must be a boolean')
  }
  const hint = readString(option.hint, `${path}.hint`, { max: LIMITS.hint })
  return { label, description, preview, correct: option.correct === true, hint }
}

function normalizeQuestion(question, index, { ids, rootAbs, maxInlineBytes }) {
  const path = `questions[${index}]`
  assertObject(question, path)
  assertKeys(
    question,
    ['id', 'mode', 'multiSelect', 'header', 'question', 'detail', 'placeholder', 'required', 'options'],
    path,
  )

  let mode
  if (question.mode !== undefined) {
    if (typeof question.mode !== 'string' || !MODES.has(question.mode)) {
      fail(`${path}.mode`, 'must be one of "single", "multi", "fill", "confirm"')
    }
    mode = question.mode
    if (question.multiSelect !== undefined && typeof question.multiSelect !== 'boolean') {
      fail(`${path}.multiSelect`, 'must be a boolean')
    }
  } else if (question.multiSelect !== undefined) {
    if (typeof question.multiSelect !== 'boolean') fail(`${path}.multiSelect`, 'must be a boolean')
    mode = question.multiSelect ? 'multi' : 'single'
  } else {
    mode = 'single'
  }

  let id
  if (question.id !== undefined) {
    id = readString(question.id, `${path}.id`, { required: true, max: 32 })
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      fail(`${path}.id`, 'may contain only letters, digits, "_" and "-"')
    }
  } else {
    let n = index + 1
    while (ids.has(`q${n}`)) n += 1
    id = `q${n}`
  }
  if (ids.has(id)) fail(`${path}.id`, `duplicates another question id "${id}"`)
  ids.add(id)

  const text = readString(question.question, `${path}.question`, {
    required: true,
    max: LIMITS.question,
  })
  const header = readString(question.header, `${path}.header`, { max: LIMITS.header })
  const detail = readString(question.detail, `${path}.detail`, { max: LIMITS.detail })
  const placeholder = readString(question.placeholder, `${path}.placeholder`, {
    max: LIMITS.placeholder,
  })
  const required = readBoolean(question.required, `${path}.required`, true)

  let options = []
  if (mode === 'fill') {
    if (question.options !== undefined) {
      if (!Array.isArray(question.options) || question.options.length > 0) {
        fail(`${path}.options`, 'must be omitted for mode "fill"')
      }
    }
  } else {
    if (!Array.isArray(question.options)) {
      fail(`${path}.options`, `must be an array for mode "${mode}"`)
    }
    if (question.options.length < 2) fail(`${path}.options`, 'must contain at least two options')
    if (question.options.length > LIMITS.options) {
      fail(`${path}.options`, `must contain at most ${LIMITS.options} options`)
    }
    if (mode === 'confirm' && question.options.length !== 2) {
      fail(`${path}.options`, 'mode "confirm" requires exactly two options')
    }
    const labels = new Set()
    options = question.options.map((option, optionIndex) =>
      normalizeOption(option, `${path}.options[${optionIndex}]`, {
        labels,
        rootAbs,
        maxInlineBytes,
      }),
    )
  }

  return {
    id,
    mode,
    header,
    question: text,
    detail,
    placeholder,
    required,
    options,
  }
}

/**
 * 把模型参数归一化成 hub/preview 可直接消费的请求规格。
 *
 * @param {unknown} raw 模型给的参数（未经校验）。
 * @param {{ cwd?: string, maxInlineBytes?: number }} options
 *   `cwd` 是会话工作目录；`maxInlineBytes` 是本插件配置的内联源码上限。
 * @returns {{
 *   title?: string, detail?: string, rootAbs?: string, timeoutSeconds?: number,
 *   questions: Array<{
 *     id: string, mode: 'single'|'multi'|'fill'|'confirm', header?: string,
 *     question: string, detail?: string, placeholder?: string, required: boolean,
 *     options: Array<{ label: string, description?: string, preview?: {
 *       kind: 'url'|'path'|'html'|'php', value: string, title?: string, abs?: string
 *     } }>
 *   }>
 * }}
 */
export function normalizeArgs(raw, { cwd, maxInlineBytes = 65536 } = {}) {
  assertObject(raw, 'arguments')
  assertKeys(raw, ['title', 'detail', 'root', 'timeoutSeconds', 'questions', 'test'], 'arguments')

  const title = readString(raw.title, 'title', { max: LIMITS.title })
  const detail = readString(raw.detail, 'detail', { max: LIMITS.detail })

  const cwdAbs = typeof cwd === 'string' && cwd.trim() ? resolve(cwd.trim()) : undefined
  let rootAbs
  if (raw.root !== undefined) {
    const root = readString(raw.root, 'root', { required: true, max: 4000 })
    if (isAbsolute(root)) {
      rootAbs = resolve(root)
    } else {
      if (!cwdAbs) {
        fail('root', 'is relative but this session has no working directory; pass an absolute root')
      }
      rootAbs = resolve(cwdAbs, root)
    }
  } else if (cwdAbs) {
    rootAbs = cwdAbs
  }

  const timeoutSeconds =
    raw.timeoutSeconds === undefined
      ? undefined
      : readInteger(raw.timeoutSeconds, 'timeoutSeconds', 30, 3600)

  if (raw.test !== undefined && typeof raw.test !== 'boolean') fail('test', 'must be a boolean')
  const test = raw.test === true

  if (!Array.isArray(raw.questions)) fail('questions', 'must be an array')
  if (raw.questions.length === 0) fail('questions', 'must contain at least one question')
  if (raw.questions.length > LIMITS.questions) {
    fail('questions', `must contain at most ${LIMITS.questions} questions`)
  }

  const ids = new Set()
  const questions = raw.questions.map((question, index) =>
    normalizeQuestion(question, index, { ids, rootAbs, maxInlineBytes }),
  )

  return { title, detail, rootAbs, timeoutSeconds, test, questions }
}
