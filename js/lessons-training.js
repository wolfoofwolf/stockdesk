/* lessons-training.js — 教材訓練室：keep / counterexamples / never-learn */
(function (global) {
  'use strict';

  var PASS = 90;
  var cache = { summary: null, rubric: null, never: null, buckets: {} };

  function bust(url) {
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + '_ts=' + Date.now();
  }
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function verdictLabel(v) {
    if (v === 'keep') return '值得保留';
    if (v === 'counterexample' || v === 'counterexamples') return '反面教材';
    if (v === 'never_learn' || v === 'never-learn' || v === 'neverLearn') return '永不學習';
    return v || '—';
  }

  function scoreClass(score, thr) {
    thr = thr == null ? PASS : thr;
    if (score == null) return '';
    if (score >= thr) return 'train-score-pass';
    if (score >= thr - 10) return 'train-score-near';
    return 'train-score-fail';
  }

  function setStatus(msg) {
    if ($('train-status')) $('train-status').textContent = msg;
  }

  function fetchJson(path) {
    return fetch(bust(path)).then(function (r) {
      if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
      return r.json();
    });
  }

  function loadTrainingRoom() {
    setStatus('載入訓練室…');
    return fetchJson('data/lessons/training/gallery-index.json').then(function (sum) {
      cache.summary = sum;
      PASS = sum.passThreshold || 90;
      var buckets = sum.buckets || {};
      return Promise.all([
        fetchJson(sum.rubricPath || 'data/lessons/training/rubric-vcp-c123-dtl.json').catch(function () { return null; }),
        fetchJson(sum.neverLearnIndex || 'data/lessons/training/never-learn-index.json').catch(function () { return null; }),
        fetchJson(buckets.keep || 'data/lessons/gallery/keep/index.json').catch(function () { return { items: [] }; }),
        fetchJson(buckets.counterexamples || 'data/lessons/gallery/counterexamples/index.json').catch(function () { return { items: [] }; }),
        fetchJson(buckets.neverLearn || 'data/lessons/gallery/never-learn/index.json').catch(function () { return { items: [] }; })
      ]).then(function (arr) {
        cache.rubric = arr[0];
        cache.never = arr[1];
        cache.buckets = {
          keep: arr[2],
          counterexamples: arr[3],
          neverLearn: arr[4]
        };
        renderTrainingRoom();
        var c = sum.counts || {};
        setStatus('閘門 ≥' + PASS + ' · keep ' + (c.keep || 0) +
          ' · 反面 ' + (c.counterexample || 0) +
          ' · 永不 ' + (c.never_learn || 0) +
          ' · 更新 ' + (sum.updatedAt || ''));
      });
    }).catch(function (e) {
      setStatus('訓練室未就緒：' + e.message);
      if ($('train-cols')) {
        $('train-cols').innerHTML = '<div class="muted">未有 gallery-index.json（等 Grok 對比腳本寫入 runs／gallery）。</div>';
      }
    });
  }

  function renderRubricStrip() {
    var el = $('train-rubric');
    if (!el) return;
    var r = cache.rubric;
    var n = cache.never;
    if (!r) {
      el.innerHTML = '<span class="muted">未載入 rubric</span>';
      return;
    }
    var banned = (r.bannedAntiPatterns || []).map(function (b) {
      return '<li><code>' + esc(b.failureSignature || b.id) + '</code> — ' + esc(b.description || '') + '</li>';
    }).join('');
    var neverSigs = ((n && n.signatures) || []).map(function (s) {
      return '<li><code>' + esc(s.id) + '</code> — ' + esc(s.rule || '') + '</li>';
    }).join('');
    el.innerHTML =
      '<div class="train-rubric-head"><b>' + esc(r.title || r.id) + '</b>' +
      ' · 滿分 ' + (r.totalPoints || 100) + ' · <span class="tag">通過 ≥' + (r.passThreshold || PASS) + '</span></div>' +
      '<p class="muted" style="margin:8px 0">exemplar：<code>' + esc(r.exemplarId || '') + '</code> · 對照圖 <code>' + esc(r.exemplarSvg || '') + '</code></p>' +
      '<div class="train-rubric-grid">' +
      '<div><h4>評分項</h4><ul class="train-ul">' +
      (r.items || []).map(function (it) {
        return '<li><b>' + (it.weight || 0) + '</b> ' + esc(it.description || it.id) + '</li>';
      }).join('') + '</ul></div>' +
      '<div><h4>Banned → 永不學習</h4><ul class="train-ul">' + (banned || '<li class="muted">—</li>') + '</ul>' +
      (neverSigs ? '<h4 style="margin-top:10px">已鎖定簽名</h4><ul class="train-ul">' + neverSigs + '</ul>' : '') +
      '</div></div>';
  }

  function cardHtml(item, bucketKey) {
    var score = item.score;
    var thr = (cache.summary && cache.summary.passThreshold) || PASS;
    var path = item.galleryPath || '';
    var sigs = (item.failureSignatures || []).join(', ') || '—';
    var img = path
      ? '<img class="train-thumb" alt="' + esc(item.ticker || '') + '" loading="lazy" src="' + bust(path) + '" data-full="' + esc(path) + '" />'
      : '<div class="muted">無圖</div>';
    return '<article class="train-card" data-run="' + esc(item.runPath || '') + '" data-bucket="' + esc(bucketKey) + '">' +
      '<div class="train-card-top">' +
      '<span class="train-ticker">' + esc(item.ticker || '?') + '</span>' +
      '<span class="train-score ' + scoreClass(score, thr) + '">' + (score != null ? score : '—') + '</span>' +
      '</div>' +
      img +
      '<div class="train-meta muted">' + esc(item.gradedAt || '') + '</div>' +
      '<div class="train-meta muted">簽名：' + esc(sigs) + '</div>' +
      '</article>';
  }

  function renderCol(elId, title, hint, data, bucketKey) {
    var el = $(elId);
    if (!el) return;
    var items = (data && data.items) || [];
    var orphans = (data && data.orphanSvgs) || [];
    var body = items.length
      ? items.map(function (it) { return cardHtml(it, bucketKey); }).join('')
      : '<div class="muted">暫無</div>';
    if (orphans.length) {
      body += orphans.map(function (name) {
        var folder = bucketKey === 'keep' ? 'keep' : (bucketKey === 'counterexamples' ? 'counterexamples' : 'never-learn');
        var path = 'data/lessons/gallery/' + folder + '/' + name;
        return '<article class="train-card train-orphan"><div class="train-card-top"><span class="train-ticker">' +
          esc(name.split('_')[0]) + '</span><span class="tag">orphan</span></div>' +
          '<img class="train-thumb" alt="" loading="lazy" src="' + bust(path) + '" data-full="' + esc(path) + '" /></article>';
      }).join('');
    }
    el.innerHTML = '<header class="train-col-head"><h3>' + esc(title) +
      ' <span class="tag">' + items.length + '</span></h3><p class="muted">' + esc(hint) + '</p></header>' +
      '<div class="train-card-list">' + body + '</div>';
  }

  function bindCardClicks() {
    var preview = $('train-preview');
    var detail = $('train-run-detail');
    Array.prototype.forEach.call(document.querySelectorAll('.train-thumb'), function (img) {
      img.addEventListener('click', function () {
        var full = img.getAttribute('data-full') || img.getAttribute('src');
        if (preview) {
          preview.style.display = 'block';
          preview.src = bust(full);
        }
        var card = img.closest('.train-card');
        var run = card && card.getAttribute('data-run');
        if (run && detail) loadRunDetail(run);
        if (preview && preview.scrollIntoView) preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }

  function loadRunDetail(runPath) {
    var detail = $('train-run-detail');
    if (!detail) return;
    detail.textContent = '載入評分…';
    fetchJson(runPath).then(function (j) {
      var rows = (j.itemResults || []).map(function (it) {
        return '<tr><td>' + (it.passed ? '✓' : '✗') + '</td><td>' + esc(it.id) +
          '</td><td>' + (it.earned != null ? it.earned : '') + '/' + (it.weight || '') +
          '</td><td class="muted">' + esc(it.detail || '') + '</td></tr>';
      }).join('');
      detail.innerHTML =
        '<div><b>' + esc(j.ticker) + '</b> · ' + verdictLabel(j.verdict) +
        ' · <span class="train-score ' + scoreClass(j.score, j.passThreshold) + '">' +
        (j.score != null ? j.score : '—') + '</span> / 閘門 ' + (j.passThreshold || PASS) + '</div>' +
        '<p class="muted">candidate <code>' + esc(j.candidateSvg || '') + '</code> · run <code>' + esc(runPath) + '</code></p>' +
        (j.failureSignatures && j.failureSignatures.length
          ? '<p>失敗簽名：' + j.failureSignatures.map(function (s) { return '<code>' + esc(s) + '</code>'; }).join(' ') + '</p>'
          : '') +
        '<table><thead><tr><th></th><th>項</th><th>分</th><th>說明</th></tr></thead><tbody>' +
        rows + '</tbody></table>';
    }).catch(function (e) {
      detail.textContent = '評分載入失敗：' + e.message;
    });
  }

  function renderExemplar() {
    var img = $('train-exemplar');
    if (!img) return;
    var path = (cache.summary && cache.summary.exemplarSvg) ||
      (cache.rubric && cache.rubric.exemplarSvg) ||
      'data/lessons/exemplars/NOW_vcp_c123_dtl_style.svg';
    img.src = bust(path);
    img.style.display = 'block';
    img.alt = 'human exemplar';
  }

  function renderTrainingRoom() {
    renderRubricStrip();
    renderExemplar();
    renderCol('train-col-keep', '值得保留', '≥90% 對齊你教嘅畫法', cache.buckets.keep, 'keep');
    renderCol('train-col-counter', '反面教材', '<90 但可教；對照 exemplar 改錯', cache.buckets.counterexamples, 'counterexamples');
    renderCol('train-col-never', '永不學習', 'banned／重複錯法；畫圖禁止再犯', cache.buckets.neverLearn, 'neverLearn');
    bindCardClicks();
  }

  global.LessonsTraining = {
    load: loadTrainingRoom,
    reload: loadTrainingRoom
  };
})(window);
