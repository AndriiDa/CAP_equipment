# Change log — CAP Equipment UI service

## Step 1 — package.json
- Added devDependency `@sap/cds-dk` (provides `cds` CLI).
- Added script `watch` (`cds watch`).
- Added `cds.requires.[development].auth = mocked` (production stays `xsuaa`).

## Step 2 — db/schema.cds (new)
- Namespace `equipment.mgmt`.
- `Equipment` (cuid, managed): all specified fields, `status` default `'NEW'`, `criticality` default `'MEDIUM'`, `logs : Composition of many MaintenanceLogs on logs.parent = $self`.
- `MaintenanceLogs` (cuid, managed): `parent` association + maintenanceDate, maintenanceType, technician, notes. (`managed` on the child per spec.)
- `EquipmentTypes : CodeList` with `key code : String(10)`, `serialized : Boolean`.
- `status` is a plain field for now; `@readonly` comes with the bound actions in the next prompt.

## Step 3 — srv/equipment-service.cds (new)
- `EquipmentService` at `/odata/v4/equipment`: `Equipment` (`@odata.draft.enabled`), `MaintenanceLogs`, `EquipmentTypes` (`@readonly`).
- No actions, validations or handlers.
- `npx cds compile srv --to edmx` OK (draft actions, `logs`/`type` navigation bindings present).

## Step 4 — db/data (new CSVs)
- `equipment.mgmt-EquipmentTypes.csv`: PUMP, MOTOR, SENSOR, COMPRSR (serialized), VALVE (not serialized).
- `equipment.mgmt-Equipment.csv`: 8 records — NEW, INSTALLED, 3x IN_OPERATION, 2x MAINTENANCE, RETIRED (HIGH criticality with reason).
- `equipment.mgmt-MaintenanceLogs.csv`: 2 logs, both on equipment in MAINTENANCE.

## Step 5 — app/equipment/annotations.cds (new), app/services.cds (new)
- Labels (`@title`) for all Equipment, EquipmentTypes and MaintenanceLogs fields.
- `type`: text from `type.name`, `Common.ValueList` on `EquipmentTypes` (code, name, serialized).
- `UI.HeaderInfo` (Description = title, status = subtitle), `SelectionFields`, `LineItem`.
- Field groups + facets: General / Installation / Lifecycle, plus Maintenance Logs table (`logs/@UI.LineItem`).
- `cds compile srv app --to edmx`: ValueList, Facets, HeaderInfo present.

## Step 6 — app/equipment/webapp (new)
- `manifest.json` (FE V4 List Report + Object Page on `/Equipment`), `Component.js`, `index.html` (Fiori launchpad sandbox, UI5 from CDN).

## Step 7 — Verification
- `npm run watch`: CSVs loaded into in-memory SQLite, mocked auth, EquipmentService served.
- `GET /odata/v4/equipment/Equipment` → 8 records; `MaintenanceLogs` returns 2; `index.html` → HTTP 200.

## Not done (separate prompt)
Actions, validations, handlers, `@Core.OperationAvailable`, side effects, tests. `status` remains a plain editable field; `@readonly` on `status` comes with the bound actions. No `test` script yet.

---
# Part 2 — Behavior (CLAUDE.md rules)

## P2-1 — Test infrastructure + determination (rule: new equipment → NEW)
- `package.json`: added `@cap-js/cds-test` devDependency, script `"test": "node --test"`.
- `srv/equipment-service.js` (new): `before('CREATE', Equipment)` sets `status = 'NEW'`.
- `test/equipment.test.js` (new): cds.test + node:test; `data.reset()` before each test; `axios.defaults.validateStatus` so status codes are asserted. Helper `createEquipment` goes through draft create + `draftActivate`.
- Note: cds.test must not be given manual `before/after` globals — it detects `node:test` and defines them itself.
- Tests: initial status NEW; client-sent status is overwritten. `npm test`: 2 pass.

