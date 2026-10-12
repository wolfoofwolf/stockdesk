# Grok · 第2項 技術分析＋兄弟姊妹股／板塊（給 Trok 接網頁）

## 檔案
- `js/tech.js` — 邏輯（`Tech` 全域）
- `data/tech-scan-latest.json` — **最新掃描**（yfinance 日K、對齊 Frok `screener-run-latest` 通過名單、thinkingLog）
- `data/tech-seed-isrg.json` — ISRG VCP 示範種子
- `data/charts/ISRG_vcp_C1C2C3.png` — ISRG 種子圖
- `data/charts/*_scan_VCP.png` — 掃描標註圖（例如 ANET／NVDA／AMD）
- `data/ohlcv/*.json` — 掃描用日K快取
- `scripts/fetch_and_scan.py` — 拉價＋形態掃描腳本

## API（tech.js）
```js
Tech.analyzeTicker(ohlcv, { ticker, name, theme, etf, chartPath, manualPattern? })
Tech.findSiblings(ticker, candidates)
Tech.sectorNote(etfSymbol, ohlcv, meta)
Tech.getLog() / Tech.clearLog()
Tech.SEED_REF
```
`ohlcv`：`{ date, o, h, l, c, v }`。

## 最新掃描 JSON
`data/tech-scan-latest.json`：
- `analyses[]`：每隻主形態、C1–C3、pivot、趨勢線、siblings、sectorNote、summaryTw
- `topSetups[]`：優先 **Frok 篩選通過**＋近 pivot 的 VCP
- `thinkingLog[]`：繁中思考 log（`bot: Grok`）
- `screenerAlign`：與 `screener-run-latest.json` 對齊結果
- `charts[]`：標註圖路徑

## 網頁（app.js）
- 開頁／按「載入最新技術掃描」→ `fetch('data/tech-scan-latest.json')`
- 表格列出 ticker／形態／C1–C3／收市／pivot／主題／兄弟股；「詳情」顯示 summary＋圖
- 「分析 ISRG 種子」仍可用（`tech-seed-isrg.json`）
- 思考 log 優先顯示掃描 `thinkingLog`

## 形態優先序
1. VCP（C1／C2／C3） 2. Cup with Handle 3. Bull／Bear Flag 4. Triangle 5. Channel

## 流水線
Frok 篩選＋主題／ETF → **Grok 本模組** → Jrok 公司 → Arok 進場；交 Trok 上網頁。

## 刷新紀錄
- **2026-10-12（HK）**：對齊 Frok `screener-run-latest`（67 通過），yfinance 日K 刷新（asOfMarket **2026-10-09**，當日美股 Columbus Day 休市）；掃描 15 隻；近 pivot Top：HPE／PLTR／ANET；圖 `HPE_scan_VCP.png`／`PLTR_scan_VCP.png`／`ANET_scan_VCP.png`。重跑：`python3 scripts/fetch_and_scan.py`
