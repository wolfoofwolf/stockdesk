#!/usr/bin/env python3
"""Grok Item-2: fetch OHLCV, run Tech pattern scan, write tech-scan-latest.json + charts."""
from __future__ import annotations
import json, math, subprocess, os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

ROOT = Path("/workspace/stockdesk")
DATA = ROOT / "data"
OUT = DATA / "tech-scan-latest.json"
CHARTS = DATA / "charts"
OHLCV_DIR = DATA / "ohlcv"
OHLCV_DIR.mkdir(parents=True, exist_ok=True)
CHARTS.mkdir(parents=True, exist_ok=True)

# Prefer prior scan names still in Frok pass; fill with liquid new pass names
PREFERRED = [
    "ANET", "NVDA", "AMD", "AVGO", "MU",
    "NOW", "PANW", "ISRG", "CRWD", "SMCI",
    "CRM",  # may be out of pass — keep if still liquid / sibling use
]
# Sibling / sector ETF helpers
EXTRA = ["TSM", "AMAT", "ORCL", "PLTR", "META", "MRVL", "CEG", "VST", "VRT",
         "SYK", "BSX", "SOX", "SMH", "HACK", "IGV", "IHI", "XLV"]

# yfinance end is exclusive; Mon 2026-10-12 HK → last US bar likely Fri 2026-10-10
ASOF_END = "2026-10-13"
START = "2025-01-01"

def load_theme_map():
    m = json.loads((DATA / "theme-etf-map.json").read_text())["map"]
    return m

def bars_from_df(df: pd.DataFrame, ticker: str):
    if isinstance(df.columns, pd.MultiIndex):
        # MultiIndex from multi-ticker download — handle single extract
        try:
            sub = df.xs(ticker, axis=1, level=1) if ticker in df.columns.get_level_values(1) else df
        except Exception:
            sub = df
    else:
        sub = df
    # Normalize columns
    cols = {c.lower(): c for c in sub.columns}
    def col(name):
        for k, v in cols.items():
            if k.startswith(name):
                return v
        # try Title
        for cand in (name.title(), name.upper(), name.capitalize()):
            if cand in sub.columns:
                return cand
        return None
    o,h,l,c,v = col("open"), col("high"), col("low"), col("close"), col("volume")
    if not all([o,h,l,c]):
        raise ValueError(f"bad columns for {ticker}: {list(sub.columns)}")
    out = []
    for idx, row in sub.iterrows():
        try:
            od = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            oo, hh, ll, cc = float(row[o]), float(row[h]), float(row[l]), float(row[c])
            vv = float(row[v]) if v and pd.notna(row[v]) else 0.0
            if any(math.isnan(x) for x in (oo,hh,ll,cc)):
                continue
            out.append({"date": od, "o": round(oo,4), "h": round(hh,4), "l": round(ll,4), "c": round(cc,4), "v": int(vv)})
        except Exception:
            continue
    return out

def fetch_one(ticker: str):
    t = yf.Ticker(ticker)
    df = t.history(start=START, end=ASOF_END, auto_adjust=True)
    if df is None or len(df) < 40:
        # try download
        df = yf.download(ticker, start=START, end=ASOF_END, progress=False, auto_adjust=True)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [c[0] for c in df.columns]
    if df is None or len(df) < 40:
        return None
    bars = bars_from_df(df, ticker)
    return bars if len(bars) >= 40 else None

def pearson_corr(a, b):
    n = min(len(a), len(b))
    if n < 5:
        return None
    a = np.array(a[-n:], dtype=float)
    b = np.array(b[-n:], dtype=float)
    if np.std(a) < 1e-12 or np.std(b) < 1e-12:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])

def log_returns(closes):
    c = np.array(closes, dtype=float)
    return np.diff(np.log(np.maximum(c, 1e-9)))

