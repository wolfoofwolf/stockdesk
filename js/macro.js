/* macro.js - Drok 第4項：大市分析
   事件：CPI / PPI / NFP / FOMC；另支援七巨頭業績→板塊聯動
   輸出：報告物件 + thinking log（給 Trok 網頁顯示）
   用法：
     Macro.analyzeEvent({type:'CPI', date:'2026-10-09', actual, consensus, prior, spyDay, spyNextDays})
     Macro.analyzeMag7Earnings({ticker:'NVDA', date, segments, ledSectors})
     Macro.listEvents() / Macro.getLog()
*/
(function (global) {
  'use strict';
  var LOG = [];
  function log(step, detail) {
    var row = { t: new Date().toISOString(), bot: 'Drok', role: '大市分析', step: step, detail: detail };
    LOG.push(row);
    return row;
  }

  // 內建近期事件骨架（可被 Macro.ingest 覆蓋／追加）
  var EVENTS = [
  {
    "id": "nfp-2026-09",
    "type": "NFP",
    "date": "2026-10-03",
    "label": "非農就業（2026年9月）",
    "actual": 29000,
    "consensus": 90000,
    "extras": {
      "unemployment": 4.2,
      "ahe_mom": 0.1,
      "revisions": -60000
    },
    "spyDayReturn": 0.76,
    "note": "弱料＝利好暫停加息；10月加息機率約64%→~20%。長端息其後仍硬。",
    "status": "done",
    "sources": [
      "CME FedWatch／公開報道 2026-10"
    ]
  },
  {
    "id": "fomc-2026-09",
    "type": "FOMC",
    "date": "2026-09-16",
    "label": "FOMC（9月）",
    "hawkish": true,
    "decision": "+25bp → 3.75%–4.00%",
    "note": "全票加息；10月主流定價暫停。",
    "status": "done"
  },
  {
    "id": "cpi-2026-09",
    "type": "CPI",
    "date": "2026-10-14",
    "label": "CPI（2026年9月）—後天公布",
    "status": "upcoming",
    "consensusHeadlineYoY": 3.6,
    "consensusCoreYoY": 2.5,
    "priorHeadlineYoY": 3.4,
    "note": "08:30 ET。Cleveland nowcast ~3.60%／core MoM ~0.20%。Core ≤0.2% MoM 利好暫停；≥0.3% 可能令加息機率回升。",
    "sources": [
      "Cleveland Fed nowcast／Street consensus"
    ]
  },
  {
    "id": "ppi-2026-09",
    "type": "PPI",
    "date": "2026-10-15",
    "label": "PPI（2026年9月）",
    "status": "upcoming",
    "consensusHeadlineYoY": 5.3,
    "priorHeadlineYoY": 5.4,
    "note": "同日 Retail Sales。上游仍高，留意滯後傳導。",
    "status2": "upcoming"
  },
  {
    "id": "fomc-2026-10",
    "type": "FOMC",
    "date": "2026-10-28",
    "label": "FOMC 決定（10/27–28）",
    "status": "upcoming",
    "note": "聲明約 14:00 ET。CPI／PPI 後最終定價窗口。"
  }
];

  function candleVerdict(bar) {
    // bar: {o,h,l,c, prevHigh?, prevLow?, ma20?, ma50?}
    if (!bar || bar.o == null) return { code: 'unknown', text: '數據不足，未能判斷K線' };
    var up = bar.c >= bar.o;
    var range = bar.h - bar.l || 1e-9;
    var body = Math.abs(bar.c - bar.o);
    var upper = bar.h - Math.max(bar.o, bar.c);
    var lower = Math.min(bar.o, bar.c) - bar.l;
    var code, text;
    if (bar.c > bar.o && lower > body * 1.2 && upper < body * 0.5) {
      code = 'bullish_engulf_like'; text = '偏多：長下影／破腳穿頭味道（先殺低再收回）';
    } else if (bar.c < bar.o && upper > body * 1.2 && lower < body * 0.5) {
      code = 'bearish_shooting'; text = '偏空：長上影／破頭穿腳味道（先衝高再砸返）';
    } else if (up && body / range > 0.65) {
      code = 'strong_up'; text = '直直向上：實體偏長陽';
    } else if (!up && body / range > 0.65) {
      code = 'strong_down'; text = '直直向下：實體偏長陰';
    } else {
      code = 'mixed'; text = '膠住／十字味：實體細，方向未決';
    }
    var levels = [];
    if (bar.prevHigh != null && bar.c > bar.prevHigh) levels.push('收市創近期新高／破阻力');
    if (bar.prevLow != null && bar.c < bar.prevLow) levels.push('收市跌穿近期支持');
    if (bar.ma20 != null) levels.push(bar.c > bar.ma20 ? '企穩 SMA20 上方' : '跌穿／位於 SMA20 下方');
    if (bar.ma50 != null) levels.push(bar.c > bar.ma50 ? '企穩 SMA50 上方' : '跌穿／位於 SMA50 下方');
    return { code: code, text: text, levels: levels };
  }

  function surpriseLabel(actual, consensus) {
    if (actual == null || consensus == null) return { dir: 'na', text: '未提供實際／預期值' };
    var d = actual - consensus;
    if (Math.abs(d) < 1e-9) return { dir: 0, text: '符合預期' };
    return d > 0
      ? { dir: 1, text: '強過預期（actual > consensus）' }
      : { dir: -1, text: '弱過預期（actual < consensus）' };
  }

  function divergenceNote(dataStrong, marketUp) {
    // dataStrong: inflation hotter / NFP hotter → usually hawkish; for CPI/PPI hotter = "強"
    if (dataStrong === true && marketUp === false)
      return '留意：數據偏強但大市下跌（利淡解讀／估值壓力／升息預期升）';
    if (dataStrong === false && marketUp === true)
      return '留意：數據偏弱但大市上升（利好降息／軟著陸交易）';
    if (dataStrong === true && marketUp === true)
      return '數據偏強且大市上升（可能被解讀為經濟好而利率已定價，或風險偏好壓過利率）';
    if (dataStrong === false && marketUp === false)
      return '數據偏弱且大市下跌（衰退／需求差交易）';
    return '未能判斷數據—大市背離';
  }

  function analyzeEvent(input) {
    log('analyzeEvent:start', input);
    var type = (input && input.type) || 'UNKNOWN';
    var date = input.date;
    var sur = surpriseLabel(input.actual, input.consensus);
    // 對 CPI/PPI：高於預期 = 通脹強 = 偏 hawkish；NFP 高於預期 = 勞動強
    var dataStrong = sur.dir === 1;
    if (type === 'FOMC') dataStrong = !!input.hawkish;
    var spyRet = input.spyDayReturn; // e.g. +0.8 for +0.8%
    var marketUp = spyRet == null ? null : spyRet > 0;
    var candle = candleVerdict(input.spyCandle || null);
    var follow = (input.spyNextDays || []).map(function (d, i) {
      return {
        day: i + 1,
        returnPct: d.returnPct,
        note: d.returnPct > 0 ? '修復／延續上升' : d.returnPct < 0 ? '失地／延續下跌' : '平腳'
      };
    });
    var report = {
      bot: 'Drok',
      role: '大市分析',
      type: type,
      date: date,
      headline: (input.label || type) + ' @ ' + date,
      surprise: sur,
      divergence: marketUp == null ? '未提供當日大盤升跌' : divergenceNote(dataStrong, marketUp),
      spyDayReturn: spyRet,
      candle: candle,
      followThrough: follow,
      levelsNote: candle.levels,
      mag7Link: input.mag7Link || null,
      sources: input.sources || [],
      summaryTw: ''
    };
    report.summaryTw = [
      report.headline,
      '數據：' + sur.text,
      '當日大盤：' + (spyRet == null ? '未提供' : (spyRet >= 0 ? '+' : '') + spyRet + '%'),
      report.divergence,
      '收市K線：' + candle.text + (candle.levels.length ? '；' + candle.levels.join('；') : ''),
      follow.length ? ('其後' + follow.length + '日：' + follow.map(function (f) { return 'D+' + f.day + ' ' + f.returnPct + '%(' + f.note + ')'; }).join('，')) : '其後數日：待補'
    ].join('\n');
    log('analyzeEvent:done', { type: type, date: date, candle: candle.code, divergence: report.divergence });
    return report;
  }

  // 七巨頭：AAPL MSFT NVDA GOOGL AMZN META TSLA
  var MAG7 = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'];
  var SEG_TO_THEME = {
    'data-center': ['算力', '半導體'],
    'gpu': ['算力', '半導體'],
    'cloud': ['Software service', '算力'],
    'ads': ['Software service'],
    'iphone': ['Hardware'],
    'ev': ['智能駕駛', '能源'],
    'retail': ['雜項'],
    'search': ['Software service'],
    'networking': ['光通信', '算力']
  };

  function analyzeMag7Earnings(input) {
    log('mag7:start', input);
    var ticker = (input.ticker || '').toUpperCase();
    if (MAG7.indexOf(ticker) < 0) log('mag7:warn', '非七巨頭清單內，仍繼續分析');
    var segs = input.segments || []; // [{name, revenueMix, yoy, note}]
    segs = segs.slice().sort(function (a, b) { return (b.revenueMix || 0) - (a.revenueMix || 0); });
    var top = segs[0] || null;
    var themes = [];
    segs.forEach(function (s) {
      var key = (s.key || s.name || '').toLowerCase();
      Object.keys(SEG_TO_THEME).forEach(function (k) {
        if (key.indexOf(k) >= 0) themes = themes.concat(SEG_TO_THEME[k]);
      });
      if (s.themes) themes = themes.concat(s.themes);
    });
    themes = themes.filter(function (t, i, a) { return a.indexOf(t) === i; });
    var report = {
      bot: 'Drok',
      role: '大市分析',
      kind: 'mag7-earnings',
      ticker: ticker,
      date: input.date,
      topSegment: top,
      segments: segs,
      ledThemes: themes,
      marketDay: input.spyDayReturn,
      candle: candleVerdict(input.spyCandle || null),
      takeawayTw: '',
      sources: input.sources || []
    };
    report.takeawayTw = [
      ticker + ' 業績日 ' + (input.date || ''),
      top ? ('最賺／主引擎：' + top.name + (top.revenueMix != null ? '（佔比約 ' + top.revenueMix + '%）' : '') + (top.yoy != null ? '，YoY ' + top.yoy + '%' : '')) : '未提供業務拆分',
      themes.length ? ('可能帶動主題／板塊：' + themes.join('、')) : '板塊聯動待補',
      report.candle.text
    ].join('\n');
    log('mag7:done', { ticker: ticker, top: top && top.name, themes: themes });
    return report;
  }

  function ingestEvent(ev) {
    log('ingest', ev);
    var i = EVENTS.findIndex(function (e) { return e.id === ev.id || (e.type === ev.type && e.date === ev.date); });
    if (i >= 0) EVENTS[i] = Object.assign({}, EVENTS[i], ev);
    else EVENTS.push(ev);
    return EVENTS.slice();
  }

  global.Macro = {
    bot: 'Drok',
    role: '大市分析',
    MAG7: MAG7,
    listEvents: function () { return EVENTS.slice(); },
    ingestEvent: ingestEvent,
    analyzeEvent: analyzeEvent,
    analyzeMag7Earnings: analyzeMag7Earnings,
    candleVerdict: candleVerdict,
    getLog: function () { return LOG.slice(); },
    clearLog: function () { LOG = []; }
  };
  log('init', 'macro.js loaded');
})(typeof window !== 'undefined' ? window : global);
