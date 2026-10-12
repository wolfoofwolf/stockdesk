/* screener.js - Frok 第1項：篩選器＋主題／ETF 歸類
   可 set 嘅 TradingView 風格篩選；主題／ETF 對照；思考 log 給 Trok 網頁
   用法：
     Screener.setFilters({ marketCapMin, marketCapMax, avgVol1mMin, avgVol1mMax, priceAboveSma30 })
     Screener.run(universe) / Screener.classify(ticker) / Screener.runAndClassify(universe)
     Screener.getLog() / Screener.clearLog()
   注意：本模組只篩「你提供嘅 universe」；即時行情抓取不在範圍內（見 optional stub）。
*/
(function (global) {
  'use strict';
  var LOG = [];
  function log(step, detail) {
    var row = { t: new Date().toISOString(), bot: 'Frok', role: '篩選器＋主題／ETF', step: step, detail: detail };
    LOG.push(row);
    return row;
  }

  var DEFAULTS = {
    marketCapMin: 3e9,      // 3B
    marketCapMax: 2e12,     // 2T
    avgVol1mMin: 1e6,       // 1M shares
    avgVol1mMax: 5e8,       // 500M shares
    priceAboveSma30: true
  };

  var filters = {
    marketCapMin: DEFAULTS.marketCapMin,
    marketCapMax: DEFAULTS.marketCapMax,
    avgVol1mMin: DEFAULTS.avgVol1mMin,
    avgVol1mMax: DEFAULTS.avgVol1mMax,
    priceAboveSma30: DEFAULTS.priceAboveSma30
  };

  // 內建精簡對照（完整表見 data/theme-etf-map.json；loadMap 可覆蓋）
  var THEME_ETF = {
    NVDA: { theme: '半導體', etf: 'SOX', reason: 'GPU／AI 晶片領導，SOX／SMH 核心權重' },
    AMD: { theme: '半導體', etf: 'SOX', reason: 'CPU／GPU，半導體 ETF' },
    AVGO: { theme: '半導體', etf: 'SOX', reason: 'ASIC／networking 晶片' },
    TSM: { theme: '半導體', etf: 'SOX', reason: '晶圓代工龍頭' },
    ASML: { theme: '半導體', etf: 'SMH', reason: 'EUV 設備，半導設備鏈' },
    AMAT: { theme: '半導體', etf: 'SMH', reason: '半導製程設備' },
    LRCX: { theme: '半導體', etf: 'SMH', reason: '蝕刻設備' },
    KLAC: { theme: '半導體', etf: 'SMH', reason: '量測／檢測設備' },
    MU: { theme: '記憶體', etf: 'SOX', reason: 'DRAM／NAND' },
    INTC: { theme: '半導體', etf: 'SOX', reason: 'CPU／代工轉型' },
    QCOM: { theme: '半導體', etf: 'SOX', reason: '手機／汽車 SoC' },
    ARM: { theme: '半導體', etf: 'SOX', reason: 'IP／架構授權' },
    MRVL: { theme: '半導體', etf: 'SOX', reason: '資料中心／車用晶片' },
    SMCI: { theme: '算力', etf: 'SOXX', reason: 'AI 伺服器／機架' },
    DELL: { theme: 'Hardware', etf: 'XLK', reason: '伺服器／PC 硬體' },
    HPE: { theme: 'Hardware', etf: 'XLK', reason: '企業伺服器／GreenLake' },
    ANET: { theme: '光通信', etf: 'IGV', reason: '資料中心交換器／光網路' },
    CIEN: { theme: '光通信', etf: 'IGV', reason: '光傳輸設備' },
    COHR: { theme: '光通信', etf: 'SMH', reason: '光元件／雷射' },
    AAOI: { theme: '光通信', etf: 'SMH', reason: '光模組' },
    LITE: { theme: '光通信', etf: 'SMH', reason: '光通訊元件' },
    FN: { theme: '光通信', etf: 'SMH', reason: '光模組代工' },
    TSLA: { theme: '智能駕駛', etf: 'BOTZ', reason: 'EV＋FSD／機器人' },
    ON: { theme: '智能駕駛', etf: 'SOX', reason: '車用功率／感測半導體' },
    MOBILEYE: { theme: '智能駕駛', etf: 'BOTZ', reason: 'ADAS 視覺' },
    ALB: { theme: '金屬稀土', etf: 'XME', reason: '鋰／電池金屬' },
    MP: { theme: '金屬稀土', etf: 'REMX', reason: '稀土' },
    FCX: { theme: '金屬稀土', etf: 'XME', reason: '銅礦' },
    SQM: { theme: '金屬稀土', etf: 'LIT', reason: '鋰化學品' },
    TECK: { theme: '金屬稀土', etf: 'XME', reason: '銅／鋅' },
    META: { theme: 'Software service', etf: 'IGV', reason: '社群／AI／雲端廣告' },
    MSFT: { theme: 'Software service', etf: 'IGV', reason: 'Azure／Office／AI' },
    GOOGL: { theme: 'Software service', etf: 'IGV', reason: '搜尋／雲／AI' },
    AMZN: { theme: '算力', etf: 'WCLD', reason: 'AWS 雲算力' },
    ORCL: { theme: 'Software service', etf: 'IGV', reason: '資料庫／雲' },
    CRM: { theme: 'Software service', etf: 'IGV', reason: 'CRM SaaS' },
    ADBE: { theme: 'Software service', etf: 'IGV', reason: '創意／文件 SaaS' },
    NOW: { theme: 'Software service', etf: 'IGV', reason: '企業工作流 SaaS → IGV' },
    SNOW: { theme: 'Software service', etf: 'IGV', reason: '雲數據倉' },
    PLTR: { theme: 'Software service', etf: 'IGV', reason: '數據／AI 平台' },
    DDOG: { theme: 'Software service', etf: 'IGV', reason: '可觀測性' },
    NET: { theme: 'Cyber security', etf: 'HACK', reason: 'CDN／Zero Trust' },
    PANW: { theme: 'Cyber security', etf: 'HACK', reason: '防火牆／雲安全' },
    CRWD: { theme: 'Cyber security', etf: 'HACK', reason: '端點安全' },
    ZS: { theme: 'Cyber security', etf: 'HACK', reason: '雲安全' },
    S: { theme: 'Cyber security', etf: 'HACK', reason: '端點' },
    FTNT: { theme: 'Cyber security', etf: 'HACK', reason: '網路安全' },
    COIN: { theme: '虛擬貨幣', etf: 'BITO', reason: '加密交易所' },
    MSTR: { theme: '虛擬貨幣', etf: 'BITO', reason: '比特幣資產／軟體' },
    MARA: { theme: '虛擬貨幣', etf: 'BITO', reason: '比特幣挖礦' },
    RIOT: { theme: '虛擬貨幣', etf: 'BITO', reason: '比特幣挖礦' },
    IONQ: { theme: '量子電腦', etf: 'QTUM', reason: '量子硬體' },
    RGTI: { theme: '量子電腦', etf: 'QTUM', reason: '量子運算' },
    QUBT: { theme: '量子電腦', etf: 'QTUM', reason: '量子' },
    CEG: { theme: '核能', etf: 'URA', reason: '核能發電／數據中心供電' },
    VST: { theme: '能源', etf: 'XLU', reason: '獨立發電／電力' },
    SMR: { theme: '核能', etf: 'NLR', reason: '小型模組化反應堆' },
    OKLO: { theme: '核能', etf: 'NLR', reason: '先進核能' },
    CCJ: { theme: '核能', etf: 'URA', reason: '鈾礦' },
    AAPL: { theme: 'Hardware', etf: 'XLK', reason: '消費電子／硬體生態' },
    IBM: { theme: 'Software service', etf: 'XLK', reason: '混合雲／AI／顧問' },
    JPM: { theme: '金融', etf: 'XLF', reason: '大型銀行' },
    GS: { theme: '金融', etf: 'XLF', reason: '投資銀行' },
    V: { theme: '金融', etf: 'XLF', reason: '支付網絡' },
    MA: { theme: '金融', etf: 'XLF', reason: '支付網絡' },
    UNH: { theme: '醫療', etf: 'XLV', reason: '醫療保險／服務' },
    LLY: { theme: '醫療', etf: 'XLV', reason: '製藥／減重藥' },
    ISRG: { theme: '醫療', etf: 'XLV', reason: '達文西手術機械人' },
    BA: { theme: '太空通訊', etf: 'ITA', reason: '航太／國防' },
    AVAV: { theme: '無人機', etf: 'ITA', reason: '無人機／無人系統' },
    KTOS: { theme: '無人機', etf: 'ITA', reason: '無人／國防電子' },
    RKLB: { theme: '太空通訊', etf: 'UFO', reason: '小型火箭／太空' },
    ASTS: { theme: '太空通訊', etf: 'UFO', reason: '太空手機通訊' },
    LUNR: { theme: '太空通訊', etf: 'UFO', reason: '月球／太空服務' },
    XOM: { theme: '能源', etf: 'XLE', reason: '上下游石油' },
    CVX: { theme: '能源', etf: 'XLE', reason: '綜合能源' },
    COP: { theme: '能源', etf: 'XLE', reason: '上游油氣' },
    SLB: { theme: '能源', etf: 'OIH', reason: '油田服務' },
    DOW: { theme: '化學工業', etf: 'XLB', reason: '基礎化學' },
    LIN: { theme: '化學工業', etf: 'XLB', reason: '工業氣體' },
    APD: { theme: '化學工業', etf: 'XLB', reason: '工業氣體' },
    SHW: { theme: '化學工業', etf: 'XLB', reason: '塗料化學' },
    SNDK: { theme: '記憶體', etf: 'SOX', reason: 'NAND／儲存' },
    WDC: { theme: '記憶體', etf: 'SOX', reason: '硬碟／NAND' },
    STX: { theme: '記憶體', etf: 'SOX', reason: '硬碟' },
    BE: { theme: '能源', etf: 'PBW', reason: '燃料電池／氫能' },
    ENPH: { theme: '能源', etf: 'TAN', reason: '太陽能逆變器' },
    FSLR: { theme: '能源', etf: 'TAN', reason: '太陽能模組' },
    GEV: { theme: '能源', etf: 'XLU', reason: '電力設備／電網' },
    ETN: { theme: '算力', etf: 'XLI', reason: '電氣／數據中心電力' },
    VRT: { theme: '算力', etf: 'BOTZ', reason: '液冷／數據中心基建' },
    CLS: { theme: 'Hardware', etf: 'XLK', reason: '電子製造服務' },
    JBL: { theme: 'Hardware', etf: 'XLK', reason: '電子代工' },
    TXN: { theme: '半導體', etf: 'SOX', reason: '類比晶片' },
    ADI: { theme: '半導體', etf: 'SOX', reason: '類比／混合信號' },
    NXPI: { theme: '半導體', etf: 'SOX', reason: '車用／工業 MCU' },
    SNPS: { theme: '半導體', etf: 'IGV', reason: 'EDA 軟體' },
    CDNS: { theme: '半導體', etf: 'IGV', reason: 'EDA 軟體' },
    MDB: { theme: 'Software service', etf: 'IGV', reason: '文件資料庫' },
    TEAM: { theme: 'Software service', etf: 'IGV', reason: '協作 SaaS' },
    INTU: { theme: 'Software service', etf: 'IGV', reason: '財務／稅務軟體' },
    SPOT: { theme: 'Software service', etf: 'ARKK', reason: '串流平台' },
    UBER: { theme: '智能駕駛', etf: 'ARKK', reason: '出行／自動駕駛佈局' },
    PATH: { theme: 'Software service', etf: 'BOTZ', reason: 'RPA／自動化' },
    AI: { theme: '算力', etf: 'BOTZ', reason: '企業 AI 平台' },
    APP: { theme: 'Software service', etf: 'IGV', reason: '移動廣告平台' },
    HOOD: { theme: '金融', etf: 'XLF', reason: '零售券商／加密' },
    SCHW: { theme: '金融', etf: 'XLF', reason: '券商／財富管理' },
    BLK: { theme: '金融', etf: 'XLF', reason: '資產管理' },
    PFE: { theme: '醫療', etf: 'XLV', reason: '大型製藥' },
    ABBV: { theme: '醫療', etf: 'XLV', reason: '製藥／免疫' },
    TMO: { theme: '醫療', etf: 'XLV', reason: '生命科學工具' },
    DHR: { theme: '醫療', etf: 'XLV', reason: '生命科學／診斷' },
    GE: { theme: '能源', etf: 'XLI', reason: '航太／能源設備（GE Vernova 分拆後仍相關）' },
    NOC: { theme: '太空通訊', etf: 'ITA', reason: '國防／航太' },
    LMT: { theme: '太空通訊', etf: 'ITA', reason: '國防／航太' },
    RTX: { theme: '太空通訊', etf: 'ITA', reason: '航太防務' },
    LHX: { theme: '太空通訊', etf: 'ITA', reason: '國防電子／通訊' }
  };

  var THEMES = [
    '半導體', '能源', '光通信', '智能駕駛', '金屬稀土', '算力',
    'Software service', 'Cyber security', '記憶體', '化學工業',
    '太空通訊', '虛擬貨幣', '量子電腦', '核能', 'Hardware',
    '金融', '醫療', '無人機', '雜項'
  ];

  function getDefaults() {
    return {
      marketCapMin: DEFAULTS.marketCapMin,
      marketCapMax: DEFAULTS.marketCapMax,
      avgVol1mMin: DEFAULTS.avgVol1mMin,
      avgVol1mMax: DEFAULTS.avgVol1mMax,
      priceAboveSma30: DEFAULTS.priceAboveSma30
    };
  }

  function setFilters(obj) {
    log('setFilters:start', obj);
    if (!obj || typeof obj !== 'object') {
      log('setFilters:warn', 'ignored non-object');
      return getFilters();
    }
    var keys = ['marketCapMin', 'marketCapMax', 'avgVol1mMin', 'avgVol1mMax', 'priceAboveSma30'];
    keys.forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null) filters[k] = obj[k];
    });
    // 允許額外 TradingView 風格欄位（預留，run 時若 universe 有對應欄就可用）
    Object.keys(obj).forEach(function (k) {
      if (keys.indexOf(k) < 0) filters[k] = obj[k];
    });
    log('setFilters:done', getFilters());
    return getFilters();
  }

  function getFilters() {
    var out = {};
    Object.keys(filters).forEach(function (k) { out[k] = filters[k]; });
    return out;
  }

  function passOne(s, f) {
    var reasons = [];
    var fail = [];
    if (s.marketCap == null) fail.push('缺 marketCap');
    else if (s.marketCap < f.marketCapMin || s.marketCap > f.marketCapMax) {
      fail.push('市值 ' + s.marketCap + ' 不在 [' + f.marketCapMin + ',' + f.marketCapMax + ']');
    } else {
      reasons.push('市值 OK');
    }
    if (s.avgVol1m == null) fail.push('缺 avgVol1m');
    else if (s.avgVol1m < f.avgVol1mMin || s.avgVol1m > f.avgVol1mMax) {
      fail.push('1M成交量 ' + s.avgVol1m + ' 不在 [' + f.avgVol1mMin + ',' + f.avgVol1mMax + ']');
    } else {
      reasons.push('成交量 OK');
    }
    if (f.priceAboveSma30) {
      if (s.price == null || s.sma30 == null) fail.push('缺 price/sma30');
      else if (!(s.price > s.sma30)) fail.push('價格 ' + s.price + ' ≤ SMA30 ' + s.sma30);
      else reasons.push('價格 > SMA30');
    }
    return { ok: fail.length === 0, reasons: reasons, fail: fail };
  }

  function run(universe) {
    log('run:start', { count: universe ? universe.length : 0, filters: getFilters() });
    var list = Array.isArray(universe) ? universe : [];
    var f = getFilters();
    var passed = [];
    var rejected = [];
    list.forEach(function (s) {
      if (!s || !s.ticker) {
        rejected.push({ ticker: '?', fail: ['缺 ticker'] });
        return;
      }
      var r = passOne(s, f);
      if (r.ok) {
        passed.push(Object.assign({}, s));
        log('run:pass', { ticker: s.ticker, reasons: r.reasons, marketCap: s.marketCap, avgVol1m: s.avgVol1m, price: s.price, sma30: s.sma30 });
      } else {
        rejected.push({ ticker: s.ticker, fail: r.fail });
        log('run:reject', { ticker: s.ticker, fail: r.fail });
      }
    });
    log('run:done', { passed: passed.length, rejected: rejected.length, tickers: passed.map(function (x) { return x.ticker; }) });
    return { passed: passed, rejected: rejected, filters: f };
  }

  function classifyOne(ticker) {
    var t = String(ticker || '').toUpperCase().trim();
    var hit = THEME_ETF[t];
    if (hit) {
      var row = { ticker: t, theme: hit.theme, etf: hit.etf, reason: hit.reason };
      log('classify:hit', row);
      return row;
    }
    var fallback = {
      ticker: t,
      theme: '雜項',
      etf: 'SPY',
      reason: '未入主題對照表 → 雜項；可參考 SPY／QQQ 作寬基'
    };
    log('classify:misc', fallback);
    return fallback;
  }

  function classify(tickerOrList) {
    if (Array.isArray(tickerOrList)) {
      log('classify:batch', { n: tickerOrList.length });
      return tickerOrList.map(function (x) {
        var tk = typeof x === 'string' ? x : (x && x.ticker);
        return classifyOne(tk);
      });
    }
    return classifyOne(tickerOrList);
  }

  function runAndClassify(universe) {
    log('runAndClassify:start', { n: universe ? universe.length : 0 });
    var result = run(universe);
    var classified = result.passed.map(function (s) {
      var c = classifyOne(s.ticker);
      return Object.assign({}, s, {
        theme: c.theme,
        etf: c.etf,
        reason: c.reason
      });
    });
    log('runAndClassify:done', {
      passed: classified.length,
      sample: classified.slice(0, 8).map(function (x) {
        return x.ticker + '→' + x.theme + '/' + x.etf;
      })
    });
    return {
      filters: result.filters,
      rejected: result.rejected,
      results: classified
    };
  }

  function loadMap(mapObj) {
    log('loadMap', { keys: mapObj ? Object.keys(mapObj).length : 0 });
    if (!mapObj || typeof mapObj !== 'object') return THEME_ETF;
    Object.keys(mapObj).forEach(function (k) {
      var v = mapObj[k];
      if (v && v.theme && v.etf) {
        THEME_ETF[String(k).toUpperCase()] = {
          theme: v.theme,
          etf: v.etf,
          reason: v.reason || (v.theme + ' → ' + v.etf)
        };
      }
    });
    return THEME_ETF;
  }

  /** Optional stub：即時抓取不在第1項範圍；Trok／其他 bot 可之後接真實 API */
  function fetchYahooStub(tickers) {
    log('fetchYahooStub', '未實作即時行情；請傳入 universe JSON。tickers=' + (tickers || []).join(','));
    return Promise.resolve({ ok: false, message: 'live fetch out of scope for Screener; provide universe' });
  }

  function listThemes() {
    return THEMES.slice();
  }

  function getMap() {
    var out = {};
    Object.keys(THEME_ETF).forEach(function (k) {
      out[k] = Object.assign({}, THEME_ETF[k]);
    });
    return out;
  }


  function groupByTheme(results) {
    var by = {};
    THEMES.forEach(function (th) { by[th] = []; });
    (results || []).forEach(function (row) {
      var th = row.theme || '雜項';
      if (!by[th]) by[th] = [];
      by[th].push({
        ticker: row.ticker,
        name: row.name,
        etf: row.etf,
        theme: th,
        marketCap: row.marketCap,
        avgVol1m: row.avgVol1m,
        price: row.price,
        sma30: row.sma30,
        reason: row.reason
      });
    });
    log('groupByTheme', {
      themes: Object.keys(by).filter(function (k) { return by[k].length; }).map(function (k) {
        return k + ':' + by[k].length;
      })
    });
    return by;
  }

  /** Build payload for data/screener-run-latest.json (Trok can fetch without re-click) */
  function exportRun(runResult, universeSize) {
    var results = (runResult && runResult.results) || [];
    var rejected = (runResult && runResult.rejected) || [];
    var payload = {
      asOf: new Date().toISOString(),
      bot: 'Frok',
      filters: (runResult && runResult.filters) || getFilters(),
      stats: {
        universe: universeSize != null ? universeSize : (results.length + rejected.length),
        passed: results.length,
        rejected: rejected.length
      },
      byTheme: groupByTheme(results),
      results: results,
      rejectedSample: rejected.slice(0, 15),
      log: LOG.slice(-40)
    };
    log('exportRun', { passed: payload.stats.passed, rejected: payload.stats.rejected });
    return payload;
  }

  global.Screener = {
    bot: 'Frok',
    role: '篩選器＋主題／ETF',
    THEMES: THEMES,
    getDefaults: getDefaults,
    setFilters: setFilters,
    getFilters: getFilters,
    run: run,
    classify: classify,
    runAndClassify: runAndClassify,
    loadMap: loadMap,
    getMap: getMap,
    listThemes: listThemes,
    groupByTheme: groupByTheme,
    exportRun: exportRun,
    fetchYahoo: fetchYahooStub,
    getLog: function () { return LOG.slice(); },
    clearLog: function () { LOG = []; }
  };
  log('init', 'screener.js loaded；預設市值3B–2T、1M成交量1M–500M、價格>SMA30；exportRun→screener-run-latest.json');
})(typeof window !== 'undefined' ? window : global);