# --- pattern detection (mirror tech.js) ---
def zigzag(bars, pct_move=0.06):
    if not bars or len(bars) < 3:
        return []
    pts = []
    mode = None
    extreme = bars[0]
    extreme_i = 0
    for i in range(1, len(bars)):
        b = bars[i]
        if mode is None:
            if (b["h"] - bars[0]["l"]) / (bars[0]["l"] or 1) >= pct_move:
                pts.append({"type": "L", "i": 0, "bar": bars[0]})
                mode = "h"; extreme = b; extreme_i = i
            elif (bars[0]["h"] - b["l"]) / (bars[0]["h"] or 1) >= pct_move:
                pts.append({"type": "H", "i": 0, "bar": bars[0]})
                mode = "l"; extreme = b; extreme_i = i
            elif b["h"] > extreme["h"]:
                extreme = b; extreme_i = i
            elif b["l"] < extreme["l"]:
                extreme = b; extreme_i = i
            continue
        if mode == "h":
            if b["h"] >= extreme["h"]:
                extreme = b; extreme_i = i
            elif (extreme["h"] - b["l"]) / (extreme["h"] or 1) >= pct_move:
                pts.append({"type": "H", "i": extreme_i, "bar": extreme})
                mode = "l"; extreme = b; extreme_i = i
        else:
            if b["l"] <= extreme["l"]:
                extreme = b; extreme_i = i
            elif (b["h"] - extreme["l"]) / (extreme["l"] or 1) >= pct_move:
                pts.append({"type": "L", "i": extreme_i, "bar": extreme})
                mode = "h"; extreme = b; extreme_i = i
    pts.append({"type": "H" if mode == "h" else "L", "i": extreme_i, "bar": extreme})
    return pts

def pct(a, b):
    if a is None or b is None or a == 0:
        return None
    return ((a - b) / a) * 100

def detect_vcp(bars):
    zz = zigzag(bars, 0.055)
    hl = []
    for i in range(len(zz) - 1):
        if zz[i]["type"] == "H" and zz[i+1]["type"] == "L":
            p = pct(zz[i]["bar"]["h"], zz[i+1]["bar"]["l"])
            hl.append({
                "highDate": zz[i]["bar"]["date"], "high": zz[i]["bar"]["h"],
                "lowDate": zz[i+1]["bar"]["date"], "low": zz[i+1]["bar"]["l"],
                "pct": None if p is None else round(p, 1),
                "_hi": zz[i]["i"], "_li": zz[i+1]["i"],
            })
    if len(hl) < 2:
        return None

    def score_slice(sl):
        if not sl or len(sl) < 2:
            return -1e9
        s = 0
        for k in range(1, len(sl)):
            if sl[k]["pct"] is None or sl[k-1]["pct"] is None:
                return -1e9
            if sl[k]["pct"] <= sl[k-1]["pct"] * 1.05:
                s += 30
            elif sl[k]["pct"] <= sl[k-1]["pct"] * 1.2:
                s += 10
            else:
                s -= 40
        last_pct = sl[-1]["pct"]
        if last_pct <= 8:
            s += 25
        elif last_pct <= 12:
            s += 10
        if sl[0]["pct"] >= 15:
            s += 15
        s += sl[-1]["_li"]
        if len(sl) == 3:
            s += 20
        return s

    best = None
    best_score = -1e9
    for n in (3, 2):
        if len(hl) < n:
            continue
        for s0 in range(0, len(hl) - n + 1):
            sl = hl[s0:s0+n]
            sc = score_slice(sl)
            if sc > best_score:
                best_score = sc
                contractions = [{
                    "label": f"C{idx+1}", "pct": c["pct"],
                    "highDate": c["highDate"], "high": c["high"],
                    "lowDate": c["lowDate"], "low": c["low"],
                } for idx, c in enumerate(sl)]
                last_h = sl[-1]
                pivot = last_h["high"]
                pivot_date = last_h["highDate"]
                for z in zz:
                    if z["type"] == "H" and last_h["_hi"] <= z["i"] <= last_h["_hi"] + 60 and z["bar"]["h"] >= pivot * 0.98:
                        if z["bar"]["h"] >= pivot:
                            pivot = z["bar"]["h"]
                            pivot_date = z["bar"]["date"]
                best = {
                    "pattern": "VCP",
                    "contractions": contractions,
                    "pivot": round(pivot, 2),
                    "pivotDate": pivot_date,
                    "contracting": contractions[-1]["pct"] < contractions[0]["pct"],
                    "_score": sc,
                }
    if best and best_score > 0:
        return best
    return None

