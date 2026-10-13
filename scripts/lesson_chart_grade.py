#!/usr/bin/env python3
"""Grade a VCP chart against the human NOW exemplar rubric (lessons training gate).

Usage:
  python scripts/lesson_chart_grade.py data/charts/NOW_scan_VCP.svg
  python scripts/lesson_chart_grade.py data/charts/NOW_scan_VCP.svg --ticker NOW
  python scripts/lesson_chart_grade.py path.svg --analysis-json /tmp/one.json --exemplar-id draw-style-vcp-c123-dtl-now

Exit code 0 always on successful grade write; --strict exits 1 if not keep.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
LESSONS = DATA / "lessons"
TRAINING = LESSONS / "training"
GALLERY = LESSONS / "gallery"
RUBRIC_PATH = TRAINING / "rubric-vcp-c123-dtl.json"
NEVER_PATH = TRAINING / "never-learn-index.json"
REMED_PATH = TRAINING / "remediation-queue.json"
SCAN_PATH = DATA / "tech-scan-latest.json"
HK = timezone(timedelta(hours=8))


def _now_iso() -> str:
    return datetime.now(HK).strftime("%Y-%m-%dT%H:%M:%S+08:00")


def _load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _svg_blob(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _has_comment_or_text(svg: str, *needles: str) -> bool:
    """Match matplotlib `<!-- label -->` or standalone text; avoid substring false positives."""
    for n in needles:
        if f"<!-- {n} -->" in svg or f"<!--{n}-->" in svg:
            return True
        # word-ish boundary for short labels (C1/C2/C3/DTL)
        if re.search(rf"(?<![A-Za-z0-9_-]){re.escape(n)}(?![A-Za-z0-9_-])", svg):
            return True
    return False


def _find_analysis(ticker: str | None, analysis_json: Path | None) -> dict | None:
    if analysis_json and analysis_json.exists():
        obj = _load_json(analysis_json, {})
        if isinstance(obj, dict) and (obj.get("ticker") or obj.get("contractions")):
            return obj
        if isinstance(obj, dict) and "analyses" in obj and ticker:
            for a in obj["analyses"]:
                if a.get("ticker") == ticker:
                    return a
    if ticker and SCAN_PATH.exists():
        scan = _load_json(SCAN_PATH, {})
        for a in scan.get("analyses") or []:
            if a.get("ticker") == ticker:
                return a
    return None


def _infer_ticker(svg_path: Path, explicit: str | None) -> str:
    if explicit:
        return explicit.upper()
    m = re.match(r"([A-Za-z0-9.-]+)_scan_", svg_path.name)
    if m:
        return m.group(1).upper()
    return svg_path.stem.split("_")[0].upper()


def _parse_date(s: str | None):
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _contractions(analysis: dict | None) -> list[dict]:
    if not analysis:
        return []
    cons = analysis.get("contractions") or []
    return [c for c in cons if isinstance(c, dict)]


def check_items(svg: str, analysis: dict | None, rubric: dict) -> tuple[list[dict], list[str]]:
    """Return (itemResults, failureSignatures)."""
    cons = _contractions(analysis)
    by_label = {str(c.get("label", "")).upper(): c for c in cons}
    pcts = [c.get("pct") for c in cons if c.get("pct") is not None]
    as_of = _parse_date((analysis or {}).get("asOf") or (analysis or {}).get("asOfMarket"))
    if as_of is None and cons:
        # fallback: use latest lowDate
        dates = [_parse_date(c.get("lowDate") or c.get("highDate")) for c in cons]
        dates = [d for d in dates if d]
        as_of = max(dates) if dates else None

    close = (analysis or {}).get("close")
    pivot = (analysis or {}).get("pivot")
    broken = False
    if close is not None and pivot not in (None, 0):
        try:
            broken = float(close) >= float(pivot) * 0.98
        except (TypeError, ValueError):
            broken = False

    results = []
    signatures: list[str] = []

    def add(item_id: str, weight: int, passed: bool, detail: str, sig: str | None = None):
        results.append({
            "id": item_id,
            "weight": weight,
            "passed": bool(passed),
            "earned": weight if passed else 0,
            "detail": detail,
        })
        if not passed and sig:
            signatures.append(sig)

    # --- checks ---
    # zigzag
    is_vcp = bool(
        _has_comment_or_text(svg, "VCP")
        or (analysis or {}).get("primaryPattern") == "VCP"
        or "VCP" in svg[:2000]
    )
    has_paths = svg.count("<path") >= 5 or svg.count("path") >= 5
    add("zigzag_white", 6, is_vcp and has_paths and len(svg) > 5000,
        "VCP SVG with path content" if is_vcp and has_paths else "missing VCP structure/zigzag signal")

    for lab, wid in (("C1", 8), ("C2", 8), ("C3", 8)):
        ok = _has_comment_or_text(svg, lab)
        add(f"{lab.lower()}_on_low", wid, ok,
            f"{lab} label present" if ok else f"missing {lab} label")

    # progressive dates
    date_ok = False
    date_detail = "no contractions JSON"
    if len(cons) >= 3:
        highs = [_parse_date(c.get("highDate")) for c in cons[:3]]
        lows = [_parse_date(c.get("lowDate")) for c in cons[:3]]
        if all(highs) and all(lows):
            date_ok = highs[0] <= highs[1] <= highs[2] and lows[0] <= lows[1] <= lows[2]
            date_detail = (
                f"highs {[h.isoformat() for h in highs]} lows {[x.isoformat() for x in lows]}"
            )
        else:
            date_detail = "contraction dates unparseable"
    add("progressive_dates", 12, date_ok, date_detail,
        "early_left_dump_c123" if cons and not date_ok else None)

    # progressive pct
    pct_ok = len(pcts) >= 3 and pcts[0] > pcts[1] > pcts[2]
    add("progressive_pct", 12, pct_ok,
        f"pcts={pcts}" if pcts else "no pcts",
        None)

    # late base not micros
    late_ok = False
    late_detail = "no C3 date"
    late_sig = None
    c3 = by_label.get("C3") or (cons[2] if len(cons) >= 3 else None)
    c1 = by_label.get("C1") or (cons[0] if cons else None)
    if c3 and as_of:
        c3d = _parse_date(c3.get("highDate") or c3.get("lowDate"))
        c1d = _parse_date((c1 or {}).get("highDate") or (c1 or {}).get("lowDate")) if c1 else None
        if c3d:
            age_c3 = (as_of - c3d).days
            age_c1 = (as_of - c1d).days if c1d else None
            # C3 should be relatively recent (< ~150d); C1 should not be ancient dump (>400d) while C3 is recent
            if age_c3 > 150:
                late_ok = False
                late_detail = f"C3 too old ({age_c3}d before asOf {as_of})"
                late_sig = "early_left_dump_c123"
            elif age_c1 is not None and age_c1 > 400 and age_c3 < 120:
                late_ok = False
                late_detail = f"C1 ancient ({age_c1}d) while C3 recent ({age_c3}d)"
                late_sig = "early_left_dump_c123"
            elif c1d and c1d.month in (1, 2) and age_c3 < 90 and (c3d - c1d).days > 120:
                # Jan/Feb micros when a much later base exists
                late_ok = False
                late_detail = f"C1 in {c1d} (Jan/Feb micro risk) vs late C3 {c3d}"
                late_sig = "feb_micros_vs_late_base"
            else:
                late_ok = True
                late_detail = f"C1={c1d} C3={c3d} asOf={as_of} (C3 age {age_c3}d)"
    elif c3:
        late_ok = True
        late_detail = "C3 present but no asOf — soft pass"
    add("late_base_not_micros", 10, late_ok, late_detail, late_sig)

    green_ok = _has_comment_or_text(svg, "綠色", "绿色") or ("#2e7d32" in svg.lower())
    add("c3_green_box", 8, green_ok,
        "green C3 box present" if green_ok else "missing C3 green box")

    vol_ok = _has_comment_or_text(svg, "成交量萎縮", "成交量萎缩")
    add("vol_dry_zh_note", 8, vol_ok,
        "Chinese vol-dry note present" if vol_ok else "missing 成交量萎縮 note")

    arrow_ok = green_ok and vol_ok  # co-emitted with style-lock draw path
    add("vol_arrow", 4, arrow_ok,
        "vol arrow inferred from green+note co-presence" if arrow_ok else "vol arrow proxy failed")

    dtl_ok = _has_comment_or_text(svg, "down trend line(DTL)", "DTL")
    add("dtl_label", 6, dtl_ok,
        "DTL label present" if dtl_ok else "missing DTL")

    has_bo = _has_comment_or_text(svg, "Bo DTL")
    bo_ok = has_bo or not broken
    add("bo_dtl", 4, bo_ok,
        "Bo DTL present" if has_bo else ("N/A not broken — full credit" if not broken else "broken but missing Bo DTL"))

    pivot_ok = _has_comment_or_text(svg, "pivot point")
    # Prefer dedicated comment; ignore "pivot point" inside the Chinese vol-dry note for this item
    if not (f"<!-- pivot point -->" in svg or f"<!--pivot point-->" in svg):
        # still allow bare annotate if note absent; else require dedicated comment
        if _has_comment_or_text(svg, "成交量萎縮", "成交量萎缩") and "pivot point" in svg:
            # only the vol note mentions it — not a dedicated pivot label
            pivot_ok = False
    add("pivot_label", 6, pivot_ok,
        "pivot point present" if pivot_ok else "missing pivot point")

    # Aggregate style-lock collapse (many annotation misses) → missing_style_lock
    style_ids = {"c1_on_low", "c2_on_low", "c3_on_low", "c3_green_box",
                 "vol_dry_zh_note", "dtl_label", "pivot_label"}
    style_miss = sum(1 for r in results if r["id"] in style_ids and not r["passed"])
    if style_miss >= 3:
        signatures.append("missing_style_lock")

    uniq = []
    for s in signatures:
        if s and s not in uniq:
            uniq.append(s)
    return results, uniq


def decide_verdict(score: int, threshold: int, failure_sigs: list[str], never_idx: dict) -> str:
    """keep >=90; structural bans / repeats → never_learn; else teachable counterexample."""
    repeats = never_idx.get("repeatCounts") or {}
    hard = {"early_left_dump_c123", "feb_micros_vs_late_base"}
    hit_hard = [s for s in failure_sigs if s in hard]
    repeated = [s for s in failure_sigs if int(repeats.get(s, 0)) >= 1]
    # missing_style_lock alone is never_learn only when score is very low or already repeated
    style_collapse = "missing_style_lock" in failure_sigs and (score < 50 or "missing_style_lock" in repeated)

    if hit_hard or style_collapse or (repeated and score < threshold):
        return "never_learn"
    if score >= threshold:
        return "keep"
    return "counterexample"


def remediation_line(item_results: list[dict], failure_sigs: list[str], ticker: str) -> str | None:
    failed = [r for r in item_results if not r["passed"]]
    if not failed:
        return None
    ids = ",".join(r["id"] for r in failed[:6])
    sigs = ",".join(failure_sigs) if failure_sigs else "none"
    return (
        f"{_now_iso()} | {ticker} | fail[{ids}] | sigs={sigs} | "
        f"fix detect_vcp late-base selection and/or draw_candle_chart VCP style-lock labels in "
        f"scripts/multi_pattern_scan.py"
    )


def grade(
    svg_path: Path,
    ticker: str | None = None,
    analysis_json: Path | None = None,
    exemplar_id: str = "draw-style-vcp-c123-dtl-now",
    copy_gallery: bool = True,
) -> dict:
    rubric = _load_json(RUBRIC_PATH)
    if not rubric:
        raise SystemExit(f"missing rubric: {RUBRIC_PATH}")
    never_idx = _load_json(NEVER_PATH, {"signatures": [], "repeatCounts": {}})
    threshold = int(rubric.get("passThreshold") or 90)

    ticker = _infer_ticker(svg_path, ticker)
    analysis = _find_analysis(ticker, analysis_json)
    svg = _svg_blob(svg_path)

    item_results, failure_sigs = check_items(svg, analysis, rubric)
    score = sum(r["earned"] for r in item_results)
    # weight sanity
    total_w = sum(r["weight"] for r in item_results)
    if total_w != 100:
        # normalize if rubric drift
        score = round(score * 100 / total_w) if total_w else 0

    verdict = decide_verdict(score, threshold, failure_sigs, never_idx)
    passed = score >= threshold and verdict == "keep"

    stamp = datetime.now(HK).strftime("%Y%m%dT%H%M%S")
    run_path = TRAINING / "runs" / f"{stamp}_{ticker}.json"

    result = {
        "gradedAt": _now_iso(),
        "ticker": ticker,
        "candidateSvg": str(svg_path.relative_to(ROOT)) if svg_path.is_relative_to(ROOT) else str(svg_path),
        "exemplarId": exemplar_id,
        "rubricId": rubric.get("id"),
        "score": score,
        "passThreshold": threshold,
        "pass": passed,
        "verdict": verdict,
        "failureSignatures": failure_sigs,
        "itemResults": item_results,
        "analysisSnapshot": {
            "primaryPattern": (analysis or {}).get("primaryPattern"),
            "pivot": (analysis or {}).get("pivot"),
            "close": (analysis or {}).get("close"),
            "contractions": _contractions(analysis),
            "asOf": (analysis or {}).get("asOf"),
        } if analysis else None,
    }
    _write_json(run_path, result)
    result["runPath"] = str(run_path.relative_to(ROOT))

    if copy_gallery:
        dest_dir = GALLERY / (
            "keep" if verdict == "keep" else
            "counterexamples" if verdict == "counterexample" else
            "never-learn"
        )
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{ticker}_{stamp}{svg_path.suffix}"
        try:
            shutil.copy2(svg_path, dest)
            result["galleryPath"] = str(dest.relative_to(ROOT))
        except OSError as e:
            result["galleryCopyError"] = str(e)

        if verdict == "never_learn":
            # bump repeat counts + ensure signatures listed
            rc = never_idx.setdefault("repeatCounts", {})
            for s in failure_sigs:
                rc[s] = int(rc.get(s, 0)) + 1
            never_idx["updatedAt"] = _now_iso()
            _write_json(NEVER_PATH, never_idx)
            # rolling counterexamples index not needed; never-learn index is source of truth
        elif verdict == "counterexample":
            idx_path = GALLERY / "counterexamples" / "index.json"
            idx = _load_json(idx_path, {"updatedAt": None, "items": []})
            idx["items"].append({
                "ticker": ticker,
                "score": score,
                "gradedAt": result["gradedAt"],
                "runPath": result["runPath"],
                "galleryPath": result.get("galleryPath"),
                "failureSignatures": failure_sigs,
            })
            idx["updatedAt"] = _now_iso()
            _write_json(idx_path, idx)

    if not passed:
        line = remediation_line(item_results, failure_sigs, ticker)
        if line:
            q = _load_json(REMED_PATH, {"items": []})
            q.setdefault("items", []).append({
                "at": _now_iso(),
                "ticker": ticker,
                "score": score,
                "verdict": verdict,
                "line": line,
                "runPath": result.get("runPath"),
            })
            q["updatedAt"] = _now_iso()
            _write_json(REMED_PATH, q)
            result["remediationQueued"] = True

    return result


def main():
    ap = argparse.ArgumentParser(description="Grade VCP chart vs NOW exemplar rubric")
    ap.add_argument("svg", type=Path, help="Candidate chart SVG")
    ap.add_argument("--ticker", default=None)
    ap.add_argument("--analysis-json", type=Path, default=None,
                    help="Single analysis object or tech-scan-latest.json")
    ap.add_argument("--exemplar-id", default="draw-style-vcp-c123-dtl-now")
    ap.add_argument("--no-gallery", action="store_true")
    ap.add_argument("--strict", action="store_true", help="Exit 1 unless verdict=keep")
    args = ap.parse_args()
    svg = args.svg
    if not svg.is_absolute():
        svg = (Path.cwd() / svg).resolve()
        if not svg.exists():
            svg = (ROOT / args.svg).resolve()
    if not svg.exists():
        raise SystemExit(f"SVG not found: {args.svg}")

    result = grade(
        svg_path=svg,
        ticker=args.ticker,
        analysis_json=args.analysis_json,
        exemplar_id=args.exemplar_id,
        copy_gallery=not args.no_gallery,
    )
    print(json.dumps({
        "ticker": result["ticker"],
        "score": result["score"],
        "pass": result["pass"],
        "verdict": result["verdict"],
        "failureSignatures": result["failureSignatures"],
        "runPath": result.get("runPath"),
        "galleryPath": result.get("galleryPath"),
        "failedItems": [r["id"] for r in result["itemResults"] if not r["passed"]],
    }, ensure_ascii=False, indent=2))
    if args.strict and result["verdict"] != "keep":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
