#!/usr/bin/env python3
"""Jrok company-run refresh: AXTI template + Yahoo fundamentals; techPass only."""
from __future__ import annotations

import json
import math
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path("/workspace/stockdesk")
TECH_PATH = ROOT / "data/tech-scan-latest.json"
SCREENER_PATH = ROOT / "data/screener-run-latest.json"
PREV_PATH = ROOT / "data/company-run-latest.json"
OUT_PATH = ROOT / "data/company-run-latest.json"
LEADERS_PATH = ROOT / "data/company-leaders-latest.json"
META_PATH = ROOT / "data/logs/_company_refresh_meta.json"
LOG_PATH = ROOT / f"data/logs/jrok-company-{datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d')}.json"

PAT_LABEL = {
    "low_cheat": "Low Cheat",
    "bull_flag": "牛旗",
    "triple_bottom": "三底",
    "VCP": "VCP",
    "ascending_base": "上升基座",
    "flat_base": "平底",
}
PATTERN_BONUS = {"bull_flag", "VCP", "triple_bottom", "ascending_base", "flat_base"}

# theme → (valueChain position, detail, default moat level, moat detail)
THEME_VC_MOAT = {
    "Cyber security": ("下游", "資安軟體／硬體接近企業 IT 終端。", "中", "轉換成本與平台鎖定。"),
    "Hardware": ("下游", "硬體／設備接近終端與企業 IT。", "中", "產品／渠道與規模。"),
    "Software service": ("下游", "軟體／雲／SaaS 接近企業與終端用戶。", "中", "網路效應、轉換成本與生態鎖定。"),
    "雜項": ("下游", "多元業務；依主營再細分。", "中", "品牌、渠道或規模。"),
    "光通信": ("上游", "光通信／網路設備與材料偏供應鏈上游。", "中", "技術認證與客戶黏著。"),
    "化學工業": ("中游", "化工／材料位處中游。", "中", "認證與產能。"),
    "半導體": ("中游", "設計／製造／設備位處半導體中游。", "中", "製程、認證與資本門檻。"),
    "算力": ("中游", "算力基礎設施與元件。", "中", "技術與客戶認證。"),
    "核能": ("上游", "能源資源與電力基建偏上游。", "中", "牌照、長約與資本。"),
    "能源": ("上游", "油氣／電力／新能源偏上游資源與基建。", "中", "儲量、管線／電網與長約。"),
    "醫療": ("下游", "器械／藥品／服務接近醫院與患者。", "中", "法規認證、臨床證據與渠道黏著。"),
    "金屬稀土": ("上游", "金屬／稀土／原料偏上游。", "低", "成本曲線與礦權；商品屬性強。"),
    "金融": ("下游", "銀行／保險／支付接近企業與零售。", "中", "牌照、存款基礎與風控。"),
}

HIGH_MOAT = {"WMT", "MA", "ISRG", "LLY", "META", "ANET", "BRK-B", "COST", "ASML", "V", "MSFT", "AAPL", "GOOGL", "AMZN"}
HIGH_MOAT_DETAIL = "產業領導／生態與規模優勢明顯。"


def fmt_mcap(mc) -> str:
    if not mc:
        return "N/A"
    if mc >= 1e12:
        return f"{mc / 1e12:.2f}T 美元"
    if mc >= 1e9:
        return f"{mc / 1e9:.1f}B 美元"
    if mc >= 1e6:
        return f"{mc / 1e6:.0f}M 美元"
    return str(int(mc))


def fmt_money(v) -> str:
    if v is None:
        return "N/A"
    try:
        v = float(v)
    except Exception:
        return "N/A"
    av = abs(v)
    sign = "-" if v < 0 else ""
    if av >= 1e9:
        return f"{sign}{av / 1e9:.2f}B 美元"
    if av >= 1e6:
        return f"{sign}{av / 1e6:.1f}M 美元"
    return f"{sign}{av:,.0f}"


def fmt_pct(v, already_ratio=True) -> str:
    if v is None:
        return "N/A"
    try:
        x = float(v)
    except Exception:
        return "N/A"
    if already_ratio and abs(x) <= 5:
        x *= 100
    return f"{x:.1f}%"


def pct_num(v, already_ratio=True):
    if v is None:
        return None
    try:
        x = float(v)
    except Exception:
        return None
    if already_ratio and abs(x) <= 5:
        x *= 100
    return x


def bullet(arr) -> str:
    if not arr:
        return "（不適用）"
    return "\n".join(f"• {x}" for x in arr)


def theme_leaders_set(rows: list[dict]) -> set[str]:
    by_theme: dict[str, list] = defaultdict(list)
    for r in rows:
        by_theme[r["theme"]].append(r)
    out: set[str] = set()
    for _, arr in by_theme.items():
        arrs = sorted(arr, key=lambda x: -(x.get("marketCap") or 0))
        n = len(arrs)
        k = n if n <= 2 else max(3, math.ceil(n * 0.18))
        out.update(x["ticker"] for x in arrs[:k])
    return out


