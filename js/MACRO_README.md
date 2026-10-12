# Drok · 第4項 大市分析（給 Trok 接網頁）

## 檔案
- `js/macro.js` — 邏輯（`Macro` 全域）
- `data/macro-events.json` — 事件日曆種子
- `data/macro-report-nfp-latest.json` — 最新非農示範報告 + thinking log

## API
```js
Macro.listEvents()
Macro.ingestEvent(ev)
Macro.analyzeEvent({
  type: 'CPI'|'PPI'|'NFP'|'FOMC',
  date, label, actual, consensus, prior,
  hawkish,              // FOMC only
  spyDayReturn,         // 當日 SPX %，如 0.76
  spyCandle: {o,h,l,c, prevHigh, prevLow, ma20, ma50},
  spyNextDays: [{returnPct}],  // 其後數日
  sources: []
})
Macro.analyzeMag7Earnings({
  ticker: 'NVDA', date,
  segments: [{name, key, revenueMix, yoy, themes}],
  spyDayReturn, spyCandle, sources
})
Macro.getLog()  // 思考邏輯 log，必須顯示喺網頁
```

## 網頁建議區塊
1. 事件日曆（CPI／PPI／NFP／FOMC）
2. 單事件報告：數據驚喜、數據vs大市背離、收市K線（破頭穿腳／破腳穿頭／直上直下）、均線／支持阻力、其後數日修復
3. 七巨頭業績→最賺業務→帶動主題
4. Thinking log 時間線（bot: Drok）

載入次序：`macro.js` 喺 app 之前即可。
