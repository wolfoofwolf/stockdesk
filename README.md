# StockDesk

六項流水線網頁（Trok 整合）。本地用靜態伺服器打開 `index.html`。

| # | Bot | 職責 | 檔案 | 狀態 |
|---|-----|------|------|------|
| 1 | Frok | 篩選器＋主題／ETF | `js/screener.js` | ✅ |
| 2 | Grok | 技術＋兄弟股／板塊 | `js/tech.js` | ✅ |
| 3 | Jrok | 公司分析 | `js/company.js` | ✅ |
| 4 | Drok | 大市 | `js/macro.js` | ✅ |
| 5 | Arok | 進場策略 | `js/entry.js` | ✅ |
| 6 | Trok | 催化劑＋總司令＋網頁 | `js/commander.js` + `index.html` | ✅ |

每步思考 log：側欄 Bot 狀態 + 各面板 log +「思考 Log」總頁。


## 即時同步（Live sync）
頂部開關預設開啟，每 **15 秒** `fetch`（cache-bust）：
- `data/screener-run-latest.json`（Frok）
- `data/tech-scan-latest.json`（Grok）
- `data/macro-run-latest.json`（Drok）

各 bot 覆寫對應 JSON 後，開住頁面就會自動更新，唔使重新下載包。

**必須用 HTTP 伺服器**（`file://` 會被瀏覽器擋 fetch）：
```bash
cd stockdesk && python3 -m http.server 8765
# 開 http://localhost:8765
```