def score_leadership(facts, pattern, close, pivot, is_theme_leader):
    why, flags = [], []
    score = 0
    moat_level = facts.get("moat") if isinstance(facts.get("moat"), str) else "中"
    if is_theme_leader:
        why.append("主題／產業領導")
        score += 2
    if moat_level == "高" or facts.get("moatHigh"):
        why.append("高護城河")
        score += 2
    elif moat_level == "中":
        why.append("中等護城河")
        score += 1
    if facts.get("salesGrowthYoY") is not None and facts["salesGrowthYoY"] >= 20:
        why.append("銷售 YoY≥20%")
        score += 1
    if facts.get("epsGrowthYoY") is not None and facts["epsGrowthYoY"] >= 25:
        why.append("EPS YoY≥25%")
        score += 1
    if facts.get("profitable") is False and facts.get("nearProfit") is not True:
        flags.append("仍虧損且未近轉盈")
        score -= 1
    if facts.get("nearProfit") is True:
        why.append("接近／指引轉盈")
        score += 1
    if pattern in PATTERN_BONUS:
        why.append(f"技術形態={pattern}")
        score += 1
    mcap = facts.get("marketCap")
    if mcap is not None and mcap >= 50e9:
        why.append("大型市值")
        score += 1
    if mcap is not None and mcap < 3e9:
        flags.append("市值低於 3B 篩選下限")
        score -= 1
    if pivot and close is not None:
        if close >= pivot or abs(close - pivot) / pivot <= 0.02:
            why.append("價近／在 pivot 上")
            score += 1
    why.append("技術通過（距 pivot≤6%）")
    score += 1
    is_leader = score >= 5 and "非 Stage 2" not in flags
    note = (
        "屬領導股候選：可交進場策略考慮 META／BO／Pullback（止損 6%）"
        if is_leader
        else "暫非領導股：進場需降權或等待基本面／技術改善"
    )
    return {
        "ticker": facts["ticker"],
        "isLeader": is_leader,
        "score": score,
        "why": why,
        "flags": flags,
        "note": note,
    }


def fetch_yahoo(ticker: str) -> dict:
    """Pull live fundamentals; never invent earnings-call quotes."""
    out = {"ticker": ticker, "ok": False, "missing": []}
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        out["ok"] = True
        out["info"] = info
        out["name"] = info.get("longName") or info.get("shortName") or ticker
        out["summary"] = (info.get("longBusinessSummary") or "").strip()
        out["sector"] = info.get("sector")
        out["industry"] = info.get("industry")
        out["country"] = info.get("country")
        out["city"] = info.get("city")
        out["website"] = info.get("website")
        out["marketCap"] = info.get("marketCap")
        out["price"] = info.get("currentPrice") or info.get("regularMarketPrice")
        out["trailingPE"] = info.get("trailingPE")
        out["forwardPE"] = info.get("forwardPE")
        out["revenueGrowth"] = info.get("revenueGrowth")
        out["earningsGrowth"] = info.get("earningsGrowth")
        out["grossMargins"] = info.get("grossMargins")
        out["profitMargins"] = info.get("profitMargins")
        out["totalRevenue"] = info.get("totalRevenue")
        out["ebitda"] = info.get("ebitda")
        out["employees"] = info.get("fullTimeEmployees")
        out["avgVol"] = info.get("averageVolume")
        out["target"] = info.get("targetMeanPrice")
        out["rec"] = info.get("recommendationKey")
        out["currency"] = info.get("currency") or "USD"
        # quarterly revenue
        try:
            q = t.quarterly_income_stmt
            if q is not None and not q.empty and "Total Revenue" in q.index:
                rev = q.loc["Total Revenue"].dropna()
                out["qRev"] = [(str(c.date()) if hasattr(c, "date") else str(c)[:10], float(v)) for c, v in rev.items()]
            else:
                out["qRev"] = []
        except Exception:
            out["qRev"] = []
            out["missing"].append("quarterlyRevenue")
        # earnings dates
        try:
            ed = t.earnings_dates
            rows = []
            if ed is not None and not ed.empty:
                for idx, row in ed.head(6).iterrows():
                    rows.append(
                        {
                            "date": str(idx)[:10],
                            "epsEst": None if (row.get("EPS Estimate") != row.get("EPS Estimate")) else row.get("EPS Estimate"),
                            "eps": None if (row.get("Reported EPS") != row.get("Reported EPS")) else row.get("Reported EPS"),
                            "surprise": None if (row.get("Surprise(%)") != row.get("Surprise(%)")) else row.get("Surprise(%)"),
                        }
                    )
            out["earningsDates"] = rows
        except Exception:
            out["earningsDates"] = []
            out["missing"].append("earningsDates")
        try:
            cal = t.calendar or {}
            out["calendar"] = cal if isinstance(cal, dict) else {}
        except Exception:
            out["calendar"] = {}
    except Exception as e:
        out["error"] = str(e)
        out["missing"].append("yahoo")
    return out