def detect_flag(bars):
    if not bars or len(bars) < 40:
        return None
    n = len(bars)
    pole = bars[n-40:n-15]
    flag = bars[n-15:]
    pole_start, pole_end = pole[0]["c"], pole[-1]["c"]
    pole_move = (pole_end - pole_start) / pole_start
    flag_high = max(b["h"] for b in flag)
    flag_low = min(b["l"] for b in flag)
    flag_range = (flag_high - flag_low) / ((flag_high + flag_low) / 2)
    flag_slope = (flag[-1]["c"] - flag[0]["c"]) / flag[0]["c"]
    pole_high = max(b["h"] for b in pole)
    pole_low = min(b["l"] for b in pole)
    if pole_move > 0.12 and flag_range < 0.12 and flag_slope < 0.02:
        return {"pattern": "bull_flag", "poleMovePct": round(pole_move*1000)/10,
                "flagRangePct": round(flag_range*1000)/10, "pivot": round(flag_high,2),
                "poleHigh": pole_high, "poleLow": pole_low}
    if pole_move < -0.12 and flag_range < 0.12 and flag_slope > -0.02:
        return {"pattern": "bear_flag", "poleMovePct": round(pole_move*1000)/10,
                "flagRangePct": round(flag_range*1000)/10, "pivot": round(flag_low,2),
                "poleHigh": pole_high, "poleLow": pole_low}
    return None

def detect_triangle(bars):
    if not bars or len(bars) < 30:
        return None
    zz = zigzag(bars[-50:], 0.04)
    highs = [p for p in zz if p["type"] == "H"][-3:]
    lows = [p for p in zz if p["type"] == "L"][-3:]
    if len(highs) < 2 or len(lows) < 2:
        return None
    h_flat = abs(highs[-1]["bar"]["h"] - highs[0]["bar"]["h"]) / highs[0]["bar"]["h"] < 0.03
    l_rising = lows[-1]["bar"]["l"] > lows[0]["bar"]["l"] * 1.01
    h_falling = highs[-1]["bar"]["h"] < highs[0]["bar"]["h"] * 0.99
    l_flat = abs(lows[-1]["bar"]["l"] - lows[0]["bar"]["l"]) / lows[0]["bar"]["l"] < 0.03
    if h_flat and l_rising:
        return {"pattern": "ascending_triangle", "pivot": round(max(h["bar"]["h"] for h in highs), 2)}
    if l_flat and h_falling:
        return {"pattern": "descending_triangle", "pivot": round(min(l["bar"]["l"] for l in lows), 2)}
    if h_falling and l_rising:
        return {"pattern": "sym_triangle", "pivot": round(highs[-1]["bar"]["h"], 2)}
    return None

def detect_channel(bars):
    if not bars or len(bars) < 40:
        return None
    sl = bars[-40:]
    highs = [b["h"] for b in sl]
    lows = [b["l"] for b in sl]
    def slope(vals):
        n = len(vals)
        sx = sum(range(n)); sy = sum(vals)
        sxx = sum(i*i for i in range(n)); sxy = sum(i*vals[i] for i in range(n))
        den = n*sxx - sx*sx
        if abs(den) < 1e-9:
            return 0
        return (n*sxy - sx*sy) / den
    sh, slp = slope(highs), slope(lows)
    mid = (highs[0] + lows[0]) / 2 or 1
    same = (sh > 0 and slp > 0) or (sh < 0 and slp < 0)
    parallel = abs(sh - slp) / mid < 0.15
    if same and parallel and abs(sh) / mid > 0.02:
        return {"pattern": "rising_channel" if sh > 0 else "falling_channel", "dir": "up" if sh > 0 else "down"}
    return None

