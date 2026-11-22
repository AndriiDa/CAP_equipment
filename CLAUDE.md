Project

SAP CAP (Node.js) project implementing the same draft-enabled Equipment Management application as the RAP project. Business rules and message texts must stay identical in both.

Runtime: @sap/cds (Node.js), SQLite for development
UI: Fiori Elements V4 (List Report + Object Page) in app/equipment
Draft-enabled root, composition child
Business logic in the backend only, never only in UI annotations
Commands
npm test — run all tests (must stay green)
npm run watch — run locally on http://localhost:4004
npx cds compile srv --to edmx — check the OData metadata after CDS changes
Structure
Path	Content
db/schema.cds	Entities, enums, defaults
db/data/*.csv	Demo data (same records as RAP)
srv/equipment-service.cds	Service, draft, actions, function, side effects
srv/equipment-service.js	Handlers: determination, validations, actions
_i18n/messages.properties	Message texts
app/equipment/annotations.cds	Fiori Elements annotations
test/*.test.js	cds.test + node:test
Entities
Entity	Role
Equipment	Root, cuid (GUID key) + managed
MaintenanceLogs	Child: logs : Composition of many MaintenanceLogs on logs.parent = $self
EquipmentTypes	Code list, serialized flag, value help for type

Field names are the camelCase form of the RAP fields (installationDate, responsiblePerson, retirementReason, maintenanceType, …).

Lifecycle
text
NEW --install--> INSTALLED --startOperation--> IN_OPERATION
IN_OPERATION --startMaintenance--> MAINTENANCE
MAINTENANCE --completeMaintenance--> IN_OPERATION
INSTALLED | MAINTENANCE --retire--> RETIRED

status is @readonly and changes only through bound actions.

Business Rules
Equipment ID is the GUID key (cuid), filled automatically.
Serial number is mandatory for serialized equipment types.
Installation requires installation date, location, and responsible person.
startMaintenance is allowed only from IN_OPERATION.
retire is allowed only from INSTALLED or MAINTENANCE.
HIGH criticality requires a reason for retirement.
A maintenance log can be created only while Equipment is in MAINTENANCE.
Behavior (RAP → CAP)
RAP	CAP	Rule
Determination setInitialStatus	default 'NEW' + before('CREATE', Equipment)	New equipment → NEW
Validation validateSerialNumber	before(['CREATE','UPDATE'], Equipment)	2
Validation validateInstallation	before('install', Equipment)	3
Action install	bound action + on('install')	NEW → INSTALLED
Action startOperation	bound action + on('startOperation')	INSTALLED → IN_OPERATION
Action startMaintenance	bound action + on('startMaintenance')	4
Action completeMaintenance	bound action + on('completeMaintenance')	MAINTENANCE → IN_OPERATION
Action retire	bound action retire(reason) + before/on	5, 6
Function checkInstallation	bound function, read-only	missing installation fields
Validation validateMaintenanceLog	check new logs on Equipment save	7

All status changes go through one shared helper that checks the current status first.

Feature Control

Use @Core.OperationAvailable on each action (write $self.status, not in.status):

Status	Enabled actions
NEW	install
INSTALLED	startOperation, retire
IN_OPERATION	startMaintenance
MAINTENANCE	completeMaintenance, retire
RETIRED	none

Annotations only control the UI. Handlers must also check the status, because API clients can call actions directly.

Rule 7: in draft, logs are saved as deep data of Equipment, so check new logs in the Equipment save handler. Hiding the log Create button is optional: check the CDS docs (cds-mcp search_docs) before choosing an annotation.

Validations and Errors
req.error({ status: 400, message: <i18n key>, target }) to collect errors, req.reject to stop.
Always set status (400, 409), otherwise CAP returns 500.
For bound actions use targets with the in/ prefix (e.g. in/location) so Fiori highlights the field.
Message texts go to _i18n/messages.properties.
Service and UI

Every action needs:

handler with status check
@Core.OperationAvailable
@Common.SideEffects, so status refreshes in the UI
a Fiori button in UI.Identification: Install, Start Operation, Start Maintenance, Complete Maintenance, Retire
a test

The Object Page shows MaintenanceLogs as a table section.

Tests

Test at minimum:

a valid lifecycle transition
an invalid source status (409)
missing installation data (400 with field targets)
HIGH criticality retirement without reason (fails)
HIGH criticality retirement with reason (succeeds)
maintenance log in MAINTENANCE (succeeds) and in another status (fails)
initial status determination

Use data.reset() before each test. Check status codes and messages, not only success.

Development Workflow
Plan first. Inspect schema, service, handlers, annotations and tests. Show the plan before changing anything.
Small steps. Change one file, then run npm test.
Errors. Show compile or test errors before fixing them. Make the smallest fix.
Check metadata with cds compile --to edmx after CDS changes.
Use tools. Use the cds-mcp server (search_model, search_docs) before writing CDS or CQL.

Make no unrelated changes. Never hide errors.

Do not update status outside the action helper, invent CDS annotations, or add unnecessary abstractions.

Definition of Done
npm test passes.
cds compile --to edmx shows the expected annotations.
Lifecycle rules and validations work.
Buttons and side effects work in the Fiori app.
No unrelated changes remain.