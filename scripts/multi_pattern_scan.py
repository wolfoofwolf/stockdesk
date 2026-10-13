#!/usr/bin/env python3
"""Grok Item-2: multi-pattern scan (not VCP-only) + candlestick SVG charts.

VCP style lock: C1–C3 on lows + C3 green vol-dry box + DTL + Bo DTL + pivot
(see lessons draw-style-vcp-c123-dtl-now). After drawing, grade vs exemplar:

  python scripts/lesson_chart_grade.py data/charts/NOW_scan_VCP.svg --ticker NOW
  python scripts/multi_pattern_scan.py --grade data/charts/NOW_scan_VCP.svg

Keep only score>=90 (gallery/keep); else counterexample / never_learn + remediation-queue.
"""
from __future__ import annotations
import json, math, os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import FancyBboxPatch, Rectangle

ROOT = Path("/workspace/stockdesk")
DATA = ROOT / "data"
OUT = DATA / "tech-scan-latest.json"
CHARTS = DATA / "charts"
OHLCV_DIR = DATA / "ohlcv"
OHLCV_DIR.mkdir(parents=True, exist_ok=True)
CHARTS.mkdir(parents=True, exist_ok=True)

ASOF_END = "2026-10-14"
START = "2025-01-01"

PREFERRED = [
    "ANET", "NVDA", "AMD", "AVGO", "MU", "NOW", "PANW", "ISRG", "CRWD",
    "SMCI", "HPE", "PLTR", "MRVL", "MSTR", "PFE", "DELL", "DDOG", "FTNT",
    "AMAT", "CIEN", "GLW", "BE", "CEG", "VRT", "META", "ORCL", "TSM",
]
EXTRA = ["TSM", "AMAT", "ORCL", "META", "SOX", "SMH", "HACK", "IGV", "IHI", "XLV"]

LABELS = {
    "VCP": "VCP（波動收縮）",
    "bull_flag": "上升旗形（Bull Flag）",
    "bear_flag": "下降旗形（Bear Flag）",
    "triple_bottom": "三底（Triple Bottom）",
    "triple_top": "三頂（Triple Top）",
    "low_cheat": "Low Cheat（Minervini 提前進場）",
    "cup_with_handle": "杯柄（Cup with Handle）",
    "ascending_triangle": "上升三角（Ascending Triangle）",
    "descending_triangle": "下降三角（Descending Triangle）",
    "sym_triangle": "對稱三角（Symmetrical Triangle）",
    "flat_base": "平底（Flat Base）",
    "ascending_base": "上升底（Ascending Base）",
    "rising_channel": "上升通道（Up Channel）",
    "falling_channel": "下降通道（Down Channel）",
}


def load_theme_map():
    return json.loads((DATA / "theme-etf-map.json").read_text())["map"]


def bars_from_df(df: pd.DataFrame, ticker: str):
    if isinstance(df.columns, pd.MultiIndex):
        try:
            sub = df.xs(ticker, axis=1, level=1) if ticker in df.columns.get_level_values(1) else df
        except Exception:
            sub = df
    else:
        sub = df
    cols = {c.lower(): c for c in sub.columns}
    def col(name):
        for k, v in cols.items():
            if k.startswith(name):
                return v
        for cand in (name.title(), name.upper(), name.capitalize()):
            if cand in sub.columns:
                return cand
        return None
    o, h, l, c, v = col("open"), col("high"), col("low"), col("close"), col("volume")
    if not all([o, h, l, c]):
        raise ValueError(f"bad columns for {ticker}: {list(sub.columns)}")
    out = []
    for idx, row in sub.iterrows():
        try:
            od = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            oo, hh, ll, cc = float(row[o]), float(row[h]), float(row[l]), float(row[c])
            vv = float(row[v]) if v and pd.notna(row[v]) else 0.0
            if any(math.isnan(x) for x in (oo, hh, ll, cc)):
                continue
            out.append({"date": od, "o": round(oo, 4), "h": round(hh, 4), "l": round(ll, 4), "c": round(cc, 4), "v": int(vv)})
        except Exception:
            continue
    return out


def fetch_one(ticker: str):
    t = yf.Ticker(ticker)
    df = t.history(start=START, end=ASOF_END, auto_adjust=True)
    if df is None or len(df) < 40:
        df = yf.download(ticker, start=START, end=ASOF_END, progress=False, auto_adjust=True)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [c[0] for c in df.columns]
    if df is None or len(df) < 40:
        return None
    bars = bars_from_df(df, ticker)
    return bars if len(bars) >= 40 else None


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


def atr(bars, n=14):
    if len(bars) < n + 1:
        return None
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i - 1]["c"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs[-n:]) / n


