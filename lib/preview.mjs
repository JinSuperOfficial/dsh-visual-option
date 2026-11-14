/**
 * 每个待答请求一个的只读预览静态服务。
 *
 * root 挂在 `/`，所以站点页里的相对路径、根绝对路径（/lib/theme.js）都按真实
 * 目录工作；内联 HTML/PHP 文档挂在 `/<token>.html`。PHP 是否执行由 config 的
 * `phpBinary` 决定（'' = 不执行，只给源码），执行失败/找不到 php 时回退到源码。
 *
 * 安全边界：只 bind 127.0.0.1；只读；无目录列表；realpath 之后必须仍在 root 内
 * （拦 `..`、绝对路径逃逸与 symlink 逃逸）；不携带任何宿主凭据。
 */

import { spawn } from 'node:child_process'
import { createReadStream, promises as fsp, constants as FS } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'

const EXEC_TIMEOUT_MS = 8000
const MAX_STDOUT_BYTES = 2 * 1024 * 1024
const MAX_SOURCE_BYTES = 128 * 1024

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.wasm', 'application/wasm'],
])

function isInside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function mimeOf(file) {
  return MIME.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
}

function relPosix(root, file) {
  return relative(root, file).split(sep).join('/')
}

function encodeRel(rel) {
  return rel
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function docName() {
  return `luc-${randomBytes(8).toString('hex')}.html`
}

/** 解析 config 的 phpBinary：''/null = 不执行；'auto' = 探测 PATH；其余当可执行路径。 */
export async function resolvePhpBinary(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '') return null
  if (raw !== 'auto') return raw
  const names = process.platform === 'win32' ? ['php.exe', 'php.bat', 'php.cmd', 'php'] : ['php']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        await fsp.access(candidate, FS.X_OK)
        return candidate
      } catch {
        /* keep searching */
      }
    }
  }
  return null
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening)
      rejectListen(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolveListen()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

function closeServer(server, waitMs = 1000) {
  if (!server) return Promise.resolve()
  return new Promise((resolveClose) => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      resolveClose()
    }
    try {
      server.close(finish)
      server.closeAllConnections?.()
    } catch {
      finish()
    }
    const timer = setTimeout(finish, waitMs)
    timer.unref?.()
  })
}

function runPhp(args, { php, cwd }) {
  return new Promise((resolveRun) => {
    let settled = false
    let stdout = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let child
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish({ ok: false, reason: 'timeout', stdout })
    }, EXEC_TIMEOUT_MS)
    timer.unref?.()

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveRun(result)
    }

    try {
      child = spawn(php, args, {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      finish({ ok: false, reason: 'spawn', stdout: '' })
      return
    }

    child.on('error', () => finish({ ok: false, reason: 'missing', stdout: '' }))
    child.stdout?.on('data', (chunk) => {
      if (settled || stdoutBytes >= MAX_STDOUT_BYTES) return
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stdout += chunk.toString('utf8').slice(0, Math.max(0, MAX_STDOUT_BYTES - (stdoutBytes - chunk.length)))
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        finish({ ok: false, reason: 'overflow', stdout })
        return
      }
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      if (settled) return
      stderrBytes += chunk.length
      if (stderrBytes > 8192) child.stderr.destroy()
    })
    child.on('close', (code) => {
      finish(code === 0 ? { ok: true, stdout } : { ok: false, reason: 'exit', stdout })
    })
  })
}