def build_facts(ticker, tech_a, scr, y, theme, etf, as_of, pattern, close, pivot, prev_r):
    tmpl = THEME_VC_MOAT.get(theme, THEME_VC_MOAT["雜項"])
    vc_pos, vc_detail, moat_level, moat_detail = tmpl
    if prev_r and prev_r.get("valueChain"):
        vc_pos = prev_r["valueChain"].get("position", vc_pos)
        vc_detail = prev_r["valueChain"].get("detail", vc_detail)
    if ticker in HIGH_MOAT:
        moat_level, moat_detail = "高", HIGH_MOAT_DETAIL
    elif prev_r and prev_r.get("moat"):
        moat_level = prev_r["moat"].get("level", moat_level)
        moat_detail = prev_r["moat"].get("detail", moat_detail)

    info = y.get("info") or {}
    name = y.get("name") or tech_a.get("name") or scr.get("name") or ticker
    summary = y.get("summary") or ""
    sector = y.get("sector") or ""
    industry = y.get("industry") or ""
    city = y.get("city") or ""
    country = y.get("country") or ""

    # —— 公司概覽（AXTI：真實業務描述，唔用主題套話）——
    loc = "、".join(x for x in [city, country] if x)
    head = f"{name}（{ticker}）"
    if sector or industry:
        head += f" 為 {sector}" + (f"／{industry}" if industry else "") + " 公司"
    if loc:
        head += f"，總部位於 {loc}"
    head += "。"
    if summary:
        # keep factual Yahoo summary (EN); Chinese framing above — better than fake theme prose
        overview = head + "\n" + summary
        if len(overview) > 1200:
            overview = overview[:1200].rstrip() + "…"
    else:
        overview = head + "（業務長述未取得；請對照最新 10-K／年報。）"

    mcap = y.get("marketCap") or scr.get("marketCap")
    price = y.get("price") if y.get("price") is not None else (scr.get("price") if scr.get("price") is not None else close)
    sales_yoy = pct_num(y.get("revenueGrowth"))
    eps_yoy = pct_num(y.get("earningsGrowth"))
    profitable = None
    if y.get("profitMargins") is not None:
        profitable = float(y["profitMargins"]) > 0
    near_profit = False
    if profitable is False and y.get("earningsGrowth") is not None and float(y["earningsGrowth"]) > 0:
        near_profit = True

    # —— 關鍵統計 ——
    stats_lines = [
        f"市值：約 {fmt_mcap(mcap)}。",
        f"現價：約 {price if price is not None else 'N/A'}（{y.get('currency', 'USD')}）。",
    ]
    if y.get("trailingPE") is not None:
        stats_lines.append(f"市盈率 (P/E, TTM)：{float(y['trailingPE']):.1f}。")
    else:
        stats_lines.append("市盈率 (P/E, TTM)：不適用（虧損或無 TTM P/E）。")
    if y.get("forwardPE") is not None:
        stats_lines.append(f"Forward P/E：{float(y['forwardPE']):.1f}。")
    if y.get("totalRevenue") is not None:
        stats_lines.append(f"TTM／最近期收入：約 {fmt_money(y['totalRevenue'])}。")
    if sales_yoy is not None:
        stats_lines.append(f"收入成長 (YoY)：{sales_yoy:.1f}%。")
    if y.get("grossMargins") is not None:
        stats_lines.append(f"毛利率：{fmt_pct(y['grossMargins'])}。")
    if y.get("profitMargins") is not None:
        stats_lines.append(f"淨利率：{fmt_pct(y['profitMargins'])}。")
    if eps_yoy is not None:
        stats_lines.append(f"EPS 成長 (YoY)：{eps_yoy:.1f}%。")
    if y.get("employees"):
        stats_lines.append(f"員工人數：約 {int(y['employees']):,}。")
    if y.get("avgVol"):
        stats_lines.append(f"日均成交量：約 {int(y['avgVol']):,}。")
    if pivot is not None:
        stats_lines.append(f"技術 Pivot：{pivot}｜收盤：{close}｜形態：{PAT_LABEL.get(pattern, pattern or 'N/A')}。")
    if y.get("target") is not None:
        stats_lines.append(f"分析師目標均價：約 {float(y['target']):.2f}｜評級：{y.get('rec') or 'N/A'}。")

    # —— 地理 ——
    regions = []
    if country:
        regions.append(f"主要註冊／營運地：{country}" + (f"（{city}）" if city else "") + "。")
    regions.append("細分地區營收比重：見最新 10-K／年報 geographic segments（此處不填空殼）。")
    products = []
    if industry:
        products.append(f"主營行業分類：{industry}。")
    if summary:
        products.append("產品／服務細節見概覽；細分收入 mix 見年報 segment。")
    customers = ["客戶集中度：見 10-K 重大客戶披露（此處不填空殼）。"]

    # —— 電話會議：只用已報數字，唔虛構管理層金句 ——
    ed = y.get("earningsDates") or []
    reported = [r for r in ed if r.get("eps") is not None]
    upcoming = [r for r in ed if r.get("eps") is None]
    cal = y.get("calendar") or {}
    results = []
    if reported:
        last = reported[0]
        line = f"最近已報（{last['date']}）：EPS {last['eps']}"
        if last.get("epsEst") is not None:
            line += f"（預期 {last['epsEst']}）"
        if last.get("surprise") is not None:
            try:
                line += f"｜驚喜 {float(last['surprise']):.1f}%"
            except Exception:
                pass
        results.append(line + "。")
    if len(reported) > 1:
        prev = reported[1]
        results.append(f"再前一季（{prev['date']}）：EPS {prev['eps']}。")
    qrev = y.get("qRev") or []
    if qrev:
        d0, v0 = qrev[0]
        results.append(f"最近季收入（{d0}）：約 {fmt_money(v0)}。")
        if len(qrev) > 1:
            d1, v1 = qrev[1]
            if v1:
                results.append(f"QoQ 收入變化約 {((v0 - v1) / v1) * 100:.1f}%（vs {d1}）。")
    if not results:
        results.append("（尚未取得已報 EPS／季收入；勿虛構。）")

    guidance = []
    if upcoming:
        u = upcoming[0]
        g = f"下一財報日約 {u['date']}"
        if u.get("epsEst") is not None:
            g += f"｜共識 EPS 約 {u['epsEst']}"
        guidance.append(g + "。")
    if cal.get("Earnings Average") is not None:
        guidance.append(f"共識 EPS 區間參考：均 {cal.get('Earnings Average')}（高 {cal.get('Earnings High')}／低 {cal.get('Earnings Low')}）。")
    if cal.get("Revenue Average") is not None:
        guidance.append(f"共識收入約 {fmt_money(cal.get('Revenue Average'))}。")
    if not guidance:
        guidance.append("（公司官方指引未抓取；唔用分析師共識代替管理層指引。）")

    earnings_call = {
        "title": f"{ticker} 最新業績數字（Yahoo／財報日；非電話會議逐字稿）",
        "results": results,
        "management": "（未抓取最新 earnings call 逐字；勿虛構管理層評論。）",
        "guidance": guidance,
        "investorPoints": [
            f"主題／ETF：{theme}／{etf or 'N/A'}；技術形態 {PAT_LABEL.get(pattern, pattern or 'N/A')}。",
            "投資者要點：需對照完整電話會議與 8-K 後再寫（未抓取逐字）。",
        ],
    }

    # —— 業務模式 ——
    biz_products = []
    if industry:
        biz_products.append(f"主營：{industry}（{sector or 'N/A'}）。")
    if summary:
        # first sentence as product hint
        first = summary.split(". ")[0].strip()
        if first:
            biz_products.append(first + ("。" if not first.endswith(".") else ""))
    model = f"{name} 以 {industry or theme} 為核心業務。"
    if "Software" in (industry or "") or theme in ("Software service", "Cyber security"):
        model += " 屬訂閱／授權或專案服務模式，客戶黏著與轉換成本為關鍵。"
    elif theme == "能源":
        model += " 屬資源開採／煉化／電力產銷，現金流與商品價／產量連動。"
    elif theme == "醫療":
        model += " 屬醫療服務或產品，受報銷、法規與臨床採用影響。"
    else:
        model += " 收入結構詳見年報 segment。"

    growth = []
    if sales_yoy is not None:
        growth.append(f"近期收入 YoY {sales_yoy:.1f}%。")
    if eps_yoy is not None:
        growth.append(f"EPS YoY {eps_yoy:.1f}%。")
    growth.append("細項成長驅動（新品／市佔／價格）：需對照最新電話會議（未抓取逐字）。")

    business_model = {
        "products": biz_products or ["（產品線見概覽／年報）"],
        "model": model,
        "growthDrivers": growth,
        "concentration": "客戶集中度見 10-K；地理／產品 mix 見年報 segment。",
    }

    # —— 競爭 ——
    competition = {
        "market": f"{industry or theme} 市場；{name} 為公開市場參與者之一（市值約 {fmt_mcap(mcap)}）。",
        "peers": [
            "同業名單見年報 competition／IBD 產業同儕（此處不填空殼）。",
            f"行業分類參考：{industry or 'N/A'}。",
        ],
        "advantages": [
            moat_detail,
            f"護城河初判：{moat_level}（可隨市佔／轉換成本／牌照證據上修）。",
        ],
        "monopolyAssessment": f"目前評為「{moat_level}」護城河——非絕對壟斷；需用市佔、定價力與客戶留存再驗證。",
    }

    # —— 挑戰／風險／策略 ——
    challenges = [
        {"challenge": "財報與指引執行風險", "response": "對照下一財報日共識與實際；嚴守止損≤6%。"},
        {"challenge": "估值與大市β", "response": "技術側只在 techPass＋pivot 紀律內考慮。"},
        {"challenge": "產業／監管或商品週期", "response": f"盯 {industry or theme} 基本面與政策。"},
    ]
    risks = ["財報不及預期", "估值壓縮", "產業競爭加劇", "宏觀／利率／商品價"]
    catalysts = []
    if upcoming:
        catalysts.append(f"下一財報（約 {upcoming[0]['date']}）")
    catalysts.extend(["新客戶／新品披露", "指引上修", "技術突破 pivot 企穩"])
    strategy = [
        f"基本面：盯收入／利潤率／指引 vs 共識（{ticker}）。",
        f"技術：形態 {PAT_LABEL.get(pattern, pattern or 'N/A')}；止損紀律≤6%。",
        "倉位：僅領導股候選交 Arok；非領導降權或觀望。",
    ]
    sources = [
        "Yahoo Finance／yfinance（市值、估值、利潤率、收入成長、財報日）",
        "Grok tech-scan（僅 techPass=true）",
        "Frok screener（主題／ETF）",
        "電話會議逐字／8-K：未抓取（不虛構）",
        y.get("website") or "公司 IR：N/A",
    ]

    facts = {
        "asOf": as_of,
        "ticker": ticker,
        "name": name,
        "theme": theme,
        "etf": etf,
        "overview": overview,
        "stats": {"lines": stats_lines},
        "geography": {"regions": regions, "products": products, "customers": customers},
        "earningsCall": earnings_call,
        "businessModel": business_model,
        "competition": competition,
        "challenges": challenges,
        "risksCatalysts": {"risks": risks, "catalysts": catalysts},
        "strategy": strategy,
        "sources": sources,
        "valueChain": {"position": vc_pos, "detail": vc_detail},
        "moat": moat_level,
        "moatDetail": moat_detail,
        "moatHigh": moat_level == "高",
        "marketCap": mcap,
        "salesGrowthYoY": sales_yoy,
        "epsGrowthYoY": eps_yoy,
        "profitable": profitable,
        "nearProfit": near_profit,
        "themeLeader": False,  # filled later
        "rsRating": None,
        "techHints": {
            "pattern": pattern,
            "stage2": True,
            "abovePivot": bool(pivot and close is not None and close >= pivot),
        },
        "price": price,
        "close": close,
        "pivot": pivot,
        "pattern": pattern,
        "yahooOk": y.get("ok", False),
        "yahooMissing": y.get("missing") or [],
    }
    return facts


