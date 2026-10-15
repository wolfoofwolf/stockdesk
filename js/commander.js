/* commander.js - Trok 第6項：資料蒐集（催化劑）＋總司令匯總
   Commander.getLog() / Commander.scoreCatalyst() / Commander.summarize()
*/
(function (global) {
  'use strict';
  var LOG = [];
  function log(step, detail) {
    var row = { t: new Date().toISOString(), bot: 'Trok', role: '資料蒐集＋總司令', step: step, detail: detail };
    LOG.push(row); return row;
  }

  var CATALYSTS = [
    {
      id: 'warsh-2026-10-16',
      date: '2026-10-16',
      title: 'Kevin Warsh（Fed 主席）IMF 曼谷 fireside chat',
      tickers: [],
      themes: ['大市', '利率'],
      score: 7,
      note: '11:30–12:00 HKT；同 Georgieva；10/28 FOMC 前最後公開（其後 blackout）'
    },
    {
      id: 'cpi-2026-10-14',
      date: '2026-10-14',
      title: '美國 CPI（9月）— 已公布（偏熱）',
      tickers: [],
      themes: ['大市', '利率'],
      score: 8,
      note: '已出 Headline +0.6%/+3.7%、Core +0.3%/+2.6%；餘震中'
    },
    {
      id: 'ppi-2026-10-15',
      date: '2026-10-15',
      title: '美國 PPI＋零售＋初請 — 今夜 20:30 HKT',
      tickers: [],
      themes: ['大市', '利率'],
      score: 7,
      note: 'CPI 後翌日；確認通脹路徑'
    },
    {
      id: 'fomc-2026-10-28',
      date: '2026-10-28',
      title: 'FOMC（10月）',
      tickers: [],
      themes: ['大市', '利率'],
      score: 8,
      note: '9月已+25bp至3.75–4.00%；主流定價暫停'
    },
    {
      id: 'pivot-watch-hpe-pltr-anet',
      date: '2026-10-12',
      title: '近 pivot 觀察：HPE／PLTR／ANET',
      tickers: ['HPE', 'PLTR', 'ANET'],
      themes: ['Hardware', 'Software service', '光通信'],
      score: 6,
      note: '今日休市；下一交易日睇能否收穩突破 pivot'
    },
    {
      id: 'seed-policy-1',
      date: '2026-10-01',
      title: '美國政府／產業政策監控骨架已就緒（待接入即時新聞源）',
      tickers: [],
      themes: ['算力', '半導體'],
      score: 3,
      note: '種子項目：後續每日監控政策撥款、出口管制、特朗普公開點名'
    }
  ];

  function scoreCatalyst(input) {
    log('scoreCatalyst:start', input);
    // 簡易評分 1–10：官方撥款/立法 > 口頭推介 > 傳聞
    var score = 5;
    var why = [];
    var t = ((input && input.title) || '') + ' ' + ((input && input.note) || '');
    if (/撥款|bill|act|executive|補貼|tariff|出口管制/i.test(t)) { score += 3; why.push('政策／立法級'); }
    if (/trump|特朗普|點名|推薦/i.test(t)) { score += 2; why.push('政治人物點名'); }
    if (/傳聞|rumor|據悉/i.test(t)) { score -= 2; why.push('傳聞降權'); }
    if (input && input.tickers && input.tickers.length) { score += 1; why.push('有明確標的'); }
    score = Math.max(1, Math.min(10, score));
    var row = Object.assign({ id: 'c' + Date.now(), score: score, why: why }, input || {});
    CATALYSTS.unshift(row);
    log('scoreCatalyst:done', { score: score, why: why, title: row.title });
    return row;
  }

  function summarize(bundle) {
    log('summarize:start', { keys: bundle ? Object.keys(bundle) : [] });
    bundle = bundle || {};
    var lines = [];
    lines.push('【總司令匯報】' + new Date().toISOString().slice(0, 10));
    lines.push('');
    lines.push('1) 篩選／主題：' + (bundle.screener ? '已有結果' : '等待 Frok 交檔'));
    lines.push('2) 技術／板塊：' + (bundle.tech ? '已有結果' : '等待 Grok 交檔'));
    lines.push('3) 公司分析：' + (bundle.company ? '已有結果' : '等待 Jrok 交檔'));
    lines.push('4) 大市：' + (bundle.macro ? '已接 Drok 模組' : '等待 Macro'));
    lines.push('5) 進場策略：' + (bundle.entry ? '已有結果' : '等待 Arok 交檔'));
    lines.push('6) 催化劑：現有 ' + CATALYSTS.length + ' 條監控項');
    if (bundle.macro && bundle.macro.headline) lines.push('   └ 大市要點：' + bundle.macro.headline);
    if (bundle.entry && bundle.entry.summary) lines.push('   └ 進場要點：' + bundle.entry.summary);
    lines.push('');
    lines.push('下一步：等第1／2／3／5項模組入 /workspace/stockdesk/ 後自動匯總上頁。');
    var text = lines.join('\n');
    log('summarize:done', { chars: text.length });
    return { text: text, at: new Date().toISOString() };
  }

  global.Commander = {
    listCatalysts: function () { return CATALYSTS.slice(); },
    scoreCatalyst: scoreCatalyst,
    summarize: summarize,
    getLog: function () { return LOG.slice(); },
    clearLog: function () { LOG = []; }
  };
  log('init', 'Commander ready');
})(window);