async function execPhpSource(source, { php, cwd }) {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'luc-php-'))
  try {
    const file = join(dir, 'index.php')
    await fsp.writeFile(file, source, 'utf8')
    return await runPhp(['-d', 'display_errors=0', '-f', file], { php, cwd })
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function execPhpFile(file, { php, cwd }) {
  return runPhp(['-d', 'display_errors=0', '-f', file], { php, cwd })
}

async function readSource(file) {
  const handle = await fsp.open(file, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, MAX_SOURCE_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    return { body: buffer.toString('utf8'), truncated: stat.size > length }
  } finally {
    await handle.close()
  }
}

function serveBuffer(request, response, buffer, type) {
  response.writeHead(200, {
    'content-type': type,
    'content-length': String(buffer.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  response.end(buffer)
}

function sendText(response, status, text, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(text)
}

/**
 * 为一个待答请求创建预览会话：校验 root/文件、准备内联文档、按需执行 PHP，
 * 然后起一个只监听 loopback 的静态服务。
 *
 * @param {ReturnType<import('./args.mjs').normalizeArgs>} spec
 * @param {{ phpBinary?: string }} options
 */
export async function createPreviewSession(spec, { phpBinary = '' } = {}) {
  /** @type {Map<string, { body: string, type: string }>} */
  const docs = new Map()
  /** @type {Map<string, { body: string, type: string }>} real path -> 执行结果 */
  const dynamic = new Map()
  /** @type {Map<string, { language: string, body: string, truncated?: boolean }>} */
  const sources = new Map()
  /** @type {Array<{ key: string, kind: 'frame', title?: string, external: boolean, executed: boolean, rel?: string, docPath?: string, url?: string } | { key: string, kind: 'source', title?: string, language: string }>} */
  const entries = []

  let tempRoot
  let server
  let realRoot
  let closed = false
  let phpPromise

  const getPhp = () => {
    if (!phpPromise) phpPromise = resolvePhpBinary(phpBinary)
    return phpPromise
  }

  try {
    let rootDir = spec.rootAbs
    if (!rootDir) {
      tempRoot = await fsp.mkdtemp(join(tmpdir(), 'luc-root-'))
      rootDir = tempRoot
    }
    let rootStat
    try {
      rootStat = await fsp.stat(rootDir)
    } catch {
      throw new Error(`let_user_choose: preview root "${rootDir}" does not exist`)
    }
    if (!rootStat.isDirectory()) {
      throw new Error(`let_user_choose: preview root "${rootDir}" is not a directory`)
    }
    realRoot = await fsp.realpath(rootDir)

    let executedCount = 0

    for (let questionIndex = 0; questionIndex < spec.questions.length; questionIndex += 1) {
      const question = spec.questions[questionIndex]
      for (let optionIndex = 0; optionIndex < question.options.length; optionIndex += 1) {
        const option = question.options[optionIndex]
        const preview = option.preview
        if (!preview) continue
        const key = `${questionIndex}:${optionIndex}`

        if (preview.kind === 'url') {
          entries.push({
            key,
            kind: 'frame',
            title: preview.title,
            external: true,
            executed: false,
            url: preview.value,
          })
          continue
        }

        if (preview.kind === 'html') {
          const path = `/${docName()}`
          docs.set(path, { body: preview.value, type: 'text/html; charset=utf-8' })
          entries.push({
            key,
            kind: 'frame',
            title: preview.title,
            external: false,
            executed: false,
            docPath: path,
          })
          continue
        }

        if (preview.kind === 'php') {
          const php = await getPhp()
          if (php) {
            const result = await execPhpSource(preview.value, { php, cwd: realRoot })
            if (result.ok) {
              const path = `/${docName()}`
              docs.set(path, { body: result.stdout, type: 'text/html; charset=utf-8' })
              entries.push({
                key,
                kind: 'frame',
                title: preview.title,
                external: false,
                executed: true,
                docPath: path,
              })
              executedCount += 1
              continue
            }
          }
          sources.set(key, { language: 'php', body: preview.value })
          entries.push({ key, kind: 'source', title: preview.title, language: 'php' })
          continue
        }

        // path
        const abs = preview.abs
        let stat
        try {
          stat = await fsp.stat(abs)
        } catch {
          throw new Error(
            `let_user_choose: preview.path "${preview.value}" does not exist (root: ${realRoot})`,
          )
        }
        if (!stat.isFile()) {
          throw new Error(`let_user_choose: preview.path "${preview.value}" is not a file`)
        }
        const real = await fsp.realpath(abs)
        if (!isInside(realRoot, real)) {
          throw new Error(
            `let_user_choose: preview.path "${preview.value}" escapes the preview root after resolving symlinks`,
          )
        }
        const extension = extname(real).toLowerCase()
        if (extension === '.php' || extension === '.phtml') {
          const php = await getPhp()
          if (php) {
            const result = await execPhpFile(real, { php, cwd: realRoot })
            if (result.ok) {
              dynamic.set(real, { body: result.stdout, type: 'text/html; charset=utf-8' })
              entries.push({
                key,
                kind: 'frame',
                title: preview.title,
                external: false,
                executed: true,
                rel: relPosix(realRoot, real),
              })
              executedCount += 1
              continue
            }
          }
          const source = await readSource(real)
          sources.set(key, { language: 'php', body: source.body, truncated: source.truncated })
          entries.push({ key, kind: 'source', title: preview.title, language: 'php' })
          continue
        }
        entries.push({
          key,
          kind: 'frame',
          title: preview.title,
          external: false,
          executed: false,
          rel: relPosix(realRoot, real),
        })
      }
    }

    const handler = async (request, response) => {
      try {
        if (closed) return sendText(response, 503, 'preview closed')
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return sendText(response, 405, 'method not allowed')
        }
        const url = new URL(request.url ?? '/', 'http://preview.invalid')
        const doc = docs.get(url.pathname)
        if (doc) return serveBuffer(request, response, Buffer.from(doc.body, 'utf8'), doc.type)

        const rawRel = url.pathname.replace(/^\/+/, '')
        if (rawRel === '') return sendText(response, 404, 'not found')
        let rel
        try {
          rel = decodeURIComponent(rawRel)
        } catch {
          return sendText(response, 400, 'bad path')
        }
        if (rel.includes('\u0000')) return sendText(response, 400, 'bad path')
        const abs = resolve(realRoot, rel)
        if (!isInside(realRoot, abs)) return sendText(response, 404, 'not found')

        let real
        let stat
        try {
          real = await fsp.realpath(abs)
          stat = await fsp.stat(real)
        } catch {
          return sendText(response, 404, 'not found')
        }
        if (!isInside(realRoot, real) || !stat.isFile()) {
          return sendText(response, 404, 'not found')
        }

        const executed = dynamic.get(real)
        if (executed) {
          return serveBuffer(request, response, Buffer.from(executed.body, 'utf8'), executed.type)
        }

        response.writeHead(200, {
          'content-type': mimeOf(real),
          'content-length': String(stat.size),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        const stream = createReadStream(real)
        stream.on('error', () => {
          try {
            response.destroy()
          } catch {
            /* ignore */
          }
        })
        stream.pipe(response)
      } catch {
        try {
          sendText(response, 500, 'internal error')
        } catch {
          /* ignore */
        }
      }
    }

    server = http.createServer((request, response) => {
      void handler(request, response)
    })
    await listen(server)
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const baseUrl = `http://127.0.0.1:${port}`

    const options = new Map()
    for (const entry of entries) {
      if (entry.kind === 'source') {
        options.set(entry.key, {
          kind: 'source',
          language: entry.language,
          title: entry.title,
        })
        continue
      }
      let url = entry.url
      if (!url) {
        url = entry.docPath ? `${baseUrl}${entry.docPath}` : `${baseUrl}/${encodeRel(entry.rel ?? '')}`
      }
      const view = {
        kind: 'frame',
        url,
        external: entry.external,
        executed: entry.executed,
        title: entry.title,
      }
      options.set(entry.key, view)
    }

    return {
      port,
      baseUrl,
      root: realRoot,
      options,
      sources,
      executedCount,
      close: async () => {
        if (closed) return
        closed = true
        docs.clear()
        dynamic.clear()
        sources.clear()
        await closeServer(server)
        if (tempRoot) await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
      },
    }
  } catch (error) {
    closed = true
    docs.clear()
    dynamic.clear()
    sources.clear()
    await closeServer(server)
    if (tempRoot) await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
