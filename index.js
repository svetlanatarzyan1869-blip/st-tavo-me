/* ============================================================================
 * Tavo · Варианты для меня — расширение для SillyTavern
 * Панель под последним сообщением бота: карусель вариантов для ПЕРСОНАЖА
 * ИГРОКА (его действия/мысли/эмоции — отдельный человек от бота, может быть
 * в другом месте). Кнопка «✍️ так и сделаю»: пишет полноразмерный ход игрока
 * в его стиле → постит как user → генерит реакцию бота.
 * Генерация — нативная, через настроенное в SillyTavern подключение:
 *   - варианты:    generateRaw (мета-задача, вне чата)
 *   - ход игрока:  generateRaw (пишем ЗА игрока, вне пресета персонажа)
 *   - реакция бота: generateQuietPrompt(quietToLoud) -> дописываем в чат
 * Хранилище — в message.extra последнего сообщения (переживает перезаход).
 * Namespace ti2- / tavo_me_* — не конфликтует с панелью «Идеи для сюжета».
 * ========================================================================== */
(function () {
  'use strict';

  // ===== НАСТРОЙКИ =====
  var VARIANTS_COUNT = 5;    // сколько вариантов генерировать
  var CONTEXT_MESSAGES = 12; // сколько последних сообщений отдавать модели как транскрипт
  // =====================

  var PANEL_CLASS = 'tavo-me-panel';

  function optionsSystem(playerName) {
    return 'You generate options for what the player character named "' + playerName + '" could do next - ONLY this player, nobody else. '
      + 'In the transcript, the lines whose speaker is "' + playerName + '" are the PLAYER. Every other name is a SEPARATE, AI-controlled character - not the player. '
      + 'The player is a distinct person with their own body, location, thoughts and feelings, and may be in a COMPLETELY DIFFERENT place or situation than the AI characters. '
      + 'Stay strictly inside the player\'s own perspective and surroundings - do not move the player to where the AI characters are. '
      + 'Propose distinct things the PLAYER personally does, thinks, feels, or says next. NEVER narrate, decide, or speak for the AI characters; they are not yours to control here. '
      + 'For EACH option, classify it with EXACTLY ONE type (in Russian): Драма, Романтика, Спокойствие, Напряжение, Тайна, Неожиданное. Vary the types across options. '
      + 'Write the Заголовок and the sentence in the SAME language as the transcript, phrased as the player\'s own action, thought or line. '
      + 'Reply ONLY as separate lines formatted EXACTLY: Тип :: Заголовок :: what the player does. No numbering, no preamble, no closing remarks.';
  }

  function moveSystem(playerName) {
    return 'You write the next roleplay post FOR the player character named "' + playerName + '". '
      + 'In the transcript, the lines whose speaker is "' + playerName + '" are the player; every other named speaker is a separate AI-controlled character. '
      + 'Output ONLY what ' + playerName + ' does, thinks and says, in the voice and personality of ' + playerName
      + ' (a person distinct from the AI characters, with their own reactions and emotions), matching how ' + playerName + ' writes in this chat. '
      + 'Do NOT write other characters or the world reacting - only the move by ' + playerName + '. '
      + 'Write a FULL-LENGTH roleplay post: the same length, detail and formatting as the usual posts by ' + playerName + ' in this chat '
      + '(actions, inner thoughts and spoken lines woven together), NOT a brief summary. Take your time inside the moment. '
      + 'Write in the SAME language as the transcript. Output ONLY the post text - no preamble, no quotes around it.';
  }

  var REACT_TPL = '[Continue the roleplay in-character as the character(s) and the world, reacting to what {PLAYER} '
    + 'just did. Stay measured, do not over-dramatize. Never speak or act for {PLAYER}. Match the established style, '
    + 'POV and formatting.]';

  var TYPES = {
    'драма': { e: '🔥', c: '#ff5c7a' }, 'драм': { e: '🔥', c: '#ff5c7a' },
    'романтик': { e: '💗', c: '#ff77c8' }, 'роман': { e: '💗', c: '#ff77c8' },
    'спокой': { e: '🌿', c: '#4fd1a1' },
    'напряж': { e: '⚡', c: '#ffb454' },
    'тайн': { e: '🔍', c: '#a99bff' }, 'загадк': { e: '🔍', c: '#a99bff' },
    'неожид': { e: '🎲', c: '#5cc8ff' }, 'сюрприз': { e: '🎲', c: '#5cc8ff' }
  };
  function typeOf(s) {
    var k = (s || '').toLowerCase().trim();
    for (var key in TYPES) { if (k.indexOf(key) > -1) return { name: s.trim(), e: TYPES[key].e, c: TYPES[key].c }; }
    return { name: (s || 'Вариант').trim(), e: '🎭', c: 'currentColor' };
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var BSVG = '<svg class="ti2-bf" viewBox="0 0 100 90">'
    + '<g class="wl"><path d="M50 44 C30 16,8 10,6 30 C0 42,9 50,27 47 C42 45,49 47,50 44Z" opacity=".62"/><path d="M50 46 C34 56,14 62,13 77 C15 88,32 83,43 68 C49 60,50 51,50 46Z" opacity=".5"/></g>'
    + '<g class="wr"><path d="M50 44 C70 16,92 10,94 30 C100 42,91 50,73 47 C58 45,51 47,50 44Z" opacity=".62"/><path d="M50 46 C66 56,86 62,87 77 C85 88,68 83,57 68 C51 60,50 51,50 46Z" opacity=".5"/></g>'
    + '<ellipse cx="50" cy="52" rx="2" ry="13" opacity=".9"/></svg>';
  var FLYCFG = [
    { top: '6%', w: 42, op: .30, d: 14, dl: 0, f: .24 },
    { top: '20%', w: 30, op: .26, d: 18, dl: -3, f: .28 },
    { top: '38%', w: 24, op: .23, d: 12, dl: -6, f: .22 },
    { top: '56%', w: 46, op: .28, d: 16, dl: -2, f: .26 },
    { top: '70%', w: 22, op: .22, d: 20, dl: -8, f: .30 },
    { top: '12%', w: 28, op: .24, d: 15, dl: -5, f: .25 },
    { top: '48%', w: 36, op: .26, d: 13, dl: -9, f: .27 },
    { top: '78%', w: 26, op: .22, d: 17, dl: -4, f: .23 }
  ];
  var FLIES = '<div class="ti2-flies">' + FLYCFG.map(function (c, i) {
    return '<span class="ti2-fly" style="top:' + c.top + ';width:' + c.w + 'px;height:' + c.w + 'px;opacity:' + c.op + ';--fd:' + c.f + 's;animation:ti2-f' + ((i % 6) + 1) + ' ' + c.d + 's ease-in-out infinite;animation-delay:' + c.dl + 's">' + BSVG + '</span>';
  }).join('') + '</div>';

  function ctx() { return SillyTavern.getContext(); }

  function toast(msg) {
    try {
      var c = ctx();
      if (c.toastr && c.toastr.error) c.toastr.error(msg);
      else if (window.toastr) window.toastr.error(msg);
      else console.warn('[tavo-me]', msg);
    } catch (e) { console.warn('[tavo-me]', msg); }
  }

  function playerName() { return ctx().name1 || 'User'; }

  // ---- транскрипт последних сообщений ----
  function buildTranscript() {
    var c = ctx();
    var chat = c.chat || [];
    var slice = chat.filter(function (m) { return m && !m.is_system; }).slice(-CONTEXT_MESSAGES);
    return slice.map(function (m) {
      var who = m.is_user ? (c.name1 || 'User') : (m.name || c.name2 || 'Character');
      return who + ': ' + (m.mes || '');
    }).join('\n');
  }

  // ---- нативная генерация через ST ----
  // Через полный конвейер (generateQuietPrompt) — с карточкой/джейлбреком пресета, иначе «голый»
  // generateRaw режется контент-фильтром провайдера (напр. Gemini: PROHIBITED_CONTENT / prompt_blocked).
  async function genOptions() {
    var pn = playerName();
    var instr = '[OOC planning task — do NOT write story prose and do NOT continue the roleplay. '
      + optionsSystem(pn) + ' Give EXACTLY ' + VARIANTS_COUNT + ' options for ' + pn + ' now, as ' + VARIANTS_COUNT + ' lines only.]';
    return await ctx().generateQuietPrompt({ quietPrompt: instr, quietToLoud: false });
  }

  // Ход игрока: инструктируем писать ЗА игрока, постим как user.
  async function genPlayerMove(steer) {
    var c = ctx();
    var pn = playerName();
    var instr = '[' + moveSystem(pn) + ' Take the scene in THIS direction: ' + steer + ' Write ' + pn + '\'s next post now.]';
    var text = await c.generateQuietPrompt({ quietPrompt: instr, quietToLoud: true });
    text = (text || '').trim();
    if (!text) throw new Error('пустой ответ модели (ход игрока)');
    var mes = { name: pn, is_user: true, is_system: false, send_date: Date.now(), mes: text, extra: {} };
    c.chat.push(mes);
    c.addOneMessage(mes);
    await c.saveChat();
    return text;
  }

  // Реакция бота на ход игрока: «громкая» генерация в контексте чата.
  async function genBotReaction() {
    var c = ctx();
    var quiet = REACT_TPL.split('{PLAYER}').join(playerName());
    var text = await c.generateQuietPrompt({ quietPrompt: quiet, quietToLoud: true });
    text = (text || '').trim();
    if (!text) throw new Error('пустой ответ модели (реакция бота)');
    var mes = { name: c.name2 || 'Character', is_user: false, is_system: false, send_date: Date.now(), mes: text, extra: {} };
    c.chat.push(mes);
    c.addOneMessage(mes);
    await c.saveChat();
    return text;
  }

  function parse(raw) {
    return String(raw || '').split(/\r?\n/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.indexOf('::') > -1; })
      .map(function (l) {
        var p = l.split('::').map(function (x) { return x.trim(); });
        if (p.length >= 3) { return { type: p[0].replace(/^[-*\d.\s]+/, ''), title: p[1], desc: p.slice(2).join(' :: ') }; }
        return { type: '', title: p[0].replace(/^[-*\d.\s]+/, ''), desc: p.slice(1).join(' :: ') };
      }).slice(0, VARIANTS_COUNT);
  }

  // ---- хранилище: в message.extra последнего сообщения ----
  function storeOf(idx) {
    var m = ctx().chat[idx];
    if (!m) return null;
    if (!m.extra) m.extra = {};
    return m.extra;
  }
  function getIdeas(idx) { var e = storeOf(idx); return (e && e.tavo_me_ideas) || null; }
  function setIdeas(idx, items) { var e = storeOf(idx); if (e) { e.tavo_me_ideas = items; ctx().saveChat(); } }
  function getCollapsed(idx) { var e = storeOf(idx); return e ? e.tavo_me_collapsed : undefined; }
  function setCollapsedStore(idx, v) { var e = storeOf(idx); if (e) { e.tavo_me_collapsed = v; ctx().saveChat(); } }

  // ---- построение DOM панели ----
  function buildPanelDom() {
    var panel = document.createElement('div');
    panel.className = 'ti2-panel ' + PANEL_CLASS;
    panel.innerHTML =
      '<div class="ti2-head"><span class="ti2-title">🎭 варианты для меня<span class="ti2-count"></span></span>'
      + '<button class="ti2-toggle" type="button" aria-label="свернуть">▾</button></div>'
      + '<div class="ti2-body"><div class="ti2-out"></div></div>';
    return panel;
  }

  // ---- логика одной панели ----
  function initPanel(panel, idx) {
    if (panel.dataset.ti2Bound) return;
    panel.dataset.ti2Bound = '1';

    var head = panel.querySelector('.ti2-head');
    var toggle = panel.querySelector('.ti2-toggle');
    var countEl = panel.querySelector('.ti2-count');
    var out = panel.querySelector('.ti2-out');

    function setCount(n) { countEl.textContent = n ? (' · ' + n) : ''; }
    function setCollapsed(v) { panel.classList.toggle('collapsed', !!v); setCollapsedStore(idx, v ? 1 : 0); }

    function renderCards(items) {
      setCount(items.length);
      var cards = items.map(function (it, i) {
        var t = typeOf(it.type);
        var style = '--acc:' + t.c + ';animation-delay:' + (i * 0.06).toFixed(2) + 's';
        return '<div class="ti2-card" style="' + style + '">' + FLIES
          + '<div class="ti2-badge"><span>' + t.e + '</span>' + esc(t.name) + '</div>'
          + '<b>' + esc(it.title) + '</b>'
          + '<p>' + esc(it.desc) + '</p>'
          + '<button class="ti2-go" type="button" data-steer="' + esc(it.desc) + '">✍️ так и сделаю</button>'
          + '</div>';
      }).join('');
      var total = items.length, dots = '';
      for (var j = 0; j < total; j++) { dots += '<span class="ti2-dot' + (j === 0 ? ' on' : '') + '"></span>'; }
      out.innerHTML = '<div class="ti2-view"><div class="ti2-track">' + cards + '</div></div>'
        + '<div class="ti2-ctrls"><button class="ti2-nav ti2-prev" type="button">‹</button><div class="ti2-dots">' + dots + '</div><button class="ti2-nav ti2-next" type="button">›</button></div>'
        + '<button class="ti2-reroll" type="button">🔄 другие варианты</button>';

      var track = out.querySelector('.ti2-track');
      var dotEls = [].slice.call(out.querySelectorAll('.ti2-dot'));
      var N = dotEls.length, cur = 0;
      function show(k) { cur = Math.max(0, Math.min(N - 1, k)); track.style.transform = 'translateX(-' + (cur * 100) + '%)'; dotEls.forEach(function (d, j) { d.classList.toggle('on', j === cur); }); }
      dotEls.forEach(function (d, j) { d.addEventListener('click', function () { show(j); }); });
      out.querySelector('.ti2-prev').addEventListener('click', function () { show(cur - 1); });
      out.querySelector('.ti2-next').addEventListener('click', function () { show(cur + 1); });
      out.querySelectorAll('.ti2-card').forEach(function (card) { card.addEventListener('click', function (e) { if (e.target.closest('button')) return; show((cur + 1) % N); }); });
      var sx = null;
      track.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
      track.addEventListener('touchend', function (e) { if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; if (dx > 40) show(cur - 1); else if (dx < -40) show(cur + 1); sx = null; });
      out.querySelector('.ti2-reroll').addEventListener('click', function () { generate(); });

      out.querySelectorAll('.ti2-go').forEach(function (g) {
        g.addEventListener('click', async function () {
          var steer = g.getAttribute('data-steer'); var og = g.textContent; g.disabled = true;
          try {
            g.textContent = '✍️ пишу за тебя…';
            await genPlayerMove(steer);
            g.textContent = '💬 бот отвечает…';
            await genBotReaction();
            g.textContent = '✅ готово';
            pokeAll();
          } catch (e) { g.disabled = false; g.textContent = og; toast('Ошибка: ' + ((e && e.message) || e)); }
        });
      });
    }

    function showGenButton() {
      setCount(0);
      out.innerHTML = '<button class="ti2-btn" type="button"><span class="ti2-btn-txt">✨ придумать варианты</span></button>';
      out.querySelector('.ti2-btn').addEventListener('click', function () { generate(); });
    }

    async function generate() {
      setCollapsed(false);
      out.innerHTML = '<div class="ti2-cap">✨ подбираю варианты под сцену…</div><div class="ti2-skel"></div><div class="ti2-skel"></div><div class="ti2-skel"></div>';
      try {
        var raw = await genOptions();
        var items = parse(raw);
        if (!items.length) { out.innerHTML = '<div class="ti2-card"><p>Пусто — попробуй ещё раз 🔄</p></div>'; return; }
        setIdeas(idx, items);
        renderCards(items);
      } catch (e) { out.innerHTML = '<div class="ti2-card"><p>⚠️ ' + esc((e && e.message) || e) + '</p></div>'; }
    }

    toggle.addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(!panel.classList.contains('collapsed')); });
    head.addEventListener('click', function () { setCollapsed(!panel.classList.contains('collapsed')); });
    // не даём кликам по панели всплывать до обработчиков сообщения ST
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    // init: подтянуть сохранённые варианты и состояние сворачивания
    var stored = getIdeas(idx);
    if (stored && stored.length) { renderCards(stored); } else { showGenButton(); }
    var col = getCollapsed(idx);
    if (col !== 0) { panel.classList.add('collapsed'); } // свёрнуто по умолчанию
  }

  // ---- размещение панели под последним сообщением бота ----
  function refresh() {
    var c;
    try { c = ctx(); } catch (e) { return; }
    var chat = c.chat || [];
    var lastIdx = -1;
    for (var i = chat.length - 1; i >= 0; i--) { if (chat[i] && !chat[i].is_system) { lastIdx = i; break; } }

    document.querySelectorAll('.' + PANEL_CLASS).forEach(function (p) {
      if (p.dataset.mesid !== String(lastIdx)) p.remove();
    });
    if (lastIdx < 0) return;
    if (chat[lastIdx].is_user) return; // панель только под сообщением бота

    var mesEl = document.querySelector('#chat .mes[mesid="' + lastIdx + '"]') || document.querySelector('.mes[mesid="' + lastIdx + '"]');
    if (!mesEl) return;
    if (document.querySelector('.' + PANEL_CLASS + '[data-mesid="' + lastIdx + '"]')) return; // уже стоит
    var panel = buildPanelDom();
    panel.dataset.mesid = String(lastIdx);
    // вставляем ПОСЛЕ сообщения (сиблингом), а не внутрь: TavernHelper и прочие
    // рендереры перерисовывают содержимое .mes в iframe и затирают вставленное внутрь.
    // Стекуемся после уже стоящих tavo-панелей этого сообщения (идеи выше, мы ниже).
    var anchor = mesEl;
    while (anchor.nextElementSibling && anchor.nextElementSibling.className &&
           String(anchor.nextElementSibling.className).indexOf('tavo-') > -1) {
      anchor = anchor.nextElementSibling;
    }
    anchor.insertAdjacentElement('afterend', panel);
    initPanel(panel, lastIdx);
  }

  var refreshTimer = null;
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 90); }
  // общий сигнал для ВСЕХ tavo-панелей (идеи + для меня): после ручного дописывания в чат
  function pokeAll() { window.dispatchEvent(new CustomEvent('tavo-panels-refresh')); }

  // следим за контейнером чата: любое добавление/удаление сообщения двигает панель под последнее
  function watchChat() {
    var el = document.getElementById('chat');
    if (!el) { setTimeout(watchChat, 500); return; }
    new MutationObserver(scheduleRefresh).observe(el, { childList: true });
  }

  // ---- запуск ----
  function boot() {
    var c;
    try { c = SillyTavern.getContext(); } catch (e) { setTimeout(boot, 300); return; }
    if (!c || !c.eventSource || !c.eventTypes) { setTimeout(boot, 300); return; }
    var es = c.eventSource, et = c.eventTypes;
    [
      et.CHARACTER_MESSAGE_RENDERED, et.USER_MESSAGE_RENDERED, et.CHAT_CHANGED,
      et.MESSAGE_DELETED, et.MESSAGE_SWIPED, et.MESSAGE_EDITED, et.MORE_MESSAGES_LOADED
    ].forEach(function (ev) { if (ev) es.on(ev, scheduleRefresh); });
    window.addEventListener('tavo-panels-refresh', scheduleRefresh);
    watchChat();
    scheduleRefresh();
    console.log('[tavo-me] загружено');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