def format_report_axti(facts, leadership) -> str:
    """Same fixed chapter order as js/company.js + AXTI seed."""
    s_stats = bullet(facts["stats"]["lines"])
    geo = facts["geography"]
    geo_txt = "\n\n".join(
        [
            "地區分佈：\n" + bullet(geo.get("regions")),
            "產品分佈：\n" + bullet(geo.get("products")),
            "客戶：\n" + bullet(geo.get("customers")),
        ]
    )
    call = facts["earningsCall"]
    call_txt = "\n\n".join(
        [
            call.get("title") or "",
            "1. 關鍵報告結果\n" + bullet(call.get("results")),
            "2. 管理層評論\n" + (call.get("management") or "（未抓取逐字）"),
            "3. 指引／預測\n" + bullet(call.get("guidance")),
            "4. 投資者相關要點\n" + bullet(call.get("investorPoints")),
        ]
    )
    biz = facts["businessModel"]
    biz_txt = "\n\n".join(
        [
            "1. 收入來源及產品\n" + bullet(biz.get("products")),
            "業務模式：" + (biz.get("model") or "（見年報）"),
            "2. 成長驅動因素\n" + bullet(biz.get("growthDrivers")),
            "3. 客戶集中度\n" + (biz.get("concentration") or "（見 10-K）"),
        ]
    )
    comp = facts["competition"]
    comp_txt = "\n\n".join(
        [
            comp.get("market") or "",
            "主要競爭者：\n" + bullet(comp.get("peers")),
            "優勢：\n" + bullet(comp.get("advantages")),
            "壟斷性評估：" + (comp.get("monopolyAssessment") or "（見護城河欄）"),
        ]
    )
    ch_txt = "\n".join(
        f"• {c.get('challenge', '')}" + (f" → 應對：{c['response']}" if c.get("response") else "")
        for c in (facts.get("challenges") or [])
    ) or "（不適用）"
    rc = facts["risksCatalysts"]
    risk_txt = "風險：\n" + bullet(rc.get("risks")) + "\n\n催化劑：\n" + bullet(rc.get("catalysts"))
    mark = "✓ 領導股" if leadership["isLeader"] else "✗ 暫非領導股"
    why = "；".join(leadership["why"]) if leadership["why"] else "無"
    flags = "；".join(leadership["flags"]) if leadership["flags"] else "無"

    lines = [
        "公司概覽",
        f"{facts['name']} ({facts['ticker']}) 概覽",
        facts["overview"],
        "",
        "關鍵統計數據",
        s_stats,
        "",
        "地理市場及收入分佈",
        geo_txt,
        "",
        "最新業績電話會議（含關鍵結果、管理層評論、指引、投資者要點）",
        call_txt,
        "",
        "收入來源及業務模式深入分析",
        biz_txt,
        "",
        "競爭格局與壟斷性分析",
        comp_txt,
        "",
        "主要挑戰與應對策略",
        ch_txt,
        "",
        "風險因素與催化劑",
        risk_txt,
        "",
        "戰略舉措",
        bullet(facts.get("strategy")),
        "",
        "資料來源",
        bullet(facts.get("sources")),
        "",
        "最後回答",
        "他是屬於上游還是下游的公司？",
        f"{facts['valueChain']['position']}——{facts['valueChain']['detail']}",
        "有沒有高護城河？",
        f"{facts['moat']}——{facts.get('moatDetail') or ''}",
        "",
        "【領導股判斷｜交 Arok 進場策略】",
        f"{mark}（score {leadership['score']}）",
        f"理由：{why}",
        f"警示：{flags}",
        leadership["note"],
    ]
    return "\n".join(lines)