def detect_cup(bars):
    if not bars or len(bars) < 60:
        return None
    n = len(bars)
    left, bottom, handle = bars[n-60:n-35], bars[n-35:n-15], bars[n-15:]
    left_high = max(b["h"] for b in left)
    cup_low = min(b["l"] for b in bottom)
    right_high = max(b["h"] for b in handle)
    depth = (left_high - cup_low) / left_high
    rim = right_high / left_high
    handle_low = min(b["l"] for b in handle)
    handle_depth = (right_high - handle_low) / right_high
    if 0.12 < depth < 0.45 and rim > 0.9 and 0.02 < handle_depth < 0.15:
        return {"pattern": "cup_with_handle", "cupDepthPct": round(depth*1000)/10,
                "handleDepthPct": round(handle_depth*1000)/10, "pivot": round(max(left_high, right_high), 2)}
    return None

def build_trendlines(bars):
    zz = zigzag(bars, 0.06)
    lows = [p for p in zz if p["type"] == "L"][-4:]
    highs = [p for p in zz if p["type"] == "H"][-4:]
    lines = []
    if len(lows) >= 2:
        a, b = lows[-2], lows[-1]
        lines.append({
            "dir": "up" if b["bar"]["l"] >= a["bar"]["l"] else "down",
            "fromDate": a["bar"]["date"], "fromPrice": a["bar"]["l"],
            "toDate": b["bar"]["date"], "toPrice": b["bar"]["l"],
            "note": "低點抬高（上升趨勢線）" if b["bar"]["l"] >= a["bar"]["l"] else "低點降低",
        })
    if len(highs) >= 2:
        c, d = highs[-2], highs[-1]
        lines.append({
            "dir": "down" if d["bar"]["h"] <= c["bar"]["h"] else "up",
            "fromDate": c["bar"]["date"], "fromPrice": c["bar"]["h"],
            "toDate": d["bar"]["date"], "toPrice": d["bar"]["h"],
            "note": "高點降低（下降壓力線）" if d["bar"]["h"] <= c["bar"]["h"] else "高點抬高",
        })
    return lines

LABELS = {
    "VCP": "VCP（波動收縮）",
    "bull_flag": "上升旗形（Bull Flag）",
    "bear_flag": "下降旗形（Bear Flag）",
    "ascending_triangle": "上升三角",
    "descending_triangle": "下降三角",
    "sym_triangle": "對稱三角",
    "rising_channel": "上升通道",
    "falling_channel": "下降通道",
    "cup_with_handle": "杯柄（Cup with Handle）",
}

def sma(closes, n):
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n

def analyze(ticker, bars, meta):
    last = bars[-1]
    closes = [b["c"] for b in bars]
    ma30 = sma(closes, 30)
    ma50 = sma(closes, 50)
    vcp = detect_vcp(bars)
    flag = detect_flag(bars)
    tri = detect_triangle(bars)
    chan = detect_channel(bars)
    cup = detect_cup(bars)
    primary = vcp or cup or flag or tri or chan
    alts = [p for p in (vcp, cup, flag, tri, chan) if p and p is not primary]
    trendlines = build_trendlines(bars)
    pivot = primary.get("pivot") if primary else None
    status = None
    if pivot is not None:
        if last["c"] > pivot:
            status = "收市已企穩／突破 pivot 上方"
        elif last["h"] >= pivot and last["c"] < pivot:
            status = "盤中試破但收市仍低於 pivot"
        else:
            status = "仍未破 pivot；收市低於突破位"
    contractions_tw = ""
    if vcp and vcp.get("contractions"):
        contractions_tw = " → ".join(f"{c['label']} {c['pct']}%" for c in vcp["contractions"])
    report = {
        "bot": "Grok",
        "role": "技術分析＋兄弟姊妹股／板塊",
        "ticker": ticker,
        "name": meta.get("name"),
        "theme": meta.get("theme"),
        "etf": meta.get("etf"),
        "timeframe": "日K",
        "asOf": last["date"],
        "close": round(last["c"], 2),
        "ma30": None if ma30 is None else round(ma30, 2),
        "ma50": None if ma50 is None else round(ma50, 2),
        "aboveMa30": None if ma30 is None else last["c"] > ma30,
        "primaryPattern": primary["pattern"] if primary else "none",
        "primaryLabelTw": LABELS.get(primary["pattern"], primary["pattern"]) if primary else "未識別清晰形態",
        "detail": {k: v for k, v in (primary or {}).items() if not str(k).startswith("_")},
        "alternates": [{k: v for k, v in a.items() if not str(k).startswith("_")} for a in alts],
        "contractions": vcp["contractions"] if vcp else None,
        "pivot": pivot,
        "pivotDate": primary.get("pivotDate") if primary else None,
        "status": status,
        "trendlines": trendlines,
        "chartPath": meta.get("chartPath"),
        "barsUsed": len(bars),
        "dataSource": meta.get("dataSource", "yfinance"),
    }
    lines = [
        f"{ticker}" + (f"（{meta.get('name')}）" if meta.get("name") else "") + f" 日K技術分析 @ {last['date']}",
        f"主形態：{report['primaryLabelTw']}" + (f"；{contractions_tw}" if contractions_tw else ""),
        (f"Pivot／突破位：${pivot}" + (f"（{report['pivotDate']}）" if report.get("pivotDate") else "")) if pivot is not None else "Pivot：待定",
        f"收市：${report['close']}" + (f"；{status}" if status else ""),
        (f"相對 SMA30：{'上方' if report['aboveMa30'] else '下方'}（SMA30≈{report['ma30']}）") if ma30 is not None else "",
        ("趨勢線：" + "；".join(l["note"] for l in trendlines)) if trendlines else "",
        f"主題／ETF：{meta.get('theme')}／{meta.get('etf')}" if meta.get("theme") else "",
    ]
    report["summaryTw"] = "\n".join(x for x in lines if x)
    return report