## P2-2 — Validation serial number (rule 2) + `status @readonly`
- `_i18n/messages.properties` (new): `SERIAL_NUMBER_REQUIRED`.
- `srv/equipment-service.cds`: `annotate EquipmentService.Equipment with { status @readonly }` (status changes only via actions).
- `srv/equipment-service.js`: `before(['CREATE','UPDATE'], Equipment)` — for UPDATE merges request data with the stored row, looks up `EquipmentTypes.serialized`, `req.error(400, SERIAL_NUMBER_REQUIRED, target 'serialNumber')`.
- First test run failed (3 tests, 500): `SELECT.one.from('EquipmentService.EquipmentTypes', typeCode)` treated the value as key `ID`, but the key is `code`. Smallest fix: `SELECT.one.from(EquipmentTypes).where({ code })`.
- Tests added: serialized without serial no. (400, message text, target), with serial no. (201), non-serialized without serial no. (201). `npm test`: 5 pass.

## P2-3 — Shared status helper, `install` (rule 3), `startOperation`
- `srv/equipment-service.cds`: bound actions `install`, `startOperation` with `@Core.OperationAvailable: ( $self.status = ... )` and `@Common.SideEffects: { TargetProperties: ['_it/status'] }`. `cds compile --to edmx` shows the `Core.OperationAvailable` annotations on `install(...)`.
- `srv/equipment-service.js`: `TRANSITIONS` table (allowed source status + target status per action) and one helper `changeStatus` — reads the current status, `404` if missing, `409 INVALID_STATUS_TRANSITION` if the source status is not allowed, then updates via `UPDATE(db.Equipment)` (bypasses `@readonly` on `status`).
- `before('install')` validation (rule 3): `400` with targets `in/installationDate`, `in/location`, `in/responsiblePerson`. Skipped when the status does not allow install, so the wrong status answers 409 first.
- `_i18n/messages.properties`: `INVALID_STATUS_TRANSITION`, `EQUIPMENT_NOT_FOUND`, `INSTALLATION_DATE_REQUIRED`, `LOCATION_REQUIRED`, `RESPONSIBLE_PERSON_REQUIRED`.
- Tests: install with missing data (400 + 3 targets + message), valid install via draft edit (NEW → INSTALLED), install from INSTALLED (409 + message), startOperation valid, startOperation from NEW (409, status unchanged). `npm test`: 10 pass.
- Environment note: the earlier background `cds watch` was killed by the harness (low memory); not restarted. Tests start their own server.

## P2-4 — `startMaintenance`, `completeMaintenance`
- `srv/equipment-service.cds`: both actions with `@Core.OperationAvailable` (`IN_OPERATION` / `MAINTENANCE`) and `@Common.SideEffects` on `_it/status`.
- `srv/equipment-service.js`: two entries in `TRANSITIONS` and two `on(...)` handlers that call `changeStatus`.
- Tests: full round trip IN_OPERATION → MAINTENANCE → IN_OPERATION; startMaintenance from NEW/INSTALLED/MAINTENANCE/RETIRED → 409 with message; completeMaintenance from IN_OPERATION → 409. `npm test`: 13 pass.

## P2-5 — `retire(reason)` (rules 5, 6)
- `srv/equipment-service.cds`: `action retire(reason : String(255))`, `@Core.OperationAvailable` for INSTALLED or MAINTENANCE, side effects on `_it/status`, `_it/retirementReason`, `_it/retiredAt`.
- `srv/equipment-service.js`: `retire` in `TRANSITIONS` (INSTALLED | MAINTENANCE → RETIRED); `before('retire')` rule 6 → `400 RETIREMENT_REASON_REQUIRED`, target `reason` (action parameter, so no `in/` prefix), skipped when the status does not allow retire so the wrong status gives 409; `on('retire')` goes through `changeStatus` and also stores `retirementReason` and `retiredAt`.
- `_i18n/messages.properties`: `RETIREMENT_REASON_REQUIRED`.
- Tests: HIGH without reason (400, unchanged), HIGH with reason (RETIRED, reason + retiredAt stored), MEDIUM without reason OK, NEW/IN_OPERATION/RETIRED → 409. `npm test`: 17 pass.

