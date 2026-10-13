# Lessons training room

- `rubric-vcp-c123-dtl.json` — 100-pt checklist (pass ≥ 90)
- `lesson_chart_grade.py` (in `scripts/`) — grades candidate SVG vs exemplar
- `runs/` — per-grade JSON
- `remediation-queue.json` — drain before mass redraw
- `never-learn-index.json` — banned failure signatures

Loop: draw → grade → keep | counterexample | never_learn → remediate → redraw.
