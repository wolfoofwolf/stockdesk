# StockDesk

六項流水線美股工作台：篩選 → 技術 → 公司 → 大市 → 進場 → 總司令。

## 公開網頁（GitHub Pages）

目標網址：https://wolfoofwolf.github.io/stockdesk/

首次請到 repo **Settings → Pages**：
1. Source：Deploy from a branch
2. Branch：`main`，folder：`/ (root)`
3. Save，約 1–2 分鐘後開上面網址

## 本機（即時同步）

```bash
cd stockdesk
python3 -m http.server 8765
# 開 http://127.0.0.1:8765/
```

不要用 `file://` 雙擊開 HTML（瀏覽器會擋 JSON／圖）。

## 結構

- `index.html` / `css/` / `js/` — 前端
- `data/*-latest.json` — 各 bot 最新結果（頁面每 15 秒拉取）
- `data/charts/*.png` — 技術圖（目前未上 GitHub，Pages 上圖可能缺）
- `scripts/fetch_and_scan.py` — 離線掃描腳本

## 注意

Pages 係靜態快照，唔係 Bot 電腦嗰種 live。要接近即時需重新 push `*-latest.json`，或開 Bot 桌面睇 `8765`。
