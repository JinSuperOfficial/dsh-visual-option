/**
 * Browser half of dsh-let-user-choose.
 *
 * Mounts one `shell.overlay` entry that polls Connection's /api channel for a
 * pending choice in the current session and renders it as a native-looking
 * dialog. It owns no Host state: the pending request and preview servers live
 * in the Host plugin, and answering settles the blocked tool call.
 */

window.__ModuleLoader__.load({
  id: 'dsh-visual-option',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/api/let-user-choose'
    const CLIENT_VERSION = '0.2.25'
    const POLL_MS = 1000
    const TOAST_MS = 2600
    const FRAME_SLOW_MS = 6000

    const PREFS_KEY = 'dsh-visual-option:prefs'
    const WIDTHS = ['auto', '768', '390']

    function loadPrefs() {
      try {
        const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}')
        return {
          width: WIDTHS.includes(raw.width) ? raw.width : 'auto',
          icons: raw.icons !== false,
        }
      } catch {
        return { width: 'auto', icons: true }
      }
    }

    const PREFS = loadPrefs()

    function savePrefs(patch) {
      Object.assign(PREFS, patch)
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(PREFS))
      } catch {
        /* private mode: keep the in-memory value */
      }
    }

    const LOCAL_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals allow-same-origin'
    const EXT_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals'

    const ZH = {
      defaultTitle: '请选择',
      requiredHint: '请先完成必填项',
      submit: '提交',
      submitting: '提交中…',
      cancel: '取消',
      close: '关闭',
      minimize: '收起',
      restore: '展开',
      seatKicker: '等待你回答',
      seatIdle: '这个选择还没作答',
      modeAsk: '提问',
      modeMulti: '多选提问',
      modeConfirm: '确认',
      modeFill: '填空',
      modeQuiz: '测验',
      rowSep: '：',
      rowCancelled: '已取消',
      rowTimeout: '已超时',
      settingsTab: '选择题弹窗',
      settingsTest: '发起测试',
      settingsTestHint: '在你当前打开的会话里真弹一次，答完即收尾',
      settingsParams: '服务端参数',
      settingsSave: '保存',
      settingsTimeout: '等待上限（毫秒）',
      settingsInlineBytes: '内联内容上限（字节）',
      settingsPhp: 'PHP 可执行文件',
      settingsPrefs: '界面偏好',
      settingsWidth: '默认预览宽度',
      settingsIcons: '对话里显示模式图标',
      settingsSaved: '已保存',
      settingsFailed: '操作失败',
      settingsLoadFailed: '读取设置失败',
      settingsSent: '已发出，去会话里看看',
      settingsNoSession: '先打开一个会话再测试',
      previewWidth: '预览宽度',
      widthAuto: '自适应',
      refreshAll: '刷新预览',
      openTab: '新标签页打开',
      frameSlow: '预览加载较慢；该页面可能禁止被嵌入。',
      sourceLoading: '读取源码…',
      sourceFailed: '读取源码失败。',
      sourceNotExecuted: '源码预览（PHP 未执行）',
      phpExecuted: 'PHP 已执行',
      answeredElsewhere: '已在其他窗口回答',
      answerFailed: '提交失败，请重试',
      timeLeft: '剩余 {time}',
      expired: '等待已结束',
      note: '备注',
      hintLabel: '提示',
      ask: '提问',
      askPlaceholder: '问一句，先不选…',
      askSend: '发送',
      askEmpty: '先写一句再发送',
      addNote: '＋ 备注',
      notePlaceholder: '可选备注，会一并返回给模型',
      fillPlaceholder: '输入你的回答',
      otherTitle: '其他',
      otherPlaceholder: '不在上面？写在这里',
      skip: '跳过',
      skipUndo: '撤销跳过',
      next: '下一题',
      prev: '上一题',
      finish: '完成',
      otherHint: '输入你的答案（其他）',
      resultKicker: '测验结果',
      resultTitle: '答对 {score} / {total}',
      resultNote: '只显示对错，不显示正确答案。',
      remotePreview: '本地页面预览只在本机打开 GUI 时可加载。',
      previewTitle: '页面预览',
    }

    const EN = {
      defaultTitle: 'Choose',
      requiredHint: 'Complete the required questions first.',
      submit: 'Submit',
      submitting: 'Submitting…',
      cancel: 'Cancel',
      close: 'Close',
      minimize: 'Collapse',
      restore: 'Open',
      seatKicker: 'Waiting for your answer',
      seatIdle: 'This choice is still unanswered',
      modeAsk: 'Question',
      modeMulti: 'Multi-select',
      modeConfirm: 'Confirm',
      modeFill: 'Fill in',
      modeQuiz: 'Quiz',
      rowSep: ': ',
      rowCancelled: 'cancelled',
      rowTimeout: 'timed out',
      settingsTab: 'Choice dialog',
      settingsTest: 'Run a test',
      settingsTestHint: 'Fires a real request in the session you have open; it settles as soon as you answer',
      settingsParams: 'Host settings',
      settingsSave: 'Save',
      settingsTimeout: 'Wait limit (ms)',
      settingsInlineBytes: 'Inline limit (bytes)',
      settingsPhp: 'PHP executable',
      settingsPrefs: 'Interface',
      settingsWidth: 'Default preview width',
      settingsIcons: 'Show mode icons in chat',
      settingsSaved: 'Saved',
      settingsFailed: 'Failed',
      settingsLoadFailed: 'Could not read settings',
      settingsSent: 'Sent — check the session',
      settingsNoSession: 'Open a session first',
      previewWidth: 'Preview width',
      widthAuto: 'Fit',
      refreshAll: 'Refresh previews',
      openTab: 'Open in new tab',
      frameSlow: 'The preview is slow to load; this page may block embedding.',
      sourceLoading: 'Loading source…',
      sourceFailed: 'Could not load the source.',
      sourceNotExecuted: 'Source preview (PHP not executed)',
      phpExecuted: 'PHP executed',
      answeredElsewhere: 'Answered in another window',
      answerFailed: 'Submit failed. Try again.',
      timeLeft: '{time} left',
      expired: 'Wait is over',
      note: 'Note',
      hintLabel: 'Hint',
      ask: 'Ask',
      askPlaceholder: 'Ask a question first…',
      askSend: 'Send',
      askEmpty: 'Write a question first',
      addNote: '+ Note',
      notePlaceholder: 'Optional note, returned with your answer',
      fillPlaceholder: 'Type your answer',
      otherTitle: 'Other',
      otherPlaceholder: 'Something else? Type it here',
      skip: 'Skip',
      skipUndo: 'Unskip',
      next: 'Next',
      prev: 'Back',
      finish: 'Done',
      otherHint: 'Type your own answer',
      resultKicker: 'Quiz result',
      resultTitle: '{score} / {total} correct',
      resultNote: 'Right or wrong only — correct answers stay hidden.',
      remotePreview: 'Local previews only load when the GUI is opened on this host.',
      previewTitle: 'Page preview',
    }

    const ZH_HANT = {
      defaultTitle: '請選擇',
      requiredHint: '請先完成必填項',
      submit: '提交',
      submitting: '提交中…',
      cancel: '取消',
      close: '關閉',
      minimize: '收合',
      restore: '展開',
      seatKicker: '等待你回答',
      seatIdle: '這個選擇還沒作答',
      modeAsk: '提問',
      modeMulti: '多選提問',
      modeConfirm: '確認',
      modeFill: '填空',
      modeQuiz: '測驗',
      rowSep: '：',
      rowCancelled: '已取消',
      rowTimeout: '已逾時',
      settingsTab: '選擇題彈窗',
      settingsTest: '發起測試',
      settingsTestHint: '在你當前打開的會話裡真彈一次，答完即收尾',
      settingsParams: '服務端參數',
      settingsSave: '儲存',
      settingsTimeout: '等待上限（毫秒）',
      settingsInlineBytes: '內聯內容上限（位元組）',
      settingsPhp: 'PHP 執行檔',
      settingsPrefs: '介面偏好',
      settingsWidth: '預設預覽寬度',
      settingsIcons: '對話裡顯示模式圖示',
      settingsSaved: '已儲存',
      settingsFailed: '操作失敗',
      settingsLoadFailed: '讀取設定失敗',
      settingsSent: '已發出，去會話裡看看',
      settingsNoSession: '先打開一個會話再測試',
      previewWidth: '預覽寬度',
      widthAuto: '自適應',
      refreshAll: '重新整理預覽',
      openTab: '新分頁開啟',
      frameSlow: '預覽載入較慢；該頁面可能禁止被嵌入',
      sourceLoading: '讀取原始碼…',
      sourceFailed: '讀取原始碼失敗',
      sourceNotExecuted: '原始碼預覽（PHP 未執行）',
      phpExecuted: 'PHP 已執行',
      answeredElsewhere: '已在其他視窗回答',
      answerFailed: '提交失敗，請重試',
      timeLeft: '剩餘 {time}',
      expired: '等待已結束',
      note: '備註',
      hintLabel: '提示',
      ask: '提問',
      askPlaceholder: '問一句，先不選…',
      askSend: '傳送',
      askEmpty: '先寫一句再傳送',
      addNote: '＋ 備註',
      notePlaceholder: '可選備註，會一併回傳給模型',
      fillPlaceholder: '輸入你的回答',
      otherTitle: '其他',
      otherPlaceholder: '不在上面？寫在這裡',
      skip: '跳過',
      skipUndo: '復原跳過',
      next: '下一題',
      prev: '上一題',
      finish: '完成',
      otherHint: '輸入你的答案（其他）',
      resultKicker: '測驗結果',
      resultTitle: '答對 {score} / {total}',
      resultNote: '只顯示對錯，不顯示正確答案',
      remotePreview: '本機頁面預覽只在本機開啟 GUI 時可載入',
      previewTitle: '頁面預覽',
    }

    const JA = {
      defaultTitle: '選択してください',
      requiredHint: '必須項目を完了してください',
      submit: '送信',
      submitting: '送信中…',
      cancel: 'キャンセル',
      close: '閉じる',
      minimize: '折りたたむ',
      restore: '開く',
      seatKicker: '回答を待っています',
      seatIdle: 'この選択はまだ未回答です',
      modeAsk: '質問',
      modeMulti: '複数選択',
      modeConfirm: '確認',
      modeFill: '記入',
      modeQuiz: 'テスト',
      rowSep: '：',
      rowCancelled: 'キャンセル済み',
      rowTimeout: 'タイムアウト',
      settingsTab: '選択ダイアログ',
      settingsTest: 'テストを実行',
      settingsTestHint: '開いているセッションで実際に一度表示します。回答すると終了します',
      settingsParams: 'ホスト設定',
      settingsSave: '保存',
      settingsTimeout: '待機上限（ミリ秒）',
      settingsInlineBytes: 'インライン上限（バイト）',
      settingsPhp: 'PHP 実行ファイル',
      settingsPrefs: '表示設定',
      settingsWidth: '既定のプレビュー幅',
      settingsIcons: '会話にモードアイコンを表示',
      settingsSaved: '保存しました',
      settingsFailed: '失敗しました',
      settingsLoadFailed: '設定を読み込めません',
      settingsSent: '送信しました。セッションを確認してください',
      settingsNoSession: '先にセッションを開いてください',
      previewWidth: 'プレビュー幅',
      widthAuto: '自動',
      refreshAll: 'プレビューを更新',
      openTab: '新しいタブで開く',
      frameSlow: 'プレビューの読み込みが遅いです。このページは埋め込みを禁止している可能性があります',
      sourceLoading: 'ソースを読み込み中…',
      sourceFailed: 'ソースを読み込めませんでした',
      sourceNotExecuted: 'ソースプレビュー（PHP 未実行）',
      phpExecuted: 'PHP 実行済み',
      answeredElsewhere: '他のウィンドウで回答済みです',
      answerFailed: '送信に失敗しました。もう一度お試しください',
      timeLeft: '残り {time}',
      expired: '待機が終了しました',
      note: 'メモ',
      hintLabel: 'ヒント',
      ask: '質問',
      askPlaceholder: '質問を書いてから選択してください…',
      askSend: '送信',
      askEmpty: '質問を入力してください',
      addNote: '＋ メモ',
      notePlaceholder: '任意のメモ。回答と一緒にモデルへ渡ります',
      fillPlaceholder: '回答を入力',
      otherTitle: 'その他',
      otherPlaceholder: '候補にない場合はここに記入',
      skip: 'スキップ',
      skipUndo: 'スキップを解除',
      next: '次へ',
      prev: '戻る',
      finish: '完了',
      otherHint: '自分の答えを入力（その他）',
      resultKicker: 'クイズ結果',
      resultTitle: '{total} 問中 {score} 問正解',
      resultNote: '正誤のみ表示し、正解は表示しません',
      remotePreview: 'ローカルプレビューはこのマシンで GUI を開いたときのみ読み込めます',
      previewTitle: 'ページプレビュー',
    }

    const ES = {
      defaultTitle: 'Elige',
      requiredHint: 'Completa primero los campos obligatorios',
      submit: 'Enviar',
      submitting: 'Enviando…',
      cancel: 'Cancelar',
      close: 'Cerrar',
      minimize: 'Contraer',
      restore: 'Abrir',
      seatKicker: 'Esperando tu respuesta',
      seatIdle: 'Esta elección sigue sin responder',
      modeAsk: 'Pregunta',
      modeMulti: 'Selección múltiple',
      modeConfirm: 'Confirmar',
      modeFill: 'Rellenar',
      modeQuiz: 'Cuestionario',
      rowSep: ': ',
      rowCancelled: 'cancelado',
      rowTimeout: 'agotado',
      settingsTab: 'Diálogo de opciones',
      settingsTest: 'Ejecutar una prueba',
      settingsTestHint: 'Lanza una petición real en la sesión abierta; termina al responder',
      settingsParams: 'Ajustes del host',
      settingsSave: 'Guardar',
      settingsTimeout: 'Límite de espera (ms)',
      settingsInlineBytes: 'Límite en línea (bytes)',
      settingsPhp: 'Ejecutable PHP',
      settingsPrefs: 'Interfaz',
      settingsWidth: 'Ancho de vista previa',
      settingsIcons: 'Mostrar iconos de modo en el chat',
      settingsSaved: 'Guardado',
      settingsFailed: 'Error',
      settingsLoadFailed: 'No se pudo leer la configuración',
      settingsSent: 'Enviado; revisa la sesión',
      settingsNoSession: 'Abre una sesión primero',
      previewWidth: 'Ancho de vista previa',
      widthAuto: 'Ajustar',
      refreshAll: 'Actualizar vistas previas',
      openTab: 'Abrir en una pestaña nueva',
      frameSlow: 'La vista previa tarda; puede que esta página bloquee la inserción',
      sourceLoading: 'Cargando código…',
      sourceFailed: 'No se pudo cargar el código',
      sourceNotExecuted: 'Vista previa del código (PHP no ejecutado)',
      phpExecuted: 'PHP ejecutado',
      answeredElsewhere: 'Respondido en otra ventana',
      answerFailed: 'No se pudo enviar. Inténtalo de nuevo',
      timeLeft: 'Queda {time}',
      expired: 'La espera terminó',
      note: 'Nota',
      hintLabel: 'Pista',
      ask: 'Preguntar',
      askPlaceholder: 'Escribe una pregunta antes de elegir…',
      askSend: 'Enviar',
      askEmpty: 'Escribe una pregunta primero',
      addNote: '＋ Nota',
      notePlaceholder: 'Nota opcional, se envía junto con la respuesta',
      fillPlaceholder: 'Escribe tu respuesta',
      otherTitle: 'Otro',
      otherPlaceholder: '¿No está arriba? Escríbelo aquí',
      skip: 'Saltar',
      skipUndo: 'Deshacer salto',
      next: 'Siguiente',
      prev: 'Anterior',
      finish: 'Listo',
      otherHint: 'Escribe tu propia respuesta (otro)',
      resultKicker: 'Resultado',
      resultTitle: '{score} de {total} correctas',
      resultNote: 'Solo se muestra correcto/incorrecto, sin las respuestas',
      remotePreview: 'Las vistas locales solo cargan con la GUI abierta en este equipo',
      previewTitle: 'Vista previa',
    }

    const FR = {
      defaultTitle: 'Choisir',
      requiredHint: "Complétez d'abord les champs obligatoires",
      submit: 'Envoyer',
      submitting: 'Envoi…',
      cancel: 'Annuler',
      close: 'Fermer',
      minimize: 'Réduire',
      restore: 'Ouvrir',
      seatKicker: 'En attente de ta réponse',
      seatIdle: 'Ce choix est encore sans réponse',
      modeAsk: 'Question',
      modeMulti: 'Choix multiples',
      modeConfirm: 'Confirmation',
      modeFill: 'Saisie',
      modeQuiz: 'Quiz',
      rowSep: ' : ',
      rowCancelled: 'annulé',
      rowTimeout: 'expiré',
      settingsTab: 'Boîte de choix',
      settingsTest: 'Lancer un test',
      settingsTestHint: "Envoie une vraie requête dans la session ouverte ; elle se termine dès que tu réponds",
      settingsParams: 'Réglages de l’hôte',
      settingsSave: 'Enregistrer',
      settingsTimeout: "Limite d'attente (ms)",
      settingsInlineBytes: 'Limite en ligne (octets)',
      settingsPhp: 'Exécutable PHP',
      settingsPrefs: 'Interface',
      settingsWidth: 'Largeur par défaut',
      settingsIcons: 'Afficher les icônes de mode',
      settingsSaved: 'Enregistré',
      settingsFailed: 'Échec',
      settingsLoadFailed: 'Lecture des réglages impossible',
      settingsSent: 'Envoyé ; vérifie la session',
      settingsNoSession: "Ouvre d'abord une session",
      previewWidth: "Largeur de l'aperçu",
      widthAuto: 'Ajuster',
      refreshAll: 'Actualiser les aperçus',
      openTab: 'Ouvrir dans un nouvel onglet',
      frameSlow: "L'aperçu est lent ; cette page bloque peut-être l'intégration",
      sourceLoading: 'Chargement du code…',
      sourceFailed: 'Impossible de charger le code',
      sourceNotExecuted: 'Aperçu du code (PHP non exécuté)',
      phpExecuted: 'PHP exécuté',
      answeredElsewhere: 'Déjà répondu dans une autre fenêtre',
      answerFailed: "Échec de l'envoi. Réessayez",
      timeLeft: 'Reste {time}',
      expired: "L'attente est terminée",
      note: 'Note',
      hintLabel: 'Indice',
      ask: 'Demander',
      askPlaceholder: 'Posez une question avant de choisir…',
      askSend: 'Envoyer',
      askEmpty: "Écrivez d'abord une question",
      addNote: '＋ Note',
      notePlaceholder: 'Note facultative, renvoyée avec la réponse',
      fillPlaceholder: 'Saisissez votre réponse',
      otherTitle: 'Autre',
      otherPlaceholder: 'Pas dans la liste ? Écrivez-le ici',
      skip: 'Passer',
      skipUndo: 'Annuler le passage',
      next: 'Suivant',
      prev: 'Précédent',
      finish: 'Terminer',
      otherHint: 'Saisissez votre propre réponse (autre)',
      resultKicker: 'Résultat du quiz',
      resultTitle: '{score} / {total} correctes',
      resultNote: "Seul le vrai/faux s'affiche, pas les réponses",
      remotePreview: "Les aperçus locaux ne se chargent qu'avec la GUI ouverte sur cette machine",
      previewTitle: 'Aperçu de la page',
    }

    const LOCALES = [
      ['zh', ZH],
      ['en', EN],
      ['zh-Hant', ZH_HANT],
      ['ja', JA],
      ['es', ES],
      ['fr', FR],
    ]

    const LANGUAGES = [
      { id: 'zh-Hant', label: '汉语(漢語)', fallback: 'zh' },
      { id: 'ja', label: 'にほんご', fallback: 'en' },
      { id: 'es', label: 'Español', fallback: 'en' },
      { id: 'fr', label: 'Français', fallback: 'en' },
    ]

    const CSS = `
.luc-root{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}
.luc-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);animation:luc-fade var(--ds-transition-duration,160ms) ease}
.luc-panel{position:relative;z-index:1;display:flex;flex-direction:column;width:min(1100px,94vw);height:auto;max-height:min(860px,88vh);overflow:hidden;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;animation:luc-in var(--ds-transition-duration,160ms) ease;outline:none}
@keyframes luc-fade{from{opacity:0}to{opacity:1}}
@keyframes luc-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.luc-mask,.luc-panel{animation:none}}
.luc-head{display:flex;align-items:flex-start;gap:14px;padding:20px 18px 14px 22px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.luc-head-text{min-width:0;flex:1}
.luc-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.luc-sub{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:pre-wrap}
.luc-head-right{display:flex;align-items:center;gap:10px;flex:none}
.luc-time{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.luc-time-over{color:var(--dsw-alias-state-warn-primary)}
.luc-close{width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;cursor:pointer}
.luc-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.luc-body{flex:1;min-height:0;overflow:auto;padding:16px 22px 20px;display:flex;flex-direction:column;gap:20px;overscroll-behavior:contain}
.luc-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;position:sticky;top:-16px;z-index:2;padding:4px 0 8px;background:var(--dsw-alias-bg-layer-2)}
.luc-tools-label{font-size:12px;color:var(--dsw-alias-label-secondary);margin-right:2px}
.luc-chip{height:24px;padding:0 8px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.luc-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.luc-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.luc-spacer{flex:1}
.luc-remote{padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.luc-q{display:flex;flex-direction:column;gap:10px}
.luc-qkicker{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-transform:uppercase;letter-spacing:.04em}
.luc-qhead{display:flex;align-items:flex-start;gap:6px}
.luc-qtitle{font-size:14px;line-height:22px;font-weight:500;white-space:pre-wrap}
.luc-req{color:var(--dsw-alias-state-error-primary);font-weight:600}
.luc-qdetail{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;margin-top:-4px}
.luc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.luc-list{display:flex;flex-direction:column;gap:10px}
.luc-cards-confirm{display:flex;gap:12px;flex-wrap:wrap}
.luc-cards-confirm .luc-card{flex:1;min-width:160px}
@media (max-width:760px){.luc-grid{grid-template-columns:1fr}}
.luc-card{display:flex;flex-direction:column;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;overflow:hidden;transition:border-color .12s,box-shadow .12s}
.luc-card:hover{border-color:var(--dsw-alias-border-l2)}
.luc-card:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.luc-card.luc-on{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.luc-card.luc-flat .luc-card-head{padding:12px}
.luc-frame-wrap{position:relative;display:flex;justify-content:center;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l1);overflow:auto}
.luc-frame-wrap.luc-frame-wide{justify-content:flex-start}
.luc-frame{display:block;flex:none;width:100%;height:320px;border:0;background:transparent}
.luc-frame-slow{position:absolute;left:12px;right:12px;bottom:12px;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;box-shadow:var(--dsw-elevation-prominent)}
.luc-frame-open{position:absolute;top:8px;right:8px;width:28px;height:28px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:14px;line-height:1}
.luc-frame-open:hover{background:var(--dsw-alias-interactive-bg-hover)}
.luc-card-head{display:flex;align-items:flex-start;gap:10px;padding:10px 12px}
.luc-card-text{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.luc-card-label{font-size:14px;line-height:22px;font-weight:500;overflow-wrap:anywhere}
.luc-card-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
.luc-dot{flex:none;width:16px;height:16px;margin-top:3px;border:1.5px solid var(--dsw-alias-border-l2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center}
.luc-card.luc-check .luc-dot{border-radius:4px}
.luc-on .luc-dot{border-color:var(--dsw-alias-brand-primary)}
.luc-on .luc-dot::after{content:'';width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.luc-card.luc-check.luc-on .luc-dot::after{width:10px;height:10px;border-radius:2px}
.luc-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-foreground);font-size:11px;line-height:18px;align-self:flex-start}
.luc-note-btn{flex:none;height:22px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:20px;cursor:pointer;white-space:nowrap}
.luc-note-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.luc-note-btn.luc-note-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.luc-note{padding:0 12px 10px;cursor:default}
.luc-note-input{width:100%;box-sizing:border-box;min-height:44px;resize:vertical;padding:7px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px}
.luc-note-input:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}
.luc-source{display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l1)}
.luc-source-note{padding:6px 12px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.luc-src{margin:0;padding:10px 12px;max-height:260px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
.luc-kicker{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.luc-ver{font-size:10.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);opacity:.7;margin-right:2px;font-variant-numeric:tabular-nums}
.luc-ver-head{font-size:11px;margin-right:6px}
.luc-num-list{display:flex;flex-direction:column;gap:6px}
.luc-num{border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.luc-num-on{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent)}
.luc-num-head{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer}
.luc-num-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.luc-radio{flex:none;width:16px;height:16px;margin-top:3px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:inline-flex;align-items:center;justify-content:center}
.luc-radio-square{border-radius:4px}
.luc-radio-on{border-color:var(--dsw-alias-brand-primary)}
.luc-radio-on::after{content:'';width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.luc-radio-square.luc-radio-on::after{width:10px;height:10px;border-radius:2px}
.luc-num-index{flex:none;width:14px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:22px;font-variant-numeric:tabular-nums}
.luc-num-text{flex:1;min-width:0}
.luc-num-label{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.luc-num-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.luc-num-note{padding:0 12px 10px}
.luc-hint-text{margin:0 12px 10px;padding:7px 10px;border-radius:6px;background:var(--dsw-alias-bg-base);border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.luc-other-bar{display:flex;align-items:center;gap:10px;height:44px;margin:0 22px 12px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.luc-other-ico{color:var(--dsw-alias-label-tertiary);font-size:13px}
.luc-other-field{flex:1;min-width:0;height:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;outline:none}
.luc-other-field::placeholder{color:var(--dsw-alias-label-tertiary)}
.luc-btn-left{margin-left:10px}
.luc-btn-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.luc-progress{display:flex;align-items:center;gap:2px}
.luc-step{width:24px;height:24px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;font-size:15px;line-height:1}
.luc-step:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.luc-step:disabled{opacity:.35;cursor:default}
.luc-step-text{min-width:40px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.luc-result-body{justify-content:flex-start;gap:8px}
.luc-result-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.luc-result-mark{width:22px;text-align:center;font-size:15px;color:var(--dsw-alias-label-tertiary)}
.luc-result-ok .luc-result-mark{color:var(--dsw-alias-state-success-primary)}
.luc-result-bad .luc-result-mark{color:var(--dsw-alias-state-error-primary)}
.luc-result-text{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.luc-fill{width:100%;box-sizing:border-box;min-height:84px;resize:vertical;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:20px}
.luc-fill:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-1px}
.luc-foot{display:flex;align-items:center;gap:10px;padding:12px 22px 16px;border-top:1px solid var(--dsw-alias-border-l1)}
.luc-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.luc-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.luc-btn{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.luc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.luc-btn:disabled{opacity:.4;cursor:default}
.luc-primary{height:36px;padding:0 16px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:14px}
.luc-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.luc-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1001;padding:8px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;box-shadow:var(--dsw-elevation-prominent);pointer-events:none}
.luc-min{width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;cursor:pointer}
.luc-min:hover{background:var(--dsw-alias-interactive-bg-hover)}
.luc-row{display:flex;align-items:center;gap:6px;min-width:0;height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
@media (hover:hover){.luc-row:hover{color:var(--dsw-alias-label-secondary)}}
.luc-row-icon{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;color:inherit}
.luc-row-label{flex:none;color:inherit}
.luc-row-sep{flex:none;color:inherit;opacity:.75}
.luc-row-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.luc-row-note{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.luc-row-clickable{cursor:pointer}
.luc-row[data-mode="quiz"] .luc-row-icon{color:var(--dsw-alias-state-business-primary)}
.luc-pill{pointer-events:auto;cursor:pointer;position:fixed;right:18px;bottom:104px;z-index:999;display:flex;align-items:center;gap:8px;max-width:min(320px,calc(100vw - 36px));padding:8px 10px 8px 12px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;box-sizing:border-box}
.luc-pill-icon{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-state-business-primary)}
.luc-pill-text{min-width:0;display:flex;flex-direction:column}
.luc-pill-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px}
.luc-pill-title{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.luc-pill-actions{flex:none;display:flex;align-items:center;gap:6px;margin-left:2px}
.luc-pill-btn{height:24px;padding:0 9px;border-radius:999px;border:0.5px solid var(--dsw-alias-border-l3);background:transparent;color:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap}
.luc-pill-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.luc-pill-btn[data-primary]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}

`

    function openInTab(url) {
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        /* ignore */
      }
    }

    function isLoopbackHost() {
      const host = window.location.hostname
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
    }

    function formatRemaining(totalSeconds) {
      const safe = Math.max(0, totalSeconds)
      const minutes = Math.floor(safe / 60)
      const seconds = safe % 60
      return `${minutes}:${String(seconds).padStart(2, '0')}`
    }

    /**
     * 弹窗与输入区共用的一份最小化状态：弹窗收起后由输入区的常驻条接管，
     * 请求本身仍然挂起（Host 那边的工具调用一直卡着），所以模型不会继续说话。
     */
    function createChoiceUi() {
      let minimized = false
      const listeners = new Set()
      const notify = () => {
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            /* a listener must not break the toggle */
          }
        }
      }
      return {
        get() {
          return minimized
        },
        set(next) {
          if (minimized === next) return
          minimized = next
          notify()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    function initialDraft(view) {
      const draft = {}
      for (const question of view.questions) {
        draft[question.id] = { selected: [], custom: '', notes: {}, hints: {}, skipped: false }
      }
      return draft
    }

    function missingRequired(view, draft) {
      for (const question of view.questions) {
        if (!question.required) continue
        const answer = draft[question.id]
        if (!answer) return true
        if (answer.skipped === true) continue
        if (question.mode === 'fill') {
          if (!answer.custom.trim()) return true
        } else if (answer.selected.length === 0 && !String(answer.custom || '').trim()) {
          return true
        }
      }
      return false
    }

    function buildAnswers(view, draft) {
      return view.questions.map((question) => {
        const answer = draft[question.id] || { selected: [], custom: '', notes: {}, skipped: false }
        if (answer.skipped === true) {
          return { id: question.id, selected: [], skipped: true }
        }
        if (question.mode === 'fill') {
          return { id: question.id, selected: [], custom: answer.custom.trim() }
        }
        const notes = Object.keys(answer.notes || {})
          .map((label) => ({ label, note: String(answer.notes[label] || '').trim() }))
          .filter((entry) => entry.note !== '')
        const hints = Object.keys(answer.hints || {}).filter((label) => answer.hints[label] === true)
        return {
          id: question.id,
          selected: [...answer.selected],
          ...(String(answer.custom || '').trim() !== '' ? { custom: answer.custom.trim() } : {}),
          ...(hints.length > 0 ? { hints } : {}),
          ...(notes.length > 0 ? { notes } : {}),
        }
      })
    }

    function useSessionKey(ctx) {
      const current = ctx.uiSession.adapter.current
      const [binding, setBinding] = React.useState(() => current.getSnapshot())
      React.useEffect(() => {
        let active = true
        const sync = () => {
          if (active) setBinding(current.getSnapshot())
        }
        sync()
        const unsubscribe = current.subscribe(sync)
        return () => {
          active = false
          unsubscribe()
        }
      }, [current])
      return binding && binding.key ? binding.key : null
    }

    function useLocaleRevision(ctx) {
      const [, bump] = React.useReducer((n) => n + 1, 0)
      React.useEffect(() => ctx.locale.subscribe(bump), [ctx])
    }

    function SourceView({ url, t }) {
      const [state, setState] = React.useState({ status: 'loading', text: '' })
      React.useEffect(() => {
        let cancelled = false
        setState({ status: 'loading', text: '' })
        fetch(url, { cache: 'no-store' })
          .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
          .then((text) => {
            if (!cancelled) setState({ status: 'ok', text })
          })
          .catch(() => {
            if (!cancelled) setState({ status: 'error', text: '' })
          })
        return () => {
          cancelled = true
        }
      }, [url])
      if (state.status === 'loading') return h('pre', { className: 'luc-src' }, t('sourceLoading'))
      if (state.status === 'error') return h('pre', { className: 'luc-src' }, t('sourceFailed'))
      return h('pre', { className: 'luc-src' }, state.text)
    }

    function FrameBox({ preview, width, t }) {
      const [state, setState] = React.useState('loading')
      React.useEffect(() => {
        setState('loading')
        const timer = setTimeout(() => {
          setState((current) => (current === 'loading' ? 'slow' : current))
        }, FRAME_SLOW_MS)
        return () => clearTimeout(timer)
      }, [preview.url])
      const sandbox = preview.external ? EXT_SANDBOX : LOCAL_SANDBOX
      return h(
        'div',
        { className: 'luc-frame-wrap' + (width === 'auto' ? '' : ' luc-frame-wide') },
        h('iframe', {
          className: 'luc-frame',
          src: preview.url,
          sandbox,
          referrerPolicy: 'no-referrer',
          loading: 'lazy',
          title: preview.title || t('previewTitle'),
          onLoad: () => setState('ok'),
          style: width === 'auto' ? undefined : { width: `${width}px` },
        }),
        state === 'slow'
          ? h(
              'div',
              { className: 'luc-frame-slow' },
              h('span', null, t('frameSlow')),
              h(
                'button',
                { type: 'button', className: 'luc-btn', onClick: () => openInTab(preview.url) },
                t('openTab'),
              ),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'luc-frame-open',
            title: t('openTab'),
            'aria-label': t('openTab'),
            onClick: () => openInTab(preview.url),
          },
          '↗',
        ),
      )
    }

    function NumRow({ question, option, number, checked, onToggle, note, onNote, hintShown, onHint, t }) {
      const multi = question.mode === 'multi'
      const [editing, setEditing] = React.useState(() => note !== '')
      return h(
        'div',
        { className: 'luc-num' + (checked ? ' luc-num-on' : '') },
        h(
          'div',
          {
            className: 'luc-num-head',
            role: multi ? 'checkbox' : 'radio',
            'aria-checked': checked,
            tabIndex: 0,
            onClick: (event) => {
              if (event.target.closest('button, textarea, input, a')) return
              onToggle()
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onToggle()
              }
            },
          },
          h('span', {
            className: 'luc-radio' + (checked ? ' luc-radio-on' : '') + (multi ? ' luc-radio-square' : ''),
            'aria-hidden': 'true',
          }),
          h('span', { className: 'luc-num-index', 'aria-hidden': 'true' }, String(number)),
          h(
            'div',
            { className: 'luc-num-text' },
            h('div', { className: 'luc-num-label' }, option.label),
            option.description ? h('div', { className: 'luc-num-desc' }, option.description) : null,
          ),
          option.hint
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'luc-note-btn' + (hintShown ? ' luc-note-on' : ''),
                  onClick: (event) => {
                    event.stopPropagation()
                    onHint()
                  },
                },
                t('hintLabel'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'luc-note-btn' + (note !== '' ? ' luc-note-on' : ''),
              onClick: (event) => {
                event.stopPropagation()
                setEditing((current) => !current)
              },
            },
            note !== '' ? t('note') : t('addNote'),
          ),
        ),
        hintShown && option.hint
          ? h(
              'div',
              {
                className: 'luc-hint-text',
                onClick: (event) => {
                  event.stopPropagation()
                  onHint()
                },
              },
              option.hint,
            )
          : null,
        editing
          ? h(
              'div',
              { className: 'luc-num-note', onClick: (event) => event.stopPropagation() },
              h('textarea', {
                className: 'luc-note-input',
                rows: 2,
                maxLength: 1000,
                value: note,
                placeholder: t('notePlaceholder'),
                onChange: (event) => onNote(event.target.value),
                onKeyDown: (event) => event.stopPropagation(),
              }),
            )
          : null,
      )
    }

    function OptionCard({ question, option, checked, onToggle, note, onNote, hintShown, onHint, width, reload, t }) {
      const preview = option.preview
      const multi = question.mode === 'multi'
      const [editing, setEditing] = React.useState(() => note !== '')
      return h(
        'div',
        {
          className:
            'luc-card' +
            (checked ? ' luc-on' : '') +
            (multi ? ' luc-check' : '') +
            (preview ? '' : ' luc-flat'),
          role: multi ? 'checkbox' : 'radio',
          'aria-checked': checked,
          tabIndex: 0,
          onClick: (event) => {
            if (event.target.closest('button, textarea, a, iframe, pre, input')) return
            onToggle()
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onToggle()
            }
          },
        },
        preview && preview.kind === 'frame'
          ? h(FrameBox, { key: `frame-${reload}`, preview, width, t })
          : null,
        preview && preview.kind === 'source'
          ? h(
              'div',
              { className: 'luc-source' },
              h(
                'div',
                { className: 'luc-source-note' },
                preview.executed ? t('phpExecuted') : t('sourceNotExecuted'),
              ),
              h(SourceView, { key: `src-${reload}`, url: preview.url, t }),
            )
          : null,
        h(
          'div',
          { className: 'luc-card-head' },
          h('span', { className: 'luc-dot', 'aria-hidden': 'true' }),
          h(
            'div',
            { className: 'luc-card-text' },
            h('div', { className: 'luc-card-label' }, option.label),
            option.description ? h('div', { className: 'luc-card-desc' }, option.description) : null,
            preview && preview.executed ? h('span', { className: 'luc-badge' }, t('phpExecuted')) : null,
          ),
          option.hint
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'luc-note-btn' + (hintShown ? ' luc-note-on' : ''),
                  onClick: (event) => {
                    event.stopPropagation()
                    onHint()
                  },
                },
                t('hintLabel'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'luc-note-btn' + (note !== '' ? ' luc-note-on' : ''),
              onClick: (event) => {
                event.stopPropagation()
                setEditing((current) => !current)
              },
            },
            note !== '' ? t('note') : t('addNote'),
          ),
        ),
        hintShown && option.hint
          ? h(
              'div',
              {
                className: 'luc-hint-text',
                onClick: (event) => {
                  event.stopPropagation()
                  onHint()
                },
              },
              option.hint,
            )
          : null,
        editing
          ? h(
              'div',
              { className: 'luc-note', onClick: (event) => event.stopPropagation() },
              h('textarea', {
                className: 'luc-note-input',
                rows: 2,
                maxLength: 1000,
                value: note,
                placeholder: t('notePlaceholder'),
                onChange: (event) => onNote(event.target.value),
                onClick: (event) => event.stopPropagation(),
                onKeyDown: (event) => event.stopPropagation(),
              }),
            )
          : null,

      )
    }

    function createDialog(ctx, t, ui, publish, ensureToolview) {
      return function Dialog() {
        useLocaleRevision(ctx)
        const sessionId = useSessionKey(ctx)

        const [req, setReq] = React.useState(null)
        const [minimized, setMinimized] = React.useState(ui.get())
        const [draft, setDraft] = React.useState({})
        const [submitting, setSubmitting] = React.useState(false)
        const [error, setError] = React.useState(null)
        const [notice, setNotice] = React.useState(null)
        const [width, setWidth] = React.useState(PREFS.width)
        const [reload, setReload] = React.useState(0)
        const [openOther, setOpenOther] = React.useState({})
        const [step, setStep] = React.useState(0)
        const [askOpen, setAskOpen] = React.useState(false)
        const [askValue, setAskValue] = React.useState('')
        const [result, setResult] = React.useState(null)
        const resultRef = React.useRef(false)
        const [now, setNow] = React.useState(Date.now())

        const offsetRef = React.useRef(0)
        const reqIdRef = React.useRef(null)
        const noticeTimerRef = React.useRef(null)
        const rootRef = React.useRef(null)
        const panelRef = React.useRef(null)
        const submitRef = React.useRef(null)

        function showNotice(text) {
          setNotice(text)
          if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
          noticeTimerRef.current = setTimeout(() => {
            noticeTimerRef.current = null
            setNotice(null)
          }, TOAST_MS)
        }

        function accept(next, serverNow) {
          if (typeof serverNow === 'number') offsetRef.current = serverNow - Date.now()
          if (!next) {
            if (resultRef.current) return
            if (reqIdRef.current !== null) {
              reqIdRef.current = null
              setReq(null)
              setDraft({})
              setSubmitting(false)
              setError(null)
              ui.set(false)
            }
            return
          }
          setNow(Date.now())
          if (reqIdRef.current === next.id) return
          reqIdRef.current = next.id
          ui.set(false)
          setReq(next)
          setDraft(initialDraft(next))
          setError(null)
          setSubmitting(false)
          setWidth('auto')
          setStep(0)
          setResult(null)
          setAskOpen(false)
          setAskValue('')
          resultRef.current = false
        }

        React.useEffect(() => {
          return ui.subscribe(() => setMinimized(ui.get()))
        }, [])

        /*
         * 把请求登记成“挂起交互”：输入区会被常驻条取代（和 ask_user_question 一样
         * 发不出新消息），收起弹窗时那条常驻条就是唯一入口，请求本身继续挂起。
         */
        React.useEffect(() => {
          if (!req || !sessionId || typeof publish !== 'function') return undefined
          const first = req.questions && req.questions[0]
          const title = req.title || (first && first.question) || ''
          let unpublish = null
          try {
            unpublish = publish(
              {
                key: 'let-user-choose:' + req.id,
                sessionId,
                kind: 'let-user-choose',
                requestId: req.id,
                title,
                total: req.questions ? req.questions.length : 1,
              },
              () => {},
            )
          } catch {
            unpublish = null
          }
          return () => {
            if (typeof unpublish === 'function') {
              try {
                unpublish()
              } catch {
                /* already released */
              }
            }
          }
        }, [req && req.id, sessionId])

        React.useEffect(() => {
          if (!sessionId) {
            reqIdRef.current = null
            setReq(null)
            setDraft({})
            return
          }
          let disposed = false
          let timer = null
          const schedule = () => {
            if (!disposed) timer = setTimeout(tick, POLL_MS)
          }
          const tick = async () => {
            clearTimeout(timer)
            timer = null
            if (disposed) return
            if (document.visibilityState === 'visible') {
              try {
                const response = await fetch(`${API}/pending?session=${encodeURIComponent(sessionId)}`, {
                  cache: 'no-store',
                })
                if (response.ok) {
                  const data = await response.json()
                  if (typeof ensureToolview === 'function' && data && typeof data.toolName === 'string') {
                    ensureToolview(data.toolName)
                  }
                  if (!disposed) accept(data.requests && data.requests[0] ? data.requests[0] : null, data.now)
                }
              } catch {
                /* the Host may be restarting; keep polling */
              }
            }
            schedule()
          }
          const onVisible = () => {
            if (document.visibilityState === 'visible') void tick()
          }
          document.addEventListener('visibilitychange', onVisible)
          void tick()
          return () => {
            disposed = true
            clearTimeout(timer)
            document.removeEventListener('visibilitychange', onVisible)
          }
        }, [sessionId])

        React.useEffect(() => {
          if (!req) return undefined
          const timer = setInterval(() => setNow(Date.now()), 1000)
          return () => clearInterval(timer)
        }, [req !== null])

        React.useEffect(() => {
          if (!req || minimized) return undefined
          const previous = document.body.style.overflow
          document.body.style.overflow = 'hidden'
          return () => {
            document.body.style.overflow = previous
          }
        }, [req !== null, minimized])

        React.useEffect(() => {
          if (req && !minimized && panelRef.current) panelRef.current.focus()
        }, [req && req.id, minimized])

        React.useEffect(() => {
          return () => {
            if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
          }
        }, [])

        async function submit(action, draftOverride) {
          const view = req
          if (!view || submitting) return
          const effectiveDraft = draftOverride || draft
          if (action === 'ask' && askValue.trim() === '') {
            setError(t('askEmpty'))
            return
          }
          if (action === 'submit' && missingRequired(view, effectiveDraft)) {
            setError(t('requiredHint'))
            return
          }
          setSubmitting(true)
          setError(null)
          try {
            const response = await fetch(`${API}/answer`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                requestId: view.id,
                action,
                answers: action === 'submit' ? buildAnswers(view, effectiveDraft) : [],
                ...(action === 'ask' ? { question: askValue.trim() } : {}),
              }),
            })
            if (response.ok) {
              if (view.test === true && action === 'submit') {
                const answersOut = buildAnswers(view, effectiveDraft)
                const rows = view.questions.map((item) => {
                  const picked = answersOut.find((entry) => entry.id === item.id)
                  if (!picked || picked.skipped === true) return { label: item.question, status: 'skipped' }
                  const correct = new Set(
                    (item.options || [])
                      .filter((option) => option.correct === true)
                      .map((option) => option.label),
                  )
                  if (correct.size === 0) return { label: item.question, status: 'none' }
                  const ok =
                    picked.selected.length === correct.size &&
                    picked.selected.every((label) => correct.has(label))
                  return { label: item.question, status: ok ? 'ok' : 'bad' }
                })
                const scored = rows.filter((row) => row.status === 'ok' || row.status === 'bad')
                resultRef.current = true
                setResult({ rows, correct: scored.filter((row) => row.status === 'ok').length, total: scored.length })
                return
              }
              reqIdRef.current = null
              setReq(null)
              setDraft({})
            } else if (response.status === 404 || response.status === 409) {
              reqIdRef.current = null
              setReq(null)
              setDraft({})
              showNotice(t('answeredElsewhere'))
            } else {
              setError(t('answerFailed'))
            }
          } catch {
            setError(t('answerFailed'))
          } finally {
            setSubmitting(false)
          }
        }
        submitRef.current = submit

        React.useEffect(() => {
          if (!req) return undefined
          const onKey = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (submitRef.current) void submitRef.current('cancel')
            }
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [req !== null])

        // 用户一旦有交互（鼠标移动/点按、滚轮、键盘输入）就取消本次等待的时限：
        // Host 端计时器换成 1 小时安全兜底，弹窗改显示「不限时」。
        // 只发一次，响应失败也不影响本地展示。
        React.useEffect(() => {
          if (!req) return undefined
          const requestId = req.id
          let sent = false
          const hold = () => {
            if (sent) return
            sent = true
            setReq((current) =>
              current && current.id === requestId
                ? { ...current, expiresAt: null, timeoutCancelled: true }
                : current,
            )
            fetch(`${API}/hold`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({ requestId }),
            }).catch(() => {})
          }
          const events = ['pointermove', 'pointerdown', 'keydown', 'wheel']
          for (const name of events) {
            window.addEventListener(name, hold, { passive: true, capture: true })
          }
          return () => {
            for (const name of events) {
              window.removeEventListener(name, hold, { capture: true })
            }
          }
        }, [req && req.id])

        function toggle(question, label) {
          const view = req
          if (!view) return
          const base = draft[question.id] || { selected: [], custom: '' }
          const selected =
            question.mode === 'multi'
              ? base.selected.includes(label)
                ? base.selected.filter((item) => item !== label)
                : [...base.selected, label]
              : [label]
          const nextDraft = { ...draft, [question.id]: { ...base, selected, skipped: false } }
          setDraft(nextDraft)
          if (question.mode === 'confirm' && view.questions.length === 1) {
            void submit('submit', nextDraft)
          }
        }

        function setCustom(id, value) {
          const base = draft[id] || { selected: [], custom: '', notes: {}, skipped: false }
          setDraft({ ...draft, [id]: { ...base, custom: value, skipped: false } })
        }

        function toggleHint(id, label) {
          const base = draft[id] || { selected: [], custom: '', notes: {}, hints: {}, skipped: false }
          const hints = { ...(base.hints || {}), [label]: !(base.hints && base.hints[label]) }
          setDraft({ ...draft, [id]: { ...base, hints } })
        }

        function toggleSkip(id) {
          const base = draft[id] || { selected: [], custom: '', notes: {}, skipped: false }
          const skipped = base.skipped !== true
          setDraft({
            ...draft,
            [id]: skipped
              ? { selected: [], custom: '', notes: {}, skipped: true }
              : { ...base, skipped: false },
          })
        }

        function setOtherOpen(id, open) {
          setOpenOther((current) => ({ ...current, [id]: open }))
        }

        function setNote(id, label, value) {
          const base = draft[id] || { selected: [], custom: '', notes: {} }
          const notes = { ...(base.notes || {}), [label]: value }
          setDraft({ ...draft, [id]: { ...base, notes } })
        }

        function trapFocus(event) {
          const panel = panelRef.current
          if (!panel) return
          const nodes = Array.from(
            panel.querySelectorAll('button:not([disabled]), [tabindex="0"], textarea, a[href]'),
          ).filter((node) => node.offsetParent !== null)
          if (nodes.length === 0) return
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }

        function onKeyDown(event) {
          if (event.key === 'Tab') {
            trapFocus(event)
            return
          }
          if (event.key === 'Enter' && event.target === panelRef.current) {
            event.preventDefault()
            void submit('submit')
          }
        }

        if (!req) {
          return h(
            React.Fragment,
            null,
            h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
            notice ? h('div', { className: 'luc-toast', role: 'status' }, notice) : null,
          )
        }

        const timed = req.expiresAt !== null && req.expiresAt !== undefined
        const remaining = timed
          ? Math.max(0, Math.round((req.expiresAt - (now + offsetRef.current)) / 1000))
          : 0
        const questions = req.questions
        const index = Math.min(Math.max(step, 0), questions.length - 1)
        const question = questions[index]
        const answer = draft[question.id] || { selected: [], custom: '', notes: {}, skipped: false }
        const otherValue = String(answer.custom || '')
        const hasFrames = (question.options || []).some(
          (option) => option.preview && option.preview.kind === 'frame',
        )
        const remote = !isLoopbackHost()
        const isLast = index === questions.length - 1

        function answered(target) {
          const value = draft[target.id] || { selected: [], custom: '', notes: {}, skipped: false }
          if (value.skipped === true) return true
          if (target.mode === 'fill') return String(value.custom || '').trim() !== ''
          return value.selected.length > 0 || String(value.custom || '').trim() !== ''
        }

        function goNext() {
          if (!answered(question) && question.required === true) {
            setError(t('requiredHint'))
            return
          }
          setError(null)
          if (isLast) void submit('submit')
          else setStep(index + 1)
        }

        function skipCurrent() {
          if (answer.skipped === true) {
            toggleSkip(question.id)
            return
          }
          setError(null)
          if (isLast) {
            toggleSkip(question.id)
            void submit('submit')
            return
          }
          toggleSkip(question.id)
          setStep(index + 1)
        }

        function finishResult() {
          resultRef.current = false
          setResult(null)
          reqIdRef.current = null
          setReq(null)
          setDraft({})
        }

        const head = h(
          'div',
          { className: 'luc-head' },
          h(
            'div',
            { className: 'luc-head-text' },
            h('div', { className: 'luc-kicker' }, result ? t('resultKicker') : question.header || req.title || t('defaultTitle')),
            h(
              'h2',
              { className: 'luc-title', id: 'luc-title' },
              result ? t('resultTitle', { score: result.correct, total: result.total }) : question.question,
            ),
            !result && (question.detail || req.detail)
              ? h('p', { className: 'luc-sub' }, question.detail || req.detail)
              : null,
          ),
          h(
            'div',
            { className: 'luc-head-right' },
            h('span', { className: 'luc-ver luc-ver-head', title: 'client bundle version' }, 'v' + CLIENT_VERSION),
            timed && !result
              ? h(
                  'span',
                  { className: 'luc-time' + (remaining <= 0 ? ' luc-time-over' : '') },
                  remaining <= 0 ? t('expired') : t('timeLeft', { time: formatRemaining(remaining) }),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'luc-min',
                title: t('minimize'),
                'aria-label': t('minimize'),
                onClick: () => ui.set(true),
              },
              '—',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'luc-close',
                title: t('close'),
                'aria-label': t('close'),
                onClick: () => (result ? finishResult() : void submit('cancel')),
              },
              '×',
            ),
          ),
        )

        let optionsBlock = null
        if (!result && question.options.length > 0) {
          if (question.options.some((option) => option.preview)) {
            const cards = question.options.map((option) =>
              h(OptionCard, {
                key: option.label,
                question,
                option,
                checked: answer.selected.includes(option.label),
                onToggle: () => toggle(question, option.label),
                note: (answer.notes && answer.notes[option.label]) || '',
                onNote: (value) => setNote(question.id, option.label, value),
                hintShown: Boolean(answer.hints && answer.hints[option.label]),
                onHint: () => toggleHint(question.id, option.label),
                width,
                reload,
                t,
              }),
            )
            optionsBlock = h('div', { className: 'luc-grid' }, cards)
          } else {
            optionsBlock = h(
              'div',
              { className: 'luc-num-list' },
              question.options.map((option, optionIndex) =>
                h(NumRow, {
                  key: option.label,
                  question,
                  option,
                  number: optionIndex + 1,
                  checked: answer.selected.includes(option.label),
                  onToggle: () => toggle(question, option.label),
                  note: (answer.notes && answer.notes[option.label]) || '',
                  onNote: (value) => setNote(question.id, option.label, value),
                  hintShown: Boolean(answer.hints && answer.hints[option.label]),
                  onHint: () => toggleHint(question.id, option.label),
                  t,
                }),
              ),
            )
          }
        }

        const otherOpen = openOther[question.id] === true
        const askBar =
          !result && askOpen
            ? h(
                'div',
                { className: 'luc-other-bar luc-ask-bar' },
                h('span', { className: 'luc-other-ico', 'aria-hidden': 'true' }, '?'),
                h('input', {
                  className: 'luc-other-field',
                  type: 'text',
                  maxLength: 4000,
                  value: askValue,
                  placeholder: t('askPlaceholder'),
                  onChange: (event) => setAskValue(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submit('ask')
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setAskOpen(false)
                    }
                  },
                }),
                h(
                  'button',
                  { type: 'button', className: 'luc-btn luc-primary', disabled: submitting, onClick: () => void submit('ask') },
                  submitting ? t('submitting') : t('askSend'),
                ),
              )
            : null

        const otherBar =
          !result && otherOpen
            ? h(
                'div',
                { className: 'luc-other-bar' },
                h('span', { className: 'luc-other-ico', 'aria-hidden': 'true' }, '✎'),
                h('input', {
                  className: 'luc-other-field',
                  type: 'text',
                  maxLength: 4000,
                  value: otherValue,
                  placeholder: t('otherHint'),
                  onChange: (event) => setCustom(question.id, event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      goNext()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setOtherOpen(question.id, false)
                    }
                  },
                }),
              )
            : null

        const fillBlock =
          !result && question.mode === 'fill'
            ? h('textarea', {
                className: 'luc-fill',
                rows: 4,
                maxLength: 4000,
                value: answer.custom,
                placeholder: question.placeholder || t('fillPlaceholder'),
                onChange: (event) => setCustom(question.id, event.target.value),
              })
            : null

        const toolbar =
          !result && hasFrames
            ? h(
                'div',
                { className: 'luc-tools' },
                h('span', { className: 'luc-tools-label' }, t('previewWidth')),
                ['auto', '768', '390'].map((value) =>
                  h(
                    'button',
                    {
                      key: value,
                      type: 'button',
                      className: 'luc-chip' + (width === value ? ' luc-chip-on' : ''),
                      'aria-pressed': width === value,
                      onClick: () => setWidth(value),
                    },
                    value === 'auto' ? t('widthAuto') : value,
                  ),
                ),
                h('span', { className: 'luc-spacer' }),
                h(
                  'button',
                  { type: 'button', className: 'luc-btn', onClick: () => setReload((n) => n + 1) },
                  t('refreshAll'),
                ),
              )
            : null

        const remoteNote = remote && hasFrames ? h('div', { className: 'luc-remote' }, t('remotePreview')) : null

        const resultBody = result
          ? h(
              'div',
              { className: 'luc-body luc-result-body' },
              result.rows.map((row, rowIndex) =>
                h(
                  'div',
                  { key: rowIndex, className: 'luc-result-row luc-result-' + row.status },
                  h(
                    'span',
                    { className: 'luc-result-mark', 'aria-hidden': 'true' },
                    row.status === 'ok' ? '✓' : row.status === 'bad' ? '✗' : row.status === 'skipped' ? '—' : '·',
                  ),
                  h('span', { className: 'luc-result-text' }, row.label),
                ),
              ),
            )
          : null

        const footer = result
          ? h(
              'div',
              { className: 'luc-foot' },
              h('span', { className: 'luc-spacer' }),
              h('button', { type: 'button', className: 'luc-btn luc-primary', onClick: finishResult }, t('finish')),
            )
          : h(
              'div',
              { className: 'luc-foot' },
              h(
                'div',
                { className: 'luc-progress' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'luc-step',
                    disabled: index === 0,
                    'aria-label': t('prev'),
                    onClick: () => setStep(index - 1),
                  },
                  '‹',
                ),
                h('span', { className: 'luc-step-text' }, (index + 1) + ' / ' + questions.length),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'luc-step',
                    disabled: isLast,
                    'aria-label': t('next'),
                    onClick: () => {
                      setError(null)
                      setStep(index + 1)
                    },
                  },
                  '›',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'luc-btn luc-btn-left' + (otherOpen ? ' luc-btn-on' : ''),
                    disabled: submitting,
                    onClick: () => setOtherOpen(question.id, !otherOpen),
                  },
                  t('otherTitle') + (String(answer.custom || '').trim() !== '' ? ' ·' : ''),
                ),
              ),
              error ? h('span', { className: 'luc-error', role: 'alert' }, error) : null,
              h('span', { className: 'luc-spacer' }),
              h('span', { className: 'luc-ver', title: 'client bundle version' }, CLIENT_VERSION),
              h(
                'button',
                {
                  type: 'button',
                  className: 'luc-btn' + (askOpen ? ' luc-btn-on' : ''),
                  disabled: submitting,
                  onClick: () => setAskOpen(!askOpen),
                },
                t('ask'),
              ),
              h(
                'button',
                { type: 'button', className: 'luc-btn', disabled: submitting, onClick: skipCurrent },
                answer.skipped === true ? t('skipUndo') : t('skip'),
              ),
              h(
                'button',
                { type: 'button', className: 'luc-btn', disabled: submitting, onClick: () => void submit('cancel') },
                t('cancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'luc-btn luc-primary',
                  disabled: submitting,
                  onClick: goNext,
                },
                submitting ? t('submitting') : isLast ? t('submit') : t('next'),
              ),
            )

        // 收起时：输入区能接管就用常驻条，接管不了就退成右下角的小胶囊
        // 两种形态都保持请求挂起，没有作答就没有结果
        if (!req) return null
        if (minimized) {
          const pillMode = choiceModeOf(readChoiceArgsFromView(req))
          const pillTitle = req.title || (req.questions && req.questions[0] && req.questions[0].question) || ''
          return h(
            React.Fragment,
            null,
            h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
            h(
              'div',
              { className: 'luc-pill', role: 'status', onClick: () => ui.set(false) },
              h('span', { className: 'luc-pill-icon' }, renderModeIcon(pillMode)),
              h(
                'div',
                { className: 'luc-pill-text' },
                h('div', { className: 'luc-pill-label' }, t(ROW_LABELS[pillMode]) || t('seatKicker')),
                pillTitle ? h('div', { className: 'luc-pill-title' }, pillTitle) : null,
              ),
              h(
                'div',
                { className: 'luc-pill-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'luc-pill-btn',
                    onClick: (event) => {
                      event.stopPropagation()
                      void submit('cancel')
                    },
                  },
                  t('cancel'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'luc-pill-btn',
                    'data-primary': 'true',
                    onClick: (event) => {
                      event.stopPropagation()
                      ui.set(false)
                    },
                  },
                  t('restore'),
                ),
              ),
            ),
          )
        }

        return h(
          React.Fragment,
          null,
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          notice ? h('div', { className: 'luc-toast', role: 'status' }, notice) : null,
          h(
            'div',
            { className: 'luc-root', ref: rootRef, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'luc-title' },
            h('div', { className: 'luc-mask', 'aria-hidden': 'true' }),
            h(
              'div',
              { className: 'luc-panel' + (result ? ' luc-panel-result' : ''), ref: panelRef, tabIndex: -1, onKeyDown },
              head,
              result
                ? resultBody
                : h('div', { className: 'luc-body' }, toolbar, remoteNote, h('section', { className: 'luc-q' }, optionsBlock, fillBlock)),
              askBar,
              otherBar,
              footer,
            ),
          ),
        )
      }
    }

    /** 转录里代替默认工具卡片的那一行：`模式：主题`，和原生提问卡片同一排风格。 */
    /** 服务端返回的请求快照本来就是普通对象，直接借同一个判定。 */
    function readChoiceArgsFromView(view) {
      if (!view || typeof view !== 'object') return {}
      return { title: view.title, questions: view.questions, test: view.test === true }
    }

    /**
     * Tool 视图拿到的 `args` 是懒读取视图（PartialArguments），不是普通对象：
     * 直接 `args.title` 永远是 undefined，必须走 `value(key)` / `text(key)`。
     */
    function readChoiceArgs(args) {
      if (!args || typeof args !== 'object') return {}
      const read = (key) => {
        if (typeof args.value === 'function') {
          let value
          try {
            value = args.value(key)
          } catch {
            value = undefined
          }
          if (value !== undefined) return value
          if (typeof args.text === 'function') {
            try {
              return args.text(key)
            } catch {
              return undefined
            }
          }
          return undefined
        }
        return args[key]
      }
      return { title: read('title'), questions: read('questions'), test: read('test') }
    }

    /** 一次调用里谁是“主角”模式：测验优先，其次看第一题。 */
    function choiceModeOf(args) {
      if (args && args.test === true) return 'quiz'
      const questions = args && Array.isArray(args.questions) ? args.questions : []
      const first = questions[0] || {}
      if (first.mode === 'multi' || (first.mode !== 'fill' && first.mode !== 'confirm' && first.multiSelect === true)) {
        return 'multi'
      }
      if (first.mode === 'confirm') return 'confirm'
      if (first.mode === 'fill') return 'fill'
      return 'ask'
    }

    const ROW_LABELS = {
      ask: 'modeAsk',
      multi: 'modeMulti',
      confirm: 'modeConfirm',
      fill: 'modeFill',
      quiz: 'modeQuiz',
    }

    /** 五种模式各一个线稿图标：问号圈 / 勾选框+行 / 勾选方框 / 填空框 / 叠放测验卡 */
    function renderModeIcon(mode) {
      const paths = {
        ask: [
          h('circle', { key: 'c', cx: 8, cy: 8, r: 6.2 }),
          h('path', { key: 'q', d: 'M6.3 6.1a1.8 1.8 0 1 1 2.55 1.66c-.55.24-.9.72-.9 1.33v.3' }),
          h('path', { key: 'd', d: 'M7.95 11.5h.1' }),
        ],
        multi: [
          h('rect', { key: 'a', x: 2.4, y: 2.6, width: 3.4, height: 3.4, rx: 1 }),
          h('rect', { key: 'b', x: 2.4, y: 9.9, width: 3.4, height: 3.4, rx: 1 }),
          h('path', { key: 'c', d: 'M3.4 4.3l.9.9 1.4-1.7' }),
          h('path', { key: 'd', d: 'M8.2 4.3h5.4' }),
          h('path', { key: 'e', d: 'M8.2 11.6h5.4' }),
        ],
        confirm: [
          h('rect', { key: 'a', x: 2.2, y: 2.2, width: 11.6, height: 11.6, rx: 3 }),
          h('path', { key: 'b', d: 'M5.3 8.2l1.9 1.9 3.6-3.9' }),
        ],
        fill: [
          h('rect', { key: 'a', x: 1.9, y: 3.2, width: 12.2, height: 9.6, rx: 2 }),
          h('path', { key: 'b', d: 'M4.4 6.4h7.2' }),
          h('path', { key: 'c', d: 'M4.4 9.6h4.4' }),
        ],
        quiz: [
          h('rect', { key: 'a', x: 2.1, y: 2.1, width: 8, height: 8, rx: 1.8 }),
          h('rect', { key: 'b', x: 5.4, y: 5.4, width: 8, height: 8, rx: 1.8 }),
        ],
      }
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        paths[mode] || paths.ask,
      )
    }

    function createChoiceRow(ui) {
      return function ChoiceRow(props) {
      const block = props.block || {}
      const args = readChoiceArgs(block.args)
      const meta = block.meta && typeof block.meta === 'object' ? block.meta : {}
      const mode = choiceModeOf(args)
      const questions = Array.isArray(args.questions) ? args.questions : []
      const first = questions[0] || {}
      const title = typeof args.title === 'string' && args.title !== '' ? args.title : first.question || ''
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const note = meta.status === 'cancelled' ? t('rowCancelled') : meta.status === 'timeout' ? t('rowTimeout') : ''
      const pending = props.phase !== 'result' && note === ''
      return h(
        React.Fragment,
        null,
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h(
          'div',
          {
            className: 'luc-row' + (pending ? ' luc-row-clickable' : ''),
            'data-mode': mode,
            'data-tool': props.toolName || 'let_user_choose',
            ...(pending ? { role: 'button', tabIndex: 0, onClick: () => ui.set(false) } : {}),
          },
          PREFS.icons ? h('span', { className: 'luc-row-icon' }, renderModeIcon(mode)) : null,
          h('span', { className: 'luc-row-label' }, t(ROW_LABELS[mode])),
          title ? h('span', { className: 'luc-row-sep' }, t('rowSep')) : null,
          title ? h('span', { className: 'luc-row-title' }, title) : null,
          note ? h('span', { className: 'luc-row-note' }, note) : null,
        ),
      )
      }
    }

    const SETTINGS_CSS = `
.luc-set{display:flex;flex-direction:column;gap:18px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.luc-set-sec{display:flex;flex-direction:column;gap:8px}
.luc-set-h{font-weight:500;font-size:13px;color:var(--dsw-alias-label-primary)}
.luc-set-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.luc-set-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.luc-set-label{min-width:132px;color:var(--dsw-alias-label-secondary)}
.luc-set-in{height:28px;padding:0 8px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.luc-set-in-num{width:120px}
.luc-set-in-wide{width:260px}
.luc-set-btn{height:28px;padding:0 12px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}
.luc-set-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.luc-set-btn:disabled{opacity:.5;cursor:default}
.luc-set-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.luc-set-status{font-size:12px;line-height:18px}
.luc-set-ok{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}
.luc-set-err{color:var(--dsw-alias-state-error-primary)}
`

    /** 设置 → 插件 → 选择题弹窗：每个功能都能当场点一下，参数也能调 */
    function createSettingsPage(ctx, t) {
      return function SettingsPage() {
        const [config, setConfig] = React.useState(null)
        const [draft, setDraft] = React.useState({ timeoutMs: '', maxInlineBytes: '', phpBinary: '' })
        const [status, setStatus] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [prefs, setPrefs] = React.useState({ width: PREFS.width, icons: PREFS.icons })

        React.useEffect(() => {
          let disposed = false
          void (async () => {
            try {
              const response = await fetch(`${API}/settings`, { cache: 'no-store' })
              if (!response.ok) throw new Error(String(response.status))
              const data = await response.json()
              if (disposed) return
              setConfig(data.config)
              setDraft({
                timeoutMs: String(data.config.timeoutMs),
                maxInlineBytes: String(data.config.maxInlineBytes),
                phpBinary: String(data.config.phpBinary ?? ''),
              })
            } catch {
              if (!disposed) setStatus({ kind: 'err', text: t('settingsLoadFailed') })
            }
          })()
          return () => {
            disposed = true
          }
        }, [])

        async function save() {
          setBusy(true)
          setStatus(null)
          try {
            const response = await fetch(`${API}/settings`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({
                confirm: true,
                timeoutMs: Number(draft.timeoutMs),
                maxInlineBytes: Number(draft.maxInlineBytes),
                phpBinary: draft.phpBinary,
              }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || data.ok !== true) throw new Error(data.error || String(response.status))
            setConfig(data.config)
            setDraft({
              timeoutMs: String(data.config.timeoutMs),
              maxInlineBytes: String(data.config.maxInlineBytes),
              phpBinary: String(data.config.phpBinary ?? ''),
            })
            setStatus({ kind: 'ok', text: t('settingsSaved') })
          } catch {
            setStatus({ kind: 'err', text: t('settingsFailed') })
          } finally {
            setBusy(false)
          }
        }

        async function test(mode) {
          const sessionId = ctx.uiSession.adapter.current.getSnapshot().key
          if (!sessionId) {
            setStatus({ kind: 'err', text: t('settingsNoSession') })
            return
          }
          setBusy(true)
          setStatus(null)
          try {
            const response = await fetch(`${API}/selftest`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({ confirm: true, sessionId, mode }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok || data.ok !== true) throw new Error(data.error || String(response.status))
            setStatus({ kind: 'ok', text: t('settingsSent') })
          } catch {
            setStatus({ kind: 'err', text: t('settingsFailed') })
          } finally {
            setBusy(false)
          }
        }

        function setPref(patch) {
          savePrefs(patch)
          setPrefs({ ...prefs, ...patch })
        }

        const tests = [
          ['single', t('modeAsk')],
          ['multi', t('modeMulti')],
          ['confirm', t('modeConfirm')],
          ['fill', t('modeFill')],
          ['quiz', t('modeQuiz')],
        ]

        const widthOptions = [
          ['auto', t('widthAuto')],
          ['768', '768'],
          ['390', '390'],
        ]

        return h(
          React.Fragment,
          null,
          h('style', { dangerouslySetInnerHTML: { __html: SETTINGS_CSS } }),
          h(
            'div',
            { className: 'luc-set' },
            h(
              'div',
              { className: 'luc-set-sec' },
              h('div', { className: 'luc-set-h' }, t('settingsTest')),
              h('div', { className: 'luc-set-note' }, t('settingsTestHint')),
              h(
                'div',
                { className: 'luc-set-row' },
                ...tests.map(([mode, label], index) =>
                  h(
                    'button',
                    {
                      key: mode,
                      type: 'button',
                      className: 'luc-set-btn' + (index === 0 ? ' luc-set-primary' : ''),
                      disabled: busy,
                      onClick: () => void test(mode),
                    },
                    label,
                  ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'luc-set-sec' },
              h('div', { className: 'luc-set-h' }, t('settingsParams')),
              h(
                'div',
                { className: 'luc-set-row' },
                h('span', { className: 'luc-set-label' }, t('settingsTimeout')),
                h('input', {
                  className: 'luc-set-in luc-set-in-num',
                  type: 'number',
                  min: 5000,
                  max: 3600000,
                  step: 1000,
                  value: draft.timeoutMs,
                  onChange: (event) => setDraft({ ...draft, timeoutMs: event.target.value }),
                }),
              ),
              h(
                'div',
                { className: 'luc-set-row' },
                h('span', { className: 'luc-set-label' }, t('settingsInlineBytes')),
                h('input', {
                  className: 'luc-set-in luc-set-in-num',
                  type: 'number',
                  min: 1024,
                  max: 1048576,
                  step: 1024,
                  value: draft.maxInlineBytes,
                  onChange: (event) => setDraft({ ...draft, maxInlineBytes: event.target.value }),
                }),
              ),
              h(
                'div',
                { className: 'luc-set-row' },
                h('span', { className: 'luc-set-label' }, t('settingsPhp')),
                h('input', {
                  className: 'luc-set-in luc-set-in-wide',
                  type: 'text',
                  placeholder: '"auto" 或可执行文件路径，留空表示不执行',
                  value: draft.phpBinary,
                  onChange: (event) => setDraft({ ...draft, phpBinary: event.target.value }),
                }),
              ),
              h(
                'div',
                { className: 'luc-set-row' },
                h(
                  'button',
                  { type: 'button', className: 'luc-set-btn', disabled: busy || !config, onClick: () => void save() },
                  t('settingsSave'),
                ),
                status
                  ? h(
                      'span',
                      {
                        className:
                          'luc-set-status ' + (status.kind === 'ok' ? 'luc-set-ok' : 'luc-set-err'),
                      },
                      status.text,
                    )
                  : null,
              ),
            ),
            h(
              'div',
              { className: 'luc-set-sec' },
              h('div', { className: 'luc-set-h' }, t('settingsPrefs')),
              h(
                'div',
                { className: 'luc-set-row' },
                h('span', { className: 'luc-set-label' }, t('settingsWidth')),
                h(
                  'select',
                  {
                    className: 'luc-set-in',
                    value: prefs.width,
                    onChange: (event) => setPref({ width: event.target.value }),
                  },
                  ...widthOptions.map(([value, label]) => h('option', { key: value, value }, label)),
                ),
              ),
              h(
                'div',
                { className: 'luc-set-row' },
                h('span', { className: 'luc-set-label' }, t('settingsIcons')),
                h('input', {
                  type: 'checkbox',
                  checked: prefs.icons,
                  onChange: (event) => setPref({ icons: event.target.checked }),
                }),
              ),
            ),
          ),
        )
      }
    }

    function apply(ctx) {
      ctx.effect(() => {
        const disposers = []
        if (typeof ctx.locale.addLanguage === 'function') {
          for (const language of LANGUAGES) {
            try {
              disposers.push(ctx.locale.addLanguage(language))
            } catch {
              /* the locale is already registered by another plugin */
            }
          }
        }
        for (const [locale, dict] of LOCALES) {
          disposers.push(ctx.locale.register('let-user-choose', locale, dict))
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {
              /* ignore */
            }
          }
        }
      }, 'let-user-choose: dictionaries')

      const t = ctx.locale.bind('let-user-choose')
      const ui = createChoiceUi()

      // 登记成会话的挂起交互：宿主要知道这个会话在等人回答（界面另用弹窗 + 小胶囊）
      let publish = null
      if (ctx.uiSession && typeof ctx.uiSession.registerPendingInteraction === 'function') {
        try {
          publish = ctx.uiSession.registerPendingInteraction(() => 1)
        } catch {
          publish = null
        }
      }

      // 转录里的工具行：按模式给图标，和原生提问卡片同一排
      const ChoiceRow = createChoiceRow(ui)
      const toolviews = new Set()
      const ensureToolview = (name) => {
        const key = typeof name === 'string' && name !== '' ? name : 'let_user_choose'
        if (toolviews.has(key)) return
        toolviews.add(key)
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register({ name: 'tool.call.toolview', key, locale: 'let-user-choose' }, ChoiceRow),
        )
      }
      ensureToolview('let_user_choose')

      const Dialog = createDialog(ctx, t, ui, publish, ensureToolview)
      const SettingsPage = createSettingsPage(ctx, t)
      // 标签可能在语言还没就绪时被投影一次，兜一个静态文案，避免出现空标签页
      const settingsLabel = () => {
        const text = t('settingsTab')
        return typeof text === 'string' && text !== '' && text !== 'settingsTab' ? text : '选择题'
      }
      // 两个入口：设置里顶层的独立页（好找），以及 插件 分类里的一个标签页
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-visual-option',
            order: 65,
            label: settingsLabel,
          },
          SettingsPage,
        ),
      )
      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'dsh-visual-option',
            order: 70,
            label: settingsLabel,
          },
          SettingsPage,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'let-user-choose.dialog',
            order: 40,
          },
          Dialog,
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'uiSession'],
      apply,
    }
  },
})
