# Frok · 第1項 篩選器＋主題／ETF（給 Trok 接網頁）

## 檔案
- `js/screener.js` — 邏輯（`Screener` 全域）
- `data/theme-etf-map.json` — ticker → 主題＋ETF（100+ 流動美股）
- `data/screener-universe-sample.json` — 離線示範 universe（約 130 檔；price/sma30 可 Yahoo chart 刷新）
- `data/screener-run-latest.json` — 最新一次預設篩選＋主題／ETF 結果（給網頁直接載入）

## 預設篩選（TradingView 風格，可 set）
| 欄位 | 預設 |
|------|------|
| `marketCapMin` | 3e9（3B） |
| `marketCapMax` | 2e12（2T） |
| `avgVol1mMin` | 1e6（1M 股） |
| `avgVol1mMax` | 5e8（500M 股） |
| `priceAboveSma30` | `true`（價格 > SMA30） |

`Screener.setFilters({...})` 會同預設 merge；可加額外欄位預留。

## API
```js
Screener.getDefaults()
Screener.setFilters({ marketCapMin, marketCapMax, avgVol1mMin, avgVol1mMax, priceAboveSma30 })
Screener.getFilters()
Screener.run(universe)              // { passed, rejected, filters }
Screener.classify('NOW')            // { ticker, theme, etf, reason }
Screener.classify(['NVDA','NOW'])   // 陣列
Screener.runAndClassify(universe)   // { filters, rejected, results[] } 每筆含 theme/etf
Screener.loadMap(mapObj)            // 用 theme-etf-map.json 嘅 map 覆蓋／擴充
Screener.listThemes()
Screener.getLog()                   // 思考邏輯 log（必須顯示）
Screener.clearLog()
Screener.groupByTheme(results)      // 按主題分桶
Screener.exportRun(runResult, n)      // 產出 screener-run-latest.json 形狀
Screener.fetchYahoo(tickers)        // stub：即時抓取不在範圍，請傳 universe
```

### universe 單筆格式
```js
{ ticker, name, marketCap, avgVol1m, price, sma30, sector? }
```
- `marketCap`：美元
- `avgVol1m`：股數（約 1 個月日均量）
- `price`／`sma30`：價格

## 主題清單（固定）
半導體、能源、光通信、智能駕駛、金屬稀土、算力、Software service、Cyber security、記憶體、化學工業、太空通訊、虛擬貨幣、量子電腦、核能、Hardware、金融、醫療、無人機、雜項

範例：`NOW → Software service / IGV`，`NVDA → 半導體 / SOX`

## 網頁建議區塊
1. **篩選表單**：綁 `Screener.setFilters`（市值、成交量、價格>SMA30 開關）
2. **結果表**：ticker、名稱、theme、etf、marketCap、avgVol1m、price vs sma30
3. **Thinking log 時間線**：`Screener.getLog()`（bot: Frok，role: 篩選器＋主題／ETF）
4. 「執行篩選」掣：讀表單 → `runAndClassify(universe)` → 刷新表同 log

## 載入次序
`screener.js` 喺 core 之後、app 之前。建議：
```html
<script src="js/screener.js"></script>
<!-- 可 async 載入 data/theme-etf-map.json 後 Screener.loadMap(json.map) -->
<!-- data/screener-universe-sample.json 做離線 demo -->
<!-- 建議啟動時 fetch data/screener-run-latest.json 顯示最新結果，無需重撳 -->
```

## 注意
- 本模組**只篩你提供嘅 universe**，唔負責即時行情。
- 未知 ticker → `雜項` + `SPY`（寬基備註）。
- 唔改 `macro.js`；唔做 index.html（頁面屬 Trok）。