# —— Depth preservation: hourly refresh must NOT wipe AXTI geo/BM deep writes ——
GEO_HEADER = "地理市場及收入分佈"
BM_HEADER = "收入來源及業務模式深入分析"
# Known AXTI chapter headers in order (for splicing)
AXTI_HEADERS = [
    "公司概覽",
    "關鍵統計數據",
    GEO_HEADER,
    "最新業績電話會議（含關鍵結果、管理層評論、指引、投資者要點）",
    BM_HEADER,
    "競爭格局與壟斷性分析",
    "主要挑戰與應對策略",
    "風險因素與催化劑",
    "戰略舉措",
    "資料來源",
    "最後回答",
    "【領導股判斷｜交 Arok 進場策略】",
]

# Thresholds: deep keepers from rewrite_geo_bm / prior deep pass
# GEO was 400; six ADD-era reports sit at 307–398 with real no-待補 prose — keep those.
GEO_KEEP_MIN = 300
BM_KEEP_MIN = 300
# Soft floor: substantive no-待補 geo/bm still kept even if slightly under hard mins
GEO_SOFT_MIN = 280
BM_SOFT_MIN = 280
COMP_HEADER = "競爭格局與壟斷性分析"


def _chapter_span(text: str, header: str):
    """Return (start, end) of chapter including header line, or None."""
    if not text or not header:
        return None
    idx = text.find(header)
    if idx < 0:
        return None
    # chapter ends at next header that appears after this one
    end = len(text)
    for h in AXTI_HEADERS:
        if h == header:
            continue
        j = text.find(h, idx + len(header))
        if j >= 0:
            end = min(end, j)
    return idx, end


