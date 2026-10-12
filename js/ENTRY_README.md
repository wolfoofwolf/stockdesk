# Entry（Arok · 第5項）

## 職責
進場策略：META / BO / Pullback，參考 Mark Minervini、JLaw。止損只接受 **6%**。必須與 `Company.isLeader` 對「係咪領導股」。

## API
```js
Entry.propose(snap)           // 直接用 snapshot（可含 isLeader）
Entry.withLeadership(snap, facts, hints)  // 先呼叫 Company.isLeader
Entry.analyzeSeed()           // ISRG 示範
Entry.getLog() / Entry.clearLog()
```

## snapshot 欄位
- `ticker, price, entry, pivot, pattern, contractions, stage2`
- `zone:{low,high}`, `volume`, `avgVolume`, `volumeDryUp`, `priorRunPct`
- `brokeTrendline`, `marketTrend:'up'|'down'`, `rsi`, `macdDivergence`
- `stop`, `target`, `closes[]`（可選，用於內建 RSI／MACD／SMA）
- `isLeader` 或交由 `withLeadership` 計算

## 方法
1. **META**：橫向 zone、MA 5/10/20/30/50/63/120/200 支持、MACD 交叉／背離、RSI 60–80、形態加分（≥2 邊緣）
2. **BO**：放量突破 pivot／趨勢線，最好 `marketTrend:'up'`
3. **Pullback**：大升後縮量回踩 zone，並盡量配合 META

非領導股 → `action: 降權／觀望`（即使技術達標）。

## 檔案
- `js/entry.js`
- `data/entry-seed-isrg.json`
