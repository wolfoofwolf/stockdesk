# Jrok · 第3項 公司分析報告（給 Trok 接網頁）

## 檔案
- `js/company.js` — 邏輯（`Company` 全域）
- `data/company-seed-axti.json` — AXTI 示範種子＋完整繁中報告＋ thinking log

## API
```js
Company.analyze(facts)        // 產出報告物件（含 textTw、leadership、moat、valueChain）
Company.formatReport(report)  // 繁中固定章節順序字串
Company.isLeader(facts, hints)// 領導股判斷（給 Arok Entry）
Company.analyzeSeed()         // 跑內建 AXTI 示範
Company.getSeed()
Company.getLog() / Company.clearLog()
```

## 固定章節順序（不可改）
1. 公司概覽  
2. 關鍵統計數據  
3. 地理市場及收入分佈  
4. 最新業績電話會議  
5. 收入來源及業務模式深入分析  
6. 競爭格局與壟斷性分析  
7. 主要挑戰與應對策略  
8. 風險因素與催化劑  
9. 戰略舉措  
10. 資料來源  
11. 最後回答：上游／下游？有沒有高護城河？  
＋ 領導股判斷區塊（交 Arok）

## 網頁建議區塊
1. 輸入 ticker／載入種子按鈕 → `Company.analyzeSeed()` 或 `analyze(facts)`
2. 顯示 `report.textTw`（繁中全文）
3. 顯示 `report.leadership`（是否領導股、score、理由）
4. Thinking log：`Company.getLog()`（bot: Jrok）

載入次序：`company.js` 喺 `app.js` 之前。缺欄會標「待補」並寫入 log，不捏造數字。

## 即時同步
- 覆寫 `data/company-run-latest.json`（含 `reports[]`、`thinkingLog`、`asOf`）
- 網頁每 15 秒 `fetch` 此檔；開頁亦會載入
- 面板③顯示掃描表，點 ticker 睇繁中報告＋領導股判斷