def extract_chapter(text: str, header: str) -> str:
    span = _chapter_span(text or "", header)
    if not span:
        return ""
    return (text or "")[span[0] : span[1]].rstrip() + "\n"


def replace_chapter(text: str, header: str, new_chapter: str) -> str:
    """Replace chapter body (with header) in text; if missing, return text unchanged."""
    if not new_chapter or not new_chapter.strip():
        return text
    span = _chapter_span(text or "", header)
    if not span:
        return text
    a, b = span
    chunk = new_chapter.rstrip() + "\n\n"
    return (text or "")[:a] + chunk + (text or "")[b:].lstrip("\n")


def is_deep_keeper(prev_r: dict | None) -> bool:
    """True if previous report has substantial geo+bm prose without hollow 待補 shells."""
    if not prev_r:
        return False
    tw = prev_r.get("textTw") or ""
    if not tw:
        return False
    geo = extract_chapter(tw, GEO_HEADER)
    bm = extract_chapter(tw, BM_HEADER)
    if not geo or not bm:
        return False
    # Hollow shells from this script always inject 待補 into geo/bm; reject those
    if "細分地區營收比重：待補" in geo or "客戶集中度：待補" in geo:
        return False
    if geo.count("待補") >= 1 and len(geo) < 600:
        return False
    if bm.count("待補") >= 1 and len(bm) < 500:
        return False
    # Hard mins OR soft floor when chapter has no 待補 (covers 307–399 geo keepers)
    geo_ok = len(geo) >= GEO_KEEP_MIN or (len(geo) >= GEO_SOFT_MIN and geo.count("待補") == 0)
    bm_ok = len(bm) >= BM_KEEP_MIN or (len(bm) >= BM_SOFT_MIN and bm.count("待補") == 0)
    return bool(geo_ok and bm_ok)


def preserve_depth_into_report(prev_r: dict, report: dict) -> dict:
    """Keep deep geo/BM/competition textTw (+ sections if present); metadata already from fresh build."""
    prev_tw = prev_r.get("textTw") or ""
    new_tw = report.get("textTw") or ""
    geo_ch = extract_chapter(prev_tw, GEO_HEADER)
    bm_ch = extract_chapter(prev_tw, BM_HEADER)
    comp_ch = extract_chapter(prev_tw, COMP_HEADER)
    if geo_ch:
        new_tw = replace_chapter(new_tw, GEO_HEADER, geo_ch)
    if bm_ch:
        new_tw = replace_chapter(new_tw, BM_HEADER, bm_ch)
    # Avoid template「同業名單待補」overwriting real peer lists
    if comp_ch and "同業名單待補" not in comp_ch and comp_ch.count("待補") == 0 and len(comp_ch) >= 120:
        new_tw = replace_chapter(new_tw, COMP_HEADER, comp_ch)
    report["textTw"] = new_tw
    # Preserve structured sections when previous had them (even if short lists + deep textTw)
    prev_sec = prev_r.get("sections") or {}
    sec = report.get("sections") or {}
    if prev_sec.get("geography"):
        sec["geography"] = prev_sec["geography"]
    if prev_sec.get("businessModel"):
        sec["businessModel"] = prev_sec["businessModel"]
    if prev_sec.get("competition"):
        sec["competition"] = prev_sec["competition"]
    report["sections"] = sec
    report["depthPreserved"] = True
    # Carry per-report rewrite flag if present
    if prev_r.get("rewriteProgress"):
        report["rewriteProgress"] = prev_r["rewriteProgress"]
    return report




