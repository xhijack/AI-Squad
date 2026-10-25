---
name: pipeline-report
description: "Report the sales pipeline: stage counts and conversion, velocity, win and loss reasons, and a forecast with its method, from CRM data in aggregate. Use as the sales lead or analyst weekly or monthly."
---
# Pipeline report

Write it in `docs/reports/<period>-pipeline.md`.

## Sections
1. **Summary:** three lines: pipeline value, change since last period, the decision needed.
2. **Stages:** count and value per stage (stages as defined in `docs/PIPELINE.md`), conversion stage to stage.
3. **Velocity:** average days per stage and from first contact to close.
4. **Win and loss reasons:** top reasons with counts.
5. **Forecast:** expected closes this period, with the method (for example stage probability × value) and its assumptions.
6. **Data quality:** the latest hygiene check result; caveats for small samples.
7. **Next:** three recommendations.

Aggregates only: no names, emails or phone numbers in the report, logs or commits. Every number states its date range and source.
