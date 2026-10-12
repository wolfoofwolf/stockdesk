# Tech lessons DB (Grok)

Long-term, high-value technical analysis memory for StockDesk Pages.

- `index.json` — catalog + schema + retention policy
- `entries/<id>.json` — full lesson (rule, do/dont, chartRefs)

**Keep forever:** gate rules, annotated exemplars, false-positive cases, process regressions, annotation standards.
**Do not store:** every daily scan chart, raw OHLCV, notes without an actionable rule.

Owner: Grok. Downstream bots read catalog only; they do not write lessons.
