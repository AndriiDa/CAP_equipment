import cds from '@sap/cds'

// Allowed source status and resulting status for every bound action
const TRANSITIONS = {
  install: { from: ['NEW'], to: 'INSTALLED' },
  startOperation: { from: ['INSTALLED'], to: 'IN_OPERATION' },
  startMaintenance: { from: ['IN_OPERATION'], to: 'MAINTENANCE' },
  completeMaintenance: { from: ['MAINTENANCE'], to: 'IN_OPERATION' },
  retire: { from: ['INSTALLED', 'MAINTENANCE'], to: 'RETIRED' }
}

// Installation fields (rule 3) and their messages
const INSTALLATION_FIELDS = {
  installationDate: 'INSTALLATION_DATE_REQUIRED',
  location: 'LOCATION_REQUIRED',
  responsiblePerson: 'RESPONSIBLE_PERSON_REQUIRED'
}

export default class EquipmentService extends cds.ApplicationService {
  init() {
    const { Equipment, EquipmentTypes, MaintenanceLogs } = this.entities
    const db = cds.entities('equipment.mgmt')

    // The only place that changes status: checks the current status first
    const changeStatus = async (req, action, extra = {}) => {
      const row = await SELECT.one.from(req.subject).columns('ID', 'status')
      if (!row) return req.reject({ status: 404, message: 'EQUIPMENT_NOT_FOUND' })
      const { from, to } = TRANSITIONS[action]
      if (!from.includes(row.status)) {
        return req.reject({ status: 409, message: 'INVALID_STATUS_TRANSITION', args: [action, row.status] })
      }
      await UPDATE(db.Equipment, row.ID).with({ status: to, ...extra })
    }

    // Determination setInitialStatus: new equipment always starts as NEW
    this.before('CREATE', Equipment, req => {
      req.data.status = 'NEW'
    })

    // Validations on save: rule 2 (validateSerialNumber) and rule 3 (validateInstallation)
    this.before(['CREATE', 'UPDATE'], Equipment, async req => {
      const existing = req.event === 'UPDATE'
        ? await SELECT.one.from(Equipment, req.data.ID).columns('status', 'type_code', 'serialNumber', ...Object.keys(INSTALLATION_FIELDS))
        : {}
      const valueOf = field => (field in req.data ? req.data[field] : existing?.[field])

      // Rule 3: once the status is past NEW, installation fields must not be empty.
      // On CREATE the status is NEW, so nothing to check.
      if (existing?.status && existing.status !== 'NEW') {
        for (const [field, message] of Object.entries(INSTALLATION_FIELDS)) {
          if (!valueOf(field)?.toString().trim()) req.error({ status: 400, message, target: field })
        }
      }

      // Rule 2: serialized types need a serial number
      const typeCode = valueOf('type_code')
      if (typeCode && !valueOf('serialNumber')?.trim()) {
        const type = await SELECT.one.from(EquipmentTypes).where({ code: typeCode }).columns('serialized')
        if (type?.serialized) req.error({ status: 400, message: 'SERIAL_NUMBER_REQUIRED', target: 'serialNumber' })
      }
    })

    // Validation validateMaintenanceLog (rule 7): logs are saved as deep data of Equipment,
    // new logs are only allowed while the equipment is in MAINTENANCE
    this.before(['CREATE', 'UPDATE'], Equipment, async req => {
      if (!req.data.logs?.length) return
      let status = 'NEW'
      let knownIds = []
      if (req.event === 'UPDATE') {
        status = (await SELECT.one.from(Equipment, req.data.ID).columns('status'))?.status
        knownIds = (await SELECT.from(db.MaintenanceLogs).columns('ID').where({ parent_ID: req.data.ID })).map(log => log.ID)
      }
      const hasNewLogs = req.data.logs.some(log => !knownIds.includes(log.ID))
      if (hasNewLogs && status !== 'MAINTENANCE') {
        req.error({ status: 409, message: 'LOG_ONLY_IN_MAINTENANCE', target: 'logs' })
      }
    })

    // Rule 7 for API clients that create a log directly on an active record (not via draft)
    this.before('CREATE', MaintenanceLogs, async req => {
      const parent = await SELECT.one.from(Equipment, req.data.parent_ID).columns('status')
      if (parent?.status !== 'MAINTENANCE') {
        req.error({ status: 409, message: 'LOG_ONLY_IN_MAINTENANCE', target: 'parent_ID' })
      }
    })

    // Validation validateInstallation (rule 3): only checked if the status allows install,
    // otherwise the status helper answers with 409
    this.before('install', Equipment, async req => {
      const row = await SELECT.one.from(req.subject).columns('status', ...Object.keys(INSTALLATION_FIELDS))
      if (!row || !TRANSITIONS.install.from.includes(row.status)) return
      for (const [field, message] of Object.entries(INSTALLATION_FIELDS)) {
        if (!row[field]) req.error({ status: 400, message, target: `in/${field}` })
      }
    })

    // Rule 6: HIGH criticality equipment needs a reason for retirement.
    // Only checked if the status allows retire, otherwise the status helper answers with 409
    this.before('retire', Equipment, async req => {
      const row = await SELECT.one.from(req.subject).columns('status', 'criticality')
      if (!row || !TRANSITIONS.retire.from.includes(row.status)) return
      if (row.criticality === 'HIGH' && !req.data.reason?.trim()) {
        req.error({ status: 400, message: 'RETIREMENT_REASON_REQUIRED', target: 'reason' })
      }
    })

    // Function checkInstallation: read-only, returns the missing installation fields
    this.on('checkInstallation', Equipment, async req => {
      const row = await SELECT.one.from(req.subject).columns(...Object.keys(INSTALLATION_FIELDS))
      if (!row) return req.reject({ status: 404, message: 'EQUIPMENT_NOT_FOUND' })
      const missing = Object.keys(INSTALLATION_FIELDS).filter(field => !row[field])
      return { isComplete: missing.length === 0, missingFields: missing.join(' ') }
    })

    this.on('install', Equipment, req => changeStatus(req, 'install'))
    this.on('startOperation', Equipment, req => changeStatus(req, 'startOperation'))
    this.on('startMaintenance', Equipment, req => changeStatus(req, 'startMaintenance'))
    this.on('completeMaintenance', Equipment, req => changeStatus(req, 'completeMaintenance'))
    this.on('retire', Equipment, req => {
      const reason = req.data.reason?.trim()
      return changeStatus(req, 'retire', { ...(reason && { retirementReason: reason }), retiredAt: new Date().toISOString() })
    })

    return super.init()
  }
}