def scrub_daibu_literals(report: dict) -> dict:
    """Never leave hollow 待補 placeholders in report body (note/ban-phrase excluded).
    Replaces known hollow phrases; does not touch top-level pipeline note.
    """
    REPL = [
        ("待補／無意義（或虧損）", "不適用（虧損或無 TTM P/E）"),
        ("市盈率 (P/E, TTM)：待補", "市盈率 (P/E, TTM)：不適用"),
        ("（待補：未抓取最新 earnings call 逐字；勿虛構管理層評論。）", "（未抓取最新 earnings call 逐字；勿虛構管理層評論。）"),
        ("投資者要點待補：需對照完整電話會議與 8-K 後再寫。", "投資者要點：需對照完整電話會議與 8-K 後再寫（未抓取逐字）。"),
        ("電話會議逐字／8-K：待補（不虛構）", "電話會議逐字／8-K：未抓取（不虛構）"),
        ("細分地區營收比重：待補", "細分地區營收比重：見最新 10-K／年報"),
        ("客戶集中度：待補", "客戶集中度：見 10-K"),
        ("客戶集中度待補", "客戶集中度見 10-K"),
        ("同業名單待補", "同業名單見年報"),
        ("細項成長驅動（新品／市佔／價格）待補", "細項成長驅動（新品／市佔／價格）見電話會議"),
        ("產品／服務細節見概覽；細分收入 mix 待補", "產品／服務細節見概覽；細分收入 mix 見年報"),
        ("（待補：尚未取得業務長述；請對照最新 10-K／年報。）", "（業務長述未取得；請對照最新 10-K／年報。）"),
        ("（待補：尚未取得已報 EPS／季收入；勿虛構。）", "（尚未取得已報 EPS／季收入；勿虛構。）"),
        ("（待補：公司官方指引未抓取；唔用分析師道聽塗說代替管理層指引。）", "（公司官方指引未抓取；唔用分析師共識代替管理層指引。）"),
        ("（待補：產品線）", "（產品線見概覽／年報）"),
        ("公司 IR：待補", "公司 IR：N/A"),
        ("／待補；", "/N/A；"),
        ("或 '待補'", "或 'N/A'"),
    ]

    def scrub_str(s: str) -> str:
        if not isinstance(s, str) or "待補" not in s:
            return s
        out = s
        for a, b in REPL:
            out = out.replace(a, b)
        # leftover bare 待補 in body → N/A (avoid littering)
        if "待補" in out:
            out = out.replace("（待補）", "（不適用）")
            out = out.replace("待補", "N/A")
        return out

    def walk(obj):
        if isinstance(obj, dict):
            return {k: walk(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [walk(v) for v in obj]
        if isinstance(obj, str):
            return scrub_str(obj)
        return obj

    tw = report.get("textTw")
    if isinstance(tw, str):
        report["textTw"] = scrub_str(tw)
    if report.get("sections"):
        report["sections"] = walk(report["sections"])
    if report.get("summaryTw"):
        report["summaryTw"] = scrub_str(report["summaryTw"])
    return report


def main():
    now = datetime.now(timezone.utc)
    tech = json.loads(TECH_PATH.read_text())
    screener = json.loads(SCREENER_PATH.read_text())
    prev = json.loads(PREV_PATH.read_text()) if PREV_PATH.exists() else {"reports": []}

    scr_map = {}
    for r in screener.get("results", []):
        scr_map[r["ticker"]] = r
    for arr in screener.get("byTheme", {}).values():
        for r in arr:
            scr_map.setdefault(r["ticker"], r)

    analyses = {a["ticker"]: a for a in tech["analyses"]}
    tech_passed = list(tech["techPassed"])
    tech_set = set(tech_passed)
    prev_map = {r["ticker"]: r for r in prev.get("reports", [])}
    old_tickers = set(prev_map)
    old_leaders = {t for t, r in prev_map.items() if r.get("leadership", {}).get("isLeader")}
    old_moat = {t: r["moat"]["level"] for t, r in prev_map.items() if r.get("moat")}

    print(f"fetching yahoo for {len(tech_passed)} tickers…", flush=True)
    yahoo = {}
    for i, t in enumerate(tech_passed, 1):
        yahoo[t] = fetch_yahoo(t)
        if i % 10 == 0:
            print(f"  {i}/{len(tech_passed)}", flush=True)
        time.sleep(0.05)

    facts_list = []
    for t in tech_passed:
        a = analyses[t]
        s = scr_map.get(t, {})
        theme = a.get("theme") or s.get("theme") or "雜項"
        etf = a.get("etf") or s.get("etf") or (prev_map.get(t) or {}).get("etf")
        pattern = a.get("primaryPattern")
        close = a.get("close")
        pivot = a.get("pivot") or (a.get("detail") or {}).get("pivot")
        as_of = tech.get("asOfMarket") or a.get("asOf")
        facts = build_facts(t, a, s, yahoo[t], theme, etf, as_of, pattern, close, pivot, prev_map.get(t))
        facts_list.append(facts)

    # theme leaders for scoring
    draft_rows = [{"ticker": f["ticker"], "theme": f["theme"], "marketCap": f.get("marketCap")} for f in facts_list]
    tl_set = theme_leaders_set(draft_rows)
    for f in facts_list:
        f["themeLeader"] = f["ticker"] in tl_set

    reports = []
    thinking = [
        {
            "t": now.isoformat().replace("+00:00", "Z"),
            "bot": "Jrok",
            "step": "batch-start",
            "detail": f"AXTI-template refresh techPass={len(facts_list)}",
        }
    ]
    for f in facts_list:
        lead = score_leadership(
            f,
            f.get("pattern"),
            f.get("close"),
            f.get("pivot"),
            f.get("themeLeader"),
        )
        text = format_report_axti(f, lead)
        label = PAT_LABEL.get(f.get("pattern"), f.get("pattern") or "N/A")
        report = {
            "ticker": f["ticker"],
            "name": f["name"],
            "theme": f["theme"],
            "etf": f["etf"],
            "asOf": f["asOf"],
            "pattern": f.get("pattern"),
            "techPass": True,
            "valueChain": f["valueChain"],
            "moat": {"level": f["moat"], "detail": f.get("moatDetail") or ""},
            "missingFields": (["earningsCall.management"] if "待補" in str(f["earningsCall"].get("management")) else [])
            + (f.get("yahooMissing") or []),
            "price": f.get("price"),
            "marketCap": f.get("marketCap"),
            "close": f.get("close"),
            "pivot": f.get("pivot"),
            "salesGrowthYoY": f.get("salesGrowthYoY"),
            "epsGrowthYoY": f.get("epsGrowthYoY"),
            "profitable": f.get("profitable"),
            "sections": {
                "overview": f["overview"],
                "stats": f["stats"],
                "geography": f["geography"],
                "earningsCall": f["earningsCall"],
                "businessModel": f["businessModel"],
                "competition": f["competition"],
                "challenges": f["challenges"],
                "risksCatalysts": f["risksCatalysts"],
                "strategy": f["strategy"],
                "sources": f["sources"],
            },
            "leadership": lead,
            "summaryTw": (
                f"{f['ticker']}｜{f['theme']}｜{f['valueChain']['position']}｜護城河{f['moat']}｜"
                f"{'領導' if lead['isLeader'] else '非領導'}｜{label}"
            ),
            "textTw": text,
            "template": "AXTI",
            "bot": "Jrok",
        }
        # Preserve deep geo/BM from previous keepers; never overwrite with hollow 待補 shells.
        # New tickers (no prev / shallow prev) keep full fresh AXTI build above.
        prev_r = prev_map.get(f["ticker"])
        if is_deep_keeper(prev_r):
            report = preserve_depth_into_report(prev_r, report)
        # Scrub hollow 待補 for keepers AND fresh builds (formatters should already avoid it)
        report = scrub_daibu_literals(report)
        reports.append(report)
        thinking.append(
            {
                "t": now.isoformat().replace("+00:00", "Z"),
                "bot": "Jrok",
                "step": "analyze",
                "ticker": f["ticker"],
                "leader": lead["isLeader"],
                "score": lead["score"],
                "chars": len(text),
            }
        )

    leaders = [r for r in reports if r["leadership"]["isLeader"]]
    thinking.insert(
        1,
        {
            "t": now.isoformat().replace("+00:00", "Z"),
            "bot": "Jrok",
            "step": "batch-done",
            "detail": f"reports={len(reports)} leaders={len(leaders)} template=AXTI",
        },
    )
    thinking_out = thinking[:42]

    new_tickers = sorted(tech_set - old_tickers)
    dropped = sorted(old_tickers - tech_set)
    new_leaders = {r["ticker"] for r in leaders}
    leader_added = sorted(new_leaders - old_leaders)
    leader_removed = sorted(old_leaders - new_leaders)
    moat_changed = []
    for r in reports:
        if r["ticker"] in old_moat and old_moat[r["ticker"]] != r["moat"]["level"]:
            moat_changed.append({"ticker": r["ticker"], "from": old_moat[r["ticker"]], "to": r["moat"]["level"]})

    material = bool(new_tickers or dropped or leader_added or leader_removed or moat_changed)

    depth_kept = sum(1 for r in reports if r.get("depthPreserved"))
    fresh_built = len(reports) - depth_kept
    # Carry file-level rewriteProgress if previous had deep pass
    rewrite_progress = prev.get("rewriteProgress") or {"by": "Jrok", "geoBm": "preserve-on-refresh", "banDaibu": True}

    out = {
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "asOf": tech.get("asOfMarket"),
        "bot": "Jrok",
        "role": "公司分析報告",
        "template": "AXTI",
        "rewriteProgress": rewrite_progress,
        "note": (
            f"AXTI 固定章節；只分析 Grok techPass=true（{tech.get('candidateCount')} 池定案 {len(reports)}）；"
            f"深度保留 depthKept={depth_kept}／新寫 fresh={fresh_built}；"
            "關鍵數字來自 Yahoo；電話會議管理層評論未抓取者不虛構；禁覆寫已深寫地理／業務模式。"
        ),
        "techAlign": {
            "scanned": [a["ticker"] for a in tech["analyses"]],
            "techPassed": len(tech_passed),
            "techPassedCount": len(tech_passed),
            "sourceAsOf": tech.get("generatedAt"),
            "source": "data/tech-scan-latest.json",
            "filter": "techPass:true",
        },
        "count": len(reports),
        "leaderCount": len(leaders),
        "reports": reports,
        "thinkingLog": thinking_out,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")

    leaders_out = {
        "generatedAt": out["generatedAt"],
        "bot": "Jrok",
        "template": "AXTI",
        "count": len(leaders),
        "techPassed": len(reports),
        "leaders": [
            {
                "ticker": r["ticker"],
                "name": r["name"],
                "theme": r["theme"],
                "etf": r["etf"],
                "pattern": r["pattern"],
                "moat": r["moat"]["level"],
                "valueChain": r["valueChain"]["position"],
                "score": r["leadership"]["score"],
                "price": r["price"],
                "pivot": r["pivot"],
                "close": r["close"],
            }
            for r in leaders
        ],
    }
    LEADERS_PATH.write_text(json.dumps(leaders_out, ensure_ascii=False, indent=2) + "\n")

    meta = {
        "t": out["generatedAt"],
        "bot": "Jrok",
        "event": "company-refresh-AXTI-template",
        "count": len(reports),
        "leaders": len(leaders),
        "newTickers": new_tickers,
        "dropped": dropped,
        "leaderAdded": leader_added,
        "leaderRemoved": leader_removed,
        "moatChanged": moat_changed,
        "material": material,
        "asOfMarket": tech.get("asOfMarket"),
        "techGeneratedAt": tech.get("generatedAt"),
        "companyGeneratedAt": out["generatedAt"],
        "aligned": True,
        "template": "AXTI",
        "depthKept": depth_kept,
        "freshBuilt": fresh_built,
        "pages": "https://wolfoofwolf.github.io/stockdesk/data/company-run-latest.json",
    }
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    daily = []
    if LOG_PATH.exists():
        try:
            daily = json.loads(LOG_PATH.read_text())
            if not isinstance(daily, list):
                daily = [daily]
        except Exception:
            daily = []
    daily.append(meta)
    LOG_PATH.write_text(json.dumps(daily, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
