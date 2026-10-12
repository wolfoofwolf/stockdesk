/* tech.js - Grok 第2項：技術分析＋兄弟姊妹股／板塊
   日K形態：VCP、bull/bear flag、三底、Low Cheat、杯柄、三角、平底／上升底、通道
   趨勢線、兄弟股相關、板塊 ETF 形態備註
   輸出：報告物件 + thinking log（給 Trok 網頁顯示）
   用法：
     Tech.analyzeTicker(ohlcv, meta)
     Tech.findSiblings(ticker, candidates)
     Tech.sectorNote(etfSymbol, ohlcv)
     Tech.getLog() / Tech.clearLog()
*/
(function (global) {
  'use strict';
  var LOG = [];
  function log(step, detail) {
    var row = {
      t: new Date().toISOString(),
      bot: 'Grok',
      role: '技術分析＋兄弟姊妹股／板塊',
      step: step,
      detail: detail
    };
    LOG.push(row);
    return row;
  }

  function pct(a, b) {
    if (a == null || b == null || a === 0) return null;
    return ((a - b) / a) * 100;
  }

  function sma(arr, n) {
    if (!arr || arr.length < n) return null;
    var s = 0;
    for (var i = arr.length - n; i < arr.length; i++) s += arr[i];
    return s / n;
  }

  function returns(closes) {
    var r = [];
    for (var i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
      else r.push(0);
    }
    return r;
  }

  function correlation(a, b) {
    var n = Math.min(a.length, b.length);
    if (n < 5) return null;
    a = a.slice(-n);
    b = b.slice(-n);
    var ma = 0, mb = 0;
    for (var i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (var j = 0; j < n; j++) {
      var xa = a[j] - ma, xb = b[j] - mb;
      num += xa * xb;
      da += xa * xa;
      db += xb * xb;
    }
    if (da < 1e-12 || db < 1e-12) return 0;
    return num / Math.sqrt(da * db);
  }

  /** ZigZag swing points（最少 pctMove% 轉向） */
  function zigzag(bars, pctMove) {
    pctMove = pctMove == null ? 0.06 : pctMove;
    if (!bars || bars.length < 3) return [];
    var pts = [];
    var mode = null; // 'h' looking for high confirmation via drop, 'l' looking for low
    var extreme = bars[0];
    var extremeI = 0;
    for (var i = 1; i < bars.length; i++) {
      var b = bars[i];
      if (mode === null) {
        if ((b.h - bars[0].l) / (bars[0].l || 1) >= pctMove) {
          pts.push({ type: 'L', i: 0, bar: bars[0] });
          mode = 'h';
          extreme = b;
          extremeI = i;
        } else if ((bars[0].h - b.l) / (bars[0].h || 1) >= pctMove) {
          pts.push({ type: 'H', i: 0, bar: bars[0] });
          mode = 'l';
          extreme = b;
          extremeI = i;
        } else if (b.h > extreme.h) {
          extreme = b;
          extremeI = i;
        } else if (b.l < extreme.l) {
          extreme = b;
          extremeI = i;
        }
        continue;
      }
      if (mode === 'h') {
        if (b.h >= extreme.h) {
          extreme = b;
          extremeI = i;
        } else if ((extreme.h - b.l) / (extreme.h || 1) >= pctMove) {
          pts.push({ type: 'H', i: extremeI, bar: extreme });
          mode = 'l';
          extreme = b;
          extremeI = i;
        }
      } else {
        if (b.l <= extreme.l) {
          extreme = b;
          extremeI = i;
        } else if ((b.h - extreme.l) / (extreme.l || 1) >= pctMove) {
          pts.push({ type: 'L', i: extremeI, bar: extreme });
          mode = 'h';
          extreme = b;
          extremeI = i;
        }
      }
    }
    pts.push({ type: mode === 'h' ? 'H' : 'L', i: extremeI, bar: extreme });
    return pts;
  }

  function contractionFromHL(hBar, lBar) {
    var p = pct(hBar.h, lBar.l);
    return {
      highDate: hBar.date,
      high: hBar.h,
      lowDate: lBar.date,
      low: lBar.l,
      pct: p == null ? null : Math.round(p * 10) / 10
    };
  }

  /** 從 ZigZag 擷取最多 3 段收縮（C1→C2→C3），要求深度大致遞減；優先最近一段 */
  function detectVCP(bars) {
    log('pattern:scanVCP', 'ZigZag 掃描收縮段');
    var zz = zigzag(bars, 0.055);
    var hl = [];
    for (var i = 0; i < zz.length - 1; i++) {
      if (zz[i].type === 'H' && zz[i + 1].type === 'L') {
        var c = contractionFromHL(zz[i].bar, zz[i + 1].bar);
        c._hi = zz[i].i;
        c._li = zz[i + 1].i;
        hl.push(c);
      }
    }
    if (hl.length < 2) {
      log('pattern:VCP', '收縮段不足，未能確認 VCP');
      return null;
    }

    function scoreSlice(slice) {
      // 越高越好：深度遞減、末段夠緊、越近現價
      if (!slice || slice.length < 2) return -1e9;
      var s = 0;
      for (var k = 1; k < slice.length; k++) {
        if (slice[k].pct == null || slice[k - 1].pct == null) return -1e9;
        if (slice[k].pct <= slice[k - 1].pct * 1.05) s += 30;
        else if (slice[k].pct <= slice[k - 1].pct * 1.2) s += 10;
        else s -= 40;
      }
      var lastPct = slice[slice.length - 1].pct;
      if (lastPct <= 8) s += 25;
      else if (lastPct <= 12) s += 10;
      s += slice[0].pct >= 15 ? 15 : 0; // 首段要夠大先似 VCP
      s += slice[slice.length - 1]._li; // 越近越好
      if (slice.length === 3) s += 20;
      return s;
    }

    var best = null;
    var bestScore = -1e9;
    for (var n = 3; n >= 2; n--) {
      if (hl.length < n) continue;
      for (var s = 0; s <= hl.length - n; s++) {
        var slice = hl.slice(s, s + n);
        var sc = scoreSlice(slice);
        if (sc > bestScore) {
          bestScore = sc;
          var contractions = slice.map(function (c, idx) {
            return {
              label: 'C' + (idx + 1),
              pct: c.pct,
              highDate: c.highDate,
              high: c.high,
              lowDate: c.lowDate,
              low: c.low
            };
          });
          var lastH = slice[slice.length - 1];
          var pivot = lastH.high;
          var pivotDate = lastH.highDate;
          // 其後 60 根內的 swing high 可作 pivot 重試
          for (var z = 0; z < zz.length; z++) {
            if (zz[z].type === 'H' && zz[z].i >= lastH._hi && zz[z].i <= lastH._hi + 60 && zz[z].bar.h >= pivot * 0.98) {
              if (zz[z].bar.h >= pivot) {
                pivot = zz[z].bar.h;
                pivotDate = zz[z].bar.date;
              }
            }
          }
          best = {
            pattern: 'VCP',
            contractions: contractions,
            pivot: pivot,
            pivotDate: pivotDate,
            contracting: contractions[contractions.length - 1].pct < contractions[0].pct,
            _score: sc
          };
        }
      }
    }
    if (best && bestScore > 0) {
      log('pattern:VCP', best.contractions.map(function (c) {
        return c.label + ' ' + c.pct + '%';
      }).join(' → ') + '；pivot ' + best.pivot);
      return best;
    }
    log('pattern:VCP', '未找到合格遞減收縮');
    return null;
  }

  function detectFlag(bars) {
    // 旗形：近段急升／急跌（旗桿）後，窄幅反向通道（旗面）
    if (!bars || bars.length < 40) return null;
    var n = bars.length;
    var poleBars = bars.slice(n - 40, n - 15);
    var flagBars = bars.slice(n - 15);
    if (poleBars.length < 10 || flagBars.length < 8) return null;
    var poleLow = Math.min.apply(null, poleBars.map(function (b) { return b.l; }));
    var poleHigh = Math.max.apply(null, poleBars.map(function (b) { return b.h; }));
    var poleStart = poleBars[0].c;
    var poleEnd = poleBars[poleBars.length - 1].c;
    var poleMove = (poleEnd - poleStart) / poleStart;
    var flagHigh = Math.max.apply(null, flagBars.map(function (b) { return b.h; }));
    var flagLow = Math.min.apply(null, flagBars.map(function (b) { return b.l; }));
    var flagRange = (flagHigh - flagLow) / ((flagHigh + flagLow) / 2);
    var flagSlope = (flagBars[flagBars.length - 1].c - flagBars[0].c) / flagBars[0].c;

    if (poleMove > 0.12 && flagRange < 0.12 && flagSlope < 0.02) {
      log('pattern:bullFlag', '旗桿約 +' + (poleMove * 100).toFixed(1) + '%，旗面波幅 ' + (flagRange * 100).toFixed(1) + '%');
      return {
        pattern: 'bull_flag',
        poleMovePct: Math.round(poleMove * 1000) / 10,
        flagRangePct: Math.round(flagRange * 1000) / 10,
        pivot: flagHigh,
        poleHigh: poleHigh,
        poleLow: poleLow
      };
    }
    if (poleMove < -0.12 && flagRange < 0.12 && flagSlope > -0.02) {
      log('pattern:bearFlag', '旗桿約 ' + (poleMove * 100).toFixed(1) + '%，旗面波幅 ' + (flagRange * 100).toFixed(1) + '%');
      return {
        pattern: 'bear_flag',
        poleMovePct: Math.round(poleMove * 1000) / 10,
        flagRangePct: Math.round(flagRange * 1000) / 10,
        pivot: flagLow,
        poleHigh: poleHigh,
        poleLow: poleLow
      };
    }
    return null;
  }

  function detectTriangle(bars) {
    if (!bars || bars.length < 30) return null;
    var zz = zigzag(bars.slice(-50), 0.04);
    var highs = zz.filter(function (p) { return p.type === 'H'; }).slice(-3);
    var lows = zz.filter(function (p) { return p.type === 'L'; }).slice(-3);
    if (highs.length < 2 || lows.length < 2) return null;
    var hFlat = Math.abs(highs[highs.length - 1].bar.h - highs[0].bar.h) / highs[0].bar.h < 0.03;
    var lRising = lows[lows.length - 1].bar.l > lows[0].bar.l * 1.01;
    var hFalling = highs[highs.length - 1].bar.h < highs[0].bar.h * 0.99;
    var lFlat = Math.abs(lows[lows.length - 1].bar.l - lows[0].bar.l) / lows[0].bar.l < 0.03;
    if (hFlat && lRising) {
      log('pattern:ascTriangle', '高位近似水平、低點抬高');
      return { pattern: 'ascending_triangle', pivot: Math.max.apply(null, highs.map(function (h) { return h.bar.h; })) };
    }
    if (lFlat && hFalling) {
      log('pattern:descTriangle', '低位近似水平、高點降低');
      return { pattern: 'descending_triangle', pivot: Math.min.apply(null, lows.map(function (l) { return l.bar.l; })) };
    }
    if (hFalling && lRising) {
      log('pattern:symTriangle', '高點降低且低點抬高（對稱三角）');
      return { pattern: 'sym_triangle', pivot: highs[highs.length - 1].bar.h };
    }
    return null;
  }

  function detectChannel(bars) {
    if (!bars || bars.length < 40) return null;
    var slice = bars.slice(-40);
    var highs = slice.map(function (b) { return b.h; });
    var lows = slice.map(function (b) { return b.l; });
    // 簡易：高低點線性回歸斜率同向且通道寬度穩定
    function slope(vals) {
      var n = vals.length;
      var sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = 0; i < n; i++) {
        sx += i; sy += vals[i]; sxx += i * i; sxy += i * vals[i];
      }
      var den = n * sxx - sx * sx;
      if (Math.abs(den) < 1e-9) return 0;
      return (n * sxy - sx * sy) / den;
    }
    var sh = slope(highs);
    var sl = slope(lows);
    var mid = (highs[0] + lows[0]) / 2 || 1;
    var sameDir = (sh > 0 && sl > 0) || (sh < 0 && sl < 0);
    var parallel = Math.abs(sh - sl) / mid < 0.15;
    if (sameDir && parallel && Math.abs(sh) / mid > 0.02) {
      var dir = sh > 0 ? 'up' : 'down';
      log('pattern:channel', (dir === 'up' ? '上升' : '下降') + '通道');
      return { pattern: dir === 'up' ? 'rising_channel' : 'falling_channel', dir: dir };
    }
    return null;
  }

  function detectCupHandle(bars) {
    if (!bars || bars.length < 60) return null;
    var n = bars.length;
    var left = bars.slice(n - 60, n - 35);
    var bottom = bars.slice(n - 35, n - 15);
    var handle = bars.slice(n - 15);
    if (!left.length || !bottom.length || !handle.length) return null;
    var leftHigh = Math.max.apply(null, left.map(function (b) { return b.h; }));
    var cupLow = Math.min.apply(null, bottom.map(function (b) { return b.l; }));
    var rightHigh = Math.max.apply(null, handle.map(function (b) { return b.h; }));
    var depth = (leftHigh - cupLow) / leftHigh;
    var rimRecover = rightHigh / leftHigh;
    var handleLow = Math.min.apply(null, handle.map(function (b) { return b.l; }));
    var handleDepth = (rightHigh - handleLow) / rightHigh;
    if (depth > 0.12 && depth < 0.45 && rimRecover > 0.9 && handleDepth < 0.15 && handleDepth > 0.02) {
      log('pattern:cupHandle', '杯深 ' + (depth * 100).toFixed(1) + '%，柄深 ' + (handleDepth * 100).toFixed(1) + '%');
      return {
        pattern: 'cup_with_handle',
        cupDepthPct: Math.round(depth * 1000) / 10,
        handleDepthPct: Math.round(handleDepth * 1000) / 10,
        pivot: Math.max(leftHigh, rightHigh)
      };
    }
    return null;
  }

  function buildTrendlines(bars) {
    log('trendlines:start', '由 ZigZag 低點／高點擬合趨勢線');
    var zz = zigzag(bars, 0.06);
    var lows = zz.filter(function (p) { return p.type === 'L'; }).slice(-4);
    var highs = zz.filter(function (p) { return p.type === 'H'; }).slice(-4);
    var lines = [];
    if (lows.length >= 2) {
      var a = lows[lows.length - 2];
      var b = lows[lows.length - 1];
      lines.push({
        dir: b.bar.l >= a.bar.l ? 'up' : 'down',
        fromDate: a.bar.date,
        fromPrice: a.bar.l,
        toDate: b.bar.date,
        toPrice: b.bar.l,
        note: b.bar.l >= a.bar.l ? '低點抬高（上升趨勢線）' : '低點降低'
      });
    }
    if (highs.length >= 2) {
      var c = highs[highs.length - 2];
      var d = highs[highs.length - 1];
      lines.push({
        dir: d.bar.h <= c.bar.h ? 'down' : 'up',
        fromDate: c.bar.date,
        fromPrice: c.bar.h,
        toDate: d.bar.date,
        toPrice: d.bar.h,
        note: d.bar.h <= c.bar.h ? '高點降低（下降壓力線）' : '高點抬高'
      });
    }
    log('trendlines:done', lines.map(function (l) { return l.dir + '@' + l.toDate; }).join(', ') || '無');
    return lines;
  }

  function patternLabelTw(code) {
    var map = {
      VCP: 'VCP（波動收縮）',
      bull_flag: '上升旗形（Bull Flag）',
      bear_flag: '下降旗形（Bear Flag）',
      triple_bottom: '三底（Triple Bottom）',
      triple_top: '三頂（Triple Top）',
      low_cheat: 'Low Cheat（Minervini 提前進場）',
      ascending_triangle: '上升三角（Ascending Triangle）',
      descending_triangle: '下降三角（Descending Triangle）',
      sym_triangle: '對稱三角（Symmetrical Triangle）',
      rising_channel: '上升通道（Up Channel）',
      falling_channel: '下降通道（Down Channel）',
      cup_with_handle: '杯柄（Cup with Handle）',
      flat_base: '平底（Flat Base）',
      ascending_base: '上升底（Ascending Base）'
    };
    return map[code] || code;
  }

  /** Triple bottom: three ~equal lows (±3.5%) + neckline */
  function detectTripleBottom(bars) {
    if (!bars || bars.length < 60) return null;
    var window = bars.length > 120 ? bars.slice(-120) : bars;
    var offset = bars.length - window.length;
    var zz = zigzag(window, 0.04);
    var lows = zz.filter(function (p) { return p.type === 'L'; });
    if (lows.length < 3) return null;
    var best = null;
    for (var i = 0; i < lows.length - 2; i++) {
      var a = lows[i], b = lows[i + 1], c = lows[i + 2];
      if (b.i - a.i < 5 || c.i - b.i < 5) continue;
      var la = a.bar.l, lb = b.bar.l, lc = c.bar.l;
      var mid = (la + lb + lc) / 3;
      if (mid <= 0) continue;
      if (Math.max(Math.abs(la - mid), Math.abs(lb - mid), Math.abs(lc - mid)) / mid > 0.035) continue;
      var hiAb = 0, hiBc = 0, j;
      for (j = a.i; j <= b.i; j++) if (window[j].h > hiAb) hiAb = window[j].h;
      for (j = b.i; j <= c.i; j++) if (window[j].h > hiBc) hiBc = window[j].h;
      var neck = Math.max(hiAb, hiBc);
      var score = 72;
      best = {
        pattern: 'triple_bottom',
        lows: [
          { date: a.bar.date, price: Math.round(la * 100) / 100 },
          { date: b.bar.date, price: Math.round(lb * 100) / 100 },
          { date: c.bar.date, price: Math.round(lc * 100) / 100 }
        ],
        neckline: Math.round(neck * 100) / 100,
        pivot: Math.round(neck * 100) / 100,
        support: Math.round(mid * 100) / 100,
        _score: score
      };
    }
    if (best) log('pattern:triple_bottom', '頸線 $' + best.neckline);
    return best;
  }

  /** Minervini low cheat: tight plateau in lower half of base */
  function detectLowCheat(bars) {
    if (!bars || bars.length < 50) return null;
    var n = bars.length;
    var best = null;
    [50, 70, 90].forEach(function (w) {
      if (n < w) return;
      var win = bars.slice(-w);
      var leftN = Math.max(10, Math.floor(w / 3));
      var baseHigh = Math.max.apply(null, win.slice(0, leftN).map(function (b) { return b.h; }));
      var baseLow = Math.min.apply(null, win.map(function (b) { return b.l; }));
      var depth = (baseHigh - baseLow) / baseHigh;
      if (!(depth > 0.12 && depth < 0.5)) return;
      [8, 12, 16, 20].forEach(function (plen) {
        if (plen >= w - 5) return;
        var plat = win.slice(-plen);
        var ph = Math.max.apply(null, plat.map(function (b) { return b.h; }));
        var pl = Math.min.apply(null, plat.map(function (b) { return b.l; }));
        var pdepth = (ph - pl) / ph;
        if (!(pdepth >= 0.025 && pdepth <= 0.15)) return;
        var midP = (ph + pl) / 2;
        var pos = (midP - baseLow) / (baseHigh - baseLow || 1);
        if (!(pos >= 0.02 && pos <= 0.6)) return;
        var score = 62 + (pos <= 0.4 ? 18 : 8);
        var cand = {
          pattern: 'low_cheat',
          cheatDepthPct: Math.round(pdepth * 1000) / 10,
          baseDepthPct: Math.round(depth * 1000) / 10,
          basePosition: Math.round(pos * 100) / 100,
          pivot: Math.round(ph * 100) / 100,
          cheatHigh: Math.round(ph * 100) / 100,
          cheatLow: Math.round(pl * 100) / 100,
          _score: score
        };
        if (!best || score > best._score) best = cand;
      });
    });
    if (best) log('pattern:low_cheat', 'pivot $' + best.pivot + ' pos=' + best.basePosition);
    return best;
  }

  /** Flat / ascending base after advance */
  function detectFlatBase(bars) {
    if (!bars || bars.length < 50) return null;
    var n = bars.length;
    var best = null;
    [25, 30, 40].forEach(function (baseLen) {
      if (n < baseLen + 15) return;
      var prior = bars.slice(n - baseLen - 20, n - baseLen);
      var base = bars.slice(n - baseLen);
      if (!prior.length) return;
      var priorMove = (prior[prior.length - 1].c - prior[0].c) / prior[0].c;
      if (priorMove < 0.12) return;
      var bh = Math.max.apply(null, base.map(function (b) { return b.h; }));
      var bl = Math.min.apply(null, base.map(function (b) { return b.l; }));
      var depth = (bh - bl) / bh;
      if (depth > 0.16 || depth < 0.03) return;
      var third = Math.floor(baseLen / 3);
      var l1 = Math.min.apply(null, base.slice(0, third).map(function (b) { return b.l; }));
      var l3 = Math.min.apply(null, base.slice(-third).map(function (b) { return b.l; }));
      var ascending = l3 > l1 * 1.02;
      var score = 65 + (depth <= 0.12 ? 14 : 0) + (ascending ? 12 : 0);
      var cand = {
        pattern: ascending ? 'ascending_base' : 'flat_base',
        baseDepthPct: Math.round(depth * 1000) / 10,
        priorAdvancePct: Math.round(priorMove * 1000) / 10,
        pivot: Math.round(bh * 100) / 100,
        _score: score
      };
      if (!best || score > best._score) best = cand;
    });
    if (best) log('pattern:' + best.pattern, 'depth ' + best.baseDepthPct + '%');
    return best;
  }

  function pickPrimary(cands) {
    cands = cands.filter(Boolean);
    if (!cands.length) return { primary: null, alts: [] };
    cands.sort(function (a, b) { return (b._score || 0) - (a._score || 0); });
    var top = cands[0];
    if (top.pattern === 'VCP') {
      var margins = {
        bull_flag: 55, bear_flag: 55, triple_bottom: 55, low_cheat: 55,
        flat_base: 55, ascending_base: 55, cup_with_handle: 28,
        ascending_triangle: 40, descending_triangle: 40, sym_triangle: 40,
        rising_channel: 45, falling_channel: 45
      };
      var bestAlt = null;
      for (var i = 1; i < cands.length; i++) {
        var alt = cands[i];
        var m = margins[alt.pattern];
        if (m == null) continue;
        if ((alt._score || 0) >= (top._score || 0) - m) {
          if (!bestAlt || (alt._score || 0) > (bestAlt._score || 0)) bestAlt = alt;
        }
      }
      if (bestAlt) {
        return { primary: bestAlt, alts: [top].concat(cands.slice(1).filter(function (c) { return c !== bestAlt; })) };
      }
    }
    return { primary: top, alts: cands.slice(1) };
  }

  /**
   * @param {Array<{date,o,h,l,c,v}>} ohlcv
   * @param {{ticker?, name?, theme?, etf?, chartPath?}} meta
   */
  function analyzeTicker(ohlcv, meta) {
    meta = meta || {};
    var ticker = (meta.ticker || '').toUpperCase();
    log('analyzeTicker:start', { ticker: ticker, bars: ohlcv && ohlcv.length });
    if (!ohlcv || ohlcv.length < 30) {
      log('analyzeTicker:error', 'OHLCV 不足 30 根');
      return {
        bot: 'Grok',
        role: '技術分析＋兄弟姊妹股／板塊',
        ticker: ticker,
        error: 'OHLCV 不足',
        summaryTw: '數據不足，未能做日K形態分析'
      };
    }

    var last = ohlcv[ohlcv.length - 1];
    var closes = ohlcv.map(function (b) { return b.c; });
    var ma30 = sma(closes, 30);
    var ma50 = sma(closes, 50);

    var vcp = detectVCP(ohlcv);
    if (vcp) vcp._score = 100;
    var flag = detectFlag(ohlcv);
    if (flag) flag._score = flag._score || 95;
    var tri = detectTriangle(ohlcv);
    if (tri) tri._score = tri._score || 50;
    var chan = detectChannel(ohlcv);
    if (chan) chan._score = chan._score || 42;
    var cup = detectCupHandle(ohlcv);
    if (cup) cup._score = cup._score || 70;
    var triple = detectTripleBottom(ohlcv);
    var lowCheat = detectLowCheat(ohlcv);
    var flat = detectFlatBase(ohlcv);

    // 手動標註（種子／畫圖證明）可覆寫自動 VCP
    if (meta.manualPattern && meta.manualPattern.pattern === 'VCP' && meta.manualPattern.contractions) {
      log('pattern:manualVCP', meta.manualPattern.contractions.map(function (c) {
        return c.label + ' ' + c.pct + '%';
      }).join(' → ') + '；pivot ' + meta.manualPattern.pivot);
      vcp = {
        pattern: 'VCP',
        contractions: meta.manualPattern.contractions,
        pivot: meta.manualPattern.pivot,
        pivotDate: meta.manualPattern.pivotDate || null,
        contracting: true,
        source: 'manual'
      };
    }

    // 主形態：依分數＋多樣性（唔再強制全部 VCP）
    var picked = pickPrimary([vcp, flag, triple, lowCheat, cup, flat, tri, chan]);
    var primary = picked.primary;
    var alternates = picked.alts;

    var trendlines = buildTrendlines(ohlcv);
    var pivot = primary && primary.pivot != null ? primary.pivot : null;
    var status;
    if (pivot != null) {
      if (last.c > pivot) status = '收市已企穩／突破 pivot 上方';
      else if (last.h >= pivot && last.c < pivot) status = '盤中試破但收市仍低於 pivot';
      else status = '仍未破 pivot；收市低於突破位';
    }

    var contractionsTw = '';
    if (vcp && vcp.contractions) {
      contractionsTw = vcp.contractions.map(function (c) {
        return c.label + ' ' + c.pct + '%';
      }).join(' → ');
    }

    var report = {
      bot: 'Grok',
      role: '技術分析＋兄弟姊妹股／板塊',
      ticker: ticker,
      name: meta.name || null,
      theme: meta.theme || null,
      etf: meta.etf || null,
      timeframe: '日K',
      asOf: last.date,
      close: last.c,
      ma30: ma30 != null ? Math.round(ma30 * 100) / 100 : null,
      ma50: ma50 != null ? Math.round(ma50 * 100) / 100 : null,
      aboveMa30: ma30 != null ? last.c > ma30 : null,
      primaryPattern: primary ? primary.pattern : 'none',
      primaryLabelTw: primary ? patternLabelTw(primary.pattern) : '未識別清晰形態',
      detail: primary,
      alternates: alternates,
      contractions: vcp ? vcp.contractions : null,
      pivot: pivot,
      pivotDate: primary && primary.pivotDate ? primary.pivotDate : null,
      status: status || null,
      trendlines: trendlines,
      chartPath: meta.chartPath || null,
      summaryTw: ''
    };

    report.summaryTw = [
      ticker + (meta.name ? '（' + meta.name + '）' : '') + ' 日K技術分析 @ ' + last.date,
      '主形態：' + report.primaryLabelTw + (contractionsTw ? '；' + contractionsTw : ''),
      pivot != null ? ('Pivot／突破位：$' + pivot + (report.pivotDate ? '（' + report.pivotDate + '）' : '')) : 'Pivot：待定',
      '收市：$' + last.c + (status ? '；' + status : ''),
      ma30 != null ? ('相對 SMA30：' + (report.aboveMa30 ? '上方' : '下方') + '（SMA30≈' + report.ma30 + '）') : '',
      trendlines.length ? ('趨勢線：' + trendlines.map(function (l) { return l.note; }).join('；')) : '',
      meta.chartPath ? ('標註圖：' + meta.chartPath) : ''
    ].filter(Boolean).join('\n');

    log('analyzeTicker:done', {
      ticker: ticker,
      pattern: report.primaryPattern,
      pivot: pivot,
      close: last.c
    });
    return report;
  }

  /**
   * @param {string} ticker
   * @param {Array<{ticker, name?, theme?, business?, ohlcv, close?}>} candidates
   *        每個 candidate 需有 ohlcv（同長度或可對齊日期）或 closes[]
   */
  function findSiblings(ticker, candidates) {
    ticker = (ticker || '').toUpperCase();
    log('siblings:start', { ticker: ticker, n: candidates && candidates.length });
    candidates = candidates || [];
    var base = null;
    var others = [];
    candidates.forEach(function (c) {
      var t = (c.ticker || '').toUpperCase();
      if (t === ticker) base = c;
      else others.push(c);
    });
    if (!base || !base.ohlcv) {
      // 允許 base 不在清單：用第一個同 ticker 之外全當兄弟候選，相關改由 caller 預先放 closes
      log('siblings:warn', '清單無基準股 OHLCV，改用 candidates 兩兩對 ticker 的 closes／ohlcv');
    }

    function closesOf(c) {
      if (c.closes) return c.closes;
      if (c.ohlcv) return c.ohlcv.map(function (b) { return b.c; });
      return null;
    }

    var baseCloses = base ? closesOf(base) : null;
    // 若無 base，試從 meta 以外找不到就只做主題過濾
    var results = [];
    others.forEach(function (c) {
      var cl = closesOf(c);
      var corr = null;
      if (baseCloses && cl) {
        corr = correlation(returns(baseCloses), returns(cl));
        if (corr != null) corr = Math.round(corr * 1000) / 1000;
      }
      var sameTheme = base && c.theme && base.theme && c.theme === base.theme;
      var coMoving = corr != null && corr >= 0.45;
      var row = {
        ticker: (c.ticker || '').toUpperCase(),
        name: c.name || null,
        theme: c.theme || null,
        business: c.business || null,
        corr60: corr,
        close: c.close != null ? c.close : (cl ? cl[cl.length - 1] : null),
        sameTheme: !!sameTheme,
        coMoving: coMoving,
        institutionalHint: coMoving && sameTheme,
        note: ''
      };
      if (coMoving && sameTheme) {
        row.note = '同類業務且走勢同步（corr≈' + corr + '）→ 較似板塊／大戶部署';
      } else if (coMoving) {
        row.note = '走勢同步但主題未對齊，需人工確認業務';
      } else if (sameTheme) {
        row.note = '同主題但近月相關偏低，未必同步部署';
      } else {
        row.note = '相關／主題未達兄弟股門檻';
      }
      results.push(row);
      log('siblings:candidate', row.ticker + ' corr=' + corr + ' theme=' + row.theme + ' coMoving=' + coMoving);
    });

    results.sort(function (a, b) {
      return (b.corr60 || -1) - (a.corr60 || -1);
    });

    var hint = '';
    var strong = results.filter(function (r) { return r.institutionalHint; });
    if (strong.length) {
      hint = strong.map(function (r) { return r.ticker; }).join('／') +
        ' 與 ' + ticker + ' 近月同步，若同時收緊／突破，較似板塊資金部署而非單一個股。';
    } else {
      hint = '未見強同步兄弟股；可保留同主題名單繼續觀察。';
    }
    log('siblings:done', { count: results.length, hint: hint });
    return {
      bot: 'Grok',
      role: '技術分析＋兄弟姊妹股／板塊',
      ticker: ticker,
      siblings: results,
      siblingHint: hint,
      summaryTw: ticker + ' 兄弟姊妹股\n' +
        results.slice(0, 5).map(function (r) {
          return r.ticker + (r.corr60 != null ? ' corr60=' + r.corr60 : '') + ' — ' + r.note;
        }).join('\n') +
        '\n' + hint
    };
  }

  /**
   * @param {string} etfSymbol
   * @param {Array} ohlcv
   * @param {{name?, relatedTicker?, theme?}?} meta
   */
  function sectorNote(etfSymbol, ohlcv, meta) {
    meta = meta || {};
    etfSymbol = (etfSymbol || '').toUpperCase();
    log('sectorNote:start', { etf: etfSymbol, bars: ohlcv && ohlcv.length });
    var tech = ohlcv && ohlcv.length >= 30
      ? analyzeTicker(ohlcv, { ticker: etfSymbol, name: meta.name || etfSymbol, theme: meta.theme })
      : null;
    // analyzeTicker 會寫一串 log；再補板塊語境
    var note = {
      bot: 'Grok',
      role: '技術分析＋兄弟姊妹股／板塊',
      etf: etfSymbol,
      etfName: meta.name || null,
      relatedTicker: meta.relatedTicker || null,
      theme: meta.theme || null,
      asOf: tech ? tech.asOf : null,
      close: tech ? tech.close : null,
      pattern: tech ? tech.primaryPattern : 'unknown',
      patternLabelTw: tech ? tech.primaryLabelTw : '數據不足',
      pivot: tech ? tech.pivot : null,
      status: tech ? tech.status : null,
      trendlines: tech ? tech.trendlines : [],
      summaryTw: ''
    };
    note.summaryTw = [
      '板塊 ETF ' + etfSymbol + (meta.name ? '（' + meta.name + '）' : ''),
      meta.relatedTicker ? ('對應個股：' + meta.relatedTicker) : '',
      meta.theme ? ('主題：' + meta.theme) : '',
      '形態：' + note.patternLabelTw,
      note.pivot != null ? ('Pivot：$' + note.pivot) : '',
      note.close != null ? ('收市：$' + note.close + (note.status ? '；' + note.status : '')) : '',
      '若板塊 ETF 與個股同步收緊／破高，加強突破可信度；若背離則降權。'
    ].filter(Boolean).join('\n');
    log('sectorNote:done', { etf: etfSymbol, pattern: note.pattern });
    return note;
  }

  // 內建示範指針（網頁可 fetch tech-seed-isrg.json）
  var SEED_REF = {
    ticker: 'ISRG',
    chartPath: 'data/charts/ISRG_vcp_C1C2C3.png',
    seedPath: 'data/tech-seed-isrg.json',
    verified: {
      pattern: 'VCP',
      contractions: [
        { label: 'C1', pct: 26.0 },
        { label: 'C2', pct: 14.8 },
        { label: 'C3', pct: 6.6 }
      ],
      pivot: 443.84,
      close: 423.96,
      asOf: '2026-10-09'
    }
  };

  global.Tech = {
    bot: 'Grok',
    role: '技術分析＋兄弟姊妹股／板塊',
    SEED_REF: SEED_REF,
    analyzeTicker: analyzeTicker,
    findSiblings: findSiblings,
    sectorNote: sectorNote,
    zigzag: zigzag,
    detectVCP: detectVCP,
    getLog: function () { return LOG.slice(); },
    clearLog: function () { LOG = []; }
  };
  log('init', 'tech.js loaded');
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
