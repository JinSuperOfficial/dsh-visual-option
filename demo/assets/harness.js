/* Acceptance-demo harness: mounts the real client.js dialog in a DSH-like
   shell with a mocked Host, drives it with real mouse input, and lets the
   Electron recorder capture every painted frame. */

(function () {
  'use strict'

  window.addEventListener('error', (e) => {
    const stack = e.error && e.error.stack ? String(e.error.stack) : ''
    window.__err = (e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || '') + '\n' + stack
    console.error('PAGE ERROR: ' + window.__err)
  })

  window.__ModuleLoader__ = {
    load(entry) {
      window.__pluginFactory = entry.factory
    },
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const $ = (s, root = document) => root.querySelector(s)
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s))
  const BASE = location.origin + '/demo/'

  // ---------------------------------------------------------------- bridge
  let nodeRequire = null
  try { nodeRequire = typeof require === 'function' ? require : null } catch (e) { nodeRequire = null }
  let ipc = null
  try { ipc = nodeRequire ? nodeRequire('electron').ipcRenderer : null } catch (e) { ipc = null }

  const bridge = {
    move(x, y) {
      if (ipc) ipc.send('mouse:move', Math.round(x), Math.round(y))
      else synthMove(x, y)
    },
    async click(x, y) {
      if (ipc) await ipc.invoke('mouse:click', Math.round(x), Math.round(y))
      else synthClick(x, y)
    },
    start() { return ipc ? ipc.invoke('rec:start') : Promise.resolve() },
    stop() { return ipc ? ipc.invoke('rec:stop') : Promise.resolve() },
  }

  function synthMove(x, y) {
    const el = document.elementFromPoint(x, y)
    const target = el || document.body
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
  }
  function synthClick(x, y) {
    const el = document.elementFromPoint(x, y)
    if (!el) return
    const opts = { bubbles: true, clientX: x, clientY: y, button: 0 }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    el.dispatchEvent(new MouseEvent('click', opts))
  }

  // ---------------------------------------------------------------- cursor
  const cursorEl = $('#cursor')
  const rippleEl = $('#ripple')
  let cx = 1520
  let cy = 866

  function showCursor(on) {
    cursorEl.style.opacity = on ? '1' : '0'
  }
  showCursor(false)

  function setCursor(x, y) {
    cx = x
    cy = y
    cursorEl.style.transform = `translate(${x - 3}px, ${y - 2}px)`
  }
  setCursor(cx, cy)

  function easeInOutCubic(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
  }

  function moveTo(x, y, dur = 700) {
    const sx = cx
    const sy = cy
    const t0 = performance.now()
    return new Promise((resolve) => {
      function step(now) {
        const p = Math.min(1, (now - t0) / dur)
        const e = easeInOutCubic(p)
        const nx = sx + (x - sx) * e
        const ny = sy + (y - sy) * e
        setCursor(nx, ny)
        bridge.move(nx, ny)
        if (p < 1) requestAnimationFrame(step)
        else { bridge.move(x, y); resolve() }
      }
      requestAnimationFrame(step)
    })
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 46) }
  }

  async function moveToEl(el, dur = 700) {
    if (!el) throw new Error('moveToEl: element missing')
    const p = rectOf(el)
    await moveTo(p.x, p.y, dur)
  }

  async function clickEl(el, dur = 700) {
    if (!el) throw new Error('clickEl: element missing')
    const p = rectOf(el)
    await moveTo(p.x, p.y, dur)
    rippleEl.style.left = p.x + 'px'
    rippleEl.style.top = p.y + 'px'
    rippleEl.classList.remove('on')
    void rippleEl.offsetWidth
    rippleEl.classList.add('on')
    await sleep(90)
    await bridge.click(p.x, p.y)
    await sleep(70)
  }

  // ---------------------------------------------------------------- typing
  async function typeInto(el, text, speed = 55) {
    const isArea = el instanceof HTMLTextAreaElement
    const proto = isArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    el.focus()
    await sleep(80)
    let value = ''
    for (const ch of Array.from(text)) {
      value += ch
      setter.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(speed + Math.random() * 30)
    }
  }

  // ---------------------------------------------------------------- UI bits
  const captionEl = $('#caption')
  const captionText = $('#caption-text')
  function setCaption(text) {
    if (!text) { captionEl.hidden = true; return }
    captionText.textContent = text
    captionEl.hidden = false
  }

  const toolEl = $('#tool')
  const toolState = $('#tool-state')
  const toolBody = $('#tool-body')
  const toolResult = $('#tool-result')
  const toolResultPre = $('#tool-result-pre')

  function setToolRunning(argsText, bodyText) {
    toolEl.dataset.state = 'running'
    toolState.textContent = '等待用户选择…'
    toolBody.hidden = false
    toolResult.hidden = true
    const line = toolBody.querySelector('.tool-line')
    const arg = toolBody.querySelector('.tool-args')
    if (bodyText) line.textContent = bodyText
    if (argsText) arg.textContent = argsText
  }

  async function setToolResult(json, label, speed = 7) {
    toolEl.dataset.state = json.status === 'cancelled' ? 'cancelled' : 'answered'
    toolState.textContent = label
    toolBody.hidden = true
    toolResult.hidden = false
    toolResultPre.textContent = ''
    const text = JSON.stringify(json, null, 2)
    for (const ch of Array.from(text)) {
      toolResultPre.textContent += ch
      if (text.length < 60 || Math.random() < 0.9) await sleep(speed)
    }
    toolResultPre.textContent = text
    const thread = document.querySelector('.thread')
    if (thread) thread.scrollTop = thread.scrollHeight
  }

  function fadeOut(el, ms = 420) {
    return new Promise((resolve) => {
      el.classList.add('fade-out')
      setTimeout(() => { el.hidden = true; el.classList.remove('fade-out'); resolve() }, ms)
    })
  }

  function show(el) { el.hidden = false }

  // ---------------------------------------------------------------- host mock
  const host = {
    pending: null,
    holdCount: 0,
    answer: null,
    onAnswer: null,
  }

  function jsonResponse(obj) {
    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const realFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.indexOf('/api/let-user-choose/pending') === 0) {
      const now = Date.now()
      return Promise.resolve(jsonResponse({ now, requests: host.pending ? [host.pending] : [] }))
    }
    if (url.indexOf('/api/let-user-choose/answer') === 0) {
      let body = null
      try { body = JSON.parse((init && init.body) || '{}') } catch (e) { body = null }
      host.pending = null
      host.answer = body
      if (host.onAnswer) {
        const resolve = host.onAnswer
        host.onAnswer = null
        resolve(body)
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    }
    if (url.indexOf('/api/let-user-choose/source') === 0) {
      const file = url.indexOf('footer') >= 0 ? 'footer' : 'hero'
      const code = file === 'footer'
        ? '<footer class="site-foot">\n  <small>© 2026 Lumen Studio</small>\n</footer>\n\n<?php if ($debug): ?>\n  <pre><?= htmlspecialchars($trace) ?></pre>\n<?php endif ?>\n'
        : '<section class="hero">\n  <h1><?= e($title) ?></h1>\n  <p><?= e($lede) ?></p>\n  <a class="cta" href="<?= e($href) ?>">\n    <?= e($cta) ?>\n  </a>\n</section>\n\n<?php // rendered by the Host preview server ?>\n'
      return Promise.resolve(new Response(code, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } }))
    }
    if (url.indexOf('/api/let-user-choose/hold') === 0) {
      host.holdCount++
      return Promise.resolve(jsonResponse({ ok: true }))
    }
    return realFetch(input, init)
  }

  function openPending(view) {
    host.pending = Object.assign({}, view, { id: view.id, expiresAt: Date.now() + 600000 })
    console.log('OPEN PENDING ' + host.pending.id + ' questions=' + (host.pending.questions && host.pending.questions.length) + ' opts=' + (host.pending.questions && host.pending.questions.map((q) => (q.options || []).length).join(',')))
  }

  function waitForAnswer() {
    return new Promise((resolve) => { host.onAnswer = resolve })
  }

  // ---------------------------------------------------------------- plugin
  const dictionaries = {}
  let dialogComponent = null
  let root = null

  function installPlugin() {
    const factory = window.__pluginFactory
    if (!factory) throw new Error('client.js did not register a factory')
    const plugin = factory((name) => {
      if (name === 'react') return window.React
      throw new Error('unknown module ' + name)
    })

    const ctx = {
      effect(fn) { return fn() },
      locale: {
        register(ns, locale, dict) {
          if (locale === 'zh') dictionaries[ns] = dict
          return () => {}
        },
        subscribe() { return () => {} },
        bind(ns) {
          return (key, vars) => {
            let text = (dictionaries[ns] && dictionaries[ns][key]) || key
            if (vars) {
              for (const k of Object.keys(vars)) text = text.replace('{' + k + '}', String(vars[k]))
            }
            return text
          }
        },
      },
      slots: {
        inject(_name, fn) { return fn() },
        register(def, component) {
          dialogComponent = component
          return Object.assign({ component }, def)
        },
      },
      uiSession: {
        adapter: {
          current: {
            getSnapshot() { return { key: 'demo-session' } },
            subscribe() { return () => {} },
          },
        },
      },
    }

    plugin.apply(ctx)

    if (!dialogComponent) throw new Error('dialog component was not registered')
    root = window.ReactDOM.createRoot($('#overlay-root'))
    root.render(window.React.createElement(dialogComponent))
  }

  // ---------------------------------------------------------------- helpers
  async function waitFor(sel, timeout = 5000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const el = $(sel)
      if (el) return el
      await sleep(40)
    }
    throw new Error('timeout waiting for ' + sel)
  }

  async function waitGone(sel, timeout = 5000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (!$(sel)) return
      await sleep(40)
    }
    throw new Error('timeout waiting for ' + sel + ' to disappear')
  }

  function optionByLabel(label) {
    return $$('.luc-card, .luc-num').find((card) => {
      const el = card.querySelector('.luc-card-label, .luc-num-label')
      return el && el.textContent.indexOf(label) === 0
    })
  }

  function labelByLabel(label) {
    const option = optionByLabel(label)
    return option ? option.querySelector('.luc-card-label, .luc-num-label') : null
  }

  function noteBtnByLabel(label) {
    const option = optionByLabel(label)
    return option ? option.querySelector('.luc-note-btn') : null
  }

  function cardHead(label) {
    const option = optionByLabel(label)
    return option ? option.querySelector('.luc-card-head, .luc-num-head') : null
  }

  // ---------------------------------------------------------------- previews
  function prewarm() {
    return Promise.all([
      'preview/a.html',
      'preview/b.html',
    ].map((href) => new Promise((resolve) => {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:520px;height:320px;border:0'
      frame.src = BASE + href
      frame.onload = () => resolve()
      setTimeout(resolve, 2500)
      document.body.appendChild(frame)
    })))
  }
  function dropPrewarm() {
    $$('iframe[style*="-9999px"]').forEach((el) => el.remove())
  }

  // ---------------------------------------------------------------- views
  function previewFrame(name) {
    return {
      kind: 'frame',
      url: BASE + 'preview/' + name,
      external: false,
      executed: false,
      title: name,
    }
  }

  const viewPlan = {
    id: 'req-plan',
    title: '选一个落地页方向',
    detail: '两套页面都在下面，点选一个；拿不准的地方可以写在备注里。',
    expiresAt: 0,
    questions: [
      {
        id: 'q-plan',
        header: '落地页',
        question: '哪个方向更适合继续打磨？',
        mode: 'single',
        required: true,
        options: [
          {
            label: '方案 A · 暖色编辑风',
            description: '大标题 + 暖橙渐变，适合品牌叙事',
            preview: previewFrame('a.html'),
          },
          {
            label: '方案 B · 冷色仪表盘风',
            description: '数据卡片 + 冷蓝渐变，适合产品介绍',
            preview: previewFrame('b.html'),
          },
        ],
      },
      {
        id: 'q-pace',
        header: '节奏',
        question: '想怎么推进？',
        mode: 'confirm',
        required: false,
        options: [
          { label: '先出样片', description: '15 秒样片确认后再全量' },
          { label: '一次做完', description: '直接做完再一起看' },
        ],
      },
    ],
  }

  const viewSource = {
    id: 'req-source',
    title: '源码也能直接看',
    detail: 'PHP 没有执行时，客户端拿到的是源码；执行开关由插件配置决定。',
    expiresAt: 0,
    questions: [
      {
        id: 'q-file',
        header: '模板',
        question: '这两个模板长什么样？',
        mode: 'single',
        required: true,
        options: [
          { label: 'templates/hero.php', description: '首屏模板（PHP 未执行）', preview: { kind: 'source', url: '/api/let-user-choose/source?file=hero', executed: false } },
          { label: 'templates/footer.php', description: '页脚模板（PHP 未执行）', preview: { kind: 'source', url: '/api/let-user-choose/source?file=footer', executed: false } },
        ],
      },
    ],
  }


  const viewProbe = {
    id: 'req-probe',
    title: '探针',
    detail: '自动化检查',
    expiresAt: 0,
    questions: [
      {
        id: 'q1',
        header: '第 1 题',
        question: '404 表示什么？',
        mode: 'single',
        required: true,
        options: [
          { label: '未找到', hint: 'Not Found' },
          { label: '服务器内部错误', hint: '500' },
        ],
      },
    ],
  }

  const viewMore = {
    id: 'req-more',
    title: '两个快速问题',
    detail: '多选和填空可以放在同一个请求里，一次问完。',
    expiresAt: 0,
    questions: [
      {
        id: 'q-cap',
        header: '能力偏好',
        question: '想先看到哪些能力？',
        mode: 'multi',
        required: true,
        options: [
          { label: '预览嵌入', description: '把页面直接放进选项卡片' },
          { label: '选项备注', description: '每个选项单独写备注' },
          { label: '不限时等待', description: '鼠标一动就取消倒计时' },
          { label: '源码预览', description: 'PHP / 模板源码也能看' },
        ],
      },
      {
        id: 'q-note',
        header: '补充',
        question: '还有什么要交代的？',
        mode: 'fill',
        required: true,
        placeholder: '输入你的回答',
        options: [],
      },
    ],
  }

  const viewConfirm = {
    id: 'req-confirm',
    title: '现在生成第二版吗？',
    detail: '确认类问题只有一行选项，点一下就直接返回。',
    expiresAt: 0,
    questions: [
      {
        id: 'q-go',
        header: '下一步',
        question: '要现在开始出第二版吗？',
        detail: '会先出 15 秒样片，确认后再全量。',
        mode: 'confirm',
        required: true,
        options: [
          { label: '现在生成', description: '直接进入实现阶段' },
          { label: '先等等', description: '我先看看方案' },
        ],
      },
      {
        id: 'q-msg',
        header: '备注',
        question: '有想先记下来的吗？',
        mode: 'fill',
        required: false,
        placeholder: '会随答案一起回传（这次按 Esc 取消）',
        options: [],
      },
    ],
  }

  // ---------------------------------------------------------------- scenario
  function mark(name) {
    if (ipc) ipc.send('mark', name)
    else console.log('MARK ' + name + ' ' + Date.now())
  }

  const viewQuiz = {
    id: 'req-quiz',
    title: '测验模式',
    detail: '选项里标了答案，提交后只显示对错和得分，不显示正确答案',
    test: true,
    expiresAt: 0,
    questions: [
      {
        id: 'k1',
        header: '第 1 题',
        question: '404 表示什么？',
        mode: 'single',
        required: true,
        options: [
          { label: '未找到', correct: true, hint: 'Not Found' },
          { label: '服务器内部错误', hint: 'Internal Server Error' },
          { label: '请求被重定向', hint: '3xx 系列' },
        ],
      },
      {
        id: 'k2',
        header: '第 2 题',
        question: '哪一版是暖色编辑风？',
        mode: 'single',
        required: true,
        options: [
          { label: '方案 A · 暖色编辑风', correct: true, preview: previewFrame('a.html') },
          { label: '方案 B · 冷色仪表盘风', preview: previewFrame('b.html') },
        ],
      },
    ],
  }

  async function scenario() {
    dropPrewarm()
    showCursor(false)
    const sc = (id) => document.getElementById(id)
    await bridge.start()
    await sleep(200)

    // ---- intro 01: plain ask-user
    mark('s01')
    sc('scene-ask').hidden = false
    await sleep(3900)

    // ---- intro 02: split screen
    mark('s02')
    sc('scene-ask').hidden = true
    sc('scene-split').hidden = false
    await sleep(4300)

    // ---- intro 03: zoom into the plain text
    mark('s03')
    sc('scene-split').hidden = true
    sc('scene-zoom').hidden = false
    await sleep(6900)

    // ---- intro 04: disaster page
    mark('s04')
    sc('scene-zoom').hidden = true
    sc('scene-disaster').hidden = false
    await sleep(4000)

    // ---- intro 05: the real dialog, pick and annotate
    mark('s05')
    sc('scene-disaster').hidden = true
    showCursor(true)
    setToolRunning('{ "mode": "single", "timeoutSeconds": 600 }', '请选择落地页方案 · 2 个选项 · 可加备注')
    setCaption('两套页面直接嵌进对话框，点一下选中，还能写备注')
    openPending(viewPlan)
    await waitFor('.luc-panel', 5000)
    await sleep(500)
    await moveToEl(cardHead('方案 B'), 800)
    await sleep(300)
    await clickEl(labelByLabel('方案 B'), 700)
    await sleep(500)
    await clickEl(noteBtnByLabel('方案 A'), 600)
    await sleep(300)
    await typeInto($('.luc-note-input'), '排版更克制，但配色有点重', 45)
    await sleep(500)

    // ---- intro 06: the polished result
    mark('s06')
    showCursor(false)
    sc('scene-pretty').hidden = false
    await sleep(4900)

    // ---- intro 07: logo burst
    mark('s07')
    sc('scene-pretty').hidden = true
    sc('scene-burst').hidden = false
    await sleep(4900)
    sc('scene-burst').hidden = true

    // ---- body 08: stepper, pace question, submit
    mark('s08')
    showCursor(true)
    setCaption('鼠标一动倒计时就消失，还能给任意选项写备注')
    await clickEl($('.luc-primary'), 600)
    await sleep(600)
    await clickEl(labelByLabel('先出样片'), 600)
    await sleep(3800)
    await clickEl($('.luc-primary'), 700)

    // ---- body 09: structured answer
    mark('s09')
    await waitGone('.luc-panel', 4000)
    setCaption('提交后，模型拿到的是结构化答案，备注一起回传')
    await setToolResult({
      status: 'answered',
      answers: [
        {
          id: 'q-plan',
          selected: ['方案 B · 冷色仪表盘风'],
          notes: [{ label: '方案 A · 暖色编辑风', note: '排版更克制，但配色有点重' }],
        },
        { id: 'q-pace', selected: ['先出样片'] },
      ],
      summary: 'q-plan: 方案 B · 冷色仪表盘风 · q-pace: 先出样片',
    }, '已返回 · answered')
    $('#bot-tail').hidden = false
    await sleep(4200)

    // ---- body 10: multi + fill
    mark('s10')
    setCaption('多选与填空可以混在同一个请求里，底部是步骤进度')
    setToolRunning('{ "questions": 2, "mode": ["multi", "fill"] }', '想先看到哪些能力？· 补充说明')
    openPending(viewMore)
    await waitFor('.luc-panel', 5000)
    await sleep(1200)
    await clickEl(labelByLabel('选项备注'), 650)
    await sleep(400)
    await clickEl(labelByLabel('不限时等待'), 500)
    await sleep(400)
    await clickEl($('.luc-primary'), 600)
    await sleep(500)
    const fill = $('.luc-fill')
    await clickEl(fill, 600)
    await sleep(160)
    await typeInto(fill, '下周一之前出第二版，预算 3 万以内', 50)
    await sleep(400)
    await clickEl($('.luc-primary'), 650)
    await waitGone('.luc-panel', 4000)
    await setToolResult({
      status: 'answered',
      answers: [
        { id: 'q-cap', selected: ['选项备注', '不限时等待'] },
        { id: 'q-note', selected: [], custom: '下周一之前出第二版，预算 3 万以内' },
      ],
      summary: 'q-cap: 2 selected · q-note: 下周一之前出第二版…',
    }, '已返回 · answered')
    await sleep(2400)

    // ---- body 11: php source preview
    mark('s11')
    setCaption('本地页面和 PHP 模板也能直接预览，PHP 执行由配置决定')
    setToolRunning('{ "kind": "php", "phpBinary": "" }', '两个模板文件 · 源码预览')
    openPending(viewSource)
    await waitFor('.luc-panel', 5000)
    await sleep(1400)
    await clickEl(labelByLabel('templates/hero.php'), 700)
    await sleep(500)
    await clickEl($('.luc-primary'), 600)
    await waitGone('.luc-panel', 4000)
    await setToolResult({
      status: 'answered',
      answers: [{ id: 'q-file', selected: ['templates/hero.php'] }],
      summary: 'q-file: templates/hero.php',
    }, '已返回 · answered')
    await sleep(3200)

    // ---- body 12: quiz
    mark('s12')
    setCaption('测验模式：提交后只给对错和得分，不显示正确答案')
    setToolRunning('{ "test": true, "questions": 2 }', '测验：两道题，选项里标了答案')
    openPending(viewQuiz)
    await waitFor('.luc-panel', 5000)
    await sleep(1200)
    await clickEl(labelByLabel('未找到'), 600)
    await sleep(400)
    await clickEl($('.luc-primary'), 500)
    await sleep(400)
    await clickEl(labelByLabel('方案 A · 暖色编辑风'), 700)
    await sleep(400)
    await clickEl($('.luc-primary'), 600)
    await sleep(3000)
    await clickEl($('.luc-btn.luc-primary'), 500)
    await waitGone('.luc-panel', 4000)
    await setToolResult({
      status: 'answered',
      answers: [
        { id: 'k1', selected: ['未找到'] },
        { id: 'k2', selected: ['方案 A · 暖色编辑风'] },
      ],
      score: { correct: 2, total: 2 },
      summary: 'k1: 未找到 · k2: 方案 A · 暖色编辑风',
    }, '已返回 · answered')
    await sleep(2200)

    // ---- body 13: escape
    mark('s13')
    setCaption('Esc 或取消直接返回 cancelled，工具不会卡死')
    setToolRunning('{ "mode": "confirm" }', '要现在开始出第二版吗？')
    openPending(viewConfirm)
    await waitFor('.luc-panel', 5000)
    await sleep(1400)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitGone('.luc-panel', 4000)
    await setToolResult({
      status: 'cancelled',
      answers: [],
      summary: '用户取消了选择',
    }, '已取消 · cancelled')
    await sleep(3400)

    // ---- body 14: capabilities
    mark('s14')
    setCaption('')
    showCursor(false)
    show($('#tiles'))
    await sleep(4300)
    await fadeOut($('#tiles'))

    // ---- ending 15: github
    mark('s15')
    show($('#scene-github'))
    await sleep(4700)
    await fadeOut($('#scene-github'))

    // ---- ending 16: outro
    mark('s16')
    show($('#outro'))
    await sleep(3400)
    await fadeOut($('#outro'))

    await sleep(200)
    await bridge.stop()
  }

  window.__boot = async function () {
    try {
      installPlugin()
      await prewarm()
      await sleep(200)
      if (new URLSearchParams(location.search).has('probe')) await probe()
      else await scenario()
    } catch (err) {
      console.error('demo failed', err)
      const cap = $('#caption')
      cap.hidden = false
      document.querySelector('#caption-text').textContent = '录制失败: ' + err.message
      try { await bridge.stop() } catch (e) {}
    }
  }
})()
