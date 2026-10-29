/* 英语四级备考 · 本地离线学习台（零依赖前端） */
(function () {
  'use strict';

  var S = {
    meta: null,
    statsData: null,
    route: '',
    word: { mode: 'new', items: [], total: 0, idx: 0, revealed: false, spell: false, spellResult: null, loading: false, done: false },
    dict: { items: [], idx: 0, active: false, result: null, loading: false },
    listen: { items: [], current: null, answers: {}, result: null, loading: false },
    speak: { items: [], current: null, rating: 0, note: '', startedAt: 0, timer: null, left: 0, rec: null, chunks: [], url: null, stream: null },
    paper: { current: null, answers: {}, self: {}, result: null, remaining: 0, timer: null, loading: false },
    imp: { kind: 'words', result: null },
    modalResolve: null
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(sec) {
    if (sec < 0) { sec = 0; }
    var m = Math.floor(sec / 60), s = sec % 60;
    return pad(m) + ':' + pad(s);
  }
  function todayLabel() {
    var d = new Date();
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }
  function pct(a, b) { return b > 0 ? Math.round(a * 100 / b) : 0; }

  function api(path, body) {
    var opt = {};
    if (body !== undefined && body !== null) {
      opt.method = 'POST';
      opt.headers = { 'Content-Type': 'application/json' };
      opt.body = JSON.stringify(body);
    }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: '响应不是合法 JSON' }; });
    }).then(function (j) {
      if (!j || j.ok === false) { throw new Error((j && j.error) || '请求失败'); }
      return j;
    });
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast ' + (kind || ''); }, 2600);
  }

  function openModal(html) {
    $('#sheet').innerHTML = html;
    $('#modal').hidden = false;
  }
  function showModal(html) { S.modalResolve = null; openModal(html); }
  function closeModal(val) {
    $('#modal').hidden = true;
    $('#sheet').innerHTML = '';
    if (S.modalResolve) {
      var fn = S.modalResolve;
      S.modalResolve = null;
      fn(val);
    }
  }
  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      S.modalResolve = resolve;
      openModal('<h3>' + esc(title) + '</h3><p class="sub">' + esc(text) + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">' +
        '<button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn primary" data-act="modal-ok">' + esc(okLabel || '确定') + '</button></div>');
    });
  }

  function playAudio(src) {
    var a = new Audio(src);
    var p = a.play();
    if (p && p.catch) { p.catch(function () { toast('浏览器阻止了自动播放，请再点一次', 'err'); }); }
    return a;
  }
  function speakWord(w) {
    var accent = (S.meta && S.meta.settings && S.meta.settings.accent) || 'en-us';
    return playAudio('/api/audio/word?word=' + encodeURIComponent(w) + '&accent=' + accent + '&speed=120');
  }
  function speakText(text) {
    return playAudio('/api/tts?text=' + encodeURIComponent(text) + '&voice=en-us&speed=135');
  }

  function stopAllTimers() {
    if (S.paper.timer) { clearInterval(S.paper.timer); S.paper.timer = null; }
    if (S.speak.timer) { clearInterval(S.speak.timer); S.speak.timer = null; }
    if (S.speak.rec && S.speak.rec.state !== 'inactive') { try { S.speak.rec.stop(); } catch (e) {} }
    if (S.speak.stream) { S.speak.stream.getTracks().forEach(function (t) { t.stop(); }); S.speak.stream = null; }
  }

  function refreshMeta() {
    return api('/api/meta').then(function (m) { S.meta = m; updateCheckinBtn(); return m; });
  }
  function updateCheckinBtn() {
    var b = $('#checkinBtn');
    if (!b) { return; }
    if (S.meta && S.meta.checked_in) { b.classList.add('on'); b.textContent = '已打卡'; }
    else { b.classList.remove('on'); b.textContent = '打卡'; }
  }

  function go(name) {
    if (('#' + '/' + name) === location.hash) { render(); return; }
    location.hash = '#/' + name;
  }

  function emptyBox(title, sub, extra) {
    return '<div class="card empty"><b>' + esc(title) + '</b>' + esc(sub || '') + (extra || '') + '</div>';
  }
  function loadingBox() { return '<div class="empty">正在加载…</div>'; }
  function pageHead(title, sub) {
    return '<h1>' + esc(title) + '</h1><p class="sub">' + (sub || '') + '</p>';
  }

  var LETTERS = 'ABCDEF';

  function optionList(options, selected, act, extra) {
    var h = [];
    for (var i = 0; i < options.length; i++) {
      var letter = LETTERS.charAt(i);
      var cls = 'option' + (selected === letter ? ' sel' : '');
      var extraAttr = extra ? ' data-qid="' + esc(extra) + '"' : '';
      h.push('<button type="button" class="' + cls + '" data-act="' + act + '" data-o="' + letter + '"' + extraAttr + '>' +
        '<span class="key">' + letter + '</span><span>' + esc(options[i]) + '</span></button>');
    }
    return h.join('');
  }

  function barsHtml(days, key) {
    var max = 1;
    var vals = [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      var v = key === 'total' ? (d.words + d.reviews + d.dictation + d.listening + d.speaking) : (d[key] || 0);
      vals.push(v);
      if (v > max) { max = v; }
    }
    var allZero = true;
    for (var z = 0; z < vals.length; z++) { if (vals[z] > 0) { allZero = false; break; } }
    if (allZero) {
      return '<div class="empty" style="padding:30px 10px">最近还没有练习记录，完成任意一次练习后这里会出现柱状图。</div>';
    }
    var h = ['<div class="bars">'];
    for (var j = 0; j < days.length; j++) {
      var hh = vals[j] > 0 ? Math.max(4, Math.round(vals[j] * 92 / max)) : 3;
      var dt = days[j].date.slice(5);
      h.push('<div class="b' + (vals[j] ? '' : ' zero') + '" title="' + esc(days[j].date) + '：' + vals[j] + ' 次">' +
        '<i style="height:' + hh + 'px"></i><span>' + dt + '</span></div>');
    }
    h.push('</div>');
    return h.join('');
  }

  function stateChip(stage) {
    if (stage >= 21) { return '<span class="chip ok">已掌握</span>'; }
    if (stage > 0) { return '<span class="chip accent">学习中</span>'; }
    return '<span class="chip">新词</span>';
  }

  /* ---------------- 首页 ---------------- */
  function viewHome() {
    return Promise.all([refreshMeta(), api('/api/stats')]).then(function (res) {
      S.statsData = res[1];
      if (S.route !== 'home') { return; }
      var m = S.meta, st = res[1];
      var w = m.words;
      var h = [];
      h.push('<section class="hero"><h1>今天也要背单词</h1>' +
        '<p>' + todayLabel() + ' · 连续打卡 ' + st.streak + ' 天 · 单词、听力、听写、口语全部离线可用</p>' +
        '<div class="hero-stats">' +
        '<div><b>' + st.streak + '</b><span>连续打卡（天）</span></div>' +
        '<div><b>' + m.today.words + '</b><span>今日单词</span></div>' +
        '<div><b>' + w.mastered + '</b><span>已掌握 / ' + w.total + '</span></div>' +
        '<div><b>' + m.today.dictation + ' / ' + (m.today.listening + m.today.speaking) + '</b><span>今日听写 / 听说</span></div>' +
        '</div><div class="checkin-row">' +
        (m.checked_in
          ? '<button class="btn" data-go="words">今日已打卡，去背词</button>'
          : '<button class="btn primary" data-act="checkin">立即打卡</button>') +
        '<button class="btn" data-go="papers">模拟考试</button>' +
        '<button class="btn" data-go="stats">学习统计</button>' +
        '</div></section>');

      h.push('<h2>今日任务</h2><div class="grid c3">');
      h.push(taskCard('新词学习', w.new_remaining + ' 个待学', w.new_today + ' / ' + ((m.settings && m.settings.daily_new) || 20), w.new_today, ((m.settings && m.settings.daily_new) || 20), 'words'));
      h.push(taskCard('到期复习', w.due + ' 个到期待复习', w.learned + ' 个已学', w.due, Math.max(w.due, 1), 'words'));
      h.push(taskCard('听写训练', '共 ' + m.counts.dictation + ' 个句子', '今日 ' + m.today.dictation + ' 句', m.today.dictation, 5, 'dictation'));
      h.push(taskCard('听力精听', '共 ' + m.counts.listening + ' 篇材料', '今日 ' + m.today.listening + ' 篇', m.today.listening, 2, 'listening'));
      h.push(taskCard('口语练习', '共 ' + m.counts.speaking + ' 个话题', '今日 ' + m.today.speaking + ' 次', m.today.speaking, 1, 'speaking'));
      h.push(taskCard('模拟卷', '共 ' + m.counts.papers + ' 套试卷', '含写作与翻译', 0, 1, 'papers'));
      h.push('</div>');

      h.push('<h2>最近 7 天练习量</h2><div class="card">' + barsHtml(st.days.slice(-7), 'total') + '</div>');

      h.push('<h2>模块入口</h2><div class="grid c2">');
      h.push(moduleCard('单词', '艾宾浩斯记忆曲线，忘记 / 模糊 / 认识 / 太简单四档自评', 'words'));
      h.push(moduleCard('听写', '逐句精听听写，逐词对比，标出漏写与拼错', 'dictation'));
      h.push(moduleCard('听力', '短对话与短文，先做题再看原文与解析', 'listening'));
      h.push(moduleCard('口语', '朗读、话题、问答三类，录音回放并自评', 'speaking'));
      h.push('</div>');
      $('#view').innerHTML = h.join('');
    });
  }

  function taskCard(title, main, sub, done, total, route) {
    var p = total > 0 ? Math.min(100, Math.round(done * 100 / total)) : 0;
    return '<div class="card module-card" data-go="' + route + '" style="cursor:pointer">' +
      '<div class="m-main"><strong>' + esc(title) + '</strong><span>' + esc(main) + '</span>' +
      '<div class="progress" style="margin-top:8px"><i style="width:' + p + '%"></i></div></div>' +
      '<span class="chip">' + esc(sub) + '</span></div>';
  }
  function moduleCard(title, desc, route) {
    return '<div class="card module-card" data-go="' + route + '" style="cursor:pointer">' +
      '<div class="m-main"><strong>' + esc(title) + '</strong><span>' + esc(desc) + '</span></div>' +
      '<span class="chip accent">进入</span></div>';
  }

  /* ---------------- 单词 ---------------- */
  function viewWords() {
    if (!S.word.loaded) {
      $('#view').innerHTML = loadingBox();
      return loadWords(S.word.mode);
    }
    renderWords();
  }

  function loadWords(mode) {
    var st = S.word;
    st.mode = mode;
    st.loading = true;
    st.idx = 0;
    st.revealed = false;
    st.spell = false;
    st.spellResult = null;
    st.done = false;
    return api('/api/words?mode=' + mode + '&limit=100').then(function (j) {
      st.items = j.items || [];
      st.total = j.total || 0;
      st.loaded = true;
      st.loading = false;
      if (S.route === 'words') { renderWords(); }
    });
  }

  function renderWords() {
    var st = S.word;
    var modes = [['new', '新词'], ['review', '复习'], ['wrong', '错词'], ['favorite', '收藏'], ['learned', '已学'], ['all', '全部']];
    var h = [];
    h.push('<h1>背单词</h1><p class="sub">四档自评驱动记忆曲线：忘记 10 分钟后重现，认识与太简单会逐步拉长间隔。共 ' + st.total + ' 个词。</p>');
    h.push('<div class="toolbar"><div class="segmented">');
    for (var i = 0; i < modes.length; i++) {
      h.push('<button data-act="word-mode" data-mode="' + modes[i][0] + '" class="' + (st.mode === modes[i][0] ? 'on' : '') + '">' + modes[i][1] + '</button>');
    }
    h.push('</div>' + (st.loading ? '<span class="chip">加载中…</span>' : '<span class="chip">' + st.items.length + ' 个</span>') + '</div>');

    if (!st.items.length) {
      h.push(emptyBox('这里还没有单词', st.mode === 'wrong' ? '答错或自评“忘记”的单词会自动进入错词。' : (st.mode === 'review' ? '当前没有到期需要复习的单词，可以去学新词。' : '换一个模式看看，或在导入页添加词库。'), '<div style="margin-top:14px"><button class="btn" data-act="word-mode" data-mode="new">去学新词</button></div>'));
      $('#view').innerHTML = h.join('');
      return;
    }
    if (st.done) {
      h.push('<div class="card empty"><b>本轮完成</b>已浏览 ' + st.items.length + ' 个单词，成绩与记忆曲线已保存。<div style="margin-top:16px"><button class="btn primary" data-act="word-restart">再来一轮</button> <button class="btn" data-go="stats">查看统计</button></div></div>');
      $('#view').innerHTML = h.join('');
      return;
    }

    var q = st.items[st.idx];
    var prog = Math.round((st.idx) * 100 / st.items.length);
    h.push('<div class="progress-line"><span>第 ' + (st.idx + 1) + ' / ' + st.items.length + ' 个</span><span class="progress"><i style="width:' + prog + '%"></i></span><span>' + esc(st.mode === 'new' ? '新词' : '复习') + '</span></div>');

    h.push('<div class="card" style="padding:0;overflow:hidden;margin-top:12px">');
    h.push('<div class="word-card">');
    h.push('<button class="icon-btn fav" data-act="word-fav" title="收藏">' + (q.favorite ? '★' : '☆') + '</button>');
    h.push('<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:10px">' + stateChip(q.interval) +
      (q.wrong ? '<span class="chip bad">错过 ' + q.wrong + ' 次</span>' : '') +
      (q.interval ? '<span class="chip">间隔 ' + Math.round(q.interval) + ' 天</span>' : '') + '</div>');

    if (st.spell && !st.spellResult) {
      h.push('<div class="word-pos" style="font-size:14px">听发音，写出这个单词</div>');
      h.push('<div class="field" style="max-width:420px;margin:20px auto 0"><input id="spellInput" type="text" autocomplete="off" spellcheck="false" placeholder="输入你听到的单词"></div>');
      h.push('<div class="audio-row"><button class="btn primary" data-act="word-spell-submit">检查拼写</button><button class="btn" data-act="word-spell-toggle">退出拼写</button></div>');
    } else if (st.spellResult) {
      var sp = st.spellResult;
      h.push('<div class="reveal"><div class="score-big" style="color:var(--' + (sp.correct ? 'ok' : 'bad') + ')">' + (sp.correct ? '✓ 拼写正确' : '✗ 拼错了') + '</div>' +
        '<div class="meaning" style="margin-top:8px">' + esc(q.word) + '</div><div class="word-pos">' + esc(q.pos || '') + ' ' + esc(q.meaning) + '</div>' +
        (q.example ? '<div class="example">' + esc(q.example) + '</div>' : '') + '</div>' +
        '<div class="audio-row"><button class="btn primary" data-act="word-next">下一个</button><button class="btn" data-act="word-spell-toggle">退出拼写</button></div>');
    } else {
      h.push('<div class="word-xl">' + esc(q.word) + '</div><div class="word-pos">' + esc(q.pos || '') + (q.reps ? ' · 已复习 ' + q.reps + ' 次' : '') + '</div>');
      h.push('<div class="audio-row"><button class="btn sm" data-act="word-audio" data-speed="120">🔊 发音</button><button class="btn sm" data-act="word-audio" data-speed="100">🐢 慢速</button>' +
        (q.example ? '<button class="btn sm" data-act="word-example">例句发音</button>' : '') +
        '<button class="btn sm" data-act="word-spell-toggle">拼写模式</button></div>');
      if (st.revealed) {
        h.push('<div class="reveal"><div class="meaning">' + esc(q.meaning) + '</div>' +
          (q.example ? '<div class="example">' + esc(q.example) + '</div>' : '') +
          '<div class="word-meta">按 1–4 也可以快速评价</div></div>');
        h.push('<div class="rating-row">' +
          '<button class="btn" data-act="word-rate" data-rating="0">忘记<small style="display:block;color:var(--muted);font-size:11px">10 分钟</small></button>' +
          '<button class="btn" data-act="word-rate" data-rating="1">模糊<small style="display:block;color:var(--muted);font-size:11px">半天</small></button>' +
          '<button class="btn" data-act="word-rate" data-rating="2">认识<small style="display:block;color:var(--muted);font-size:11px">1 天起</small></button>' +
          '<button class="btn" data-act="word-rate" data-rating="3">太简单<small style="display:block;color:var(--muted);font-size:11px">更久</small></button></div>');
      } else {
        h.push('<div class="audio-row"><button class="btn primary" data-act="word-reveal" style="min-width:180px">显示释义</button></div>');
      }
    }
    h.push('</div></div>');

    h.push('<div class="toolbar" style="margin-top:14px"><button class="btn" data-act="word-prev">上一个</button><button class="btn" data-act="word-next">跳过</button><span style="flex:1"></span><span class="chip">空格显示释义 · 1–4 评价</span></div>');
    $('#view').innerHTML = h.join('');
  }

  function wordAdvance(delta) {
    var st = S.word;
    st.idx += delta;
    st.revealed = false;
    st.spellResult = null;
    if (st.idx >= st.items.length) { st.done = true; st.idx = st.items.length - 1; }
    if (st.idx < 0) { st.idx = 0; }
    renderWords();
  }

  /* ---------------- 听写 ---------------- */
  function viewDictation() {
    if (S.dict.active) {
      if (S.dict.result) { renderDictResult(); } else { renderDictRun(); }
      return;
    }
    if (!S.dict.items.length) {
      $('#view').innerHTML = loadingBox();
      return loadDictList();
    }
    renderDictList();
  }

  function loadDictList() {
    return api('/api/dictation?limit=100').then(function (j) {
      S.dict.items = j.items || [];
      if (S.route === 'dictation') { renderDictList(); }
    });
  }

  function renderDictList() {
    var items = S.dict.items;
    var h = [pageHead('听写训练', '逐句精听：先听整句，写下你听到的内容，提交后逐词对比并给出参考译文。共 ' + items.length + ' 句。')];
    h.push('<div class="toolbar"><button class="btn primary" data-act="dict-start">开始听写</button><span class="chip">建议先听两遍再动笔</span></div><div class="list">');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      h.push('<div class="list-item" data-act="dict-open" data-idx="' + i + '"><div class="idx">' + (i + 1) + '</div><div class="li-main"><strong>' + esc(it.hint || '听写句子') + '</strong>' +
        '<span>' + esc(it.source || '') + ' · 练习 ' + (it.attempts || 0) + ' 次' + (it.best !== null && it.best !== undefined ? ' · 最佳 ' + it.best + '%' : '') + '</span></div>' +
        '<span class="chip ' + (it.last_correct ? 'ok' : '') + '">' + (it.last_correct ? '上次通过' : '开始') + '</span></div>');
    }
    h.push('</div>');
    $('#view').innerHTML = h.join('');
  }

  function renderDictRun() {
    var d = S.dict;
    var it = d.items[d.idx];
    if (!it) { d.active = false; return renderDictList(); }
    var h = [];
    h.push('<div class="toolbar"><button class="btn sm" data-act="dict-back">← 返回列表</button><span class="chip accent">第 ' + (d.idx + 1) + ' / ' + d.items.length + ' 句</span><span class="chip">' + esc(it.hint || '') + '</span></div>');
    h.push('<div class="card"><audio controls preload="none" style="width:100%" src="/api/audio/dictation/' + it.id + '"></audio>');
    h.push('<div class="audio-row" style="justify-content:flex-start"><button class="btn sm" data-act="dict-play" data-slow="0">▶ 正常播放</button><button class="btn sm" data-act="dict-play" data-slow="1">🐢 慢速播放</button><span class="chip">可反复听</span></div>');
    h.push('<div class="field" style="margin-top:14px"><label>写下你听到的整句（不用管标点大小写）</label><textarea id="dictInput" placeholder="Start typing what you hear..."></textarea></div>');
    h.push('<div class="toolbar" style="margin:12px 0 0"><button class="btn primary" data-act="dict-submit">提交批改</button><button class="btn" data-act="dict-next">跳过这句</button></div></div>');
    $('#view').innerHTML = h.join('');
  }

  function renderDictResult() {
    var r = S.dict.result;
    var it = S.dict.items[S.dict.idx] || {};
    var h = [];
    h.push('<div class="toolbar"><button class="btn sm" data-act="dict-back">← 返回列表</button><span class="chip ' + (r.correct ? 'ok' : 'bad') + '">' + (r.correct ? '通过' : '再练一次') + '</span></div>');
    h.push('<div class="card"><div class="score-big">' + r.accuracy + '%</div><p class="sub">逐词准确率（≥ 90% 视为通过）· 第 ' + (S.dict.idx + 1) + ' / ' + S.dict.items.length + ' 句</p>');
    h.push('<div class="diff">');
    for (var i = 0; i < r.diff.length; i++) {
      var o = r.diff[i];
      if (o.op === 'ok') { h.push('<span class="ok">' + esc(o.word) + '</span>'); }
      else if (o.op === 'bad') { h.push('<span class="bad">' + esc(o.got || '∅') + ' → ' + esc(o.word) + '</span>'); }
      else if (o.op === 'miss') { h.push('<span class="miss">+' + esc(o.word) + '</span>'); }
      else { h.push('<span class="extra">-' + esc(o.got) + '</span>'); }
    }
    h.push('</div>');
    h.push('<div class="reveal" style="text-align:left"><div style="font-weight:600;line-height:1.8">' + esc(r.text) + '</div>' +
      (r.translation ? '<div class="example">' + esc(r.translation) + '</div>' : '') + '</div>');
    h.push('<div class="audio-row" style="justify-content:flex-start"><button class="btn" data-act="dict-play" data-slow="0">再听一遍</button><button class="btn primary" data-act="dict-next">下一句</button></div>');
    h.push('<p class="sub" style="margin:14px 0 0">漏写显示 +词，多写显示 -词，替换显示 “你写的 → 正确词”。</p></div>');
    $('#view').innerHTML = h.join('');
  }

  function dictNext() {
    var d = S.dict;
    d.result = null;
    d.idx += 1;
    if (d.idx >= d.items.length) {
      d.active = false;
      d.idx = 0;
      var h = [pageHead('听写完成', '本轮 ' + d.items.length + ' 句已完成，记录已保存。')];
      h.push(emptyBox('全部完成', '可以去听力或口语模块继续，或在统计里查看正确率。', '<div style="margin-top:16px"><button class="btn" data-act="dict-start">再来一轮</button> <button class="btn" data-go="listening">去练听力</button> <button class="btn" data-go="stats">查看统计</button></div>'));
      $('#view').innerHTML = h.join('');
      return;
    }
    renderDictRun();
  }

  /* ---------------- 听力 ---------------- */
  function viewListening() {
    if (S.listen.result) { renderListenResult(); return; }
    if (S.listen.current) { renderListenRun(); return; }
    if (!S.listen.items.length) {
      $('#view').innerHTML = loadingBox();
      return loadListenList();
    }
    renderListenList();
  }

  function loadListenList() {
    return api('/api/listening').then(function (j) {
      S.listen.items = j.items || [];
      if (S.route === 'listening') { renderListenList(); }
    });
  }

  function renderListenList() {
    var items = S.listen.items;
    var h = [pageHead('听力精听', '先听音频做题，提交后查看答案、解析、原文与译文。音频由本机离线语音合成。共 ' + items.length + ' 篇。')];
    h.push('<div class="list">');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      h.push('<div class="list-item" data-act="l-open" data-id="' + it.id + '"><div class="idx">' + (i + 1) + '</div><div class="li-main"><strong>' + esc(it.title) + '</strong><span>' + esc(it.level || 'CET-4') + ' · ' + esc(it.intro || '') + '</span></div>' +
        '<span class="chip ' + (it.best !== null && it.best !== undefined ? 'accent' : '') + '">' + (it.best !== null && it.best !== undefined ? Math.round(it.best) + ' 分' : '未练习') + '</span></div>');
    }
    h.push('</div>');
    $('#view').innerHTML = h.join('');
  }

  function renderListenRun() {
    var cur = S.listen.current;
    var h = [];
    h.push('<div class="toolbar"><button class="btn sm" data-act="l-back">← 返回列表</button><span class="chip accent">' + esc(cur.level || 'CET-4') + '</span></div>');
    h.push('<div class="card"><h2 style="margin-top:0">' + esc(cur.title) + '</h2><p class="sub">' + esc(cur.intro || '') + '</p>');
    h.push('<audio controls preload="none" style="width:100%" src="' + esc(cur.audio) + '"></audio>');
    h.push('</div>');
    h.push('<div class="card" style="margin-top:14px">');
    for (var i = 0; i < cur.questions.length; i++) {
      var q = cur.questions[i];
      h.push('<div class="qblock"><div class="qstem">' + (i + 1) + '. ' + esc(q.q) + '</div>');
      h.push(optionList(q.options, S.listen.answers[String(i)] || '', 'l-opt', String(i)));
      h.push('</div>');
    }
    h.push('<div class="toolbar" style="margin:6px 0 0"><button class="btn primary" data-act="l-submit">提交答案</button><span class="chip">已选 ' + Object.keys(S.listen.answers).length + ' / ' + cur.questions.length + '</span></div>');
    h.push('</div>');
    $('#view').innerHTML = h.join('');
  }

  function renderListenResult() {
    var r = S.listen.result;
    var cur = S.listen.current;
    var h = [];
    h.push('<div class="toolbar"><button class="btn sm" data-act="l-back">← 返回列表</button><span class="chip ' + (r.score === r.total ? 'ok' : '') + '">' + r.score + ' / ' + r.total + ' 分</span></div>');
    h.push('<div class="card"><div class="score-big">' + Math.round(r.score * 100 / Math.max(r.total, 1)) + '%</div><p class="sub">' + esc(cur.title) + '</p>');
    h.push('<div class="list">');
    for (var i = 0; i < r.details.length; i++) {
      var d = r.details[i];
      var q = cur.questions[d.index];
      h.push('<div class="list-item" style="cursor:default"><div class="idx" style="background:var(--' + (d.correct ? 'ok' : 'bad') + ');color:#fff">' + (d.correct ? '✓' : '✗') + '</div><div class="li-main"><strong style="font-weight:500">' + (d.index + 1) + '. ' + esc(q ? q.q : '') + '</strong>' +
        '<span>你的答案：' + esc(d.your || '未作答') + ' · 正确答案：' + esc(d.answer) + '</span>' +
        (d.explanation ? '<span style="display:block;margin-top:6px;color:var(--muted)">' + esc(d.explanation) + '</span>' : '') + '</div></div>');
    }
    h.push('</div>');
    h.push('<div class="audio-row" style="justify-content:flex-start;margin-top:14px"><button class="btn" data-act="l-audio">再听一遍</button><button class="btn" data-act="l-again">再做一次</button></div></div>');
    h.push('<h2>听力原文</h2><div class="card passage">' + esc(r.script) + '</div>');
    if (r.translation) { h.push('<h2>参考译文</h2><div class="card passage">' + esc(r.translation) + '</div>'); }
    $('#view').innerHTML = h.join('');
  }

  /* ---------------- 口语 ---------------- */
  function viewSpeaking() {
    if (S.speak.current) { renderSpeakRun(); return; }
    if (!S.speak.items.length) {
      $('#view').innerHTML = loadingBox();
      return loadSpeakList();
    }
    renderSpeakList();
  }

  function loadSpeakList() {
    return api('/api/speaking').then(function (j) {
      S.speak.items = j.items || [];
      if (S.route === 'speaking') { renderSpeakList(); }
    });
  }

  var SPEAK_KINDS = { read: '朗读', topic: '话题', qa: '问答' };

  function renderSpeakList() {
    var items = S.speak.items;
    var h = [pageHead('口语练习', '朗读、话题与问答三类。用浏览器录音、回放，然后按流利度与内容自评 1–5 星；录音只保留在本次页面内，评分与用时写入本地数据库。')];
    h.push('<div class="list">');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      h.push('<div class="list-item" data-act="s-open" data-idx="' + i + '"><div class="idx">' + (i + 1) + '</div><div class="li-main"><strong>' + esc(it.title) + '</strong><span>' +
        esc(SPEAK_KINDS[it.kind] || it.kind) + ' · 建议 ' + it.seconds + ' 秒 · 已练 ' + (it.attempts || 0) + ' 次' + (it.best ? ' · 最佳 ' + it.best + ' 星' : '') + '</span></div>' +
        '<span class="chip accent">打开</span></div>');
    }
    h.push('</div>');
    $('#view').innerHTML = h.join('');
  }

  function renderSpeakRun() {
    var cur = S.speak.current;
    var h = [];
    h.push('<div class="toolbar"><button class="btn sm" data-act="s-back">← 返回列表</button><span class="chip accent">' + esc(SPEAK_KINDS[cur.kind] || cur.kind) + '</span><span class="chip">建议 ' + cur.seconds + ' 秒</span><span class="chip" id="spkTimer">' + fmtClock(S.speak.left || cur.seconds) + '</span></div>');
    h.push('<div class="card"><h2 style="margin-top:0">' + esc(cur.title) + '</h2><div class="passage">' + esc(cur.prompt) + '</div>');
    h.push('<div class="audio-row" style="justify-content:flex-start"><button class="btn sm" data-act="s-tips">' + (S.speak.showTips ? '隐藏提示' : '查看提示') + '</button>' +
      '<button class="btn sm" data-act="s-sample">' + (S.speak.showSample ? '隐藏参考' : '参考表达') + '</button>' +
      '<button class="btn sm" data-act="s-timer-start">开始计时</button></div>');
    if (S.speak.showTips && cur.tips) { h.push('<p class="sub" style="margin:12px 0 0">' + esc(cur.tips) + '</p>'); }
    if (S.speak.showSample && cur.sample) { h.push('<div class="passage" style="margin-top:12px;background:var(--accent-soft)">' + esc(cur.sample) + '</div>'); }
    h.push('</div>');

    h.push('<div class="card" style="margin-top:14px"><h3>录音与回放</h3><div class="mic-row">');
    if (!S.speak.rec || S.speak.rec.state === 'inactive') {
      h.push('<button class="btn primary" data-act="s-rec-start">' + (S.speak.url ? '重新录音' : '开始录音') + '</button>');
    } else {
      h.push('<button class="btn danger" data-act="s-rec-stop"><span class="rec-dot"></span> 停止录音</button>');
    }
    h.push('<span class="chip">首次使用需允许麦克风权限</span></div>');
    if (S.speak.url) { h.push('<audio controls src="' + S.speak.url + '" style="width:100%;margin-top:12px"></audio>'); }
    h.push('</div>');

    h.push('<div class="card" style="margin-top:14px"><h3>自评</h3><div class="toolbar">');
    for (var i = 1; i <= 5; i++) {
      h.push('<button class="btn ' + (S.speak.rating >= i ? 'primary' : '') + '" data-act="s-rate" data-rating="' + i + '">' + i + ' 星</button>');
    }
    h.push('<span class="chip">' + (S.speak.rating ? '已选 ' + S.speak.rating + ' 星' : '请选择 1–5 星') + '</span></div>');
    h.push('<div class="field" style="margin-top:10px"><label>复盘笔记（可选）</label><textarea id="spkNote" style="min-height:80px" placeholder="例如：卡在第二个论点，下次先列提纲">' + esc(S.speak.note || '') + '</textarea></div>');
    h.push('<div class="toolbar" style="margin:12px 0 0"><button class="btn primary" data-act="s-save">保存记录</button><button class="btn" data-act="s-back">退出</button></div></div>');
    $('#view').innerHTML = h.join('');
  }

  function speakCleanup() {
    if (S.speak.timer) { clearInterval(S.speak.timer); S.speak.timer = null; }
    if (S.speak.rec && S.speak.rec.state !== 'inactive') { try { S.speak.rec.stop(); } catch (e) {} }
    if (S.speak.stream) { S.speak.stream.getTracks().forEach(function (t) { t.stop(); }); S.speak.stream = null; }
    S.speak.rec = null;
    if (S.speak.url) { URL.revokeObjectURL(S.speak.url); S.speak.url = null; }
    S.speak.chunks = [];
  }

  function startSpeakTimer() {
    var left = S.speak.left || S.speak.current.seconds;
    if (S.speak.timer) { clearInterval(S.speak.timer); }
    S.speak.timer = setInterval(function () {
      left -= 1;
      S.speak.left = left;
      var el = $('#spkTimer');
      if (el) { el.textContent = fmtClock(Math.max(0, left)); }
      if (left <= 0) {
        clearInterval(S.speak.timer);
        S.speak.timer = null;
        toast('时间到，录音继续也可以', 'ok');
      }
    }, 1000);
  }

  function startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast('此浏览器不支持录音，可直接进行自评', 'err');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      S.speak.stream = stream;
      S.speak.chunks = [];
      S.speak.startedAt = Date.now();
      var rec = new MediaRecorder(stream);
      S.speak.rec = rec;
      rec.ondataavailable = function (e) { if (e.data && e.data.size) { S.speak.chunks.push(e.data); } };
      rec.onstop = function () {
        if (S.speak.stream) { S.speak.stream.getTracks().forEach(function (t) { t.stop(); }); S.speak.stream = null; }
        var blob = new Blob(S.speak.chunks, { type: rec.mimeType || 'audio/webm' });
        S.speak.chunks = [];
        if (S.speak.url) { URL.revokeObjectURL(S.speak.url); }
        S.speak.url = URL.createObjectURL(blob);
        if (S.route === 'speaking') { renderSpeakRun(); }
      };
      rec.start();
      if (S.route === 'speaking') { renderSpeakRun(); }
    }).catch(function (err) {
      toast('无法访问麦克风：' + err.message, 'err');
    });
  }

  function stopRecording() {
    if (S.speak.rec && S.speak.rec.state !== 'inactive') { S.speak.rec.stop(); }
  }

  /* ---------------- 模拟卷 ---------------- */
  function viewPapers() {
    if (S.paper.result) { renderPaperResult(); return; }
    if (S.paper.current) {
      renderPaperRun();
      if (!S.paper.timer && S.paper.remaining > 0) { startPaperTimer(); }
      return;
    }
    if (!S.paper.items || !S.paper.items.length) {
      $('#view').innerHTML = loadingBox();
      return loadPaperList();
    }
    renderPaperList();
  }

  function loadPaperList() {
    return api('/api/papers').then(function (j) {
      S.paper.items = j.items || [];
      if (S.route === 'papers') { renderPaperList(); }
    });
  }

  function renderPaperList() {
    var items = S.paper.items;
    var h = [pageHead('模拟考试', '按考试节奏完成整套试卷，交卷后客观题自动判分，写作与翻译按参考范文自评。共 ' + items.length + ' 套。')];
    h.push('<div class="list">');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      h.push('<div class="list-item" data-act="p-open" data-id="' + it.id + '"><div class="idx">卷</div><div class="li-main"><strong>' + esc(it.title) + '</strong><span>' +
        Math.round(it.duration_sec / 60) + ' 分钟 · 已做 ' + (it.attempts || 0) + ' 次' + (it.best !== null && it.best !== undefined ? ' · 最高 ' + it.best + ' 分' : '') + '</span></div>' +
        '<span class="chip accent">开始</span></div>');
    }
    h.push('</div>');
    $('#view').innerHTML = h.join('');
  }

  function startPaperTimer() {
    if (S.paper.timer) { clearInterval(S.paper.timer); }
    S.paper.timer = setInterval(function () {
      S.paper.remaining -= 1;
      var el = $('#paperTimer');
      if (el) {
        el.textContent = fmtClock(Math.max(0, S.paper.remaining));
        el.className = 'timer' + (S.paper.remaining <= 300 ? ' warn' : '');
      }
      if (S.paper.remaining <= 0) {
        clearInterval(S.paper.timer);
        S.paper.timer = null;
        toast('考试时间到，请尽快交卷', 'err');
      }
    }, 1000);
  }

  function renderPaperRun() {
    var p = S.paper.current;
    var h = [];
    h.push('<div class="paper-bar"><strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.title) + '</strong><span style="flex:1"></span>' +
      '<span id="paperTimer" class="timer' + (S.paper.remaining <= 300 ? ' warn' : '') + '">' + fmtClock(Math.max(0, S.paper.remaining)) + '</span>' +
      '<button class="btn primary sm" data-act="p-submit">交卷</button><button class="btn sm" data-act="p-exit">退出</button></div>');
    if (p.intro) { h.push('<div class="card"><p class="sub" style="margin:0">' + esc(p.intro) + '</p></div>'); }
    for (var si = 0; si < p.sections.length; si++) {
      var sec = p.sections[si];
      h.push('<section><h2>' + esc(sec.title) + '</h2>');
      if (sec.intro) { h.push('<p class="sub">' + esc(sec.intro) + '</p>'); }
      h.push('<div class="card">');
      if (sec.audio) { h.push('<audio controls preload="none" style="width:100%" src="' + esc(sec.audio) + '"></audio>'); }
      if (sec.passage) { h.push('<div class="passage" style="margin-top:' + (sec.audio ? '12px' : '0') + '">' + esc(sec.passage) + '</div>'); }
      if (sec.prompt) { h.push('<div class="passage" style="white-space:pre-wrap">' + esc(sec.prompt) + '</div>'); }
      for (var qi = 0; qi < sec.questions.length; qi++) {
        var q = sec.questions[qi];
        h.push('<div class="qblock"><div class="qstem">' + (qi + 1) + '. ' + esc(q.stem) + '</div>');
        h.push(optionList(q.options, S.paper.answers[q.id] || '', 'p-opt', q.id));
        h.push('</div>');
      }
      if (sec.self_score > 0) {
        h.push('<div class="qblock"><div class="field"><label>写作 / 翻译自评：对照参考范文给自己打分（满分 ' + sec.self_score + ' 分）</label>' +
          '<input type="number" min="0" max="' + sec.self_score + '" step="0.5" data-role="self" data-si="' + si + '" value="' + (S.paper.self[String(si)] || 0) + '"></div></div>');
      }
      h.push('</div></section>');
    }
    h.push('<div class="toolbar" style="justify-content:center;margin-top:20px"><button class="btn primary" data-act="p-submit">交卷并查看成绩</button></div>');
    h.push('<p class="sub" style="text-align:center">答案保存在当前页面，交卷前请勿关闭标签页。</p>');
    $('#view').innerHTML = h.join('');
  }

  function renderPaperResult() {
    var r = S.paper.result;
    var p = S.paper.current;
    var percent = r.total > 0 ? Math.round(r.score * 100 / r.total) : 0;
    var h = [];
    h.push('<div class="toolbar"><button class="btn sm" data-act="p-back">← 返回列表</button><span class="chip">' + esc(p ? p.title : '') + '</span></div>');
    h.push('<div class="card" style="text-align:center"><div class="score-big">' + percent + '%</div><p class="sub" style="margin:4px 0 0">得分 ' + r.score + ' / ' + r.total + ' 分</p>' +
      '<div class="audio-row"><button class="btn" data-act="p-again">再做一次</button><button class="btn" data-act="p-back">返回列表</button></div></div>');

    var bySection = {};
    for (var i = 0; i < r.details.length; i++) {
      var d = r.details[i];
      if (d.type === 'self') {
        bySection[d.section + '|self'] = d;
      } else {
        var key = String(d.id).split('-')[0];
        if (!bySection[key]) { bySection[key] = []; }
        bySection[key].push(d);
      }
    }
    for (var si = 0; si < r.sections.length; si++) {
      var meta = r.sections[si];
      var mcs = bySection[String(si)] || [];
      var selfD = bySection[meta.title + '|self'];
      h.push('<h2>' + esc(meta.title) + '</h2><div class="card">');
      if (mcs.length) {
        var ok = 0;
        for (var mi = 0; mi < mcs.length; mi++) { if (mcs[mi].correct) { ok += 1; } }
        h.push('<p class="sub">客观题 ' + ok + ' / ' + mcs.length + ' 正确</p><div class="list">');
        for (var mi2 = 0; mi2 < mcs.length; mi2++) {
          var dd = mcs[mi2];
          h.push('<div class="list-item" style="cursor:default"><div class="idx" style="background:var(--' + (dd.correct ? 'ok' : 'bad') + ');color:#fff">' + (dd.correct ? '✓' : '✗') + '</div><div class="li-main"><strong style="font-weight:500">第 ' + (mi2 + 1) + ' 题</strong><span>你的答案 ' + esc(dd.your || '未答') + ' · 正确 ' + esc(dd.answer) + ' · ' + dd.score + ' 分</span>' +
            (dd.explanation ? '<span style="display:block;margin-top:4px">' + esc(dd.explanation) + '</span>' : '') + '</div></div>');
        }
        h.push('</div>');
      }
      if (selfD && selfD.self_total) {
        h.push('<p class="sub" style="margin-top:12px">自评 ' + selfD.self_score + ' / ' + selfD.self_total + ' 分</p>');
      }
      if (meta.sample) {
        h.push('<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--accent)">查看参考范文</summary><div class="passage" style="margin-top:10px;white-space:pre-wrap">' + esc(meta.sample) + '</div></details>');
      }
      h.push('</div>');
    }
    $('#view').innerHTML = h.join('');
  }

  /* ---------------- 统计 ---------------- */
  function viewStats() {
    return Promise.all([refreshMeta(), api('/api/stats')]).then(function (res) {
      var st = res[1];
      S.statsData = st;
      if (S.route !== 'stats') { return; }
      var m = S.meta;
      var h = [pageHead('学习统计', '所有记录保存在本机 data/cet4.db，关闭浏览器或重启电脑都不会丢失。')];
      h.push('<div class="grid c4">');
      h.push(statCard(st.totals.word_reviews, '单词复习次数'));
      h.push(statCard(st.word_accuracy + '%', '单词正确率'));
      h.push(statCard(st.dictation.accuracy + '%', '听写正确率（' + st.dictation.total + ' 次）'));
      h.push(statCard(st.listening.accuracy + '%', '听力正确率（' + st.listening.total + ' 题）'));
      h.push('</div>');

      h.push('<div class="grid c2" style="margin-top:14px"><div class="card"><h3>连续打卡 ' + st.streak + ' 天</h3><p class="sub" style="margin:0 0 10px">最近 8 周打卡情况，深色为已打卡。</p><div class="calendar">');
      for (var i = 0; i < st.calendar.length; i++) {
        var c = st.calendar[i];
        h.push('<i class="' + (c.checked ? 'on' : '') + (c.date === m.date ? ' today' : '') + '" title="' + esc(c.date) + '"></i>');
      }
      h.push('</div></div>');

      h.push('<div class="card"><h3>词汇记忆状态</h3>');
      var ws = st.words_by_state || {};
      var total = m.words.total || 1;
      h.push(barLine('已掌握', ws.mastered || 0, total, 'ok'));
      h.push(barLine('学习中', ws.learning || 0, total, 'accent'));
      h.push(barLine('未学习', ws.new || 0, total, ''));
      h.push('<p class="sub" style="margin:12px 0 0">今日新词 ' + m.words.new_today + ' / ' + ((m.settings && m.settings.daily_new) || 20) + '，到期复习 ' + m.words.due + ' 个。</p>');
      h.push('</div></div>');

      h.push('<h2>最近 28 天练习量（单词 + 复习 + 听写 + 听力 + 口语）</h2><div class="card">' + barsHtml(st.days, 'total') + '</div>');

      h.push('<h2>最近的模拟卷</h2>');
      if (!st.papers.length) {
        h.push(emptyBox('还没有模拟卷记录', '完成一套模拟卷后，成绩会出现在这里。', '<div style="margin-top:14px"><button class="btn" data-go="papers">去模拟考试</button></div>'));
      } else {
        h.push('<div class="list">');
        for (var pi = 0; pi < st.papers.length; pi++) {
          var pp = st.papers[pi];
          h.push('<div class="list-item" style="cursor:default"><div class="idx">' + (pi + 1) + '</div><div class="li-main"><strong>' + pp.score + ' / ' + pp.total + ' 分</strong><span>' + new Date(pp.ts * 1000).toLocaleString() + '</span></div></div>');
        }
        h.push('</div>');
      }
      $('#view').innerHTML = h.join('');
    });
  }

  function statCard(value, label) {
    return '<div class="card stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }
  function barLine(label, val, total, cls) {
    var p = Math.min(100, Math.round(val * 100 / total));
    return '<div style="margin-top:10px"><div class="progress-line"><span style="width:64px">' + esc(label) + '</span><span class="progress"><i style="width:' + p + '%"></i></span><span>' + val + '</span></div></div>';
  }

  /* ---------------- 导入与设置 ---------------- */
  var IMPORT_KINDS = [['words', '单词'], ['dictation', '听写'], ['listening', '听力'], ['paper', '模拟卷']];

  function viewImport() {
    return api('/api/settings').then(function (j) {
      if (S.route !== 'import') { return; }
      var cfg = j.settings || {};
      var h = [pageHead('题库与设置', '导入你有权使用的题库文件；没有题库时，平台自带的原创内容也可以直接练习。所有数据保存在本机。')];
      h.push('<div class="grid c2"><div class="card"><h3>学习设置</h3>');
      h.push('<div class="grid c3"><div class="field"><label>每日新词</label><input id="setNew" type="number" min="1" max="200" value="' + (cfg.daily_new || 20) + '"></div>' +
        '<div class="field"><label>每日复习上限</label><input id="setReview" type="number" min="1" max="500" value="' + (cfg.daily_review || 60) + '"></div>' +
        '<div class="field"><label>语速（词/分钟）</label><input id="setSpeed" type="number" min="80" max="220" value="' + (cfg.speed || 145) + '"></div></div>');
      h.push('<div class="toolbar" style="margin:14px 0 0"><button class="btn primary" data-act="i-settings">保存设置</button><span class="chip">修改后即时生效</span></div></div>');

      h.push('<div class="card"><h3>数据导出与备份</h3><p class="sub">导出词库与打卡记录为 JSON。完整数据库位于应用目录 data/cet4.db，可直接复制备份。</p>' +
        '<div class="toolbar" style="margin:0"><button class="btn" data-act="i-export">导出全部数据</button><span class="chip">/api/export</span></div></div></div>');

      h.push('<h2>导入题库</h2><div class="card">');
      h.push('<div class="toolbar"><div class="segmented">');
      for (var i = 0; i < IMPORT_KINDS.length; i++) {
        h.push('<button data-act="i-kind" data-kind="' + IMPORT_KINDS[i][0] + '" class="' + (S.imp.kind === IMPORT_KINDS[i][0] ? 'on' : '') + '">' + IMPORT_KINDS[i][1] + '</button>');
      }
      h.push('</div><button class="btn sm" data-act="i-template">填入示例格式</button><button class="btn sm" data-act="i-file">选择文件</button>');
      h.push('<input id="impFile" type="file" accept=".json,.csv,.txt" hidden></div>');
      h.push('<div class="field"><label>粘贴 JSON 或 CSV 内容（单词支持 CSV；其余类型使用 JSON）</label><textarea id="impText" style="min-height:180px" placeholder="点击“填入示例格式”查看字段，或直接把导出/整理好的文件内容粘贴在这里">' + esc(S.imp.text || '') + '</textarea></div>');
      h.push('<div class="toolbar" style="margin:12px 0 0"><button class="btn primary" data-act="i-import">导入到本地题库</button><span class="chip" id="impHint">' + importHint(S.imp.kind) + '</span></div>');
      h.push('<div id="impResult">' + (S.imp.result || '') + '</div>');
      h.push('</div>');

      h.push('<h2>题库来源与版权说明</h2><div class="card"><ul style="margin:0;padding-left:20px;line-height:1.9">' +
        '<li>内置 2089 个四级词汇来自本机用户已有的开源词表（MIT 仓库 cet4-dictation），释义与词性由该词表提供。</li>' +
        '<li>听力 4 篇、听写 30 句、口语 10 题、模拟卷 1 套均为本项目原创示例，不是官方真题，也不冒充真题。</li>' +
        '<li>听力与单词发音由本机 espeak-ng 离线合成，不联网、不调用第三方服务。</li>' +
        '<li>如需真题，请通过官方出版渠道获得授权后，按上面的格式导入自用。</li></ul></div>');
      $('#view').innerHTML = h.join('');
    });
  }

  function importHint(kind) {
    if (kind === 'words') { return '字段：word / pos / meaning / example'; }
    if (kind === 'dictation') { return '字段：text / translation / hint'; }
    if (kind === 'listening') { return '字段：title / turns / questions / translation'; }
    return '字段：title / duration_sec / sections';
  }

  function importSample(kind) {
    if (kind === 'words') {
      return [{ word: 'abandon', pos: 'v.', meaning: '放弃；抛弃', example: 'They had to abandon the car in the snow.', example_cn: '他们不得不把车丢在雪地里。' }];
    }
    if (kind === 'dictation') {
      return [{ text: 'The library will close early during the holiday.', translation: '假期期间图书馆会提前闭馆。', hint: '校园 · 8 词' }];
    }
    if (kind === 'listening') {
      return [{
        title: '短对话：借笔记', level: 'CET-4', intro: '校园场景短对话。',
        turns: [{ s: 'M', text: 'Could I borrow your notes from yesterday? I missed the class.' }, { s: 'W', text: 'Sure, but I need them back before Friday.' }],
        questions: [{ q: 'What does the man want to borrow?', options: ['A notebook', 'Class notes', 'A textbook', 'A pen'], answer: 'B', explanation: '男士说 borrow your notes，因此是课堂笔记。' }],
        translation: '男：我能借你昨天的笔记吗？我缺了一节课。女：可以，但周五前要还给我。'
      }];
    }
    return [{
      title: '自定义模拟卷', duration_sec: 3600, intro: '导入的练习卷。', kind: 'imported',
      sections: [{ title: 'Part I 词汇选择', type: 'reading', intro: '选择最合适的答案。', passage: '', prompt: '',
        questions: [{ stem: 'He was ______ to hear the news.', options: ['delighted', 'delighting', 'delight', 'delights'], answer: 'A', explanation: 'be delighted to do 表示“很高兴做某事”。' }] }]
    }];
  }

  /* ---------------- 帮助 ---------------- */
  function showHelp() {
    openModal('<h3>使用说明</h3>' +
      '<p class="sub">本地离线运行：Python 标准库后端 + SQLite，数据在 <span class="mono">data/cet4.db</span>。</p>' +
      '<ul style="line-height:2;padding-left:20px;margin:0">' +
      '<li>单词页：<span class="kbd">空格</span> 显示释义，<span class="kbd">1</span>–<span class="kbd">4</span> 评价，<span class="kbd">←</span> / <span class="kbd">→</span> 切换。</li>' +
      '<li>听写：可正常或慢速播放；提交后按词对比，漏写 +词、多写 -词、替换显示“你写的 → 正确”。</li>' +
      '<li>听力：先做题再看原文；音频可以重听。</li>' +
      '<li>口语：需要允许麦克风权限；录音只在页面内回放，不写入数据库。</li>' +
      '<li>模拟卷：计时交卷，客观题自动判分，写作与翻译按范文自评。</li>' +
      '<li>每日首次练习会自动打卡，也可以点右上角“打卡”。</li>' +
      '</ul>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-act="modal-close">知道了</button></div>');
  }

  /* ---------------- 动作处理 ---------------- */
  function doCheckin() {
    return api('/api/checkin', {}).then(function (j) {
      return refreshMeta().then(function () {
        toast('打卡成功，连续 ' + j.streak + ' 天', 'ok');
        if (S.route === 'home') { viewHome(); }
      });
    });
  }

  function revealWord() {
    if (S.word.spell) { return; }
    if (!S.word.revealed) { S.word.revealed = true; renderWords(); }
  }

  function rateWord(rating) {
    var st = S.word;
    if (st.busy) { return; }
    var q = st.items[st.idx];
    if (!q) { return; }
    st.busy = true;
    api('/api/word/review', { id: q.id, rating: rating, mode: st.mode === 'review' ? 'review' : 'study' }).then(function () {
      st.busy = false;
      refreshMeta().catch(function () {});
      wordAdvance(1);
    }).catch(function (err) {
      st.busy = false;
      toast(err.message, 'err');
    });
  }

  function submitSpell() {
    var st = S.word;
    var q = st.items[st.idx];
    var input = $('#spellInput');
    if (!q || !input) { return; }
    var val = (input.value || '').trim();
    if (!val) { toast('先写下你听到的单词', 'err'); return; }
    st.busy = true;
    api('/api/word/spell', { id: q.id, answer: val }).then(function (j) {
      st.busy = false;
      st.spellResult = j;
      refreshMeta().catch(function () {});
      renderWords();
    }).catch(function (err) { st.busy = false; toast(err.message, 'err'); });
  }

  function openPaper(id) {
    return api('/api/papers/' + id).then(function (j) {
      S.paper.current = j;
      S.paper.answers = {};
      S.paper.self = {};
      S.paper.result = null;
      S.paper.remaining = j.duration_sec || 5400;
      renderPaperRun();
      startPaperTimer();
      window.scrollTo(0, 0);
    });
  }

  function submitPaper() {
    var p = S.paper.current;
    if (!p) { return; }
    var unanswered = 0;
    for (var si = 0; si < p.sections.length; si++) {
      var qs = p.sections[si].questions;
      for (var qi = 0; qi < qs.length; qi++) {
        if (!S.paper.answers[qs[qi].id]) { unanswered += 1; }
      }
    }
    var msg = unanswered ? '还有 ' + unanswered + ' 道客观题未作答，确定交卷吗？未作答按 0 分计。' : '交卷后立即判分并保存本次成绩。';
    return confirmBox('提交试卷', msg, '交卷').then(function (ok) {
      if (!ok) { return; }
      var duration = Math.max(0, (p.duration_sec || 5400) - S.paper.remaining);
      return api('/api/papers/submit', { id: p.id, answers: S.paper.answers, self_scores: S.paper.self, duration: duration }).then(function (j) {
        S.paper.result = j;
        if (S.paper.timer) { clearInterval(S.paper.timer); S.paper.timer = null; }
        renderPaperResult();
        refreshMeta().catch(function () {});
        window.scrollTo(0, 0);
      });
    });
  }

  function saveSettings() {
    var body = {
      daily_new: parseInt(($('#setNew') || {}).value, 10) || 20,
      daily_review: parseInt(($('#setReview') || {}).value, 10) || 60,
      speed: parseInt(($('#setSpeed') || {}).value, 10) || 145
    };
    return api('/api/settings', body).then(function () {
      toast('设置已保存', 'ok');
      refreshMeta().catch(function () {});
    });
  }

  function handleImport() {
    var text = (($('#impText') || {}).value || '').trim();
    if (!text) { toast('先粘贴要导入的内容', 'err'); return; }
    var format = (text.charAt(0) === '[' || text.charAt(0) === '{') ? 'json' : 'csv';
    return api('/api/import', { kind: S.imp.kind, format: format, content: text }).then(function (j) {
      var html = '<div class="toolbar" style="margin-top:12px"><span class="chip ok">导入 ' + j.imported + ' 条</span>' +
        (j.skipped ? '<span class="chip">更新/跳过 ' + j.skipped + ' 条</span>' : '') +
        (j.errors && j.errors.length ? '<span class="chip bad">' + j.errors.length + ' 条有问题</span>' : '') + '</div>';
      if (j.errors && j.errors.length) {
        html += '<div class="passage" style="margin-top:8px">' + esc(j.errors.join('\n')) + '</div>';
      }
      S.imp.result = html;
      var box = $('#impResult');
      if (box) { box.innerHTML = html; }
      toast('导入完成：新增 ' + j.imported + ' 条', 'ok');
      refreshMeta().catch(function () {});
    });
  }

  function exportAll() {
    return fetch('/api/export?kind=all').then(function (r) { return r.json(); }).then(function (j) {
      var blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'cet4-export-' + (S.meta ? S.meta.date : 'data') + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast('已导出 JSON', 'ok');
    });
  }

  function handleAction(act, el) {
    var q, id, idx;
    switch (act) {
      case 'checkin': return doCheckin();
      case 'reload': return render();
      case 'word-mode': return loadWords(el.getAttribute('data-mode'));
      case 'word-reveal': revealWord(); return;
      case 'word-rate': rateWord(parseInt(el.getAttribute('data-rating'), 10)); return;
      case 'word-prev': wordAdvance(-1); return;
      case 'word-next': wordAdvance(1); return;
      case 'word-restart': S.word.done = false; return loadWords(S.word.mode);
      case 'word-fav':
        q = S.word.items[S.word.idx];
        if (!q) { return; }
        return api('/api/word/favorite', { id: q.id }).then(function (j) {
          q.favorite = j.favorite;
          renderWords();
        });
      case 'word-audio':
        q = S.word.items[S.word.idx];
        if (!q) { return; }
        return playAudio('/api/audio/word?word=' + encodeURIComponent(q.word) + '&speed=' + (el.getAttribute('data-speed') || '120'));
      case 'word-example':
        q = S.word.items[S.word.idx];
        if (q && q.example) { speakText(q.example); }
        return;
      case 'word-spell-toggle':
        S.word.spell = !S.word.spell;
        S.word.spellResult = null;
        renderWords();
        return;
      case 'word-spell-submit': submitSpell(); return;

      case 'dict-start': S.dict.active = true; S.dict.idx = 0; S.dict.result = null; renderDictRun(); return;
      case 'dict-open':
        S.dict.idx = parseInt(el.getAttribute('data-idx'), 10) || 0;
        S.dict.active = true;
        S.dict.result = null;
        renderDictRun();
        return;
      case 'dict-back': S.dict.active = false; S.dict.result = null; renderDictList(); return;
      case 'dict-play':
        q = S.dict.items[S.dict.idx];
        if (q) { playAudio('/api/audio/dictation/' + q.id + (el.getAttribute('data-slow') === '1' ? '?slow=1' : '')); }
        return;
      case 'dict-submit':
        q = S.dict.items[S.dict.idx];
        if (!q || !$('#dictInput')) { return; }
        if (!($('#dictInput').value || '').trim()) { toast('先写下你听到的句子', 'err'); return; }
        return api('/api/dictation/answer', { id: q.id, answer: $('#dictInput').value }).then(function (j) {
          S.dict.result = j;
          q.attempts = (q.attempts || 0) + 1;
          if (j.correct) { q.last_correct = 1; }
          renderDictResult();
          refreshMeta().catch(function () {});
        });
      case 'dict-next': dictNext(); return;

      case 'l-open':
        id = parseInt(el.getAttribute('data-id'), 10);
        return api('/api/listening/' + id).then(function (j) {
          S.listen.current = j;
          S.listen.answers = {};
          S.listen.result = null;
          renderListenRun();
          window.scrollTo(0, 0);
        });
      case 'l-opt': {
        var qid = el.getAttribute('data-qid');
        S.listen.answers[qid] = el.getAttribute('data-o');
        var block = el.closest ? el.closest('.qblock') : null;
        if (block) {
          $$('.option', block).forEach(function (x) { x.classList.remove('sel'); });
          el.classList.add('sel');
          var cnt = Object.keys(S.listen.answers).length;
          var chip = $$('#view .chip').filter(function (c) { return c.textContent.indexOf('已选') === 0; })[0];
          if (chip) { chip.textContent = '已选 ' + cnt + ' / ' + S.listen.current.questions.length; }
        }
        return;
      }
      case 'l-submit':
        if (!S.listen.current) { return; }
        if (!Object.keys(S.listen.answers).length) { toast('至少先选一个答案', 'err'); return; }
        return api('/api/listening/submit', { id: S.listen.current.id, answers: S.listen.answers }).then(function (j) {
          S.listen.result = j;
          renderListenResult();
          refreshMeta().catch(function () {});
          window.scrollTo(0, 0);
        });
      case 'l-back': S.listen.current = null; S.listen.result = null; renderListenList(); return;
      case 'l-again': S.listen.answers = {}; S.listen.result = null; renderListenRun(); return;
      case 'l-audio': if (S.listen.current) { playAudio(S.listen.current.audio); } return;

      case 's-open':
        speakCleanup();
        S.speak.current = S.speak.items[parseInt(el.getAttribute('data-idx'), 10)];
        S.speak.rating = 0;
        S.speak.note = '';
        S.speak.showTips = false;
        S.speak.showSample = false;
        S.speak.left = S.speak.current.seconds;
        renderSpeakRun();
        window.scrollTo(0, 0);
        return;
      case 's-back':
        speakCleanup();
        S.speak.current = null;
        render();
        return;
      case 's-tips': S.speak.showTips = !S.speak.showTips; renderSpeakRun(); return;
      case 's-sample': S.speak.showSample = !S.speak.showSample; renderSpeakRun(); return;
      case 's-timer-start': startSpeakTimer(); return;
      case 's-rate': S.speak.rating = parseInt(el.getAttribute('data-rating'), 10); renderSpeakRun(); return;
      case 's-rec-start': startRecording(); return;
      case 's-rec-stop': stopRecording(); return;
      case 's-save': {
        if (!S.speak.current) { return; }
        var noteEl = $('#spkNote');
        S.speak.note = noteEl ? noteEl.value : S.speak.note;
        var secs = S.speak.startedAt ? Math.round((Date.now() - S.speak.startedAt) / 1000) : Math.max(0, S.speak.current.seconds - S.speak.left);
        return api('/api/speaking/log', { id: S.speak.current.id, rating: S.speak.rating || 3, seconds: secs, note: S.speak.note }).then(function () {
          toast('口语记录已保存', 'ok');
          speakCleanup();
          S.speak.current = null;
          return loadSpeakList();
        });
      }

      case 'p-open':
        id = parseInt(el.getAttribute('data-id'), 10);
        return openPaper(id);
      case 'p-opt': {
        qid = el.getAttribute('data-qid');
        S.paper.answers[qid] = el.getAttribute('data-o');
        var blk = el.closest ? el.closest('.qblock') : null;
        if (blk) {
          $$('.option', blk).forEach(function (x) { x.classList.remove('sel'); });
          el.classList.add('sel');
        }
        return;
      }
      case 'p-submit': return submitPaper();
      case 'p-exit':
        return confirmBox('退出考试', '当前作答不会保存，确定退出吗？', '退出').then(function (ok) {
          if (!ok) { return; }
          if (S.paper.timer) { clearInterval(S.paper.timer); S.paper.timer = null; }
          S.paper.current = null;
          S.paper.result = null;
          renderPaperList();
        });
      case 'p-back':
        if (S.paper.timer) { clearInterval(S.paper.timer); S.paper.timer = null; }
        S.paper.current = null;
        S.paper.result = null;
        return loadPaperList();
      case 'p-again':
        if (!S.paper.current) { return; }
        return openPaper(S.paper.current.id);

      case 'i-kind': S.imp.kind = el.getAttribute('data-kind'); S.imp.result = ''; viewImport(); return;
      case 'i-template': {
        var t = $('#impText');
        if (t) { t.value = JSON.stringify(importSample(S.imp.kind), null, 2); S.imp.text = t.value; }
        return;
      }
      case 'i-file': if ($('#impFile')) { $('#impFile').click(); } return;
      case 'i-import': return handleImport();
      case 'i-export': return exportAll();
      case 'i-settings': return saveSettings();

      default:
        return;
    }
  }

  /* ---------------- 事件与路由 ---------------- */
  function onClick(e) {
    var t = e.target;
    if (t === $('#modal')) { closeModal(false); return; }
    var actEl = t.closest ? t.closest('[data-act]') : null;
    var act = actEl ? actEl.getAttribute('data-act') : '';
    if (act === 'modal-ok') { closeModal(true); return; }
    if (act === 'modal-cancel' || act === 'modal-close') { closeModal(false); return; }
    var g = t.closest ? t.closest('[data-go]') : null;
    if (g) { e.preventDefault(); go(g.getAttribute('data-go')); return; }
    if (!actEl) { return; }
    e.preventDefault();
    Promise.resolve(handleAction(act, actEl)).catch(function (err) {
      toast(err && err.message ? err.message : '操作失败', 'err');
    });
  }

  function onInput(e) {
    var t = e.target;
    if (t.id === 'impText') { S.imp.text = t.value; }
    if (t.id === 'spkNote') { S.speak.note = t.value; }
    if (t.getAttribute && t.getAttribute('data-role') === 'self') {
      var si = t.getAttribute('data-si');
      S.paper.self[si] = parseFloat(t.value || '0') || 0;
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t.id === 'impFile' && t.files && t.files[0]) {
      var f = t.files[0];
      var reader = new FileReader();
      reader.onload = function () {
        var txt = String(reader.result || '');
        var ta = $('#impText');
        if (ta) { ta.value = txt; S.imp.text = txt; }
        toast('已读取文件 ' + f.name + '，点击导入即可', 'ok');
      };
      reader.readAsText(f);
    }
  }

  function onKey(e) {
    if (S.route !== 'words') { return; }
    var tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Enter' && e.target.id === 'spellInput') { e.preventDefault(); submitSpell(); }
      return;
    }
    if (!S.word.spell) {
      if (e.key === ' ') { e.preventDefault(); revealWord(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); wordAdvance(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); wordAdvance(-1); }
      else if (e.key >= '1' && e.key <= '4' && S.word.revealed) { rateWord(parseInt(e.key, 10) - 1); }
    }
  }

  function applyTheme() {
    var t = localStorage.getItem('cet4.theme');
    if (t === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); }
    else { document.documentElement.removeAttribute('data-theme'); }
  }
  function toggleTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (dark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('cet4.theme', 'light'); }
    else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('cet4.theme', 'dark'); }
  }

  var VIEWS = {
    home: viewHome,
    words: viewWords,
    listening: viewListening,
    dictation: viewDictation,
    speaking: viewSpeaking,
    papers: viewPapers,
    stats: viewStats,
    import: viewImport
  };
  var TITLES = {
    home: '首页', words: '背单词', listening: '听力精听', dictation: '听写训练',
    speaking: '口语练习', papers: '模拟考试', stats: '学习统计', import: '题库与设置'
  };

  function render() {
    var name = (location.hash || '#/home').replace(/^#\/?/, '').split('?')[0];
    if (!VIEWS[name]) { name = 'home'; }
    if (S.route === 'speaking' && name !== 'speaking') { speakCleanup(); }
    stopAllTimers();
    S.route = name;
    document.title = TITLES[name] + ' · 英语四级备考';
    $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-route') === name); });
    $('#view').innerHTML = loadingBox();
    Promise.resolve(VIEWS[name]()).catch(function (err) {
      if (S.route !== name) { return; }
      $('#view').innerHTML = '<div class="empty"><b>加载失败</b>' + esc(err.message || err) +
        '<div style="margin-top:14px"><button class="btn" data-act="reload">重试</button></div></div>';
    });
  }

  function init() {
    applyTheme();
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#helpBtn').addEventListener('click', showHelp);
    $('#checkinBtn').addEventListener('click', function () {
      doCheckin().catch(function (err) { toast(err.message, 'err'); });
    });
    window.addEventListener('hashchange', render);
    if (!location.hash) { history.replaceState(null, '', '#/home'); }
    render();
    refreshMeta().catch(function () {});
  }

  init();
})();
