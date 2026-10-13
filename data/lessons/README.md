# Tech lessons DB (Grok)

Long-term, high-value technical analysis memory for StockDesk Pages.

- `index.json` — catalog + schema + retention + **training** (schema v2)
- `entries/<id>.json` — full lesson (rule, do/dont, chartRefs)
- `exemplars/` — human gold-standard charts (e.g. NOW VCP style lock)
- `training/` — rubric, grade runs, remediation queue, never-learn index
- `gallery/` — `keep/` (≥90), `counterexamples/`, `never-learn/`

**Training loop:** draw → `scripts/lesson_chart_grade.py` vs exemplar → keep | counterexample | never_learn → process `remediation-queue.json` → redraw.

**Keep forever:** gate rules, annotated exemplars, false-positive cases, process regressions, annotation standards, training rubrics, never-learn signatures.
**Do not store:** every daily scan chart, raw OHLCV, notes without an actionable rule.

Owner: Grok. Downstream bots read catalog only; they do not write lessons.
