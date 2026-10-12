/* company.js - Jrok 第3項：公司分析報告
   繁中固定格式（順序不可改）＋上游／下游＋護城河＋領導股判斷（給 Arok 進場策略）
   用法：
     Company.analyze(facts)           // facts 見 README；缺欄會標「待補」並寫入 log
     Company.formatReport(report)     // 產出繁中完整報告字串
     Company.isLeader(facts, hints)   // 是否領導股（給 Entry／Arok）
     Company.getSeed() / Company.analyzeSeed()
     Company.getLog() / Company.clearLog()
*/
(function (global) {
  'use strict';
  var LOG = [];
  function log(step, detail) {
    var row = {
      t: new Date().toISOString(),
      bot: 'Jrok',
      role: '公司分析報告',
      step: step,
      detail: detail
    };
    LOG.push(row);
    return row;
  }

  function nz(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    return v;
  }

  function bulletList(arr) {
    if (!arr || !arr.length) return '（待補）';
    return arr.map(function (x) { return '• ' + x; }).join('\n');
  }

  function numbered(arr) {
    if (!arr || !arr.length) return '（待補）';
    return arr.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n');
  }

  // —— 領導股規則（Minervini／JLaw 風格，供 Arok 對接）——
  function isLeader(facts, hints) {
    log('isLeader:start', { ticker: facts && facts.ticker, hints: hints || null });
    facts = facts || {};
    hints = hints || {};
    var score = 0;
    var why = [];
    var flags = [];

    // 相對強度／產業地位
    if (facts.rsRating != null && facts.rsRating >= 80) { score += 2; why.push('RS≥80'); }
    else if (facts.rsRating != null && facts.rsRating < 70) { flags.push('RS偏弱'); }
    if (facts.themeLeader === true || facts.industryRank === 1) { score += 2; why.push('主題／產業領導'); }
    if (facts.moat === '高' || facts.moatHigh === true) { score += 2; why.push('高護城河'); }
    else if (facts.moat === '中') { score += 1; why.push('中等護城河'); }

    // 成長／盈利
    if (facts.epsGrowthYoY != null && facts.epsGrowthYoY >= 25) { score += 1; why.push('EPS YoY≥25%'); }
    if (facts.salesGrowthYoY != null && facts.salesGrowthYoY >= 20) { score += 1; why.push('銷售 YoY≥20%'); }
    if (facts.profitable === false && facts.nearProfit !== true) { flags.push('仍虧損且未近轉盈'); score -= 1; }
    if (facts.nearProfit === true) { why.push('接近／指引轉盈'); score += 1; }

    // 技術側提示（由 Grok Tech 傳入）
    if (hints.pattern === 'VCP' || hints.pattern === 'bull_flag') { score += 1; why.push('技術形態=' + hints.pattern); }
    if (hints.abovePivot === true) { score += 1; why.push('價在 pivot 上'); }
    if (hints.stage2 === false) { flags.push('非 Stage 2'); score -= 1; }

    // 市值過細或題材純炒作
    if (facts.marketCap != null && facts.marketCap < 3e9) { flags.push('市值低於 3B 篩選下限'); score -= 1; }

    var leader = score >= 5 && flags.indexOf('非 Stage 2') === -1;
    var verdict = {
      ticker: facts.ticker || null,
      isLeader: leader,
      score: score,
      why: why,
      flags: flags,
      note: leader
        ? '屬領導股候選：可交進場策略考慮 META／BO／Pullback（止損 6%）'
        : '暫非領導股：進場需降權或等待基本面／技術改善'
    };
    log('isLeader:done', verdict);
    return verdict;
  }

  function analyze(facts) {
    log('analyze:start', { ticker: facts && facts.ticker, name: facts && facts.name });
    facts = facts || {};
    var missing = [];
    ['ticker', 'name', 'overview', 'stats', 'geography', 'earningsCall', 'businessModel', 'competition', 'challenges', 'risksCatalysts', 'strategy', 'sources', 'valueChain', 'moat'].forEach(function (k) {
      if (facts[k] == null || facts[k] === '') missing.push(k);
    });
    if (missing.length) log('analyze:missing-fields', missing);

    var leader = isLeader(facts, facts.techHints || {});

    var report = {
      bot: 'Jrok',
      role: '公司分析報告',
      asOf: facts.asOf || new Date().toISOString().slice(0, 10),
      ticker: nz(facts.ticker, 'UNKNOWN'),
      name: nz(facts.name, '（待補公司名）'),
      theme: facts.theme || null,
      etf: facts.etf || null,
      sections: {
        overview: nz(facts.overview, '（待補：公司概覽）'),
        stats: facts.stats || { note: '（待補：關鍵統計數據）' },
        geography: facts.geography || { note: '（待補：地理市場及收入分佈）' },
        earningsCall: facts.earningsCall || { note: '（待補：最新業績電話會議）' },
        businessModel: facts.businessModel || { note: '（待補：收入來源及業務模式）' },
        competition: facts.competition || { note: '（待補：競爭格局與壟斷性）' },
        challenges: facts.challenges || [],
        risksCatalysts: facts.risksCatalysts || { risks: [], catalysts: [] },
        strategy: facts.strategy || [],
        sources: facts.sources || []
      },
      valueChain: facts.valueChain || { position: '待判定', detail: '（待補：上游／下游）' },
      moat: {
        level: typeof facts.moat === 'string' ? facts.moat : (facts.moatHigh ? '高' : (facts.moat || '待判定')),
        detail: facts.moatDetail || ''
      },
      leadership: leader,
      missingFields: missing,
      thinkingNote: '嚴格按固定章節順序產出；缺資料標待補，不捏造數字。'
    };

    report.textTw = formatReport(report);
    log('analyze:done', {
      ticker: report.ticker,
      moat: report.moat.level,
      valueChain: report.valueChain.position,
      isLeader: leader.isLeader,
      chars: report.textTw.length
    });
    return report;
  }

  function formatStats(stats) {
    if (!stats || typeof stats !== 'object') return '（待補）';
    if (stats.lines && stats.lines.length) return bulletList(stats.lines);
    var keys = Object.keys(stats).filter(function (k) { return k !== 'note'; });
    if (!keys.length) return nz(stats.note, '（待補）');
    return keys.map(function (k) { return '• ' + k + '：' + stats[k]; }).join('\n');
  }

  function formatGeo(geo) {
    if (!geo) return '（待補）';
    var parts = [];
    if (geo.regions) parts.push('地區分佈：\n' + bulletList(geo.regions));
    if (geo.products) parts.push('產品分佈：\n' + bulletList(geo.products));
    if (geo.customers) parts.push('客戶：\n' + bulletList(geo.customers));
    if (geo.note && !parts.length) return geo.note;
    return parts.length ? parts.join('\n\n') : '（待補）';
  }

  function formatCall(call) {
    if (!call) return '（待補）';
    if (call.fullText) return call.fullText;
    var parts = [];
    if (call.title) parts.push(call.title);
    if (call.results) parts.push('1. 關鍵報告結果\n' + bulletList(call.results));
    if (call.management) parts.push('2. 管理層評論\n' + (Array.isArray(call.management) ? call.management.join('\n') : call.management));
    if (call.guidance) parts.push('3. 指引／預測\n' + bulletList(call.guidance));
    if (call.investorPoints) parts.push('4. 投資者相關要點\n' + bulletList(call.investorPoints));
    if (call.note && !parts.length) return call.note;
    return parts.length ? parts.join('\n\n') : '（待補）';
  }

  function formatBiz(biz) {
    if (!biz) return '（待補）';
    if (biz.fullText) return biz.fullText;
    var parts = [];
    if (biz.products) parts.push('1. 收入來源及產品\n' + bulletList(biz.products));
    if (biz.model) parts.push('業務模式：' + biz.model);
    if (biz.growthDrivers) parts.push('2. 成長驅動因素\n' + bulletList(biz.growthDrivers));
    if (biz.concentration) parts.push('3. 客戶集中度\n' + (Array.isArray(biz.concentration) ? bulletList(biz.concentration) : biz.concentration));
    if (biz.note && !parts.length) return biz.note;
    return parts.length ? parts.join('\n\n') : '（待補）';
  }

  function formatComp(comp) {
    if (!comp) return '（待補）';
    if (comp.fullText) return comp.fullText;
    var parts = [];
    if (comp.market) parts.push(comp.market);
    if (comp.peers) parts.push('主要競爭者：\n' + bulletList(comp.peers));
    if (comp.advantages) parts.push('優勢：\n' + bulletList(comp.advantages));
    if (comp.monopolyAssessment) parts.push('壟斷性評估：' + comp.monopolyAssessment);
    if (comp.note && !parts.length) return comp.note;
    return parts.length ? parts.join('\n\n') : '（待補）';
  }

  function formatChallenges(ch) {
    if (!ch || !ch.length) return '（待補）';
    return ch.map(function (c) {
      if (typeof c === 'string') return '• ' + c;
      return '• ' + (c.challenge || '') + (c.response ? ' → 應對：' + c.response : '');
    }).join('\n');
  }

  function formatRisks(rc) {
    if (!rc) return '（待補）';
    var parts = [];
    if (rc.risks) parts.push('風險：\n' + bulletList(rc.risks));
    if (rc.catalysts) parts.push('催化劑：\n' + bulletList(rc.catalysts));
    return parts.length ? parts.join('\n\n') : '（待補）';
  }

  function formatReport(report) {
    log('formatReport:start', { ticker: report && report.ticker });
    var s = report.sections || {};
    var lines = [];
    lines.push('公司概覽');
    lines.push(report.name + ' (' + report.ticker + ') 概覽');
    lines.push(s.overview);
    lines.push('');
    lines.push('關鍵統計數據');
    lines.push(formatStats(s.stats));
    lines.push('');
    lines.push('地理市場及收入分佈');
    lines.push(formatGeo(s.geography));
    lines.push('');
    lines.push('最新業績電話會議（含關鍵結果、管理層評論、指引、投資者要點）');
    lines.push(formatCall(s.earningsCall));
    lines.push('');
    lines.push('收入來源及業務模式深入分析');
    lines.push(formatBiz(s.businessModel));
    lines.push('');
    lines.push('競爭格局與壟斷性分析');
    lines.push(formatComp(s.competition));
    lines.push('');
    lines.push('主要挑戰與應對策略');
    lines.push(formatChallenges(s.challenges));
    lines.push('');
    lines.push('風險因素與催化劑');
    lines.push(formatRisks(s.risksCatalysts));
    lines.push('');
    lines.push('戰略舉措');
    lines.push(bulletList(s.strategy));
    lines.push('');
    lines.push('資料來源');
    lines.push(bulletList(s.sources));
    lines.push('');
    lines.push('最後回答');
    lines.push('他是屬於上游還是下游的公司？');
    lines.push((report.valueChain && report.valueChain.position ? report.valueChain.position : '待判定') +
      (report.valueChain && report.valueChain.detail ? '——' + report.valueChain.detail : ''));
    lines.push('有沒有高護城河？');
    lines.push((report.moat && report.moat.level ? report.moat.level : '待判定') +
      (report.moat && report.moat.detail ? '——' + report.moat.detail : ''));
    lines.push('');
    lines.push('【領導股判斷｜交 Arok 進場策略】');
    if (report.leadership) {
      lines.push((report.leadership.isLeader ? '是領導股候選' : '暫非領導股') +
        '（score ' + report.leadership.score + '）');
      if (report.leadership.why && report.leadership.why.length) lines.push('理由：' + report.leadership.why.join('；'));
      if (report.leadership.flags && report.leadership.flags.length) lines.push('警旗：' + report.leadership.flags.join('；'));
      lines.push(report.leadership.note);
    }
    var text = lines.join('\n');
    log('formatReport:done', { chars: text.length });
    return text;
  }

  // —— AXTI 示範種子（用戶指定輸出格式範例，離線可跑）——
  var SEED_AXTI = {
    asOf: '2026-05-01',
    ticker: 'AXTI',
    name: 'AXT, Inc.',
    theme: '光通信',
    etf: 'SMH',
    overview:
      'AXT, Inc. 是一家材料科學公司，專注開發與製造高性能化合物半導體基板晶圓（compound semiconductor substrates），主要產品包括磷化銦（Indium Phosphide, InP）、砷化鎵（Gallium Arsenide, GaAs）及鍺（Germanium, Ge）。這些基板用於矽無法滿足效能需求的半導體與光電元件，核心應用為 AI 資料中心高速光學傳輸（silicon photonics）、5G 基礎建設、被動光纖網路、LED、雷射、感測器、無線功率放大器及衛星太陽能電池等。\n' +
      '核心價值主張：在 AI 基礎建設爆發下，InP 基板成為高速光模組關鍵材料（超越矽的效能）。公司透過中國合資廠（Tongmei）取得成本優勢，並積極擴產（2026 年底 InP 產能翻倍，2027 年再翻倍）。剛完成 6.325 億美元資本募集，用於擴產與 6 吋 InP R&D。目標成為 Tier-1 客戶主要供應商，抓住 AI 資料中心多億美元級成長週期。',
    stats: {
      lines: [
        '市值：約 62.8 億美元（股價近期因 AI 題材大幅上漲，波動極大）。',
        '市盈率 (P/E, TTM)：無意義（仍處虧損，EPS TTM -0.32 美元）。',
        'Forward P/E：高（市場對 Q2 轉盈及未來成長定價）。',
        '收入 (Q1 2026)：2,690 萬美元（YoY +39%，QoQ +17%，beat 預期）。',
        'TTM 收入：約 8,830 萬美元。',
        '毛利率 (Q1 GAAP)：29.6%（較 Q4 2025 的 20.9% 大幅改善，Q1 2025 為負）。',
        '淨損失 (Q1 GAAP)：160 萬美元（-0.03 美元/股），較去年同期大幅收窄；Non-GAAP 淨損 58.5 萬美元（-0.01 美元/股）。',
        '員工人數：約 1,072–1,541 人。',
        '現金與投資：1.23 億美元（Q1 減少 510 萬美元）。',
        'Backlog：InP 超過 1 億美元（強勁需求）。',
        'Q2 2026 指引：Non-GAAP EPS 0.06–0.08 美元（轉盈），GAAP 0.05–0.07 美元，預期 sequential 成長。'
      ]
    },
    geography: {
      regions: [
        '亞太 (Asia Pacific)：78%（中國為主要生產與銷售基地）。',
        '歐洲：21%。',
        '北美：1%。'
      ],
      products: [
        '磷化銦 (InP)：1,360 萬美元（50%+，主要 AI 資料中心光學應用）。',
        '砷化鎵 (GaAs)：540 萬美元。',
        '鍺基板：20 萬美元。',
        '原材料合資企業：760 萬美元。'
      ],
      customers: ['前五大客戶佔約 32%（無單一客戶超過 10%）。']
    },
    earningsCall: {
      title: 'AXTI Q1 2026 財報（2026 年 4 月 30 日公布，電話會議重點）',
      results: [
        '收入 2,690 萬美元（YoY +39%，beat 預期 2,670 萬美元）。',
        '毛利率大幅回升至 29.6%（Non-GAAP 29.9%），較去年同期負毛利大幅改善。',
        '淨損大幅收窄，Non-GAAP 每股虧損僅 0.01 美元。',
        'InP 需求強勁（AI 資料中心光學傳輸），backlog 超過 1 億美元。',
        '完成 6.325 億美元資本募集，支持 Tongmei InP 擴產與新產品 R&D。'
      ],
      management:
        '強調「AI 基礎建設多億美元級成長週期已啟動」，InP 是關鍵使能材料。公司正從「基礎供應商」轉向 Tier-1 客戶主要合作夥伴，已成功擴大客戶基礎（先前接觸有限的 Tier-1）。對 2026 年「sequential 成長」及 Q2 轉盈充滿信心。特別提到 6 吋 InP 與產能翻倍計畫，將成為產業關鍵討論議題。',
      guidance: [
        'Q2 2026：Non-GAAP EPS 0.06–0.08 美元（轉盈），GAAP 0.05–0.07 美元；收入 sequential 成長。',
        '長期：2026 年底 InP 產能翻倍，2027 年再翻倍；目標成為 AI 光學供應鏈核心玩家。'
      ],
      investorPoints: [
        'AI 題材催化劑強勁（InP 需求爆發 + 產能擴張 + 資本募集）。',
        '毛利率結構性改善（規模效應 + 產品 mix 優化）。',
        '高風險高報酬：仍處虧損但轉盈在即，估值已反映成長預期（市值 62.8 億美元 vs TTM 收入僅 8,800 萬美元）。',
        '股價近期大漲但波動劇烈（適合成長型投資者）。'
      ]
    },
    businessModel: {
      products: [
        '磷化銦 (InP)：核心成長引擎（AI 資料中心高速光學模組、silicon photonics）。Q1 貢獻逾 50% 收入。',
        '砷化鎵 (GaAs)：成熟產品，用於 5G、無線、LED 等。',
        '鍺 (Ge)：小眾（衛星太陽能）。',
        '合資企業：中國原材料生產，提供成本優勢與垂直整合。'
      ],
      model: '高技術壁壘的利基材料供應商，客戶為半導體／光電大廠，長期供應關係 + 高 switching cost。',
      growthDrivers: [
        'AI 資料中心光學升級：InP 是 800G/1.6T 光模組關鍵，需求多億美元級。',
        '產能擴張：2026–2027 年 InP 產能翻倍兩次，解決供給瓶頸。',
        '客戶多元化：從既有客戶擴大至 Tier-1 新客戶。',
        '資本募集：6.325 億美元支持擴產與 6 吋 InP R&D。',
        '毛利率改善：規模 + mix 優化，預期持續上行。'
      ],
      concentration: '前五大客戶約 32%（無超過 10% 單一客戶），相對分散。但亞太（中國）佔比高，地緣風險存在。backlog >1 億美元提供可見度。'
    },
    competition: {
      market: '化合物半導體基板市場（尤其是 InP）：高度集中，AXT 為全球 Top 3 InP 供應商之一。',
      peers: ['Sumitomo Electric（日本）', 'Japan Energy', '其他中國／歐美玩家'],
      advantages: [
        '中國成本優勢 + 積極擴產（領先同業）',
        '已切入 Tier-1 AI 供應鏈'
      ],
      monopolyAssessment: '利基寡占 + 高成長護城河（非絕對壟斷，但 InP 領域具顯著市佔與技術優勢）。AI 光學需求爆發下，產能領先者將大幅受益。vs 大型半導體材料商（如 Sumitomo），AXT 更具彈性與成長動能，但規模仍小。'
    },
    challenges: [
      { challenge: '地緣政治與出口管制風險（中國生產基地、美國出口許可）', response: '持續申請許可、多元化客戶與供應鏈' },
      { challenge: '產能執行風險（翻倍擴產延遲／成本超支）', response: '資本募集到位 + 分階段執行 + 6 吋新技術並行' },
      { challenge: '客戶集中與需求波動', response: '擴大 Tier-1 客戶基礎 + InP backlog 提供緩衝' },
      { challenge: '仍處虧損與現金消耗', response: 'Q2 轉盈指引 + 毛利率上行 + 資本募集強化資產負債表' },
      { challenge: '估值過高風險（市值遠高於當前收入）', response: '成長故事若不如預期，波動劇烈——需嚴控倉位' }
    ],
    risksCatalysts: {
      risks: ['中美貿易摩擦', '出口許可延遲', '擴產執行', '競爭者產能增加', '客戶延遲訂單'],
      catalysts: ['InP 需求超預期（AI 資料中心加速）', 'Q2 轉盈超預期', '6 吋 InP 進展', '更多 Tier-1 設計導入', 'Tongmei STAR Market IPO 進展']
    },
    strategy: [
      '重金擴產 InP：2026–2027 年產能翻倍兩次 + 6 吋新產線，鎖定 AI 光學領導地位。',
      '客戶升級：積極切入 Tier-1 供應鏈，成為「基礎供應商」轉「關鍵合作夥伴」。',
      '資本募集與 R&D：6.325 億美元用於擴產與新產品（6 吋 InP）。',
      '垂直整合：中國合資廠強化成本與供應鏈控制。',
      '長期願景：抓住 AI 基礎建設多億美元成長週期，成為化合物半導體基板全球領導者之一。'
    ],
    sources: [
      'AXT 官方 IR（investors.axt.com）',
      'Q1 2026 財報與電話會議（2026 年 4 月 30 日）',
      'Yahoo Finance、Seeking Alpha、市場分析等',
      'Q2 財報預計 7 月底公布'
    ],
    valueChain: {
      position: '上游',
      detail: '化合物半導體基板／晶圓材料供應商，位於光模組與光電元件產業鏈上游。'
    },
    moat: '中',
    moatDetail: 'InP 利基寡占與 switching cost 構成中高護城河，但面對 Sumitomo 等巨頭並非絕對壟斷；產能與 Tier-1 導入進度決定護城河能否升至「高」。',
    moatHigh: false,
    marketCap: 6.28e9,
    salesGrowthYoY: 39,
    profitable: false,
    nearProfit: true,
    themeLeader: false,
    rsRating: null,
    techHints: { pattern: 'VCP', stage2: true, abovePivot: false }
  };

  function getSeed() {
    return JSON.parse(JSON.stringify(SEED_AXTI));
  }

  function analyzeSeed() {
    log('analyzeSeed', 'AXTI demo');
    return analyze(getSeed());
  }

  global.Company = {
    analyze: analyze,
    formatReport: formatReport,
    isLeader: isLeader,
    getSeed: getSeed,
    analyzeSeed: analyzeSeed,
    getLog: function () { return LOG.slice(); },
    clearLog: function () { LOG = []; }
  };
  log('init', 'Company module ready (Jrok · 第3項)');
})(typeof window !== 'undefined' ? window : global);