## P2-6 — Function `checkInstallation`
- `srv/equipment-service.cds`: bound `function checkInstallation() returns array of String`.
- `srv/equipment-service.js`: read-only handler, returns the names of empty installation fields (same `INSTALLATION_FIELDS` as rule 3); 404 if the record is missing.
- Tests: missing fields listed for NEW seed record (data unchanged), empty list for complete record. `npm test`: 19 pass.

## P2-7 — Rule 7: maintenance logs only in MAINTENANCE
- `srv/equipment-service.js`: `before(['CREATE','UPDATE'], Equipment)` — on draft activation (deep data) compares `req.data.logs` with the stored logs of the equipment; any new log while the stored status is not MAINTENANCE → `409 LOG_ONLY_IN_MAINTENANCE`, target `logs`. For CREATE the status is always NEW, so new equipment cannot carry logs.
- Found while testing: a log could be POSTed directly to an active record (`POST Equipment(...)/logs`) in any status and returned 201 — rule 7 bypass for API clients. Fix: `before('CREATE', MaintenanceLogs)` checks the parent status (`409`, target `parent_ID`). Draft logs are unaffected (checked on save).
- `_i18n/messages.properties`: `LOG_ONLY_IN_MAINTENANCE`.
- Status code choice: 409 (state conflict) rather than 400, consistent with the lifecycle checks.
- Tests: log via draft in MAINTENANCE succeeds (+1 log); in INSTALLED / IN_OPERATION / RETIRED fails 409 with message and no log stored; direct POST outside MAINTENANCE 409; direct POST in MAINTENANCE 201; editing a record that already has logs after it left MAINTENANCE still saves. `npm test`: 24 pass.

## P2-8 — Fiori buttons (UI.Identification)
- `app/equipment/annotations.cds`: `UI.Identification` with `DataFieldForAction` buttons: Install, Start Operation, Start Maintenance, Complete Maintenance, Retire. (A redundant `annotate ... actions { retire ... }` block I first added was removed again — side effects live in the service.)
- `cds compile srv app --to edmx`: 5 `UI.DataFieldForAction` records, 5 `Core.OperationAvailable`, `Common.SideEffects` on every action.
- Test: `$metadata` contains OperationAvailable + SideEffects for each action and a button for it. `npm test`: 25 pass.

## Definition of Done — status
- `npm test`: 25/25 pass.
- Lifecycle rules 2–7 and determination enforced in handlers (annotations only drive the UI).
- Not verified in a browser: button visibility/refresh in the Fiori UI (only metadata and API behavior are tested). `npm run watch` is not running (stopped by the harness on memory pressure).
- Decisions worth review: 409 for rule 7; `retire` reason error targets the parameter `reason` (not `in/…`); message texts are my own wording — align them with the RAP project texts.

## P2-9 — Fix: side effects did not refresh status/buttons after an action
- Cause: `@Common.SideEffects` targets used the RAP prefix `_it/`; in CAP the binding parameter of bound actions is `in` (EDMX `<Parameter Name="in" .../>`), so Fiori Elements could not resolve `_it/status`.
- `srv/equipment-service.cds`: every `_it/` target replaced with `in/` (install, startOperation, startMaintenance, completeMaintenance: `in/status`; retire: `in/status`, `in/retirementReason`, `in/retiredAt`). Nothing else changed; no handler changes.
- `cds compile srv --to edmx`: each action's `TargetProperties` contains `in/...`; 0 occurrences of `_it/`.
- `test/equipment.test.js` (metadata test): each action block must contain `<String>in/status</String>` and must not contain `_it/`. Negative check: with `_it/` temporarily restored the test fails (24 pass, 1 fail); with `in/` restored `npm test` passes 25/25.
- Manual UI verification is still pending (see below); fallback if buttons stay stale: `TargetEntities` on the binding parameter — to be checked in the docs and proposed before any change.
