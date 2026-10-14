/* lessons-training.js — 教材訓練室：exemplar｜keep｜never-learn 成對對照 */
(function (global) {
  'use strict';

  var PASS = 90;
  var cache = { summary: null, rubric: null, never: null, pairs: null, hardRules: null, buckets: {} };

  function bust(url) {
    if (!url) return '';
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
        fetchJson(sum.pairsIndex || 'data/lessons/training/pairs-index.json').catch(function () { return null; }),
        fetchJson(sum.hardRulesPath || 'data/lessons/training/hard-draw-rules-vcp.json').catch(function () { return null; }),
        fetchJson(buckets.keep || 'data/lessons/gallery/keep/index.json').catch(function () { return { items: [] }; }),
        fetchJson(buckets.counterexamples || 'data/lessons/gallery/counterexamples/index.json').catch(function () { return { items: [] }; }),
        fetchJson(buckets.neverLearn || 'data/lessons/gallery/never-learn/index.json').catch(function () { return { items: [] }; })
      ]).then(function (arr) {
        cache.rubric = arr[0];
        cache.never = arr[1];
        cache.pairs = arr[2];
        cache.hardRules = arr[3];
        cache.buckets = { keep: arr[4], counterexamples: arr[5], neverLearn: arr[6] };
        renderTrainingRoom();
        var c = sum.counts || {};
        setStatus('閘門 ≥' + PASS + ' · 成對 ' + (c.pairs || (cache.pairs && cache.pairs.pairs && cache.pairs.pairs.length) || 0) +
          ' · keep ' + (c.keep || 0) +
          ' · 永不 ' + (c.neverLearn || c.never_learn || 0) +
          ' · 更新 ' + (sum.updatedAt || ''));
      });
    }).catch(function (e) {
      setStatus('訓練室未就緒：' + e.message);
      if ($('train-pairs')) {
        $('train-pairs').innerHTML = '<div class="muted">未有 gallery-index.json</div>';
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
      '<p class="muted" style="margin:8px 0">exemplar：<code>' + esc(r.exemplarId || '') + '</code></p>' +
      '<div class="train-rubric-grid">' +
      '<div><h4>評分項</h4><ul class="train-ul">' +
      (r.items || []).map(function (it) {
        return '<li><b>' + (it.weight || 0) + '</b> ' + esc(it.description || it.id) + '</li>';
      }).join('') + '</ul></div>' +
      '<div><h4>Banned → 永不學習</h4><ul class="train-ul">' + (banned || '<li class="muted">—</li>') + '</ul>' +
      (neverSigs ? '<h4 style="margin-top:10px">已鎖定簽名</h4><ul class="train-ul">' + neverSigs + '</ul>' : '') +
      '</div></div>';
  }

  function renderHardRules() {
    var el = $('train-hard-rules');
    if (!el) return;
    var h = cache.hardRules;
    if (!h) {
      el.innerHTML = '<span class="muted">未載入硬性畫法（等 Grok 寫 hard-draw-rules-vcp.json）</span>';
      return;
    }
    var must = (h.must || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    var never = (h.never || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    el.innerHTML =
      '<div><b>硬性畫法（由你教嘅圖分析鎖定）</b> · <code>' + esc(h.id || '') + '</code></div>' +
      '<p class="muted" style="margin:6px 0">' + esc(h.sourceNote || '') + '</p>' +
      '<div class="train-rubric-grid">' +
      '<div><h4>必須</h4><ol class="train-hard-ol">' + must + '</ol></div>' +
      '<div><h4>禁止</h4><ol class="train-hard-ol">' + never + '</ol></div></div>';
  }

  function thumbHtml(path, alt) {
    if (!path) return '<div class="muted">無圖</div>';
    return '<img class="train-thumb" alt="' + esc(alt || '') + '" loading="lazy" src="' + bust(path) + '" data-full="' + esc(path) + '" />';
  }

  function itemCell(roleClass, roleLabel, item, pathOverride) {
    var path = pathOverride || (item && item.galleryPath) || '';
    var score = item && item.score;
    var sigs = item && item.failureSignatures ? item.failureSignatures.join(', ') : '';
    return '<div class="train-pair-cell ' + roleClass + '">' +
      '<div class="train-pair-role">' + esc(roleLabel) +
      (score != null ? ' · <span class="train-score ' + scoreClass(score) + '">' + score + '</span>' : '') +
      '</div>' +
      thumbHtml(path, roleLabel) +
      (sigs ? '<div class="train-meta muted">簽名：' + esc(sigs) + '</div>' : '') +
      (item && item.gradedAt ? '<div class="train-meta muted">' + esc(item.gradedAt) + '</div>' : '') +
      '</div>';
  }

  function renderPairs() {
    var el = $('train-pairs');
    if (!el) return;
    var pairs = (cache.pairs && cache.pairs.pairs) || [];
    var defEx = (cache.pairs && cache.pairs.exemplarDefault) || {};
    if (!pairs.length) {
      el.innerHTML = '<div class="muted">未有 pairs-index（會回退分欄）</div>';
      return;
    }
    el.innerHTML = pairs.map(function (p) {
      var ex = p.exemplar || {};
      var exPath = ex.jpg || ex.svg || (p.ticker === 'NOW' ? (defEx.jpg || defEx.svg) : null);
      var bad = (p.neverLearn && p.neverLearn[0]) || (p.counterexamples && p.counterexamples[0]) || null;
      var badLabel = (p.neverLearn && p.neverLearn[0]) ? '永不學習' :
        ((p.counterexamples && p.counterexamples[0]) ? '反面教材' : '錯例（暫無）');
      var moreBad = ((p.neverLearn || []).length + (p.counterexamples || []).length) > 1
        ? '<div class="muted" style="margin-top:6px;font-size:11px">另有 ' +
          ((p.neverLearn || []).length + (p.counterexamples || []).length - 1) + ' 張錯例喺後備分欄</div>'
        : '';
      return '<section class="train-pair" data-ticker="' + esc(p.ticker) + '">' +
        '<div class="train-pair-head"><h3>' + esc(p.ticker) + '</h3>' +
        '<span class="muted">你教的｜值得保留｜永不學習／反面</span></div>' +
        '<div class="train-pair-grid">' +
        itemCell('role-exemplar', '你教的 exemplar', null, exPath) +
        itemCell('role-keep', '值得保留', p.keep, p.keep && p.keep.galleryPath) +
        itemCell('role-bad', badLabel, bad, bad && bad.galleryPath) +
        '</div>' + moreBad +
        '</section>';
    }).join('');
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
      '</div>' + img +
      '<div class="train-meta muted">' + esc(item.gradedAt || '') + '</div>' +
      '<div class="train-meta muted">簽名：' + esc(sigs) + '</div></article>';
  }

  function renderCol(elId, title, hint, data, bucketKey) {
    var el = $(elId);
    if (!el) return;
    var items = (data && data.items) || [];
    var body = items.length
      ? items.map(function (it) { return cardHtml(it, bucketKey); }).join('')
      : '<div class="muted">暫無</div>';
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
        else if (detail) detail.innerHTML = '<span class="muted">成對預覽：' + esc(full) + '</span>';
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
        '<p class="muted">candidate <code>' + esc(j.candidateSvg || '') + '</code></p>' +
        (j.failureSignatures && j.failureSignatures.length
          ? '<p>失敗簽名：' + j.failureSignatures.map(function (s) { return '<code>' + esc(s) + '</code>'; }).join(' ') + '</p>'
          : '') +
        '<table><thead><tr><th></th><th>項</th><th>分</th><th>說明</th></tr></thead><tbody>' +
        rows + '</tbody></table>';
    }).catch(function (e) {
      detail.textContent = '評分載入失敗：' + e.message;
    });
  }

  function renderTrainingRoom() {
    renderRubricStrip();
    renderHardRules();
    renderPairs();
    renderCol('train-col-keep', '值得保留', '≥90% 對齊你教嘅畫法', cache.buckets.keep, 'keep');
    renderCol('train-col-counter', '反面教材', '<90 但可教', cache.buckets.counterexamples, 'counterexamples');
    renderCol('train-col-never', '永不學習', 'banned／重複錯法', cache.buckets.neverLearn, 'neverLearn');
    bindCardClicks();
  }

  global.LessonsTraining = {
    load: loadTrainingRoom,
    reload: loadTrainingRoom
  };
})(window);