def find_siblings(ticker, theme, ohlcv_map, theme_map, names):
    base = ohlcv_map.get(ticker)
    if not base:
        return [], "無基準 OHLCV"
    base_ret = log_returns([b["c"] for b in base])
    rows = []
    for t, bars in ohlcv_map.items():
        if t == ticker or t in ("SOX", "SMH", "HACK", "IGV", "IHI", "XLV"):
            continue
        info = theme_map.get(t, {})
        same = info.get("theme") == theme
        # Prefer same theme; also allow high corr across
        corr = pearson_corr(base_ret, log_returns([b["c"] for b in bars]))
        if corr is not None:
            corr = round(corr, 3)
        co = corr is not None and corr >= 0.45
        if not same and not co:
            continue
        rows.append({
            "ticker": t,
            "name": names.get(t),
            "theme": info.get("theme"),
            "corr60": corr,
            "close": round(bars[-1]["c"], 2),
            "sameTheme": same,
            "coMoving": co,
            "institutionalHint": bool(co and same),
            "note": (
                f"同類業務且走勢同步（corr≈{corr}）→ 較似板塊／大戶部署" if co and same else
                "走勢同步但主題未對齊，需人工確認業務" if co else
                "同主題但近月相關偏低，未必同步部署" if same else
                "相關／主題未達兄弟股門檻"
            ),
        })
    rows.sort(key=lambda r: (-(1 if r["institutionalHint"] else 0), -(r["corr60"] or -1)))
    top = rows[:3]
    strong = [r for r in top if r["institutionalHint"]]
    if strong:
        hint = "／".join(r["ticker"] for r in strong) + f" 與 {ticker} 近月同步，若同時收緊／突破，較似板塊資金部署。"
    else:
        hint = "未見強同步兄弟股；可保留同主題名單繼續觀察。"
    return top, hint

