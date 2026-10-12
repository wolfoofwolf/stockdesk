/* entry.js - Arok 第5項：進場策略
   META / BO / Pullback（Minervini／JLaw），止損只接受 6%
   必須同 Company.isLeader 對「係咪領導股」
   用法：
     Entry.propose(snap)          // 技術＋價格結構 → 建議
     Entry.withLeadership(snap)   // 先問 Company.isLeader 再 propose
     Entry.analyzeSeed()          // ISRG 示範
     Entry.getLog() / Entry.clearLog()
*/
(function (global) {
  'use strict';
  var LOG = [];
  var MAX_STOP = 0.06; // 6%

  function log(step, detail) {
    var row = {
      t: new Date().toISOString(),
      bot: 'Arok',
      role: '進場策略',
      step: step,
      detail: detail
    };
    LOG.push(row);
    return row;
  }

  function sma(closes, n) {
    if (!closes || closes.length < n) return null;
    var s = 0;
    for (var i = closes.length - n; i < closes.length; i++) s += closes[i];
    return s / n;
  }

  function ema(closes, n) {
    if (!closes || closes.length < n) return null;
    var k = 2 / (n + 1), e = closes[closes.length - n];
    for (var i = closes.length - n + 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return e;
  }

  function rsi(closes, n) {
    n = n || 14;
    if (!closes || closes.length < n + 1) return null;
    var gains = 0, losses = 0;
    for (var i = closes.length - n; i < closes.length; i++) {
      var d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    if (losses === 0) return 100;
    var rs = (gains / n) / (losses / n);
    return 100 - 100 / (1 + rs);
  }

  function macdCross(closes) {
    if (!closes || closes.length < 35) return { cross: null, hist: null };
    function e(n) { return ema(closes, n); }
    // rough: compare MACD line vs signal via last few hist signs
    var short = [], long = [];
    // compute last 10 macd values approximately
    var macds = [];
    for (var len = 26; len <= closes.length; len++) {
      var slice = closes.slice(0, len);
      var macd = ema(slice, 12) - ema(slice, 26);
      macds.push(macd);
    }
    if (macds.length < 9) return { cross: null, hist: null };
    // signal = ema of macd 9
    var sig = macds[macds.length - 9];
    var k = 2 / 10;
    for (var i = macds.length - 8; i < macds.length; i++) sig = macds[i] * k + sig * (1 - k);
    var hist = macds[macds.length - 1] - sig;
    var prevSig = macds[macds.length - 10];
    var k2 = 2 / 10, s2 = macds[macds.length - 10];
    for (var j = macds.length - 9; j < macds.length - 1; j++) s2 = macds[j] * k2 + s2 * (1 - k2);
    var prevHist = macds[macds.length - 2] - s2;
    var cross = null;
    if (prevHist <= 0 && hist > 0) cross = 'bullish';
    if (prevHist >= 0 && hist < 0) cross = 'bearish';
    return { cross: cross, hist: hist };
  }

  function near(a, b, pct) {
    if (a == null || b == null || b === 0) return false;
    return Math.abs(a - b) / b <= (pct || 0.015);
  }

  // —— META: Multiple Edge Trading Area ——
  function scoreMeta(snap) {
    log('META:start', { ticker: snap.ticker });
    var edges = [];
    var px = snap.price;
    var closes = snap.closes || [];
    var mas = {};
    [5, 10, 20, 30, 50, 63, 120, 200].forEach(function (n) {
      mas[n] = snap['sma' + n] != null ? snap['sma' + n] : sma(closes, n);
    });

    // MA support cluster
    var maHits = [];
    Object.keys(mas).forEach(function (n) {
      var m = mas[n];
      if (m != null && px >= m && near(px, m, 0.02)) maHits.push(+n);
    });
    if (maHits.length) edges.push({ id: 'ma_support', detail: '貼近 MA' + maHits.join('/') + ' 支持' });

    // Horizontal zone
    if (snap.zone) {
      var z = snap.zone;
      if (px >= z.low && px <= z.high) edges.push({ id: 'zone', detail: '位於橫向 zone $' + z.low + '–$' + z.high });
      else if (near(px, z.high, 0.02) || near(px, z.low, 0.02)) edges.push({ id: 'zone_edge', detail: '貼 zone 邊界' });
    }

    // MACD
    var m = snap.macd || macdCross(closes);
    if (m.cross === 'bullish') edges.push({ id: 'macd_cross', detail: 'MACD 金叉' });
    if (snap.macdDivergence === 'bullish') edges.push({ id: 'macd_div', detail: 'MACD 底背離' });

    // RSI
    var r = snap.rsi != null ? snap.rsi : rsi(closes, 14);
    if (r != null && r >= 60 && r <= 80) edges.push({ id: 'rsi_strong', detail: 'RSI ' + r.toFixed(1) + '（強但不極端）' });
    if (r != null && r > 80) edges.push({ id: 'rsi_hot', detail: 'RSI ' + r.toFixed(1) + ' 過熱，降權' });

    // Pattern from Tech
    if (snap.pattern === 'VCP' || snap.pattern === 'bull_flag') {
      edges.push({ id: 'pattern', detail: '形態 ' + snap.pattern + (snap.contractions ? ' ' + snap.contractions : '') });
    }

    var score = edges.filter(function (e) { return e.id !== 'rsi_hot'; }).length;
    if (edges.some(function (e) { return e.id === 'rsi_hot'; })) score -= 1;

    var ok = score >= 2;
    var out = {
      method: 'META',
      ok: ok,
      score: score,
      edges: edges,
      mas: mas,
      rsi: r,
      note: ok ? '多邊緣重疊，META 成立' : '邊緣不足（需 ≥2），META 不成立'
    };
    log('META:done', out);
    return out;
  }

  // —— Breakout ——
  function scoreBO(snap) {
    log('BO:start', { ticker: snap.ticker });
    var reasons = [];
    var px = snap.price;
    var pivot = snap.pivot;
    var vol = snap.volume;
    var avgVol = snap.avgVolume;
    var marketOk = snap.marketTrend == null ? null : snap.marketTrend === 'up';

    if (pivot != null && px >= pivot) reasons.push('價 ≥ pivot $' + pivot);
    if (snap.brokeTrendline === true) reasons.push('放量／有效突破趨勢線或阻力');
    if (vol != null && avgVol != null && vol >= avgVol * 1.4) reasons.push('成交量 ≥ 1.4× 均量');
    else if (vol != null && avgVol != null) reasons.push('量能未達 1.4×（弱）');
    if (marketOk === true) reasons.push('大盤上升配合');
    if (marketOk === false) reasons.push('大盤偏弱，BO 降權');

    var strong = (pivot != null && px >= pivot) && (vol == null || avgVol == null || vol >= avgVol * 1.2);
    if (snap.brokeTrendline) strong = true;
    if (marketOk === false) strong = false;

    var out = {
      method: 'BO',
      ok: !!strong,
      reasons: reasons,
      pivot: pivot,
      note: strong ? '突破條件達標' : '未確認突破（或缺量／大盤）'
    };
    log('BO:done', out);
    return out;
  }

  // —— Pullback buy ——
  function scorePullback(snap) {
    log('Pullback:start', { ticker: snap.ticker });
    var reasons = [];
    var priorRun = snap.priorRunPct; // e.g. 0.25 = +25%

    if (priorRun != null && priorRun >= 0.2) reasons.push('先前大升約 ' + (priorRun * 100).toFixed(0) + '%');
    if (snap.volumeDryUp || (snap.volume != null && snap.avgVolume != null && snap.volume < snap.avgVolume * 0.75)) {
      reasons.push('回踩縮量');
    }
    if (snap.zone && snap.price >= snap.zone.low && snap.price <= snap.zone.high) {
      reasons.push('回踩落入 zone $' + snap.zone.low + '–$' + snap.zone.high);
    }
    var meta = scoreMeta(snap);
    if (meta.ok) reasons.push('回踩處 META 同時成立');

    var ok = (priorRun == null || priorRun >= 0.15) && reasons.length >= 2 && meta.score >= 1;
    var out = {
      method: 'Pullback',
      ok: ok,
      reasons: reasons,
      metaScore: meta.score,
      note: ok ? '缩量回踩＋支持區，Pullback 成立' : 'Pullback 條件不足'
    };
    log('Pullback:done', out);
    return out;
  }

  function pickStop(entry, structuralStop) {
    // 止損最多 6%：取結構止損與 6% 中較緊（距離較小）者，但永不超過 6%
    var maxStopPx = entry * (1 - MAX_STOP);
    var stop = structuralStop != null ? Math.max(structuralStop, maxStopPx) : maxStopPx;
    // If structural is tighter (higher than maxStopPx for long), use structural; if wider, clamp to 6%
    if (structuralStop != null) {
      if (structuralStop >= maxStopPx) stop = structuralStop; // tighter or equal
      else stop = maxStopPx; // structural too wide → clamp 6%
    }
    var risk = (entry - stop) / entry;
    return { stop: round2(stop), riskPct: round2(risk * 100), clamped: structuralStop != null && structuralStop < maxStopPx };
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  function chooseStyle(snap, method) {
    // Position：領導股＋VCP/大升趨勢；Swing：BO／短線 META
    if (snap.isLeader && (method === 'Pullback' || snap.pattern === 'VCP')) return 'Position trade';
    if (method === 'BO') return 'Swing trade';
    return 'Swing trade';
  }

  function propose(snap) {
    snap = snap || {};
    log('propose:start', { ticker: snap.ticker, pattern: snap.pattern, isLeader: snap.isLeader });

    var leadership = {
      isLeader: !!snap.isLeader,
      source: snap.leadershipSource || 'snapshot',
      score: snap.leaderScore != null ? snap.leaderScore : null,
      note: snap.leaderNote || null
    };

    var meta = scoreMeta(snap);
    var bo = scoreBO(snap);
    var pb = scorePullback(snap);

    var candidates = [];
    if (meta.ok) candidates.push({ method: 'META', weight: meta.score, detail: meta });
    if (bo.ok) candidates.push({ method: 'BO', weight: 3 + (snap.marketTrend === 'up' ? 1 : 0), detail: bo });
    if (pb.ok) candidates.push({ method: 'Pullback', weight: 2 + (meta.ok ? 1 : 0), detail: pb });
    candidates.sort(function (a, b) { return b.weight - a.weight; });

    var best = candidates[0] || null;
    var entry = snap.entry != null ? snap.entry : snap.price;
    var structural = snap.stop != null ? snap.stop : (snap.zone ? snap.zone.low * 0.99 : entry * 0.94);
    var stopInfo = entry != null ? pickStop(entry, structural) : null;

    // Leadership gate（Minervini／JLaw）：非領導股 → 降權或不建議新倉
    var action = '觀望';
    var why = [];
    if (!best) {
      action = '觀望';
      why.push('META／BO／Pullback 皆未達標');
    } else if (!leadership.isLeader) {
      action = '降權／觀望';
      why.push('公司分析判定暫非領導股（需 @Jrok 確認改善後再開）');
      why.push('首選方法本可為 ' + best.method + '，但領導股條件未過');
    } else {
      action = '可考慮進場';
      why.push('領導股 + ' + best.method + ' 達標');
    }

    var style = best ? chooseStyle(Object.assign({}, snap, { isLeader: leadership.isLeader }), best.method) : null;

    var report = {
      bot: 'Arok',
      role: '進場策略',
      ticker: snap.ticker || null,
      asOf: snap.asOf || null,
      leadership: leadership,
      methods: { META: meta, BO: bo, Pullback: pb },
      bestMethod: best ? best.method : null,
      tradeStyle: style,
      action: action,
      why: why,
      levels: entry != null && stopInfo ? {
        entry: round2(entry),
        stop: stopInfo.stop,
        riskPct: stopInfo.riskPct,
        maxStopPct: 6,
        stopClampedTo6pct: stopInfo.clamped,
        targetHint: snap.target != null ? round2(snap.target) : (snap.pivot && entry < snap.pivot ? round2(snap.pivot) : null)
      } : null,
      rules: {
        stopMax: '6%',
        refs: ['Mark Minervini', 'JLaw'],
        methods: ['META', 'BO', 'Pullback']
      },
      summaryZh: null
    };

    report.summaryZh = [
      report.ticker + ' 進場策略（Arok）',
      '領導股：' + (leadership.isLeader ? '是' : '否') + (leadership.score != null ? '（score ' + leadership.score + '）' : ''),
      '建議：' + action + (best ? '｜方法 ' + best.method + '｜' + style : ''),
      stopInfo ? ('入場約 $' + report.levels.entry + '／止損 $' + report.levels.stop + '（風險 ' + report.levels.riskPct + '%，上限 6%）') : '水位不足，未給出入場價',
      '原因：' + why.join('；')
    ].join('\n');

    log('propose:done', { ticker: report.ticker, action: action, best: report.bestMethod, leader: leadership.isLeader });
    return report;
  }

  function withLeadership(snap, facts, hints) {
    log('withLeadership:start', { ticker: snap && snap.ticker });
    var leadership = { isLeader: false, source: 'none', score: null, note: '無 Company 模組，當作非領導股' };
    if (global.Company && typeof Company.isLeader === 'function') {
      var v = Company.isLeader(facts || { ticker: snap.ticker }, hints || {
        pattern: snap.pattern,
        abovePivot: snap.pivot != null && snap.price >= snap.pivot,
        stage2: snap.stage2 !== false
      });
      leadership = {
        isLeader: !!v.isLeader,
        source: 'Company.isLeader',
        score: v.score,
        note: v.note,
        why: v.why,
        flags: v.flags
      };
    } else if (snap && snap.isLeader != null) {
      leadership = {
        isLeader: !!snap.isLeader,
        source: 'snapshot',
        score: snap.leaderScore != null ? snap.leaderScore : null,
        note: snap.leaderNote || null
      };
    }
    var merged = Object.assign({}, snap, {
      isLeader: leadership.isLeader,
      leaderScore: leadership.score,
      leaderNote: leadership.note,
      leadershipSource: leadership.source
    });
    var report = propose(merged);
    report.leadership = leadership;
    log('withLeadership:done', leadership);
    return report;
  }

  // —— Seed：ISRG（配合 Grok tech seed）——
  var SEED_ISRG = {
    ticker: 'ISRG',
    asOf: '2026-10-09',
    price: 423.96,
    entry: 424,
    pivot: 443.84,
    pattern: 'VCP',
    contractions: 'C1 26%→C2 14.8%→C3 6.6%',
    stage2: true,
    zone: { low: 410, high: 430 },
    volume: 1.1e6,
    avgVolume: 1.6e6,
    volumeDryUp: true,
    priorRunPct: 0.35,
    brokeTrendline: false,
    marketTrend: 'up',
    rsi: 58,
    macdDivergence: null,
    closes: null, // optional
    stop: 410,
    target: 443.84,
    // leadership will be filled via Company or override
    isLeader: true,
    leaderScore: 6,
    leaderNote: '示範：ISRG 手術機器人領導，RS／主題強（seed）',
    leadershipSource: 'seed'
  };

  function getSeed() { return JSON.parse(JSON.stringify(SEED_ISRG)); }

  function analyzeSeed() {
    log('analyzeSeed', 'ISRG demo META/BO/Pullback');
    // Prefer live Company.isLeader if facts available
    if (global.Company && Company.getSeed) {
      try {
        var facts = Company.getSeed();
        // If seed is AXTI, still demo ISRG levels but leadership from optional override
      } catch (e) {}
    }
    return propose(getSeed());
  }

  global.Entry = {
    propose: propose,
    withLeadership: withLeadership,
    scoreMeta: scoreMeta,
    scoreBO: scoreBO,
    scorePullback: scorePullback,
    getSeed: getSeed,
    analyzeSeed: analyzeSeed,
    MAX_STOP_PCT: 6,
    getLog: function () { return LOG.slice(); },
    clearLog: function () { LOG = []; }
  };
  log('init', 'Entry module ready (Arok · 第5項 · 止損上限 6%)');
})(typeof window !== 'undefined' ? window : global);