# --- detectors ---
def detect_vcp(bars):
    """Volatility Contraction Pattern.

    Prefer the *late* progressive base (C1 > C2 > C3 toward the right under the
    pivot), not early-chart micro swings. Multi-scale zigzag + min span, then
    score with strong recency / higher-low / progressive bias. Keeps _hi/_li for
    drawing.
    """
    if not bars or len(bars) < 60:
        return None
    n = len(bars)

    # Multi-scale HL pairs; reject micro (span < 4) and tiny % moves
    hl = []
    seen = set()
    for thr in (0.10, 0.08, 0.12):
        zz = zigzag(bars, thr)
        for i in range(len(zz) - 1):
            if zz[i]["type"] != "H" or zz[i + 1]["type"] != "L":
                continue
            hi, li = zz[i]["i"], zz[i + 1]["i"]
            if li - hi < 4:
                continue
            p = pct(zz[i]["bar"]["h"], zz[i + 1]["bar"]["l"])
            if p is None or p < 5:
                continue
            key = (hi // 3, li // 3)
            if key in seen:
                continue
            seen.add(key)
            hl.append({
                "highDate": zz[i]["bar"]["date"], "high": zz[i]["bar"]["h"],
                "lowDate": zz[i + 1]["bar"]["date"], "low": zz[i + 1]["bar"]["l"],
                "pct": round(p, 1),
                "_hi": hi, "_li": li,
            })
    hl.sort(key=lambda c: (c["_li"], c["_hi"]))
    cleaned = []
    for c in hl:
        if cleaned and abs(cleaned[-1]["_li"] - c["_li"]) <= 5:
            if c["pct"] > cleaned[-1]["pct"]:
                cleaned[-1] = c
            continue
        cleaned.append(c)
    hl = cleaned
    if len(hl) < 2:
        return None

    def strictly_progressive(sl):
        return all(sl[k]["pct"] < sl[k - 1]["pct"] for k in range(1, len(sl)))

    def score_slice(sl):
        if not sl or len(sl) < 2:
            return -1e9
        if not all(c["pct"] is not None for c in sl):
            return -1e9
        # 3-leg must be progressive (tiny 2% tolerance); reject expanding late legs
        if len(sl) >= 3:
            for k in range(1, len(sl)):
                if sl[k]["pct"] > sl[k - 1]["pct"] * 1.02:
                    return -1e9
        s = 0.0
        for k in range(1, len(sl)):
            if sl[k]["pct"] < sl[k - 1]["pct"]:
                s += 40
            elif sl[k]["pct"] <= sl[k - 1]["pct"] * 1.02:
                s += 15
            else:
                s -= 60
        if len(sl) == 3:
            s += 30
        if strictly_progressive(sl) and len(sl) >= 3:
            s += 30
        last_pct = sl[-1]["pct"]
        if last_pct <= 10:
            s += 25
        elif last_pct <= 14:
            s += 12
        elif last_pct <= 18:
            s += 5
        if sl[0]["pct"] >= 18:
            s += 15
        if sl[0]["pct"] >= 28:
            s += 10

        last_li = sl[-1]["_li"]
        first_hi = sl[0]["_hi"]
        dist_end = n - 1 - last_li
        # Recency: last contraction near end of series (maturing base under pivot)
        if dist_end <= 25:
            s += 70
        elif dist_end <= 45:
            s += 50
        elif dist_end <= 75:
            s += 25
        else:
            s -= 100  # early-chart micro VCPs

        mid = (first_hi + last_li) / 2
        if mid >= n * 0.50:
            s += 20
        elif mid < n * 0.30:
            s -= 50

        lows = [c["low"] for c in sl]
        if all(lows[k] >= lows[k - 1] * 0.98 for k in range(1, len(lows))):
            s += 25
        elif lows[-1] > lows[0]:
            s += 10

        highs = [c["high"] for c in sl]
        if len(highs) >= 2 and highs[-1] <= max(highs[:-1]) * 1.05:
            s += 10

        total_span = last_li - first_hi
        if 30 <= total_span <= 180:
            s += 20
        elif total_span < 18:
            s -= 50

        for k in range(1, len(sl)):
            if sl[k]["_hi"] < sl[k - 1]["_li"] - 2:
                s -= 30
        return s

    best = None
    best_score = -1e9
    for n_c in (3, 2):
        if len(hl) < n_c:
            continue
        for s0 in range(0, len(hl) - n_c + 1):
            sl = [dict(c) for c in hl[s0:s0 + n_c]]
            sc = score_slice(sl)
            if sc <= best_score:
                continue
            best_score = sc
            # Widen final contraction through subsequent pivot-zone troughs
            # (same roof high) while keeping progressive % — matches C3 green box
            last = sl[-1]
            roof = last["high"]
            end_scan = min(n, last["_li"] + 45)
            deep_i = last["_li"]
            deep_low = last["low"]
            for ii in range(last["_li"] + 1, end_scan):
                if bars[ii]["h"] > roof * 1.02:
                    break  # left the pivot roof
                if bars[ii]["l"] < deep_low:
                    deep_low = bars[ii]["l"]
                    deep_i = ii
            if deep_i != last["_li"]:
                new_pct = pct(roof, deep_low)
                if new_pct is not None:
                    new_pct = round(new_pct, 1)
                    trial = [dict(c) for c in sl]
                    trial[-1] = {
                        **last,
                        "low": deep_low,
                        "lowDate": bars[deep_i]["date"],
                        "pct": new_pct,
                        "_li": deep_i,
                    }
                    if score_slice(trial) >= sc - 25 and (
                        len(trial) < 3 or trial[-1]["pct"] < trial[-2]["pct"] * 1.02
                    ):
                        sl = trial
                        sc = score_slice(sl)
                        best_score = sc

            contractions = [{
                "label": f"C{idx + 1}", "pct": c["pct"],
                "highDate": c["highDate"], "high": c["high"],
                "lowDate": c["lowDate"], "low": c["low"],
                "_hi": c["_hi"], "_li": c["_li"],
            } for idx, c in enumerate(sl)]
            last_h = sl[-1]
            pivot = last_h["high"]
            pivot_date = last_h["highDate"]
            for ii in range(last_h["_hi"], min(n, last_h["_li"] + 35)):
                if bars[ii]["h"] >= pivot:
                    pivot = bars[ii]["h"]
                    pivot_date = bars[ii]["date"]
            best = {
                "pattern": "VCP",
                "contractions": [{k: v for k, v in c.items() if not str(k).startswith("_")} for c in contractions],
                "pivot": round(pivot, 2),
                "pivotDate": pivot_date,
                "contracting": contractions[-1]["pct"] < contractions[0]["pct"],
                "_score": max(0, sc),
                "_ann": {"contractions": contractions, "pivot": pivot},
            }
    if best and best_score > 50:
        return best
    return None



def detect_flag(bars):
    """Bull/bear flag: pole ≥ ~10% / ~2.5 ATR over 5–25 bars; flag 4–20 bars, depth ≤50% pole, slight counter-slope."""
    if not bars or len(bars) < 35:
        return None
    n = len(bars)
    a = atr(bars) or (bars[-1]["c"] * 0.02)
    best = None
    for pole_len in range(8, 26):
        for flag_len in range(5, 18):
            if pole_len + flag_len > n:
                continue
            pole = bars[n - pole_len - flag_len: n - flag_len]
            flag = bars[n - flag_len:]
            if len(pole) < 5 or len(flag) < 4:
                continue
            pole_start = pole[0]["c"]
            pole_end = max(b["h"] for b in pole)
            pole_low = min(b["l"] for b in pole)
            pole_move = (pole_end - pole_start) / pole_start
            pole_drop = (pole[0]["c"] - min(b["l"] for b in pole)) / pole[0]["c"]
            flag_high = max(b["h"] for b in flag)
            flag_low = min(b["l"] for b in flag)
            flag_range = (flag_high - flag_low) / ((flag_high + flag_low) / 2 or 1)
            flag_slope = (flag[-1]["c"] - flag[0]["c"]) / (flag[0]["c"] or 1)
            pole_height = pole_end - pole_low
            # volume contraction rough
            pole_vol = np.mean([b["v"] for b in pole]) or 1
            flag_vol = np.mean([b["v"] for b in flag]) or 1
            vol_ok = flag_vol <= pole_vol * 1.15

            # bull flag
            if pole_move >= 0.10 and pole_height >= 2.0 * a and flag_range < 0.18 and flag_slope <= 0.03:
                retrace = (pole_end - flag_low) / (pole_height or 1)
                if retrace <= 0.55 and retrace >= 0.05:
                    sc = 70 + pole_move * 90 - flag_range * 35 + (12 if vol_ok else 0) + (10 if flag_slope < 0 else 0)
                    # prefer more recent / tighter
                    sc += (18 - flag_len) * 0.5
                    cand = {
                        "pattern": "bull_flag",
                        "poleMovePct": round(pole_move * 100, 1),
                        "flagRangePct": round(flag_range * 100, 1),
                        "retracePct": round(retrace * 100, 1),
                        "pivot": round(flag_high, 2),
                        "poleHigh": round(pole_end, 2),
                        "poleLow": round(pole_low, 2),
                        "flagHigh": round(flag_high, 2),
                        "flagLow": round(flag_low, 2),
                        "_score": sc,
                        "_ann": {
                            "pole_i0": n - pole_len - flag_len,
                            "pole_i1": n - flag_len - 1,
                            "flag_i0": n - flag_len,
                            "flag_i1": n - 1,
                            "flag_high": flag_high,
                            "flag_low": flag_low,
                            "pole_high": pole_end,
                            "pole_low": pole_low,
                        },
                    }
                    if best is None or sc > best["_score"]:
                        best = cand
            # bear flag
            if pole_drop >= 0.10 and flag_range < 0.18 and flag_slope >= -0.03:
                pole_tip = min(b["l"] for b in pole)
                pole_top = max(b["h"] for b in pole)
                ph = pole_top - pole_tip
                retrace = (flag_high - pole_tip) / (ph or 1)
                if retrace <= 0.55:
                    sc = 45 + pole_drop * 70 - flag_range * 40
                    cand = {
                        "pattern": "bear_flag",
                        "poleMovePct": round(-pole_drop * 100, 1),
                        "flagRangePct": round(flag_range * 100, 1),
                        "pivot": round(flag_low, 2),
                        "poleHigh": round(pole_top, 2),
                        "poleLow": round(pole_tip, 2),
                        "flagHigh": round(flag_high, 2),
                        "flagLow": round(flag_low, 2),
                        "_score": sc,
                        "_ann": {
                            "pole_i0": n - pole_len - flag_len,
                            "pole_i1": n - flag_len - 1,
                            "flag_i0": n - flag_len,
                            "flag_i1": n - 1,
                            "flag_high": flag_high,
                            "flag_low": flag_low,
                            "pole_high": pole_top,
                            "pole_low": pole_tip,
                        },
                    }
                    if best is None or sc > best["_score"]:
                        best = cand
    return best


def detect_triple_bottom(bars):
    """Three roughly equal lows (±3%), spaced, with neckline from intervening highs."""
    if not bars or len(bars) < 60:
        return None
    window = bars[-120:] if len(bars) > 120 else bars
    offset = len(bars) - len(window)
    zz = zigzag(window, 0.04)
    lows = [p for p in zz if p["type"] == "L"]
    if len(lows) < 3:
        return None
    best = None
    for i in range(len(lows) - 2):
        a, b, c = lows[i], lows[i + 1], lows[i + 2]
        # spacing: at least 5 bars between
        if b["i"] - a["i"] < 5 or c["i"] - b["i"] < 5:
            continue
        la, lb, lc = a["bar"]["l"], b["bar"]["l"], c["bar"]["l"]
        mid = (la + lb + lc) / 3
        if mid <= 0:
            continue
        if max(abs(la - mid), abs(lb - mid), abs(lc - mid)) / mid > 0.035:
            continue
        # intervening highs for neckline
        hi_ab = max(window[j]["h"] for j in range(a["i"], b["i"] + 1))
        hi_bc = max(window[j]["h"] for j in range(b["i"], c["i"] + 1))
        neck = max(hi_ab, hi_bc)
        # prefer recent third low
        sc = 72 + (12 if abs(la - lb) / mid < 0.02 and abs(lb - lc) / mid < 0.02 else 0)
        sc += c["i"] * 0.05
        # prior downtrend into first low
        if a["i"] > 10:
            prior = window[max(0, a["i"] - 20)]["c"]
            if prior > la * 1.05:
                sc += 12
        cand = {
            "pattern": "triple_bottom",
            "lows": [
                {"date": a["bar"]["date"], "price": round(la, 2), "i": a["i"] + offset},
                {"date": b["bar"]["date"], "price": round(lb, 2), "i": b["i"] + offset},
                {"date": c["bar"]["date"], "price": round(lc, 2), "i": c["i"] + offset},
            ],
            "neckline": round(neck, 2),
            "pivot": round(neck, 2),
            "support": round(mid, 2),
            "_score": sc,
            "_ann": {
                "lows": [
                    {"i": a["i"] + offset, "price": la},
                    {"i": b["i"] + offset, "price": lb},
                    {"i": c["i"] + offset, "price": lc},
                ],
                "neckline": neck,
            },
        }
        if best is None or sc > best["_score"]:
            best = cand
    return best


def detect_triple_top(bars):
    if not bars or len(bars) < 60:
        return None
    window = bars[-120:] if len(bars) > 120 else bars
    offset = len(bars) - len(window)
    zz = zigzag(window, 0.04)
    highs = [p for p in zz if p["type"] == "H"]
    if len(highs) < 3:
        return None
    best = None
    for i in range(len(highs) - 2):
        a, b, c = highs[i], highs[i + 1], highs[i + 2]
        if b["i"] - a["i"] < 5 or c["i"] - b["i"] < 5:
            continue
        ha, hb, hc = a["bar"]["h"], b["bar"]["h"], c["bar"]["h"]
        mid = (ha + hb + hc) / 3
        if mid <= 0:
            continue
        if max(abs(ha - mid), abs(hb - mid), abs(hc - mid)) / mid > 0.035:
            continue
        lo_ab = min(window[j]["l"] for j in range(a["i"], b["i"] + 1))
        lo_bc = min(window[j]["l"] for j in range(b["i"], c["i"] + 1))
        neck = min(lo_ab, lo_bc)
        sc = 50 + c["i"] * 0.05
        cand = {
            "pattern": "triple_top",
            "highs": [
                {"date": a["bar"]["date"], "price": round(ha, 2)},
                {"date": b["bar"]["date"], "price": round(hb, 2)},
                {"date": c["bar"]["date"], "price": round(hc, 2)},
            ],
            "neckline": round(neck, 2),
            "pivot": round(neck, 2),
            "_score": sc,
            "_ann": {
                "highs": [
                    {"i": a["i"] + offset, "price": ha},
                    {"i": b["i"] + offset, "price": hb},
                    {"i": c["i"] + offset, "price": hc},
                ],
                "neckline": neck,
            },
        }
        if best is None or sc > best["_score"]:
            best = cand
    return best


def detect_low_cheat(bars):
    """Minervini low cheat: early contraction in lower third of a base / cup.
    Look for a base high→low depth, then a tight plateau (5–12%) in lower 1/3–1/2 of base."""
    if not bars or len(bars) < 50:
        return None
    n = len(bars)
    # search base windows 40–100 bars
    best = None
    for w in (50, 70, 90):
        if n < w:
            continue
        win = bars[-w:]
        base_high = max(b["h"] for b in win[: max(10, w // 3)])
        base_low = min(b["l"] for b in win)
        depth = (base_high - base_low) / base_high
        if not (0.12 < depth < 0.50):
            continue
        # plateau = last 8–20 bars
        for plen in (8, 12, 16, 20):
            if plen >= w - 5:
                continue
            plat = win[-plen:]
            ph = max(b["h"] for b in plat)
            pl = min(b["l"] for b in plat)
            pdepth = (ph - pl) / ph
            if not (0.025 <= pdepth <= 0.15):
                continue
            # position of plateau mid in base: lower third to ~half (Minervini low/mid cheat)
            mid_p = (ph + pl) / 2
            pos = (mid_p - base_low) / (base_high - base_low or 1)
            if not (0.02 <= pos <= 0.60):
                continue
            # volume dry-up
            early_vol = np.mean([b["v"] for b in win[: plen]]) or 1
            late_vol = np.mean([b["v"] for b in plat]) or 1
            vol_dry = late_vol <= early_vol * 0.95
            # prefer Stage2-ish: last close above SMA50 of full bars
            closes = [b["c"] for b in bars]
            sma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
            above = sma50 and bars[-1]["c"] > sma50 * 0.97
            sc = 62 + (18 if pos <= 0.40 else 8) + (10 if vol_dry else 0) + (8 if above else 0)
            sc += (0.12 - pdepth) * 80
            # prefer when price near plateau high (setup ready)
            if bars[-1]["c"] >= pl * 1.02:
                sc += 6
            cheat_kind = "low_cheat" if pos <= 0.38 else "low_cheat"  # mid-cheat still label low_cheat for user ask
            cand = {
                "pattern": "low_cheat",
                "cheatDepthPct": round(pdepth * 100, 1),
                "baseDepthPct": round(depth * 100, 1),
                "basePosition": round(pos, 2),
                "cheatHigh": round(ph, 2),
                "cheatLow": round(pl, 2),
                "pivot": round(ph, 2),  # buy above plateau high
                "baseHigh": round(base_high, 2),
                "baseLow": round(base_low, 2),
                "volumeDry": bool(vol_dry),
                "_score": sc,
                "_ann": {
                    "cheat_i0": n - plen,
                    "cheat_i1": n - 1,
                    "cheat_high": ph,
                    "cheat_low": pl,
                    "base_high": base_high,
                    "base_low": base_low,
                    "pivot": ph,
                },
            }
            if best is None or sc > best["_score"]:
                best = cand
    return best


def detect_cup(bars):
    if not bars or len(bars) < 60:
        return None
    n = len(bars)
    best = None
    for cup_len in (45, 55, 70):
        if n < cup_len + 8:
            continue
        for handle_len in (8, 12, 16):
            if cup_len + handle_len > n:
                continue
            left = bars[n - cup_len - handle_len: n - cup_len - handle_len + cup_len // 3]
            bottom = bars[n - cup_len - handle_len + cup_len // 3: n - handle_len]
            handle = bars[n - handle_len:]
            if not left or not bottom or not handle:
                continue
            left_high = max(b["h"] for b in left)
            cup_low = min(b["l"] for b in bottom)
            right_high = max(b["h"] for b in handle)
            depth = (left_high - cup_low) / left_high
            rim = right_high / left_high
            handle_low = min(b["l"] for b in handle)
            handle_depth = (right_high - handle_low) / right_high
            if 0.12 < depth < 0.45 and rim > 0.88 and 0.02 < handle_depth < 0.18:
                sc = 68 + (12 if 0.15 < depth < 0.35 else 0) + (10 if handle_depth < 0.12 else 0)
                cand = {
                    "pattern": "cup_with_handle",
                    "cupDepthPct": round(depth * 100, 1),
                    "handleDepthPct": round(handle_depth * 100, 1),
                    "pivot": round(max(left_high, right_high), 2),
                    "_score": sc,
                    "_ann": {
                        "cup_i0": n - cup_len - handle_len,
                        "cup_i1": n - handle_len - 1,
                        "handle_i0": n - handle_len,
                        "handle_i1": n - 1,
                        "cup_low": cup_low,
                        "left_high": left_high,
                        "handle_high": right_high,
                        "handle_low": handle_low,
                        "pivot": max(left_high, right_high),
                    },
                }
                if best is None or sc > best["_score"]:
                    best = cand
    return best


def detect_triangle(bars):
    if not bars or len(bars) < 30:
        return None
    window = bars[-55:]
    offset = len(bars) - len(window)
    zz = zigzag(window, 0.035)
    highs = [p for p in zz if p["type"] == "H"][-4:]
    lows = [p for p in zz if p["type"] == "L"][-4:]
    if len(highs) < 2 or len(lows) < 2:
        return None
    h0, h1 = highs[0], highs[-1]
    l0, l1 = lows[0], lows[-1]
    h_flat = abs(h1["bar"]["h"] - h0["bar"]["h"]) / h0["bar"]["h"] < 0.035
    l_rising = l1["bar"]["l"] > l0["bar"]["l"] * 1.015
    h_falling = h1["bar"]["h"] < h0["bar"]["h"] * 0.985
    l_flat = abs(l1["bar"]["l"] - l0["bar"]["l"]) / l0["bar"]["l"] < 0.035
    ann = {
        "h0": {"i": h0["i"] + offset, "price": h0["bar"]["h"]},
        "h1": {"i": h1["i"] + offset, "price": h1["bar"]["h"]},
        "l0": {"i": l0["i"] + offset, "price": l0["bar"]["l"]},
        "l1": {"i": l1["i"] + offset, "price": l1["bar"]["l"]},
    }
    if h_flat and l_rising:
        return {"pattern": "ascending_triangle", "pivot": round(max(h["bar"]["h"] for h in highs), 2),
                "_score": 50, "_ann": ann}
    if l_flat and h_falling:
        return {"pattern": "descending_triangle", "pivot": round(min(l["bar"]["l"] for l in lows), 2),
                "_score": 48, "_ann": ann}
    if h_falling and l_rising:
        return {"pattern": "sym_triangle", "pivot": round(h1["bar"]["h"], 2),
                "_score": 47, "_ann": ann}
    return None


def detect_flat_base(bars):
    """IBD flat base: shallow sideways after advance, depth typically ≤15%, length ≥5 weeks (~25 bars)."""
    if not bars or len(bars) < 50:
        return None
    n = len(bars)
    best = None
    # prior advance
    for base_len in (25, 30, 40):
        if n < base_len + 15:
            continue
        prior = bars[n - base_len - 20: n - base_len]
        base = bars[n - base_len:]
        if not prior:
            continue
        prior_move = (prior[-1]["c"] - prior[0]["c"]) / prior[0]["c"]
        if prior_move < 0.12:
            continue
        bh = max(b["h"] for b in base)
        bl = min(b["l"] for b in base)
        depth = (bh - bl) / bh
        if depth > 0.16 or depth < 0.03:
            continue
        # ascending base: higher lows
        third = base_len // 3
        l1 = min(b["l"] for b in base[:third])
        l3 = min(b["l"] for b in base[-third:])
        ascending = l3 > l1 * 1.02
        pattern = "ascending_base" if ascending else "flat_base"
        sc = 65 + (14 if depth <= 0.12 else 0) + (12 if ascending else 0) + prior_move * 25
        cand = {
            "pattern": pattern,
            "baseDepthPct": round(depth * 100, 1),
            "priorAdvancePct": round(prior_move * 100, 1),
            "pivot": round(bh, 2),
            "baseHigh": round(bh, 2),
            "baseLow": round(bl, 2),
            "_score": sc,
            "_ann": {
                "base_i0": n - base_len,
                "base_i1": n - 1,
                "base_high": bh,
                "base_low": bl,
                "pivot": bh,
            },
        }
        if best is None or sc > best["_score"]:
            best = cand
    return best


def detect_channel(bars):
    if not bars or len(bars) < 40:
        return None
    sl = bars[-45:]
    offset = len(bars) - len(sl)
    highs = [b["h"] for b in sl]
    lows = [b["l"] for b in sl]

    def fit(vals):
        n = len(vals)
        sx = sum(range(n)); sy = sum(vals)
        sxx = sum(i * i for i in range(n)); sxy = sum(i * vals[i] for i in range(n))
        den = n * sxx - sx * sx
        if abs(den) < 1e-9:
            return 0.0, vals[0]
        m = (n * sxy - sx * sy) / den
        b0 = (sy - m * sx) / n
        return m, b0

    sh, bh = fit(highs)
    slp, bl = fit(lows)
    mid = (highs[0] + lows[0]) / 2 or 1
    same = (sh > 0 and slp > 0) or (sh < 0 and slp < 0)
    parallel = abs(sh - slp) / mid < 0.12
    if same and parallel and abs(sh) / mid > 0.015:
        return {
            "pattern": "rising_channel" if sh > 0 else "falling_channel",
            "dir": "up" if sh > 0 else "down",
            "pivot": round(highs[-1] if sh > 0 else lows[-1], 2),
            "_score": 42,
            "_ann": {
                "i0": offset, "i1": len(bars) - 1,
                "hi_m": sh, "hi_b": bh, "lo_m": slp, "lo_b": bl,
                "n": len(sl),
            },
        }
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


def sma(closes, n):
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def pick_primary(*patterns):
    cands = [p for p in patterns if p]
    if not cands:
        return None, []
    cands.sort(key=lambda p: -p.get("_score", 0))
    # Prefer non-VCP when close in score — user asked not to force everything to VCP
    top = cands[0]
    if top.get("pattern") == "VCP":
        # Margins: allow flag/triple/low_cheat/flat to override VCP more readily;
        # cup/triangle need to be closer (keep some classic VCP as primary).
        margins = {
            "bull_flag": 55, "bear_flag": 55, "triple_bottom": 55, "triple_top": 55,
            "low_cheat": 55, "flat_base": 55, "ascending_base": 55,
            "cup_with_handle": 28, "ascending_triangle": 40, "descending_triangle": 40,
            "sym_triangle": 40, "rising_channel": 45, "falling_channel": 45,
        }
        best_alt = None
        for alt in cands[1:]:
            pat = alt.get("pattern")
            if pat not in margins:
                continue
            if alt.get("_score", 0) >= top.get("_score", 0) - margins[pat]:
                if best_alt is None or alt.get("_score", 0) > best_alt.get("_score", 0):
                    best_alt = alt
        if best_alt is not None:
            primary = best_alt
            alts = [top] + [c for c in cands[1:] if c is not best_alt]
            return primary, alts
    primary = cands[0]
    alts = cands[1:]
    return primary, alts


def analyze(ticker, bars, meta):
    last = bars[-1]
    closes = [b["c"] for b in bars]
    ma30 = sma(closes, 30)
    ma50 = sma(closes, 50)
    detectors = [
        detect_vcp(bars),
        detect_flag(bars),
        detect_triple_bottom(bars),
        detect_triple_top(bars),
        detect_low_cheat(bars),
        detect_cup(bars),
        detect_triangle(bars),
        detect_flat_base(bars),
        detect_channel(bars),
    ]
    primary, alts = pick_primary(*detectors)
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
    vcp = next((p for p in detectors if p and p.get("pattern") == "VCP"), None)
    if vcp and vcp.get("contractions"):
        contractions_tw = " → ".join(f"{c['label']} {c['pct']}%" for c in vcp["contractions"])
    why = ""
    if primary:
        pat = primary["pattern"]
        if pat == "VCP":
            why = f"收縮遞減 {contractions_tw}，選為主形態（score={primary.get('_score',0):.0f}）"
        elif pat == "bull_flag":
            why = f"旗杆升幅 {primary.get('poleMovePct')}%，旗面回撤 {primary.get('retracePct')}%≤50%，量縮整理 → Bull Flag（score={primary.get('_score',0):.0f}）"
        elif pat == "bear_flag":
            why = f"下殺旗杆後橫盤／微升整理 → Bear Flag（score={primary.get('_score',0):.0f}）"
        elif pat == "triple_bottom":
            lows = primary.get("lows") or []
            why = f"三個近似低點 {[x.get('price') for x in lows]} ＋頸線 ${primary.get('neckline')} → 三底（score={primary.get('_score',0):.0f}）"
        elif pat == "low_cheat":
            why = f"基座深度 {primary.get('baseDepthPct')}%，平台深度 {primary.get('cheatDepthPct')}% 位於基座偏下（pos={primary.get('basePosition')}）→ Low Cheat（score={primary.get('_score',0):.0f}）"
        elif pat == "cup_with_handle":
            why = f"杯深 {primary.get('cupDepthPct')}%、柄深 {primary.get('handleDepthPct')}% → 杯柄（score={primary.get('_score',0):.0f}）"
        elif pat in ("flat_base", "ascending_base"):
            why = f"先前升浪後淺盤整深度 {primary.get('baseDepthPct')}% → {LABELS.get(pat)}（score={primary.get('_score',0):.0f}）"
        else:
            why = f"偵測為 {LABELS.get(pat, pat)}（score={primary.get('_score',0):.0f}）"
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
        "alternates": [{k: v for k, v in a.items() if not str(k).startswith("_")} for a in alts[:3]],
        "contractions": vcp["contractions"] if vcp else None,
        "pivot": pivot,
        "pivotDate": primary.get("pivotDate") if primary else None,
        "status": status,
        "trendlines": trendlines,
        "chartPath": None,
        "barsUsed": len(bars),
        "dataSource": meta.get("dataSource", "yfinance"),
        "whyPattern": why,
        "_ann": (primary or {}).get("_ann"),
        "_score": (primary or {}).get("_score"),
    }
    lines = [
        f"{ticker}" + (f"（{meta.get('name')}）" if meta.get("name") else "") + f" 日K技術分析 @ {last['date']}",
        f"主形態：{report['primaryLabelTw']}" + (f"；{contractions_tw}" if contractions_tw and report['primaryPattern']=='VCP' else ""),
        why,
        (f"Pivot／突破位：${pivot}" + (f"（{report['pivotDate']}）" if report.get("pivotDate") else "")) if pivot is not None else "Pivot：待定",
        f"收市：${report['close']}" + (f"；{status}" if status else ""),
        (f"相對 SMA30：{'上方' if report['aboveMa30'] else '下方'}（SMA30≈{report['ma30']}）") if ma30 is not None else "",
        ("趨勢線：" + "；".join(l["note"] for l in trendlines)) if trendlines else "",
        f"主題／ETF：{meta.get('theme')}／{meta.get('etf')}" if meta.get("theme") else "",
    ]
    report["summaryTw"] = "\n".join(x for x in lines if x)
    return report


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
        corr = pearson_corr(base_ret, log_returns([b["c"] for b in bars]))
        if corr is not None:
            corr = round(corr, 3)
        co = corr is not None and corr >= 0.45
        if not same and not co:
            continue
        rows.append({
            "ticker": t, "name": names.get(t), "theme": info.get("theme"),
            "corr60": corr, "close": round(bars[-1]["c"], 2),
            "sameTheme": same, "coMoving": co,
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
    hint = ("／".join(r["ticker"] for r in strong) + f" 與 {ticker} 近月同步，若同時收緊／突破，較似板塊資金部署。"
            if strong else "未見強同步兄弟股；可保留同主題名單繼續觀察。")
    return top, hint


# --- candlestick chart (Frok NOW style) ---
def draw_candle_chart(ticker, bars, report, path_svg):
    # Prefer CJK-capable font for Traditional Chinese annotations
    _cjk_fp = None
    try:
        from matplotlib import font_manager as _fm
        import matplotlib as _mpl
        for _fp in (
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        ):
            if Path(_fp).exists():
                _fm.fontManager.addfont(_fp)
                _cjk_fp = _fm.FontProperties(fname=_fp)
                _mpl.rcParams["font.family"] = _cjk_fp.get_name()
                _mpl.rcParams["axes.unicode_minus"] = False
                break
    except Exception:
        _cjk_fp = None
    # VCP: macro / zoomed-out window so whole contraction structure is visible
    pat0 = report.get("primaryPattern")
    n_bars = 240 if pat0 == "VCP" else 150
    use = bars[-n_bars:] if len(bars) > n_bars else bars
    offset = len(bars) - len(use)
    dates = [pd.Timestamp(b["date"]) for b in use]
    fig = plt.figure(figsize=(13, 7.5), dpi=120)
    fig.patch.set_facecolor("#121212")
    gs = fig.add_gridspec(2, 1, height_ratios=[3.2, 1.0], hspace=0.05)
    ax = fig.add_subplot(gs[0])
    axv = fig.add_subplot(gs[1], sharex=ax)
    ax.set_facecolor("#1a1a1a")
    axv.set_facecolor("#1a1a1a")

    x = np.arange(len(use))
    width = 0.6
    for i, b in enumerate(use):
        up = b["c"] >= b["o"]
        color = "#26a69a" if up else "#ef5350"
        ax.plot([i, i], [b["l"], b["h"]], color=color, lw=0.9, solid_capstyle="round")
        body_lo = min(b["o"], b["c"])
        body_hi = max(b["o"], b["c"])
        bh = max(body_hi - body_lo, (ax.get_ylim()[1] - ax.get_ylim()[0]) * 0.001 if False else 0.01)
        # temporary; fix after ylim
        ax.add_patch(Rectangle((i - width / 2, body_lo), width, max(body_hi - body_lo, 1e-6),
                               facecolor=color, edgecolor=color, lw=0, zorder=3))
        vc = color
        axv.bar(i, b["v"], width=0.7, color=vc, alpha=0.7)

    # white zigzag overlay — coarser for VCP so line emphasizes structure swings
    zz_thr = 0.08 if pat0 == "VCP" else 0.05
    zz = zigzag(use, zz_thr)
    if len(zz) >= 2:
        zx = [p["i"] for p in zz]
        zy = [p["bar"]["h"] if p["type"] == "H" else p["bar"]["l"] for p in zz]
        ax.plot(zx, zy, color="#ffffff", lw=2.0 if pat0 == "VCP" else 1.5, alpha=0.9, zorder=4)

    pat = report.get("primaryPattern")
    ann = report.get("_ann") or {}
    label_tw = report.get("primaryLabelTw") or pat

    def x_of(global_i):
        return global_i - offset

    def add_label(xi, yi, text, edge="#ffd54f", fc="#111"):
        ax.annotate(text, xy=(xi, yi), xytext=(0, 12), textcoords="offset points",
                    fontsize=9, fontweight="bold", color="#111",
                    bbox=dict(boxstyle="round,pad=0.25", facecolor=edge, edgecolor=edge, alpha=0.95),
                    ha="center", zorder=6)

    if pat == "VCP":
        # Style lock (human exemplar NOW): white zigzag + C1/C2/C3 at lows
        # (white fill / black text to match JPG), C3 green box + vol dry-up,
        # DTL across C3 highs, Bo DTL + labeled pivot point.
        cons = report.get("contractions") or []
        ann_cons = (ann.get("contractions") if isinstance(ann, dict) else None) or cons
        c3_span = None
        c3_highs = []
        for c in ann_cons:
            try:
                if c.get("_hi") is not None and c.get("_li") is not None:
                    hi, li = int(c["_hi"]), int(c["_li"])
                else:
                    hi = next(i for i, b in enumerate(bars) if b["date"] == c["highDate"])
                    li = next(i for i, b in enumerate(bars) if b["date"] == c["lowDate"])
                xi_h, yi_h = x_of(hi), c["high"]
                xi_l, yi_l = x_of(li), c["low"]
                lab = c.get("label") or "?"
                # Exemplar JPG: white box, black text on contraction lows
                if 0 <= xi_l < len(use):
                    ax.annotate(lab, xy=(xi_l, yi_l), xytext=(0, -18), textcoords="offset points",
                                fontsize=10, fontweight="bold", color="#000000",
                                bbox=dict(boxstyle="square,pad=0.28", facecolor="#ffffff",
                                          edgecolor="#000000", lw=1.3),
                                ha="center", zorder=7)
                if 0 <= xi_h < len(use) and 0 <= xi_l < len(use):
                    if lab.upper() == "C3":
                        x0 = min(xi_h, xi_l)
                        x1 = max(xi_h, xi_l)
                        # Extend only through nearby pivot-zone chop (cap ~25 bars),
                        # not the whole right edge when price remains below pivot.
                        pv = report.get("pivot") or c["high"]
                        ext = int(x1)
                        for ii in range(int(x1) + 1, min(len(use), int(x1) + 25)):
                            if use[ii]["h"] > pv * 1.01:
                                break
                            # stop if a sharp thrust away from the tight zone
                            if use[ii]["l"] < (c["low"] * 0.92):
                                break
                            ext = ii
                        c3_span = (x0, max(x1, ext))
                        lo_i, hi_i = int(c3_span[0]), int(c3_span[1])
                        for ii in range(max(0, lo_i), min(len(use), hi_i + 1)):
                            c3_highs.append((ii, use[ii]["h"]))
                    else:
                        ax.axvspan(min(xi_h, xi_l), max(xi_h, xi_l), color="#ffffff", alpha=0.03, zorder=1)
            except (StopIteration, KeyError, TypeError, ValueError):
                pass
        if c3_span is not None:
            x0, x1 = c3_span
            idxs = [i for i in range(int(x0), int(x1) + 1) if 0 <= i < len(use)]
            if idxs:
                y_hi = max(use[i]["h"] for i in idxs)
            else:
                y_hi = use[-1]["h"]
            ax.axvspan(x0, x1, color="#2e7d32", alpha=0.22, zorder=1)
            axv.axvspan(x0, x1, color="#2e7d32", alpha=0.18, zorder=1)
            ax.annotate("綠色範圍內(pivot point)成交量萎縮",
                        xy=((x0 + x1) / 2, y_hi), xytext=(0, 18), textcoords="offset points",
                        fontsize=8, color="#000000",
                        fontproperties=_cjk_fp,
                        bbox=dict(boxstyle="square,pad=0.3", facecolor="#ffffff",
                                  edgecolor="#000000", lw=1.0),
                        ha="center", zorder=7)
            mid = int((x0 + x1) / 2)
            if 0 <= mid < len(use) and idxs:
                vmax = max(use[i]["v"] for i in idxs) or 1
                axv.annotate("", xy=(mid, max(1, use[mid]["v"] * 0.12)),
                             xytext=(mid, vmax * 0.85),
                             arrowprops=dict(arrowstyle="->", color="#ffffff", lw=2.0), zorder=6)
            # DTL across C3 highs (descending into pivot)
            if len(c3_highs) >= 3:
                mid_c = max(2, len(c3_highs) // 2)
                left = max(c3_highs[:mid_c], key=lambda t: t[1])
                later = [t for t in c3_highs[mid_c:] if t[0] > left[0]]
                if later:
                    # prefer a later peak that is <= left (descending DTL)
                    desc = [t for t in later if t[1] <= left[1] * 1.01]
                    right = max(desc or later, key=lambda t: t[1])
                else:
                    right = max(c3_highs[-max(2, len(c3_highs) // 3):], key=lambda t: t[1])
                if right[0] > left[0]:
                    slope = (right[1] - left[1]) / max(1, right[0] - left[0])
                    x_ext = min(len(use) - 1, right[0] + 10)
                    y_ext = right[1] + slope * (x_ext - right[0])
                    ax.plot([left[0], x_ext], [left[1], y_ext], color="#ffffff", lw=1.8, zorder=5)
                    ax.annotate("down trend line(DTL)", xy=(right[0], right[1]),
                                xytext=(14, 12), textcoords="offset points",
                                fontsize=8, color="#000000",
                                bbox=dict(boxstyle="square,pad=0.2", facecolor="#ffffff",
                                          edgecolor="#000000"),
                                arrowprops=dict(arrowstyle="->", color="#ffffff", lw=1.2), zorder=7)
                    y_at_last = left[1] + slope * ((len(use) - 1) - left[0])
                    if use[-1]["c"] >= y_at_last * 0.995 or (
                        report.get("pivot") is not None and use[-1]["c"] >= report["pivot"] * 0.98
                    ):
                        ax.annotate("Bo DTL", xy=(len(use) - 2, use[-2]["h"]),
                                    xytext=(-48, 24), textcoords="offset points",
                                    fontsize=9, fontweight="bold", color="#000000",
                                    bbox=dict(boxstyle="square,pad=0.25", facecolor="#ffffff",
                                              edgecolor="#000000"),
                                    arrowprops=dict(arrowstyle="->", color="#ffffff", lw=1.4), zorder=8)
        if report.get("pivot") is not None:
            pv = report["pivot"]
            ax.axhline(pv, color="#ffffff", ls="-", lw=1.2, alpha=0.85, zorder=5)
            ax.annotate("pivot point", xy=(len(use) - 1, pv),
                        xytext=(-70, 16), textcoords="offset points",
                        fontsize=9, fontweight="bold", color="#000000",
                        bbox=dict(boxstyle="square,pad=0.25", facecolor="#ffffff",
                                  edgecolor="#000000", lw=1.2),
                        arrowprops=dict(arrowstyle="->", color="#ffffff", lw=1.2),
                        ha="right", va="bottom", zorder=7)

    elif pat in ("bull_flag", "bear_flag"):
        pi0, pi1 = ann.get("pole_i0"), ann.get("pole_i1")
        fi0, fi1 = ann.get("flag_i0"), ann.get("flag_i1")
        if pi0 is not None:
            ax.axvspan(x_of(pi0), x_of(pi1), color="#66bb6a" if pat == "bull_flag" else "#ef5350", alpha=0.12)
            add_label(x_of((pi0 + pi1) // 2), ann.get("pole_high", use[-1]["h"]), "Flagpole")
        if fi0 is not None:
            fh, fl = ann.get("flag_high"), ann.get("flag_low")
            # channel lines
            ax.plot([x_of(fi0), x_of(fi1)], [fh, fh], color="#ffd54f", ls="-", lw=1.3)
            ax.plot([x_of(fi0), x_of(fi1)], [fl, fl], color="#ffd54f", ls="-", lw=1.3)
            # slight slope mimic: connect first/last highs lows of flag window
            add_label(x_of((fi0 + fi1) // 2), fl, "Flag")
        if report.get("pivot") is not None:
            pv = report["pivot"]
            ax.axhline(pv, color="#42a5f5", ls="--", lw=2.4, zorder=5)
            ax.annotate(f"Pivot ${pv:.2f}", xy=(len(use) - 1, pv),
                        xytext=(-8, 14), textcoords="offset points",
                        fontsize=11, fontweight="bold", color="#0a0a0a",
                        bbox=dict(boxstyle="round,pad=0.35", facecolor="#42a5f5", edgecolor="#90caf9", alpha=0.98),
                        ha="right", va="bottom", zorder=7)

    elif pat == "triple_bottom":
        for i, lo in enumerate(ann.get("lows") or []):
            xi = x_of(lo["i"])
            if 0 <= xi < len(use):
                add_label(xi, lo["price"], f"L{i+1}")
                ax.scatter([xi], [lo["price"]], color="#ffd54f", s=40, zorder=5)
        neck = ann.get("neckline") or report.get("pivot")
        if neck:
            ax.axhline(neck, color="#42a5f5", ls="--", lw=1.3)
            ax.text(len(use) - 1, neck, f"  neckline ${neck}", color="#42a5f5", fontsize=9, va="bottom", ha="right")
        if report.get("detail", {}).get("support") or report.get("pivot"):
            support = (report.get("detail") or {}).get("support")
            if support:
                ax.axhline(support, color="#26a69a", ls=":", lw=1.0, alpha=0.8)

    elif pat == "triple_top":
        for i, hi in enumerate(ann.get("highs") or []):
            xi = x_of(hi["i"])
            if 0 <= xi < len(use):
                add_label(xi, hi["price"], f"H{i+1}")
        neck = ann.get("neckline")
        if neck:
            ax.axhline(neck, color="#42a5f5", ls="--", lw=1.3)

    elif pat == "low_cheat":
        ci0, ci1 = ann.get("cheat_i0"), ann.get("cheat_i1")
        ch, cl = ann.get("cheat_high"), ann.get("cheat_low")
        if ci0 is not None:
            ax.axvspan(x_of(ci0), x_of(ci1), color="#ab47bc", alpha=0.15)
            ax.plot([x_of(ci0), x_of(ci1)], [ch, ch], color="#ffd54f", lw=1.4)
            ax.plot([x_of(ci0), x_of(ci1)], [cl, cl], color="#ffd54f", lw=1.2, ls=":")
            add_label(x_of((ci0 + ci1) // 2), ch, "Low Cheat")
        if ann.get("base_high"):
            ax.axhline(ann["base_high"], color="#78909c", ls=":", lw=1.0, alpha=0.7)
            ax.text(2, ann["base_high"], " base high", color="#78909c", fontsize=8, va="bottom")
        if report.get("pivot"):
            ax.axhline(report["pivot"], color="#42a5f5", ls="--", lw=1.3)
            ax.text(len(use) - 1, report["pivot"], f"  cheat pivot ${report['pivot']}",
                    color="#42a5f5", fontsize=9, va="bottom", ha="right")

    elif pat == "cup_with_handle":
        if ann.get("cup_low"):
            add_label(x_of((ann["cup_i0"] + ann["cup_i1"]) // 2), ann["cup_low"], "Cup")
        if ann.get("handle_i0") is not None:
            ax.axvspan(x_of(ann["handle_i0"]), x_of(ann["handle_i1"]), color="#ffd54f", alpha=0.12)
            add_label(x_of((ann["handle_i0"] + ann["handle_i1"]) // 2), ann.get("handle_high", use[-1]["h"]), "Handle")
        if report.get("pivot"):
            ax.axhline(report["pivot"], color="#42a5f5", ls="--", lw=1.3)

    elif pat in ("flat_base", "ascending_base"):
        if ann.get("base_i0") is not None:
            ax.axhspan(ann["base_low"], ann["base_high"], xmin=0, xmax=1, color="#42a5f5", alpha=0.06)
            ax.axhline(ann["base_high"], color="#42a5f5", ls="--", lw=1.3)
            ax.axhline(ann["base_low"], color="#26a69a", ls=":", lw=1.0)
            add_label(x_of((ann["base_i0"] + ann["base_i1"]) // 2), ann["base_high"],
                      "Asc Base" if pat == "ascending_base" else "Flat Base")

    elif pat in ("ascending_triangle", "descending_triangle", "sym_triangle"):
        for key, col in (("h0", "#ef5350"), ("h1", "#ef5350"), ("l0", "#26a69a"), ("l1", "#26a69a")):
            p = ann.get(key)
            if p:
                ax.scatter([x_of(p["i"])], [p["price"]], color=col, s=28, zorder=5)
        if ann.get("h0") and ann.get("h1"):
            ax.plot([x_of(ann["h0"]["i"]), x_of(ann["h1"]["i"])],
                    [ann["h0"]["price"], ann["h1"]["price"]], color="#ef5350", lw=1.3)
        if ann.get("l0") and ann.get("l1"):
            ax.plot([x_of(ann["l0"]["i"]), x_of(ann["l1"]["i"])],
                    [ann["l0"]["price"], ann["l1"]["price"]], color="#26a69a", lw=1.3)
        if report.get("pivot"):
            ax.axhline(report["pivot"], color="#42a5f5", ls="--", lw=1.2)

    elif pat in ("rising_channel", "falling_channel"):
        nch = ann.get("n") or 45
        i0 = ann.get("i0", offset)
        xs = np.arange(nch)
        hi_line = ann["hi_b"] + ann["hi_m"] * xs
        lo_line = ann["lo_b"] + ann["lo_m"] * xs
        ax.plot(xs + (i0 - offset), hi_line, color="#42a5f5", lw=1.3)
        ax.plot(xs + (i0 - offset), lo_line, color="#26a69a", lw=1.3)
        add_label(len(use) // 2, hi_line[-1] if len(hi_line) else use[-1]["h"],
                  "Up Channel" if pat == "rising_channel" else "Down Channel")

    # current price tag
    ax.annotate(f"{use[-1]['c']:.2f}", xy=(len(use) - 1, use[-1]["c"]),
                xytext=(8, 0), textcoords="offset points", color="#66bb6a", fontsize=9, fontweight="bold")

    ax.set_title(f"{ticker} Daily — {pat} @ {report.get('asOf')}", color="#e0e0e0", fontsize=12, pad=8)
    ax.tick_params(colors="#9e9e9e", labelbottom=False)
    axv.tick_params(colors="#9e9e9e")
    for sp in list(ax.spines.values()) + list(axv.spines.values()):
        sp.set_color("#2a2a2a")
    ax.grid(True, color="#2a2a2a", alpha=0.7, lw=0.6)
    axv.grid(True, color="#2a2a2a", alpha=0.5, lw=0.5)
    ax.set_xlim(-1, len(use))
    # date ticks
    tick_idx = list(range(0, len(use), max(1, len(use) // 6)))
    axv.set_xticks(tick_idx)
    axv.set_xticklabels([dates[i].strftime("%m/%d") for i in tick_idx], color="#9e9e9e")
    axv.set_ylabel("Volume", color="#9e9e9e", fontsize=8)
    ax.set_ylabel("Price", color="#9e9e9e", fontsize=8)
    fig.tight_layout()
    fig.savefig(path_svg, format="svg", facecolor=fig.get_facecolor(), bbox_inches="tight")
    # also png
    path_png = Path(str(path_svg).replace(".svg", ".png"))
    fig.savefig(path_png, format="png", facecolor=fig.get_facecolor(), bbox_inches="tight", dpi=120)
    plt.close(fig)
    return str(path_svg), str(path_png)


def load_screener_pass():
    p = DATA / "screener-run-latest.json"
    if not p.exists():
        return [], {}, None
    j = json.loads(p.read_text())
    results = j.get("results") or []
    return [r["ticker"] for r in results], {r["ticker"]: r for r in results}, j


def proximity_score(a):
    pivot = a.get("pivot")
    close = a.get("close")
    if pivot is None or close is None or pivot == 0:
        return -1e9
    dist = abs(close - pivot) / pivot
    score = 100 - dist * 1000
    score += (a.get("_score") or 0) * 0.15
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
        "VRT": "Vertiv", "BE": "Bloom Energy", "CIEN": "Ciena", "GLW": "Corning",
        "DELL": "Dell", "DDOG": "Datadog", "FTNT": "Fortinet", "CEG": "Constellation",
        "HPE": "Hewlett Packard Enterprise", "MSTR": "MicroStrategy", "ORCL": "Oracle", "TSM": "TSMC",
    })
    passed, pass_meta, screener = load_screener_pass()
    passed_set = set(passed)

    # Full screener universe — no 22-cap; logic chain follows Frok's entire pass list
    core = [t for t in PREFERRED if t in passed_set]
    if screener:
        ranked = sorted(screener.get("results") or [], key=lambda r: -(r.get("avgVol1m") or 0))
        for r in ranked:
            t = r["ticker"]
            if t in core:
                continue
            if t in ("AAPL", "AMZN", "MSFT", "GOOGL", "TSLA"):
                continue
            core.append(t)
    # also include any passed not already in core
    for t in passed:
        if t not in core and t not in ("AAPL", "AMZN", "MSFT", "GOOGL", "TSLA"):
            core.append(t)
    CORE = core  # all screener-passed

    thinking = []
    def tlog(step, detail):
        thinking.append({
            "t": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "bot": "Grok", "role": "技術分析＋兄弟姊妹股／板塊",
            "step": step, "detail": detail,
        })

    tlog("learn:patterns",
         "已對齊網上規則：Bull Flag=旗杆≥~10%/2ATR＋旗面≤50%回撤量縮；三底=三近似低點±3%＋頸線；"
         "Low Cheat=Minervini 基座偏下 1/3～1/2 緊平台 5–12% 提前進場；另有杯柄／三角／平底／通道。唔再強制全部 VCP。")
    tlog("scan:start", f"多形態掃描 CORE={CORE}（Frok 通過 {len(passed)}）")

    all_tickers = list(dict.fromkeys(CORE + EXTRA))
    ohlcv_map = {}
    failed = []
    for t in all_tickers:
        try:
            bars = fetch_one(t)
            if bars:
                ohlcv_map[t] = bars
                (OHLCV_DIR / f"{t}.json").write_text(json.dumps({"ticker": t, "bars": bars[-260:]}, ensure_ascii=False))
                tlog("fetch:ok", f"{t} {len(bars)} bars @ {bars[-1]['date']}")
            else:
                failed.append(t)
        except Exception as e:
            failed.append(t)
            tlog("fetch:error", f"{t}: {e}")

    analyses = []
    for t in CORE:
        if t not in ohlcv_map:
            continue
        info = theme_map.get(t, {})
        pm = pass_meta.get(t, {})
        meta = {
            "name": pm.get("name") or names.get(t),
            "theme": pm.get("theme") or info.get("theme"),
            "etf": pm.get("etf") or info.get("etf"),
            "dataSource": "yfinance",
        }
        report = analyze(t, ohlcv_map[t], meta)
        sibs, hint = find_siblings(t, meta.get("theme"), ohlcv_map, theme_map, names)
        report["siblings"] = sibs
        report["siblingHint"] = hint
        report["inScreenerPass"] = t in passed_set  # candidate pool membership
        # 技術通過：形態＋pivot＋≤6%＋質素閘（對齊 NOW VCP 畫法標準，唔再用「有形就過」）
        # 允許：VCP（C1>C2>C3）／Bull Flag／Ascending／Flat／Cup；剔除 flood 的 low_cheat／弱三底
        pat = report.get("primaryPattern")
        pat_ok = pat not in (None, "none")
        pivot = report.get("pivot")
        close = report.get("close")
        dist_ok = False
        dist = None
        if pat_ok and pivot not in (None, 0) and close is not None:
            try:
                dist = abs(float(close) - float(pivot)) / abs(float(pivot))
                dist_ok = dist <= 0.06
            except (TypeError, ValueError, ZeroDivisionError):
                dist_ok = False
        sc = float(report.get("_score") or 0)
        quality_ok = False
        if pat_ok and dist_ok and report.get("aboveMa30"):
            if pat == "VCP":
                cons = report.get("contractions") or []
                pcts = [c.get("pct") for c in cons if c.get("pct") is not None]
                progressive = len(pcts) >= 3 and pcts[0] > pcts[1] > pcts[2]
                quality_ok = progressive and sc >= 120
            elif pat == "bull_flag":
                quality_ok = sc >= 110
            elif pat in ("ascending_base", "flat_base", "cup_with_handle", "cup"):
                quality_ok = sc >= 90
            # low_cheat / triple_bottom / others: 有圖可睇，但唔入 techPass
        report["patternScore"] = round(sc, 1) if sc else None
        report["techPass"] = bool(pat_ok and dist_ok and quality_ok)
        tlog("analyze:pattern", f"{t} → {report['primaryPattern']} | {report.get('whyPattern','')}")
        analyses.append(report)

    # Draw EVERY analyzed ticker (full chain from screener); keep diversity only for logging
    chosen = [a for a in analyses if a.get("primaryPattern") != "none"]
    # also draw "none" with a basic chart so UI never blanks a screener name
    chosen_none = [a for a in analyses if a.get("primaryPattern") == "none"]
    chosen = chosen + chosen_none
    tlog("chart:plan", f"將為全部 {len(chosen)} 隻畫圖（有形態 {len(chosen)-len(chosen_none)}／無明確形態 {len(chosen_none)}）")

    drawn = []
    for a in chosen:
        t = a["ticker"]
        fname = f"{t}_scan_{a['primaryPattern']}.svg"
        path = CHARTS / fname
        try:
            svg, png = draw_candle_chart(t, ohlcv_map[t], a, path)
            rel = f"data/charts/{fname}"
            a["chartPath"] = rel
            a["chartPng"] = f"data/charts/{Path(png).name}"
            drawn.append(rel)
            tlog("chart:drawn", f"{t} {a['primaryPattern']} → {rel}")
        except Exception as e:
            tlog("chart:error", f"{t}: {e}")

    # clear private fields
    for a in analyses:
        a.pop("_ann", None)
        a.pop("_score", None)

    analyses.sort(key=lambda a: (0 if a.get("inScreenerPass") else 1, -proximity_score(a)))
    pattern_counts = {}
    for a in analyses:
        pattern_counts[a["primaryPattern"]] = pattern_counts.get(a["primaryPattern"], 0) + 1
    tlog("scan:diversity", f"形態分布：{pattern_counts}")

    top_setups = []
    for a in sorted([x for x in analyses if x["primaryPattern"] != "none"], key=lambda x: -proximity_score(x))[:8]:
        top_setups.append({
            "ticker": a["ticker"], "pattern": a["primaryPattern"], "labelTw": a["primaryLabelTw"],
            "pivot": a.get("pivot"), "close": a["close"], "status": a.get("status"),
            "theme": a.get("theme"), "etf": a.get("etf"),
            "siblings": [s["ticker"] for s in (a.get("siblings") or [])[:3]],
            "summaryTw": a.get("summaryTw"), "chartPath": a.get("chartPath"),
            "whyPattern": a.get("whyPattern"),
            "inScreenerPass": bool(a.get("inScreenerPass")),
            "contractions": a.get("contractions"),
        })

    as_of = max((a["asOf"] for a in analyses), default=None)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "bot": "Grok",
        "role": "技術分析＋兄弟姊妹股／板塊",
        "asOfMarket": as_of,
        "filterNote": "多形態掃描全覆蓋 Frok 候選池；技術通過＝形態＋pivot＋距pivot≤6%；每隻畫圖",
        "universeSource": "data/screener-run-latest.json",
        "patternCounts": pattern_counts,
        "scanned": [a["ticker"] for a in analyses],
        "failedFetches": failed,
        "analyses": analyses,
        "thinkingLog": thinking,
        "charts": drawn,
        "topSetups": top_setups,
        "techPassed": [a["ticker"] for a in analyses if a.get("techPass")],
        "techPassedCount": sum(1 for a in analyses if a.get("techPass")),
        "candidateCount": len(passed),
        "rule": "Frok=候選池；Grok=技術通過（有形態＋可畫pivot＋收市距pivot≤6%）",
        "screenerAlign": {
            "source": "data/screener-run-latest.json",
            "passedCount": len(passed),
            "scannedInPass": [a["ticker"] for a in analyses if a.get("inScreenerPass")],
        },
        "chartNote": "日K 蠟燭圖＋形態標註（跟 Frok NOW 風格）；SVG 推上 GitHub Pages",
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {OUT}")
    print("patternCounts:", pattern_counts)
    print("charts:", drawn)
    for s in top_setups[:8]:
        print(f"  {s['ticker']:6} {s['pattern']:18} pivot={s['pivot']} close={s['close']} chart={s.get('chartPath')}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 2 and sys.argv[1] == "--grade":
        # Thin wire to training gate (does not run full scan).
        sys.path.insert(0, str(ROOT / "scripts"))
        from lesson_chart_grade import grade
        svg = Path(sys.argv[2] if len(sys.argv) > 2 else DATA / "charts" / "NOW_scan_VCP.svg")
        if not svg.is_absolute():
            cand = (Path.cwd() / svg).resolve()
            svg = cand if cand.exists() else (ROOT / sys.argv[2]).resolve()
        ticker = None
        if "--ticker" in sys.argv:
            i = sys.argv.index("--ticker")
            ticker = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
        r = grade(svg_path=svg, ticker=ticker)
        print(json.dumps({
            "ticker": r["ticker"], "score": r["score"], "pass": r["pass"],
            "verdict": r["verdict"], "runPath": r.get("runPath"),
            "failedItems": [x["id"] for x in r["itemResults"] if not x["passed"]],
        }, ensure_ascii=False, indent=2))
        raise SystemExit(0 if r.get("verdict") == "keep" else 1)
    main()