def draw_vcp_chart(ticker, bars, report, path):
    """Annotated zigzag C1–C3 style chart."""
    # last ~180 bars
    use = bars[-180:] if len(bars) > 180 else bars
    dates = [pd.Timestamp(b["date"]) for b in use]
    closes = [b["c"] for b in use]
    highs = [b["h"] for b in use]
    lows = [b["l"] for b in use]
    fig, ax = plt.subplots(figsize=(11, 5.5), dpi=120)
    ax.plot(dates, closes, color="#4da3ff", lw=1.4, label="Close")
    ax.fill_between(dates, lows, highs, color="#4da3ff", alpha=0.12)
    # mark contractions
    cons = report.get("contractions") or []
    colors = ["#ff6b6b", "#ffd93d", "#6bcb77"]
    for i, c in enumerate(cons[:3]):
        try:
            hd = pd.Timestamp(c["highDate"]); ld = pd.Timestamp(c["lowDate"])
            ax.annotate(f"{c['label']} {c['pct']}%",
                        xy=(ld, c["low"]),
                        xytext=(0, -28 if i % 2 == 0 else -44),
                        textcoords="offset points",
                        color=colors[i], fontsize=9, fontweight="bold",
                        arrowprops=dict(arrowstyle="->", color=colors[i], lw=1.2))
            ax.plot([hd, ld], [c["high"], c["low"]], color=colors[i], lw=1.6, ls="--")
            ax.scatter([hd, ld], [c["high"], c["low"]], color=colors[i], s=28, zorder=5)
        except Exception:
            pass
    if report.get("pivot") is not None:
        ax.axhline(report["pivot"], color="#ff9f43", ls=":", lw=1.3, label=f"Pivot ${report['pivot']}")
    ax.set_title(f"{ticker} 日K · {report.get('primaryLabelTw','')} @ {report.get('asOf')}", color="#e8ecff", fontsize=12)
    ax.set_facecolor("#0f1424")
    fig.patch.set_facecolor("#0b1020")
    ax.tick_params(colors="#9aa6d0")
    for sp in ax.spines.values():
        sp.set_color("#2a3560")
    ax.legend(loc="upper left", facecolor="#12182c", edgecolor="#2a3560", labelcolor="#e8ecff", fontsize=8)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    fig.autofmt_xdate()
    ax.grid(True, color="#1c2545", alpha=0.6)
    fig.tight_layout()
    fig.savefig(path, facecolor=fig.get_facecolor())
    plt.close(fig)


def load_screener_pass():
    p = DATA / "screener-run-latest.json"
    if not p.exists():
        return [], {}, None
    j = json.loads(p.read_text())
    results = j.get("results") or []
    passed = [r["ticker"] for r in results]
    meta = {r["ticker"]: r for r in results}
    return passed, meta, j


def proximity_score(a):
    """Nearer to pivot = higher (for ranking top setups)."""
    pivot = a.get("pivot")
    close = a.get("close")
    if pivot is None or close is None or pivot == 0:
        return -1e9
    dist = abs(close - pivot) / pivot
    score = 100 - dist * 1000  # 1% away ≈ 90
    if a.get("primaryPattern") == "VCP":
        score += 20
        cons = a.get("contractions") or []
        if len(cons) >= 3:
            score += 10
        if cons and cons[-1].get("pct", 99) <= 8:
            score += 8
    if a.get("status") and "試破" in a["status"]:
        score += 15
    if a.get("status") and "企穩" in a["status"]:
        score += 12
    if a.get("aboveMa30"):
        score += 5
    return score


