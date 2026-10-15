/* app.js - Trok 網頁整合：接各 bot 模組＋顯示思考 log */
(function () {
  'use strict';
  var APP_LOG = [];
  var TECH_SCAN_LOG = [];
  var TECH_SCAN_CACHE = null;
  var LIVE_SYNC_MS = 15000;
  var LIVE_SYNC_TIMER = null;
  var LIVE_SYNC_ON = true;
  var LIVE_SYNC_SIG = { screener: '', tech: '', macro: '', company: '', entry: '' };

  function bust(url) {
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + '_ts=' + Date.now();
  }

  function sigOf(j) {
    if (!j) return '';
    return String(j.generatedAt || j.asOf || j.updatedAt || j.asOfMarket || '') + '|' +
      String((j.stats && j.stats.passed) || (j.analyses && j.analyses.length) || (j.scanned && j.scanned.length) || '') + '|' +
      String((j.topSetups && j.topSetups[0] && j.topSetups[0].ticker) || (j.results && j.results[0] && j.results[0].ticker) || '');
  }

  function setLiveStatus(msg) {
    if ($('live-sync-status')) $('live-sync-status').textContent = msg;
  }

  function liveRefreshAll(reason) {
    alog('live-sync:refresh', reason || 'tick');
    setLiveStatus('同步中… ' + new Date().toLocaleTimeString());
    // always re-fetch with cache bust
    loadScreenerLatestLive();
    loadTechScanLatestLive();
    loadMacroReportLive();
    loadCompanyLatestLive();
    loadEntryLatestLive();
    setTimeout(function () {
      try { runCommander(); } catch (e) {}
      setLiveStatus('已同步 ' + new Date().toLocaleTimeString() + (LIVE_SYNC_ON ? ' · 每 15 秒' : ' · 已暫停'));
    }, 500);
  }

  function startLiveSync() {
    LIVE_SYNC_ON = true;
    if (LIVE_SYNC_TIMER) clearInterval(LIVE_SYNC_TIMER);
    LIVE_SYNC_TIMER = setInterval(function () {
      if (!LIVE_SYNC_ON) return;
      liveRefreshAll('interval');
    }, LIVE_SYNC_MS);
    setLiveStatus('即時同步開啟 · 每 15 秒');
    alog('live-sync:start', LIVE_SYNC_MS);
  }

  function stopLiveSync() {
    LIVE_SYNC_ON = false;
    if (LIVE_SYNC_TIMER) { clearInterval(LIVE_SYNC_TIMER); LIVE_SYNC_TIMER = null; }
    setLiveStatus('即時同步已暫停');
    alog('live-sync:stop', 'paused');
  }

  function alog(step, detail) {
    APP_LOG.push({ t: new Date().toISOString(), bot: 'Trok', role: '網頁整合', step: step, detail: detail });
  }

  var BOTS = [
    { id: 'Frok', role: '① 篩選器＋主題／ETF', status: 'ok', file: 'js/screener.js' },
    { id: 'Grok', role: '② 技術分析＋教材庫＋兄弟姊妹股', status: 'ok', file: 'js/tech.js' },
    { id: 'Jrok', role: '③ 公司分析報告', status: 'ok', file: 'js/company.js' },
    { id: 'Drok', role: '④ 大市分析', status: 'ok', file: 'js/macro.js' },
    { id: 'Arok', role: '⑤ 進場策略', status: 'ok', file: 'js/entry.js' },
    { id: 'Trok', role: '⑥ 資料蒐集＋總司令＋網頁', status: 'ok', file: 'js/commander.js' }
  ];

  function $(id) { return document.getElementById(id); }

  function renderBots() {
    var box = $('bot-list');
    box.innerHTML = BOTS.map(function (b) {
      var st = b.status === 'ok' ? 'ok' : (b.status === 'wait' ? 'wait' : 'todo');
      var label = st === 'ok' ? '已接檔' : (st === 'wait' ? '等待交檔' : '未開始');
      return '<div class="bot"><div class="name">' + b.id + '</div><div class="role">' + b.role +
        '</div><div class="status ' + st + '">' + label + ' · ' + b.file + '</div></div>';
    }).join('');
  }

  function showPanel(name) {
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.dataset.panel === name); });
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.panel === name); });
    alog('nav', name);
  }

  function fmtLog(rows) {
    if (!rows || !rows.length) return '<div class="muted">暫無 log</div>';
    return rows.slice().reverse().map(function (r) {
      return '<div class="log-row"><span class="meta">' + (r.t || '') +
        '</span> <span class="botc">[' + (r.bot || '') + '/' + (r.role || '') + ']</span> <b>' +
        (r.step || '') + '</b> — ' + (typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)) + '</div>';
    }).join('');
  }

  function collectAllLogs() {
    var all = APP_LOG.slice();
    if (TECH_SCAN_LOG && TECH_SCAN_LOG.length) all = all.concat(TECH_SCAN_LOG);
    if (window.Commander && Commander.getLog) all = all.concat(Commander.getLog());
    if (window.Macro && Macro.getLog) all = all.concat(Macro.getLog());
    if (window.Screener && Screener.getLog) all = all.concat(Screener.getLog());
    if (window.Tech && Tech.getLog) all = all.concat(Tech.getLog());
    if (window.Company && Company.getLog) all = all.concat(Company.getLog());
    if (window.Entry && Entry.getLog) all = all.concat(Entry.getLog());
    all.sort(function (a, b) { return (a.t || '').localeCompare(b.t || ''); });
    return all;
  }

  function refreshLogs() {
    $('log-all').innerHTML = fmtLog(collectAllLogs());
    if (window.Macro && Macro.getLog && $('log-macro')) $('log-macro').innerHTML = fmtLog(Macro.getLog());
    if (window.Commander && Commander.getLog && $('log-commander')) $('log-commander').innerHTML = fmtLog(Commander.getLog());
    if (window.Screener && Screener.getLog && $('log-screener')) $('log-screener').innerHTML = fmtLog(Screener.getLog());
    if ($('log-tech')) {
      var tlogs = (TECH_SCAN_LOG && TECH_SCAN_LOG.length) ? TECH_SCAN_LOG : ((window.Tech && Tech.getLog && Tech.getLog()) || []);
      $('log-tech').innerHTML = fmtLog(tlogs);
    }
    if (window.Company && Company.getLog && $('log-company')) $('log-company').innerHTML = fmtLog(Company.getLog());
    if (window.Entry && Entry.getLog && $('log-entry')) $('log-entry').innerHTML = fmtLog(Entry.getLog());
  }

  function renderMacroEvents(ev) {
    if (!$('macro-events')) return;
    ev = ev || [];
    $('macro-events').innerHTML = '<table><thead><tr><th>日期</th><th>類型</th><th>名稱</th><th>備註</th></tr></thead><tbody>' +
      ev.map(function (e) {
        return '<tr><td>' + (e.date || '') + '</td><td><span class="tag">' + (e.type || '') +
          '</span></td><td>' + (e.label || '') + '</td><td class="muted">' + (e.note || e.consensus || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function loadMacroReport() {
    var url = bust('data/macro-run-latest.json');
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function () {
      return fetch('data/macro-report-nfp-latest.json').then(function (r) { return r.json(); });
    }).then(function (j) {
      alog('macro-report:loaded', j && (j.title || j.updatedAt));
      var body;
      if (j && j.summaryTw) {
        body = j.summaryTw;
        if (j.watch && j.watch.length) {
          body += '\n\n【前瞻】\n' + j.watch.map(function (w) {
            return '· ' + (w.date || '') + ' ' + (w.label || w.type || '') + (w.note ? ' — ' + w.note : '');
          }).join('\n');
        }
        if (j.mag7Note) body += '\n\n【七巨頭】\n' + j.mag7Note;
      } else {
        body = '未有繁中摘要（summaryTw），請等 Drok 刷新大市報告。';
      }
      $('macro-report').textContent = body;
      var logs = (j && j.thinkingLog && j.thinkingLog.length) ? j.thinkingLog : ((window.Macro && Macro.getLog && Macro.getLog()) || []);
      if ($('log-macro')) $('log-macro').innerHTML = fmtLog(logs);
      if (j && j.calendar && j.calendar.length) renderMacroEvents(j.calendar);
      else if (window.Macro && Macro.listEvents) renderMacroEvents(Macro.listEvents());
      else {
        fetch('data/macro-events.json').then(function (r) { return r.json(); }).then(function (ev) {
          renderMacroEvents(Array.isArray(ev) ? ev : (ev.events || []));
        }).catch(function () {});
      }
      window.__latestMacro = j;
      refreshOverviewKpis();
      renderOverviewGate(window.__latestCommander || null);
      refreshLogs();
    }).catch(function (e) {
      $('macro-report').textContent = '未能載入大市報告：' + e.message;
      alog('macro-report:error', e.message);
    });
  }

  function loadScreenerLatest() {
    fetch(bust('data/screener-run-latest.json')).then(function (r) { return r.json(); }).then(function (j) {
      var sg = sigOf(j);
      if (sg && sg === LIVE_SYNC_SIG.screener) { alog('screener-latest:unchanged', sg); return; }
      LIVE_SYNC_SIG.screener = sg;
      alog('screener-latest:loaded', j && j.stats);
      var rows = j.results || [];
      var st = j.stats || {};
      $('screen-summary').textContent = '最新刷新 ' + (j.asOf || '') + ' · 通過 ' + (st.passed != null ? st.passed : rows.length) +
        '／拒 ' + (st.rejected != null ? st.rejected : '?') + '（宇宙 ' + (st.universe || '?') + '）';
      renderScreenTable(rows);
      if (j.log && j.log.length && $('log-screener')) $('log-screener').innerHTML = fmtLog(j.log);
      window.__latestScreener = j;
      refreshLogs();
    }).catch(function (e) {
      $('screen-summary').textContent = '未有最新篩選檔，可撳掣用樣本宇宙重跑：' + e.message;
      alog('screener-latest:error', e.message);
    });
  }

  function contractionsTw(cons) {
    if (!cons || !cons.length) return '';
    return cons.map(function (c) {
      return (c.label || '') + ' ' + (c.pct != null ? Number(c.pct).toFixed(1) + '%' : '');
    }).join(' → ');
  }

  function showTechAnalysis(a, scrollToChart) {
    if (!a) return;
    var lines = [];
    if (a.summaryTw) lines.push(a.summaryTw);
    else {
      lines.push((a.ticker || '') + ' · ' + (a.primaryLabelTw || a.labelTw || a.primaryPattern || a.pattern || ''));
      if (a.pivot != null) lines.push('Pivot: $' + a.pivot);
      if (a.close != null) lines.push('收市: $' + a.close + (a.status ? '；' + a.status : ''));
    }
    if (a.contractions) lines.push('C1–C3: ' + contractionsTw(a.contractions));
    if (a.theme || a.etf) lines.push('主題／ETF: ' + (a.theme || '') + '／' + (a.etf || ''));
    if (a.techPass != null) lines.push('技術通過：' + (a.techPass ? '是' : '否'));
    $('tech-summary').textContent = lines.join('\n');
    var img = $('tech-chart');
    var miss = $('tech-chart-miss');
    if (a.chartPath) {
      var src = (window.CHART_ASSETS && window.CHART_ASSETS[a.chartPath]) || a.chartPath;
      img.onload = function () { if (miss) miss.style.display = 'none'; };
      img.onerror = function () { img.style.display = 'none'; if (miss) miss.style.display = 'block'; };
      img.src = src + (src.indexOf('data:') === 0 ? '' : ((src.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent((window.__latestTech && window.__latestTech.generatedAt) || Date.now())));
      img.style.display = 'block';
      if (miss) miss.style.display = 'none';
    } else {
      img.style.display = 'none';
      if (miss) miss.style.display = 'block';
    }
    var sibs = a.siblings || [];
    if (sibs.length) {
      $('tech-siblings').innerHTML = '<h3 style="color:#9aa6d0;font-size:13px">兄弟姊妹股</h3><table><thead><tr><th>Ticker</th><th>相關</th><th>提示</th></tr></thead><tbody>' +
        sibs.map(function (s) {
          if (typeof s === 'string') return '<tr><td>' + s + '</td><td></td><td></td></tr>';
          return '<tr><td>' + (s.ticker || '') + '</td><td>' + (s.corr60 != null ? Number(s.corr60).toFixed(2) : '') +
            '</td><td class="muted">' + (s.note || s.business || '') + '</td></tr>';
        }).join('') + '</tbody></table>' +
        (a.siblingHint ? '<p class="muted">' + a.siblingHint + '</p>' : '');
    } else {
      $('tech-siblings').innerHTML = a.siblingHint ? '<p class="muted">' + a.siblingHint + '</p>' : '';
    }
    if (scrollToChart) {
      var anchor = $('tech-chart-anchor');
      if (anchor && anchor.scrollIntoView) {
        setTimeout(function () {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
          try { window.scrollBy(0, -8); } catch (e) {}
        }, 50);
      }
    }
  }

  function renderTechScanTable() {
    var j = window.__latestTech;
    if (!j || !$('tech-scan-list')) return;
    var all = (j.analyses && j.analyses.length) ? j.analyses : (j.topSetups || []);
    var themeSel = $('tech-theme-filter');
    var theme = themeSel ? themeSel.value : '';
    var passOnly = $('tech-pass-only') && $('tech-pass-only').checked;
    var list = [];
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      if (passOnly && a.techPass === false) continue;
      if (passOnly && a.techPass == null && j.techPassed && j.techPassed.indexOf(a.ticker) < 0) continue;
      if (theme && (a.theme || '') !== theme) continue;
      list.push(a);
    }
    window.__techViewList = list;
    var tops = j.topSetups || [];
    $('tech-scan-list').innerHTML = '<table><thead><tr><th>Ticker</th><th>形態</th><th>C1–C3</th><th>收市</th><th>Pivot</th><th>主題/ETF</th><th>通過</th></tr></thead><tbody>' +
      list.map(function (a, idx) {
        var pass = a.techPass === true || (j.techPassed && j.techPassed.indexOf(a.ticker) >= 0);
        return '<tr data-idx="' + idx + '" class="tech-row" style="cursor:pointer"><td><b>' + (a.ticker || '') +
          '</b></td><td>' + (a.primaryLabelTw || a.labelTw || a.primaryPattern || a.pattern || '') +
          '</td><td class="muted">' + contractionsTw(a.contractions) +
          '</td><td>$' + (a.close != null ? a.close : '') +
          '</td><td>' + (a.pivot != null ? '$' + a.pivot : '') +
          '</td><td><span class="tag">' + (a.theme || '') + '</span> ' + (a.etf || '') +
          '</td><td>' + (pass ? '<span class="tag">✓</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="muted" style="margin-top:8px">顯示 ' + list.length + '／掃描 ' + all.length +
      (j.techPassedCount != null ? ' · 技術通過 ' + j.techPassedCount : '') +
      (tops.length ? ' · Top：' + tops.slice(0, 6).map(function (t) { return t.ticker; }).join(',') : '') + '</p>';
    Array.prototype.forEach.call(document.querySelectorAll('#tech-scan-list tr.tech-row'), function (tr) {
      tr.addEventListener('click', function () {
        var i = Number(tr.getAttribute('data-idx'));
        showTechAnalysis(list[i], true);
        alog('tech:scan-pick', list[i] && list[i].ticker);
      });
    });
  }

  function loadTechScanLatest() {
    fetch(bust('data/tech-scan-latest.json')).then(function (r) { return r.json(); }).then(function (j) {
      var sg = sigOf(j);
      if (sg && sg === LIVE_SYNC_SIG.tech) { alog('tech-scan:unchanged', sg); return; }
      LIVE_SYNC_SIG.tech = sg;
      alog('tech-scan:loaded', { scanned: j.scanned, top: (j.topSetups || []).length });
      window.__latestTech = j;
      TECH_SCAN_LOG = (j.thinkingLog && j.thinkingLog.length) ? j.thinkingLog.slice() : [];
      var list = (j.analyses && j.analyses.length) ? j.analyses : (j.topSetups || []);
      var tops = j.topSetups || [];
      var inPass = (j.screenerAlign && j.screenerAlign.scannedInPass) || [];
      if ($('tech-scan-status')) {
        $('tech-scan-status').textContent = '掃描 ' + list.length + ' 隻 · 技術通過 ' + (j.techPassedCount != null ? j.techPassedCount : '?') +
          ' · asOf ' + (j.asOfMarket || j.generatedAt || '') +
          ' · 候選池 ' + (j.candidateCount || ((j.screenerAlign && j.screenerAlign.passedCount) || '?'));
      }
      // fill theme filter options
      if ($('tech-theme-filter')) {
        var themes = {};
        list.forEach(function (a) { if (a.theme) themes[a.theme] = 1; });
        var cur = $('tech-theme-filter').value;
        var opts = '<option value="">全部主題</option>' + Object.keys(themes).sort().map(function (t) {
          return '<option value="' + t + '">' + t + '</option>';
        }).join('');
        $('tech-theme-filter').innerHTML = opts;
        if (cur && themes[cur]) $('tech-theme-filter').value = cur;
      }
      renderTechScanTable();
      var view = window.__techViewList || [];
      var show = null;
      if (tops.length) {
        for (var ti = 0; ti < view.length; ti++) {
          if (view[ti].ticker === tops[0].ticker) { show = view[ti]; break; }
        }
      }
      if (!show && view.length) show = view[0];
      if (show) showTechAnalysis(show, false);
      refreshLogs();
    }).catch(function (e) {
      if ($('tech-scan-status')) $('tech-scan-status').textContent = '未有掃描檔：' + e.message;
      alog('tech-scan:error', e.message);
    });
  }


  function showCompanyDetail(r, scrollToDetail) {
    if (!r) return;
    var L = r.leadership || {};
    var why = (L.why && L.why.join) ? L.why.join('；') : (L.note || '');
    if ($('company-leader')) {
      $('company-leader').textContent = (r.ticker || '') + ' · 領導股：' + (L.isLeader ? '是' : '否') +
        '（score ' + (L.score != null ? L.score : '?') + '）' + (why ? ' · ' + why : '') +
        ' · 電話會議：待補';
    }
    if ($('company-out')) {
      var body = r.textTw || r.summaryTw || '';
      if (r.summaryTw && r.textTw && r.textTw.indexOf(r.summaryTw) !== 0) {
        body = r.summaryTw + '\n\n' + r.textTw;
      }
      $('company-out').textContent = body || '無報告正文';
    }
    if (scrollToDetail) {
      var anchor = $('company-detail-anchor');
      if (anchor && anchor.scrollIntoView) {
        setTimeout(function () {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
    }
  }

  function renderCompanyTableRows(fullList) {
    var onlyLeaders = $('company-leaders-only') && $('company-leaders-only').checked;
    var themeSel = $('company-theme-filter');
    var theme = themeSel ? themeSel.value : '';
    var list = fullList || [];
    var rows = [];
    var mapIdx = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var L = r.leadership || {};
      if (onlyLeaders && !L.isLeader) continue;
      if (theme && (r.theme || '') !== theme) continue;
      mapIdx.push(i);
      rows.push(r);
    }
    window.__companyViewList = rows;
    if ($('company-scan-status')) {
      var j = window.__latestCompany || {};
      $('company-scan-status').textContent = '顯示 ' + rows.length + '／公司 ' + list.length + ' · 領導股 ' +
        (j.leaderCount != null ? j.leaderCount : '') +
        (theme ? ' · 主題 ' + theme : '') +
        ' · asOf ' + (j.asOf || j.generatedAt || '');
    }
    if (!$('company-scan-list')) return;
    if (!rows.length) {
      $('company-scan-list').innerHTML = '<p class="muted">無符合列</p>';
      return;
    }
    $('company-scan-list').innerHTML = '<table><thead><tr><th>Ticker</th><th>主題</th><th>上下游</th><th>護城河</th><th>領導股</th><th>score</th><th>形態</th></tr></thead><tbody>' +
      rows.map(function (r, ri) {
        var L = r.leadership || {};
        var vc = (r.valueChain && r.valueChain.position) || '—';
        var moat = (r.moat && r.moat.level) || '—';
        return '<tr class="company-row" data-src-idx="' + mapIdx[ri] + '" style="cursor:pointer"><td><b>' + (r.ticker || '') +
          '</b></td><td><span class="tag">' + (r.theme || '') + '</span></td><td>' + vc +
          '</td><td>' + moat + '</td><td>' + (L.isLeader ? '是' : '否') +
          '</td><td>' + (L.score != null ? L.score : '—') +
          '</td><td class="muted">' + (r.pattern || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    Array.prototype.forEach.call(document.querySelectorAll('#company-scan-list tr.company-row'), function (tr) {
      tr.addEventListener('click', function () {
        var i = Number(tr.getAttribute('data-src-idx'));
        var r = list[i];
        if (!r) return;
        showCompanyDetail(r, true);
        alog('company:scan-pick', r.ticker);
        refreshLogs();
      });
    });
  }

  function renderCompanyLatest(j) {
    if (!j) return;
    window.__latestCompany = j;
    var list = j.reports || [];
    if ($('company-out')) {
      $('company-out').textContent = '點表格一列睇全文';
    }
    if ($('company-leader')) {
      $('company-leader').textContent = '領導股閘：' + (j.leaderCount != null ? j.leaderCount : '—') +
        '／' + list.length + '（點列滑到詳情）';
    }
    if ($('company-theme-filter')) {
      var themes = {};
      list.forEach(function (r) { if (r.theme) themes[r.theme] = 1; });
      var cur = $('company-theme-filter').value;
      $('company-theme-filter').innerHTML = '<option value="">全部主題</option>' +
        Object.keys(themes).sort().map(function (t) {
          return '<option value="' + t + '">' + t + '</option>';
        }).join('');
      if (cur && themes[cur]) $('company-theme-filter').value = cur;
    }
    renderCompanyTableRows(list);
    function refilter() {
      renderCompanyTableRows((window.__latestCompany && window.__latestCompany.reports) || []);
    }
    if ($('company-leaders-only') && !$('company-leaders-only')._bound) {
      $('company-leaders-only')._bound = true;
      $('company-leaders-only').addEventListener('change', refilter);
    }
    if ($('company-theme-filter') && !$('company-theme-filter')._bound) {
      $('company-theme-filter')._bound = true;
      $('company-theme-filter').addEventListener('change', refilter);
    }
    if (j.thinkingLog && j.thinkingLog.length && $('log-company')) {
      $('log-company').innerHTML = fmtLog(j.thinkingLog);
    }
    refreshLogs();
  }

  function loadCompanyLatest() {
    fetch(bust('data/company-run-latest.json')).then(function (r) { return r.json(); }).then(function (j) {
      var sg = sigOf(j) + '|' + String(j.count || (j.reports && j.reports.length) || '');
      if (sg && sg === LIVE_SYNC_SIG.company) { alog('company-latest:unchanged', sg); return; }
      LIVE_SYNC_SIG.company = sg;
      alog('company-latest:loaded', { count: j.count, asOf: j.asOf });
      renderCompanyLatest(j);
    }).catch(function (e) {
      if ($('company-scan-status')) $('company-scan-status').textContent = '未有公司掃描檔：' + e.message;
      alog('company-latest:error', e.message);
    });
  }

  function money(n) {
    if (n == null || n === '') return '—';
    var x = Number(n);
    if (isNaN(x)) return String(n);
    return '$' + x.toFixed(2);
  }

  function showEntryDetail(r, scrollToDetail) {
    if (!r || !$('entry-out')) return;
    var L = r.levels || {};
    var lines = [];
    if (r.detailTw) {
      lines.push(r.detailTw);
    } else {
      lines.push((r.ticker || '') + ' · ' + (r.action || '') + (r.theme ? ' · ' + r.theme : ''));
      if (r.summaryTw) lines.push(r.summaryTw);
      lines.push('策略：' + (r.bestMethod || r.method || '') + '／' + (r.tradeStyle || r.style || ''));
      lines.push('形態：' + (r.pattern || '—') + (r.pivot != null ? ' · pivot $' + r.pivot : ''));
      lines.push('入場：' + money(L.entry != null ? L.entry : r.entry) +
        '　止損：' + money(L.stop != null ? L.stop : r.stop) +
        (L.riskPct != null || r.riskPct != null ? '（' + Number(L.riskPct != null ? L.riskPct : r.riskPct).toFixed(1) + '%）' : ''));
      lines.push('領導股：' + ((r.leadership && r.leadership.isLeader) ? '是' : '否') +
        (r.leadership && r.leadership.score != null ? ' · score ' + r.leadership.score : ''));
      if (r.why) lines.push('原因：' + (Array.isArray(r.why) ? r.why.join('；') : String(r.why)));
    }
    $('entry-out').textContent = lines.join('\n');
    if (scrollToDetail) {
      var anchor = $('entry-detail-anchor');
      if (anchor && anchor.scrollIntoView) {
        setTimeout(function () {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
    }
  }

  function renderEntryTable(j) {
    var full = (j && j.reports) || [];
    window.__latestEntry = j;
    var themeSel = $('entry-theme-filter');
    var theme = themeSel ? themeSel.value : '';
    var considerOnly = $('entry-consider-only') && $('entry-consider-only').checked;
    var list = [];
    for (var i = 0; i < full.length; i++) {
      var r = full[i];
      if (considerOnly && r.action && r.action.indexOf('可考慮') < 0) continue;
      if (theme && (r.theme || '') !== theme) continue;
      list.push(r);
    }
    window.__entryViewList = list;
    if ($('entry-scan-status')) {
      $('entry-scan-status').textContent = '顯示 ' + list.length + '／進場 ' + full.length +
        ' · asOf ' + ((j && (j.asOf || j.generatedAt)) || '') +
        (theme ? ' · 主題 ' + theme : '');
    }
    if (!$('entry-table')) return;
    if (!list.length) {
      $('entry-table').innerHTML = '<p class="muted">無符合列</p>';
      return;
    }
    $('entry-table').innerHTML = '<table><thead><tr>' +
      '<th>Ticker</th><th>主題</th><th>建議</th><th>策略</th><th>形態</th><th>入場</th><th>止損</th><th>風險</th><th>領導股</th>' +
      '</tr></thead><tbody>' +
      list.map(function (r, idx) {
        var L = r.levels || {};
        var entry = L.entry != null ? L.entry : r.entry;
        var stop = L.stop != null ? L.stop : r.stop;
        var risk = L.riskPct != null ? L.riskPct : r.riskPct;
        var lead = r.leadership || {};
        var leadTw = lead.isLeader === true ? ('是' + (lead.score != null ? ' (' + lead.score + ')' : '')) :
          (lead.isLeader === false ? '否／降權' : '—');
        return '<tr class="entry-row" data-idx="' + idx + '" style="cursor:pointer"><td><b>' + (r.ticker || '') +
          '</b></td><td><span class="tag">' + (r.theme || '') + '</span></td><td>' + (r.action || '') +
          '</td><td><span class="tag">' + (r.bestMethod || r.method || '') + '</span></td><td class="muted">' +
          (r.pattern || '') + '</td><td>' + money(entry) + '</td><td>' + money(stop) +
          '</td><td>' + (risk != null ? Number(risk).toFixed(1) + '%' : '—') +
          '</td><td>' + leadTw + '</td></tr>';
      }).join('') + '</tbody></table>';
    Array.prototype.forEach.call(document.querySelectorAll('#entry-table tr.entry-row'), function (tr) {
      tr.addEventListener('click', function () {
        var i = Number(tr.getAttribute('data-idx'));
        showEntryDetail(list[i], true);
        alog('entry:row-pick', list[i] && list[i].ticker);
      });
    });
  }

  function loadEntryLatest() {
    fetch(bust('data/entry-run-latest.json')).then(function (r) { return r.json(); }).then(function (j) {
      var sg = sigOf(j);
      if (sg && sg === LIVE_SYNC_SIG.entry) { alog('entry-latest:unchanged', sg); return; }
      LIVE_SYNC_SIG.entry = sg;
      window.__latestEntry = j;
      alog('entry-latest:loaded', j && (j.ticker || j.count || j.generatedAt));
      if ($('entry-theme-filter')) {
        var themes = {};
        (j.reports || []).forEach(function (r) { if (r.theme) themes[r.theme] = 1; });
        var cur = $('entry-theme-filter').value;
        $('entry-theme-filter').innerHTML = '<option value="">全部主題</option>' +
          Object.keys(themes).sort().map(function (t) {
            return '<option value="' + t + '">' + t + '</option>';
          }).join('');
        if (cur && themes[cur]) $('entry-theme-filter').value = cur;
      }
      function refilter() { renderEntryTable(window.__latestEntry); }
      if ($('entry-theme-filter') && !$('entry-theme-filter')._bound) {
        $('entry-theme-filter')._bound = true;
        $('entry-theme-filter').addEventListener('change', refilter);
      }
      if ($('entry-consider-only') && !$('entry-consider-only')._bound) {
        $('entry-consider-only')._bound = true;
        $('entry-consider-only').addEventListener('change', refilter);
      }
      if ($('entry-out')) $('entry-out').textContent = '點表格一列睇詳情';
      renderEntryTable(j);
      if (j && j.thinkingLog && j.thinkingLog.length && $('log-entry')) {
        $('log-entry').innerHTML = fmtLog(j.thinkingLog);
      }
      refreshLogs();
    }).catch(function (e) {
      if ($('entry-scan-status')) $('entry-scan-status').textContent = '未有進場檔：' + e.message;
      alog('entry-latest:miss', e.message);
    });
  }

  // Live-sync aliases（修復：原先呼叫 *Live 但未定義）
  function loadScreenerLatestLive() { loadScreenerLatest(); }
  function loadTechScanLatestLive() { loadTechScanLatest(); }
  function loadMacroReportLive() { loadMacroReport(); }
  function loadCompanyLatestLive() { loadCompanyLatest(); }
  function loadEntryLatestLive() { loadEntryLatest(); }

  function runCommander() {
    var ms = window.__latestMacro && window.__latestMacro.summaryTw;
    var ss = window.__latestScreener && window.__latestScreener.stats;
    var ts = window.__latestTech && window.__latestTech.topSetups;
    var cs = window.__latestCompany && window.__latestCompany.reports;
    var es = window.__latestEntry;
    var bundle = {
      macro: { headline: ms || (window.Macro ? '已載入 Macro 模組' : null) },
      screener: ss ? { summary: '通過 ' + ss.passed + '/' + ss.universe } : (window.Screener || null),
      tech: ts ? { summary: '掃描 top ' + ts.length + ' · ' + (ts[0] && ts[0].ticker) } : (window.Tech || null),
      company: cs ? { summary: '公司報告 ' + cs.length + ' · ' + (cs[0] && cs[0].ticker) } : (window.Company || null),
      entry: es || (window.Entry || null)
    };
    var sum = Commander.summarize(bundle);
    var extra = [];
    if (ms) extra.push('【大市】\n' + ms);
    if (ss) extra.push('【篩選】宇宙 ' + ss.universe + ' → 過 ' + ss.passed + '／拒 ' + ss.rejected);
    if (ts && ts.length) extra.push('【技術】前排：' + ts.slice(0,5).map(function (x) { return x.ticker + ' ' + (x.pattern || ''); }).join('、'));
    if (cs && cs.length) extra.push('【公司】' + cs.slice(0,5).map(function (x) {
      var L = x.leadership || {};
      return x.ticker + (L.isLeader ? '(領導)' : '(非領導)') + ' 護城河' + ((x.moat && x.moat.level) || '?');
    }).join('、'));
    $('commander-summary').textContent = sum.text + (extra.length ? '\n\n—— 最新刷新 ——\n' + extra.join('\n') : '');
    $('catalyst-list').innerHTML = Commander.listCatalysts().map(function (c) {
      return '<div class="bot"><div class="name">影響力 ' + c.score + '/10</div><div class="role">' +
        (c.date || '') + ' · ' + (c.title || '') + '</div><div class="muted">' + (c.note || (c.why || []).join('、')) + '</div></div>';
    }).join('');
    refreshLogs();
  }

  var SAMPLE_UNIVERSE = null;

  function renderScreenTable(rows) {
    if (!rows || !rows.length) {
      $('screen-table').innerHTML = '<p class="muted">無結果</p>';
      return;
    }
    $('screen-table').innerHTML = '<table><thead><tr><th>Ticker</th><th>名稱</th><th>主題</th><th>ETF</th><th>市值</th><th>價</th><th>SMA30</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var t = r.ticker || r.symbol || '';
        var cls = r.classification || r;
        return '<tr><td><b>' + t + '</b></td><td>' + (r.name || '') + '</td><td><span class="tag">' +
          (cls.theme || r.theme || '') + '</span></td><td>' + (cls.etf || r.etf || '') +
          '</td><td>' + (r.marketCap ? (r.marketCap / 1e9).toFixed(1) + 'B' : '') +
          '</td><td>' + (r.price != null ? r.price : '') + '</td><td>' + (r.sma30 != null ? r.sma30 : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function runScreenerUi() {
    var params = {
      mcapMin: Number($('f-mcap-min').value) * 1e9,
      mcapMax: Number($('f-mcap-max').value) * 1e9,
      volMin: Number($('f-vol-min').value) * 1e6,
      volMax: Number($('f-vol-max').value) * 1e6,
      priceAboveSma30: $('f-sma30').checked
    };
    alog('screener:ui-submit', params);
    function go(universe) {
      if (!window.Screener) {
        $('screen-summary').textContent = 'Screener 未載入';
        return;
      }
      Screener.setFilters({
        marketCapMin: params.mcapMin, marketCapMax: params.mcapMax,
        avgVol1mMin: params.volMin, avgVol1mMax: params.volMax,
        priceAboveSma30: params.priceAboveSma30
      });
      var res = Screener.runAndClassify(universe);
      var passed = res.results || res.passed || res.classified || [];
      var rej = Array.isArray(res.rejected) ? res.rejected.length : (res.rejectCount || 0);
      $('screen-summary').textContent = '通過 ' + passed.length + '／拒絕 ' + rej +
        '（宇宙 ' + (universe && universe.length) + '）';
      renderScreenTable(passed);
      refreshLogs();
    }
    if (SAMPLE_UNIVERSE) go(SAMPLE_UNIVERSE);
    else {
      fetch('data/screener-universe-sample.json').then(function (r) { return r.json(); }).then(function (j) {
        SAMPLE_UNIVERSE = j.universe || j;
        alog('screener:universe-loaded', SAMPLE_UNIVERSE.length);
        go(SAMPLE_UNIVERSE);
      }).catch(function (e) {
        $('screen-summary').textContent = '載入樣本宇宙失敗：' + e.message;
        alog('screener:universe-error', e.message);
      });
    }
  }

  function runTechSeed() {
    alog('tech:seed-start', 'ISRG');
    fetch('data/tech-seed-isrg.json').then(function (r) { return r.json(); }).then(function (seed) {
      if (!window.Tech) {
        $('tech-summary').textContent = 'Tech 未載入';
        return;
      }
      var report = Tech.analyzeTicker(seed.ohlcv, seed.meta || { ticker: seed.ticker });
      var sib = null;
      if (seed.siblings && seed.siblings.length) {
        // seed may already include computed siblings; still call findSiblings if ohlcv present
        var cands = [{ ticker: seed.ticker, theme: (seed.meta && seed.meta.theme) || '醫療', ohlcv: seed.ohlcv }].concat(
          seed.siblings.map(function (s) {
            return { ticker: s.ticker, name: s.name, theme: s.theme || '醫療', business: s.business, ohlcv: s.ohlcv || seed.ohlcv };
          })
        );
        try { sib = Tech.findSiblings(seed.ticker, cands); } catch (e) { sib = { error: e.message, seed: seed.siblings }; }
      }
      var lines = [];
      lines.push((report && report.summaryTw) || JSON.stringify(report && report.primaryPattern, null, 2));
      if (report && report.contractions) {
        lines.push('C1–C3: ' + report.contractions.map(function (c) {
          return (c.label || c.name || '') + ' ' + (c.pct != null ? c.pct.toFixed(1) + '%' : '');
        }).join(' → '));
      }
      if (report && report.pivot != null) lines.push('Pivot: $' + report.pivot);
      $('tech-summary').textContent = lines.join('\n');
      var chart = (report && report.chartPath) || (seed.meta && seed.meta.chartPath) || 'data/charts/ISRG_vcp_C1C2C3.png';
      $('tech-chart').src = (window.CHART_ASSETS && window.CHART_ASSETS[chart]) || chart;
      $('tech-chart').style.display = 'block';
      if (sib && sib.siblings) {
        $('tech-siblings').innerHTML = '<h3 style="color:#9aa6d0;font-size:13px">兄弟姊妹股</h3><table><thead><tr><th>Ticker</th><th>相關</th><th>提示</th></tr></thead><tbody>' +
          sib.siblings.map(function (s) {
            return '<tr><td>' + s.ticker + '</td><td>' + (s.corr60 != null ? s.corr60.toFixed(2) : '') +
              '</td><td class="muted">' + (s.institutionalHint || s.hint || s.business || '') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          (sib.siblingHint ? '<p class="muted">' + sib.siblingHint + '</p>' : '');
      } else if (seed.siblings) {
        $('tech-siblings').innerHTML = '<h3 style="color:#9aa6d0;font-size:13px">兄弟姊妹股（種子）</h3>' +
          seed.siblings.map(function (s) {
            return '<div class="bot"><div class="name">' + s.ticker + '</div><div class="role">' +
              (s.name || '') + '</div><div class="muted">' + (s.business || seed.siblingHint || '') + '</div></div>';
          }).join('');
      }
      refreshLogs();
      alog('tech:seed-done', seed.ticker);
    }).catch(function (e) {
      $('tech-summary').textContent = '載入技術種子失敗：' + e.message;
      alog('tech:seed-error', e.message);
    });
  }

  function runCompanySeed() {
    alog('company:seed-start', 'AXTI');
    if (!window.Company) { $('company-out').textContent = 'Company 未載入'; return; }
    var report = Company.analyzeSeed();
    if (report) showCompanyDetail(report, true);
    else if ($('company-out')) $('company-out').textContent = 'Company 種子無結果';
    refreshLogs();
    alog('company:seed-done', report && report.ticker);
  }

  function runEntrySeed() {
    alog('entry:seed-start', 'ISRG');
    if (!window.Entry) {
      if ($('entry-out')) $('entry-out').textContent = 'Entry 未載入';
      return;
    }
    var report = Entry.analyzeSeed();
    if (report) {
      if (!report.levels && (report.entry != null || report.stop != null)) {
        report.levels = { entry: report.entry, stop: report.stop, riskPct: report.riskPct };
      }
      showEntryDetail(report, true);
    } else if ($('entry-out')) {
      $('entry-out').textContent = 'Entry 種子無結果';
    }
    refreshLogs();
    alog('entry:seed-done', report && report.ticker);
  }


  var __lessonsIndex = null;
  var __lessonsCache = {};

  function loadLessonsCatalog() {
    fetch(bust('data/lessons/index.json')).then(function (r) { return r.json(); }).then(function (j) {
      __lessonsIndex = j;
      renderLessonsList();
      if ($('lessons-status')) {
        $('lessons-status').textContent = '教材 ' + ((j.lessons && j.lessons.length) || 0) + ' 篇 · 更新 ' + (j.updatedAt || '');
      }
      alog('lessons:loaded', { count: (j.lessons || []).length });
    }).catch(function (e) {
      if ($('lessons-status')) $('lessons-status').textContent = '未有教材庫：' + e.message;
      alog('lessons:error', e.message);
    });
  }

  function renderLessonsList() {
    if (!__lessonsIndex || !$('lessons-list')) return;
    var tier = ($('lessons-tier-filter') && $('lessons-tier-filter').value) || '';
    var rows = (__lessonsIndex.lessons || []).filter(function (L) {
      return !tier || L.tier === tier;
    });
    if (!rows.length) {
      $('lessons-list').innerHTML = '<div class="muted">無符合篩選的課文</div>';
      return;
    }
    $('lessons-list').innerHTML = '<table><thead><tr><th>標題</th><th>層級</th><th>價值</th><th>永久</th><th>圖</th></tr></thead><tbody>' +
      rows.map(function (L) {
        return '<tr class="lesson-row" data-id="' + L.id + '" style="cursor:pointer">' +
          '<td>' + L.title + '</td><td>' + L.tier + '</td><td>' + L.worth + '</td>' +
          '<td>' + (L.keepForever ? '是' : '否') + '</td><td>' + (L.chartCount || 0) + '</td></tr>';
      }).join('') + '</tbody></table>';
    Array.prototype.forEach.call(document.querySelectorAll('#lessons-list tr.lesson-row'), function (tr) {
      tr.addEventListener('click', function () { openLesson(tr.getAttribute('data-id')); });
    });
  }

  function openLesson(id) {
    function show(L) {
      var html = '<div><b>' + L.title + '</b> · ' + L.tier + ' · ' + L.worth +
        (L.keepForever ? ' · 永久保留' : '') + '</div>' +
        '<p style="margin:10px 0">' + (L.summary || '') + '</p>';
      if (L.rule) html += '<p><b>規則</b>：<code>' + L.rule + '</code></p>';
      if (L.do && L.do.length) html += '<p><b>要做</b></p><ul>' + L.do.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
      if (L.dont && L.dont.length) html += '<p><b>唔做</b></p><ul>' + L.dont.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
      if (L.tags && L.tags.length) html += '<p class="muted">tags: ' + L.tags.join(', ') + '</p>';
      $('lessons-detail').innerHTML = html;
      var box = $('lessons-charts');
      box.innerHTML = '';
      (L.chartRefs || []).forEach(function (c) {
        if (!c.chartPath) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div class="muted">' + (c.ticker || '') + ' — ' + (c.why || '') + '</div>';
        var img = document.createElement('img');
        img.alt = c.ticker || 'lesson chart';
        img.style.cssText = 'max-width:100%;border:1px solid #2a3560;border-radius:10px';
        img.src = bust(c.chartPath);
        wrap.appendChild(img);
        box.appendChild(wrap);
      });
      var anchor = $('lessons-detail-anchor');
      if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      alog('lessons:open', id);
    }
    if (__lessonsCache[id]) { show(__lessonsCache[id]); return; }
    fetch(bust('data/lessons/entries/' + id + '.json')).then(function (r) { return r.json(); }).then(function (L) {
      __lessonsCache[id] = L;
      show(L);
    }).catch(function (e) {
      $('lessons-detail').textContent = '載入失敗：' + e.message;
    });
  }


  function bind() {
    document.querySelectorAll('nav button').forEach(function (b) {
      b.addEventListener('click', function () { showPanel(b.dataset.panel); });
    });
    $('btn-refresh-log').addEventListener('click', refreshLogs);
    $('btn-commander').addEventListener('click', runCommander);
    if ($('btn-screen')) $('btn-screen').addEventListener('click', runScreenerUi);
    if ($('btn-tech')) $('btn-tech').addEventListener('click', runTechSeed);
    if ($('btn-tech-scan')) $('btn-tech-scan').addEventListener('click', loadTechScanLatest);
    if ($('btn-lessons')) $('btn-lessons').addEventListener('click', loadLessonsCatalog);
    if ($('lessons-tier-filter')) $('lessons-tier-filter').addEventListener('change', renderLessonsList);
    if ($('btn-train')) $('btn-train').addEventListener('click', function () {
      if (window.LessonsTraining && LessonsTraining.load) LessonsTraining.load();
      else if ($('train-status')) $('train-status').textContent = 'lessons-training.js 未載入';
    });
  if ($('tech-theme-filter')) $('tech-theme-filter').addEventListener('change', function () {
    renderTechScanTable();
  });
  if ($('tech-pass-only')) $('tech-pass-only').addEventListener('change', function () {
    renderTechScanTable();
  });
    if ($('btn-company')) $('btn-company').addEventListener('click', runCompanySeed);
    if ($('btn-entry')) $('btn-entry').addEventListener('click', runEntrySeed);
    if ($('btn-live-refresh')) $('btn-live-refresh').addEventListener('click', function () { liveRefreshAll('manual'); });
    if ($('live-sync-toggle')) {
      $('live-sync-toggle').addEventListener('change', function () {
        if ($('live-sync-toggle').checked) { startLiveSync(); liveRefreshAll('toggle-on'); }
        else stopLiveSync();
      });
    }
  }


  function checkFileProtocol() {
    var w = $('boot-warn');
    if (!w) return;
    if (location.protocol === 'file:') {
      w.style.display = 'block';
      w.innerHTML = '<b>而家係用 file:// 開頁，瀏覽器會擋 JSON／圖。</b><br>請關閉呢個分頁，喺 stockdesk 目錄跑：<code>python3 -m http.server 8765</code>，再開 <code>http://127.0.0.1:8765/</code>。';
      setLiveStatus('錯誤：file:// 無法載入資料');
      alog('boot:file-protocol', location.href);
    }
  }


  function loadCommanderLatest() {
    return fetch(bust('data/commander-latest.json')).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      window.__latestCommander = j;
      renderOverviewGate(j);
      alog('commander-latest:loaded', j && j.asOfHKT);
    }).catch(function (e) {
      alog('commander-latest:error', e.message);
      // fallback: derive from macro watch
      renderOverviewGate(null);
    });
  }

  function renderOverviewGate(cmd) {
    var el = $('overview-gate');
    if (!el) return;
    var g = cmd && cmd.premarketGate;
    var fired = g && g.triggered;
    var macro = window.__latestMacro;
    if (!fired && macro) {
      var blob = (macro.title || '') + ' ' + (macro.summaryTw || '') + ' ' + ((macro.watch || []).join ? macro.watch.join(' ') : '');
      if (/閘門\s*(觸發|FIRED)|gate\s*FIRED/i.test(blob)) fired = true;
    }
    if (!fired && !(g && g.cleared === false)) {
      // show quiet state only if we have explicit gate object
      if (g && g.triggered === false) {
        el.style.display = 'block';
        el.className = 'overview-gate ok';
        el.innerHTML = '<b>閘門未觸發</b> · QQQ ' + (g.qqqPct != null ? g.qqqPct + '%' : '—') +
          '／SPY ' + (g.spyPct != null ? g.spyPct + '%' : '—') +
          '（閾值 ' + (g.threshold != null ? g.threshold + '%' : '−0.65%') + '）';
        return;
      }
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.className = 'overview-gate';
    var pipe = (cmd && cmd.pipeline) || {};
    var fw = (cmd && cmd.fedWatch) || {};
    var cal = (cmd && cmd.calendar) || {};
    var ppi = cal.ppi || {};
    var holdLine = 'techPass 暫錨 ' + (pipe.techPassed != null ? pipe.techPassed : '—') +
      ' · 池 ' + (pipe.candidates != null ? pipe.candidates : '—') +
      (pipe.anchor ? ' · ' + pipe.anchor : '');
    var extra = '';
    if (fw.stance === 'hike-dominated' || (fw.octHike25Pct != null && fw.octHike25Pct >= 50)) {
      extra += '<br><b>FedWatch 加息主導</b> hold~' + (fw.octHoldPct != null ? fw.octHoldPct : '—') +
        '%／+25bp~' + (fw.octHike25Pct != null ? fw.octHike25Pct : '—') + '%';
    } else if (fw.octHoldPct != null) {
      extra += '<br>FedWatch hold~' + fw.octHoldPct + '%／hike~' + (fw.octHike25Pct != null ? fw.octHike25Pct : '—') + '%';
    }
    if (ppi.status === 'D-0' || (ppi.date && String(ppi.date).indexOf('2026-10-15') === 0)) {
      extra += '<br><b>PPI D-0</b> ' + (ppi.timeHKT || '20:30') + ' HKT' +
        (ppi.street ? ' · ' + ppi.street : '');
    }
    if (g && g.triggered) {
      el.innerHTML = '<b>🚨 閘門觸發</b> · QQQ ' + (g.qqqPct != null ? g.qqqPct + '%' : '—') +
        (g.qqqLaterPct != null ? '（其後 ~' + g.qqqLaterPct + '%）' : '') +
        '／SPY ' + (g.spyPct != null ? g.spyPct + '%' : '—') +
        ' · 閾值 ' + (g.threshold != null ? g.threshold + '%' : '−0.65%') +
        (g.driver ? '<br>' + g.driver : '') +
        extra +
        '<br>' + holdLine;
    } else {
      el.innerHTML = '<b>🚨 閘門觸發</b> · 見大市報告（Drok）' + extra + '<br>' + holdLine;
    }
  }

  function refreshOverviewKpis() {
    var ss = window.__latestScreener && window.__latestScreener.stats;
    var tech = window.__latestTech;
    var co = window.__latestCompany;
    var en = window.__latestEntry;
    if ($('kpi-pass') && ss) $('kpi-pass').textContent = (ss.passed != null ? ss.passed : '—') + '/' + (ss.universe != null ? ss.universe : '—');
    if ($('kpi-tech') && tech) {
      var n = (tech.analyses && tech.analyses.length) || (tech.scanned && tech.scanned.length) || (tech.topSetups && tech.topSetups.length) || 0;
      var top = (tech.topSetups && tech.topSetups[0] && tech.topSetups[0].ticker) || '';
      $('kpi-tech').textContent = n + (top ? ' · ' + top : '');
    }
    if ($('kpi-co') && co) $('kpi-co').textContent = String((co.reports && co.reports.length) || co.count || 0);
    if ($('kpi-entry') && en) $('kpi-entry').textContent = String((en.reports && en.reports.length) || en.count || 0);
    var bits = [];
    if (ss) bits.push('① 篩選 asOf ' + (window.__latestScreener.asOf || '') + ' · 過 ' + ss.passed);
    if (tech) bits.push('② 技術 asOf ' + (tech.asOfMarket || tech.generatedAt || '') + ' · top ' + ((tech.topSetups||[]).map(function(t){return t.ticker;}).slice(0,3).join('/') || '—'));
    if (co) bits.push('③ 公司 ' + ((co.reports||[]).length) + ' 隻');
    if (window.__latestMacro && window.__latestMacro.summaryTw) {
      var gbit = '④ 大市已載入';
      var mg = window.__latestCommander && window.__latestCommander.premarketGate;
      if (mg && mg.triggered) gbit += ' · 閘門觸發 QQQ ' + mg.qqqPct + '%';
      else if (/閘門\s*(觸發|FIRED)|gate\s*FIRED/i.test(window.__latestMacro.summaryTw || window.__latestMacro.title || '')) gbit += ' · 閘門觸發';
      bits.push(gbit);
    }
    if (window.__latestCommander && window.__latestCommander.pipeline) {
      var p = window.__latestCommander.pipeline;
      bits.push('⑥ 總司令 techPass ' + (p.techPassed != null ? p.techPassed : '—') +
        '／領導 ' + (p.leaders != null ? p.leaders : '—') +
        '／進場 ' + (p.entry != null ? p.entry : '—') +
        (p.anchor ? ' · ' + p.anchor : ''));
    }
    renderOverviewGate(window.__latestCommander || null);
    if (en) bits.push('⑤ 進場 ' + ((en.reports||[]).length || en.count || 0) + ' 隻');
    if ($('overview-live')) $('overview-live').textContent = bits.length ? bits.join('\n') : '尚未載入 latest JSON（若長期空白，請用 HTTP 開頁）';
  }

  function boot() {
    alog('boot', 'StockDesk shell');
    renderBots();
    bind();
    showPanel('overview');
    loadMacroReport();
    loadScreenerLatest();
    loadTechScanLatest();
    loadLessonsCatalog();
    if (window.LessonsTraining && LessonsTraining.load) LessonsTraining.load();
    loadCompanyLatest();
    loadEntryLatest();
    setTimeout(runCommander, 400);
    refreshLogs();
    startLiveSync();
    setLiveStatus('即時同步開啟 · 每 15 秒 · ' + new Date().toLocaleTimeString());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
