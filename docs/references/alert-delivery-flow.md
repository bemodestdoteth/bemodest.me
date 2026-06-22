# Alert delivery flow

Alert rules no longer embed delivery destinations. Rules keep their trigger threshold in `value`, add per-alert thresholds in `alert_type_rules`, and reference global delivery templates through `destination_assignments`.

## Collections

- `COLLECTION_ALERT_RULES` stores alert rules.
- `COLLECTION_ALERT_DESTINATIONS` stores global destination templates.

## Destination templates

Destination templates use a stable `_id`, `label`, `kind`, `url`, `enabled`, `supported_alert_types`, `protected`, `created_at`, and `updated_at`.

Supported kinds:

- `builtin_api_ingest`: protected built-in API destination, supports `normal` and `urgent`, and is never marked dead by migration. The built-in API receiver is `POST /api/alert-events/ingest`; the local default URL is `http://127.0.0.1:${PORT}/api/alert-events/ingest`.
- `external_webhook`: external webhook destination, defaults to `normal` and `urgent` support and preserves existing enabled/dead state during migration. External URLs must point to a real receiver service, typically an allowed HTTPS `.ts.net` endpoint such as `/hooks/new-entry` or `/hooks/price-spike`.

`/api/alerts/fired` is legacy/stale and must not be used. `WEBHOOK_URL` is deprecated and rejected by API config validation.

`enabled` is the global kill switch for a template.

## Rule assignments

Rules reference templates with `destination_assignments` objects containing `destination_id`, `enabled`, `dead`, and optional `last_failed_at`. Rules define alert-specific thresholds with `alert_type_rules` objects containing `alert_type`, `operator`, and `value`.

Alert event ingest payloads include `alert_type` plus destination metadata so downstream logs can identify the selected destination template and assignment state.

## Migration

`apps/api/src/scripts/migrate-alert-destinations.js` is dry-run by default. Pass `--apply` to write global templates and remove embedded `alert_destinations`, `webhook_url`, and `webhook_dead` fields from rules.

Legacy per-rule `webhook_url` is migration-only input. Do not reintroduce it; new delivery configuration belongs in `alertDestinations` templates and per-rule `destination_assignments`.

The migration fails on URL conflicts and warns on label conflicts.