def main():
    theme_map = load_theme_map()
    uni = json.loads((DATA / "screener-universe-sample.json").read_text())["universe"]
    names = {u["ticker"]: u["name"] for u in uni}
    names.update({
        "SOX": "PHLX Semiconductor", "SMH": "VanEck Semi", "HACK": "Cybersecurity ETF",
        "IGV": "iShares Expanded Tech-Software", "IHI": "iShares U.S. Medical Devices",
        "XLV": "Health Care Select", "MRVL": "Marvell", "PLTR": "Palantir", "META": "Meta",
    })

    passed, pass_meta, screener = load_screener_pass()
    passed_set = set(passed)

    # CORE: preferred still in pass, then liquid new pass names up to ~15
    core = [t for t in PREFERRED if t in passed_set]
    # CRM out of pass — skip from core unless we want it; task says prefer prior still in pass
    liquid_extra = []
    if screener:
        ranked = sorted(screener.get("results") or [], key=lambda r: -(r.get("avgVol1m") or 0))
        for r in ranked:
            t = r["ticker"]
            if t in core or t in liquid_extra:
                continue
            if t in ("AAPL", "AMZN", "MSFT", "GOOGL", "TSLA"):  # mega-cap noise for VCP scan optional
                # still allow a couple theme leaders
                if t not in ("META",):
                    continue
            liquid_extra.append(t)
            if len(core) + len(liquid_extra) >= 15:
                break
    # Always try META/MRVL/PLTR if in pass and not yet in list
    for t in ("MRVL", "META", "PLTR", "NOW"):
        if t in passed_set and t not in core and t not in liquid_extra:
            liquid_extra.insert(0, t)
    CORE = (core + liquid_extra)[:15]

    thinking = []
    def tlog(step, detail):
        thinking.append({
            "t": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "bot": "Grok",
            "role": "技術分析＋兄弟姊妹股／板塊",
            "step": step,
            "detail": detail,
        })

    tlog("scan:start", f"2026-10-12 刷新：從 Frok 通過 {len(passed)} 隻選 {len(CORE)} 隻流動股做日K掃描（yfinance end={ASOF_END}）")
    tlog("filter:align", f"優先名單仍在通過：{[t for t in PREFERRED if t in passed_set]}；CORE={CORE}")
    tlog("filter:default", "跟 Frok screener-run-latest（市值 3B–2T、量 1M–500M、價>SMA30）")

    all_tickers = list(dict.fromkeys(CORE + EXTRA))
    ohlcv_map = {}
    failed = []
    for t in all_tickers:
        tlog("fetch:ohlcv", f"下載 {t} 日K…")
        try:
            bars = fetch_one(t)
            if bars:
                ohlcv_map[t] = bars
                slim = bars[-260:]
                (OHLCV_DIR / f"{t}.json").write_text(json.dumps({"ticker": t, "bars": slim}, ensure_ascii=False))
                tlog("fetch:ok", f"{t} {len(bars)} 根，最新 {bars[-1]['date']} 收 {bars[-1]['c']}")
            else:
                failed.append(t)
                tlog("fetch:fail", f"{t} 無足夠數據")
        except Exception as e:
            failed.append(t)
            tlog("fetch:error", f"{t}: {e}")

    if "ISRG" not in ohlcv_map:
        seed_path = DATA / "tech-seed-isrg.json"
        if seed_path.exists():
            seed = json.loads(seed_path.read_text())
            if seed.get("ohlcv"):
                ohlcv_map["ISRG"] = seed["ohlcv"]
                tlog("fetch:fallback", "ISRG 改用 tech-seed-isrg.json")

    analyses = []
    chart_targets = []
    for t in CORE:
        if t not in ohlcv_map:
            tlog("analyze:skip", f"{t} 無 OHLCV")
            continue
        info = theme_map.get(t, {})
        pm = pass_meta.get(t, {})
        meta = {
            "name": pm.get("name") or names.get(t),
            "theme": pm.get("theme") or info.get("theme"),
            "etf": pm.get("etf") or info.get("etf"),
            "dataSource": "yfinance",
        }
        if t == "ISRG":
            meta["etf"] = meta.get("etf") or "IHI"
            meta["theme"] = meta.get("theme") or "醫療"
        report = analyze(t, ohlcv_map[t], meta)
        sibs, hint = find_siblings(t, meta.get("theme"), ohlcv_map, theme_map, names)
        report["siblings"] = sibs
        report["siblingHint"] = hint
        report["inScreenerPass"] = t in passed_set

        etf = meta.get("etf")
        sector = None
        if etf and etf in ohlcv_map:
            srep = analyze(etf, ohlcv_map[etf], {"name": names.get(etf), "theme": meta.get("theme")})
            sector = {
                "etf": etf,
                "etfName": names.get(etf),
                "relatedTicker": t,
                "theme": meta.get("theme"),
                "asOf": srep["asOf"],
                "close": srep["close"],
                "pattern": srep["primaryPattern"],
                "patternLabelTw": srep["primaryLabelTw"],
                "pivot": srep["pivot"],
                "status": srep["status"],
                "summaryTw": f"板塊 ETF {etf}：{srep['primaryLabelTw']}；收市 ${srep['close']}" + (f"；{srep['status']}" if srep.get('status') else ""),
            }
        report["sectorNote"] = sector
        tlog("analyze:done", f"{t} → {report['primaryPattern']} pivot={report.get('pivot')} close={report['close']} pass={t in passed_set}")
        score = proximity_score(report)
        report["_rankScore"] = score
        analyses.append(report)
        chart_targets.append((score, t, report))

    chart_targets.sort(key=lambda x: -x[0])
    drawn = []
    for score, t, report in chart_targets[:3]:
        if report["primaryPattern"] == "none":
            continue
        path = CHARTS / f"{t}_scan_{report['primaryPattern']}.png"
        try:
            draw_vcp_chart(t, ohlcv_map[t], report, path)
            rel = f"data/charts/{path.name}"
            report["chartPath"] = rel
            for a in analyses:
                if a["ticker"] == t:
                    a["chartPath"] = rel
            drawn.append(rel)
            tlog("chart:drawn", f"{t} → {rel}")
        except Exception as e:
            tlog("chart:error", f"{t}: {e}")

    # Sort analyses: in-pass first, then by proximity
    analyses.sort(key=lambda a: (
        0 if a.get("inScreenerPass") else 1,
        0 if a["primaryPattern"] == "VCP" else 1,
        -proximity_score(a),
    ))

    scanned_in = [a["ticker"] for a in analyses if a.get("inScreenerPass")]
    scanned_out = [a["ticker"] for a in analyses if not a.get("inScreenerPass")]
    tlog("align:screener-run", f"對齊 Frok screener-run-latest（{len(passed)} 通過）；掃描中命中 {scanned_in}；Top 依通過名單＋近 pivot 重排")

    # topSetups from in-pass with pattern, by proximity
    ranked_pass = sorted(
        [a for a in analyses if a.get("inScreenerPass") and a["primaryPattern"] != "none"],
        key=lambda a: -proximity_score(a),
    )
    if not ranked_pass:
        ranked_pass = [a for a in analyses if a["primaryPattern"] != "none"]

    for a in analyses:
        a.pop("_rankScore", None)

    top_setups = []
    for a in ranked_pass[:5]:
        top_setups.append({
            "ticker": a["ticker"],
            "pattern": a["primaryPattern"],
            "labelTw": a["primaryLabelTw"],
            "pivot": a.get("pivot"),
            "close": a["close"],
            "status": a.get("status"),
            "theme": a.get("theme"),
            "etf": a.get("etf"),
            "siblings": [s["ticker"] for s in (a.get("siblings") or [])[:3]],
            "summaryTw": a.get("summaryTw"),
            "chartPath": a.get("chartPath"),
            "inScreenerPass": bool(a.get("inScreenerPass")),
            "contractions": a.get("contractions"),
        })

    tlog("scan:done", f"完成 {len(analyses)} 隻；圖 {len(drawn)} 張；失敗 {failed}；asOfMarket 待寫")

    as_of = max((a["asOf"] for a in analyses), default=None)
    # fix last log detail
    thinking[-1]["detail"] = f"完成 {len(analyses)} 隻；圖 {len(drawn)} 張；失敗 {failed}；asOfMarket={as_of}"

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "bot": "Grok",
        "role": "技術分析＋兄弟姊妹股／板塊",
        "asOfMarket": as_of,
        "filterNote": "跟 Frok screener-run-latest 通過名單；日K 來自 yfinance（2026-10-12 刷新）",
        "universeSource": "data/screener-run-latest.json",
        "scanned": [a["ticker"] for a in analyses],
        "failedFetches": failed,
        "analyses": analyses,
        "thinkingLog": thinking,
        "charts": drawn,
        "topSetups": top_setups,
        "screenerAlign": {
            "source": "data/screener-run-latest.json",
            "passedCount": len(passed),
            "scannedInPass": scanned_in,
            "scannedOutOfPass": scanned_out,
        },
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {OUT} analyses={len(analyses)} charts={drawn} asOf={as_of}")
    for s in payload["topSetups"][:5]:
        cons = s.get("contractions") or []
        ctw = " → ".join(f"{c['label']} {c['pct']}%" for c in cons) if cons else "-"
        print(f"  TOP {s['ticker']} {s['pattern']} {ctw} pivot={s['pivot']} close={s['close']} status={s['status']} sibs={s['siblings']}")

if __name__ == "__main__":
    main()
