import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import cds from '@sap/cds'

const { GET, POST, data, axios } = cds.test(import.meta.dirname + '/..')
axios.defaults.validateStatus = () => true // check status codes ourselves

const base = '/odata/v4/equipment'
const eq = (id, active = true) => `${base}/Equipment(ID=${id},IsActiveEntity=${active})`

// Create equipment via draft and activate it
async function createEquipment(payload) {
  const draft = await POST(`${base}/Equipment`, payload)
  assert.equal(draft.status, 201)
  const res = await POST(`${eq(draft.data.ID, false)}/EquipmentService.draftActivate`, {})
  return { id: draft.data.ID, res }
}

// Seeded records (db/data) by status
const SEED = {
  NEW: '11111111-0000-0000-0000-000000000001',
  INSTALLED: '11111111-0000-0000-0000-000000000002',
  IN_OPERATION: '11111111-0000-0000-0000-000000000003',
  MAINTENANCE: '11111111-0000-0000-0000-000000000005',
  RETIRED: '11111111-0000-0000-0000-000000000008'
}
const action = (id, name, body = {}) => POST(`${eq(id)}/EquipmentService.${name}`, body)
const statusOf = async id => (await GET(eq(id))).data.status

// Change an active record through draft edit + activate
async function editEquipment(id, patch) {
  await POST(`${eq(id)}/EquipmentService.draftEdit`, { PreserveChanges: true })
  await fetchPatch(eq(id, false), patch)
  return POST(`${eq(id, false)}/EquipmentService.draftActivate`, {})
}
const fetchPatch = (url, body) => axios.patch(url, body)

beforeEach(() => data.reset())

describe('Determination', () => {
  test('new equipment gets status NEW', async () => {
    const { id, res } = await createEquipment({ description: 'New pump', type_code: 'VALVE' })
    assert.equal(res.status, 201)
    const { data: row } = await GET(eq(id))
    assert.equal(row.status, 'NEW')
  })

  test('status sent by the client is overwritten with NEW', async () => {
    const { id } = await createEquipment({ description: 'Sneaky', type_code: 'VALVE', status: 'IN_OPERATION' })
    const { data: row } = await GET(eq(id))
    assert.equal(row.status, 'NEW')
  })
})

describe('Validation: serial number (rule 2)', () => {
  test('serialized type without serial number is rejected (400, target serialNumber)', async () => {
    const { res } = await createEquipment({ description: 'Pump', type_code: 'PUMP' })
    assert.equal(res.status, 400)
    assert.equal(res.data.error.message, 'Serial number is required for serialized equipment types.')
    assert.equal(res.data.error.target, 'serialNumber')
  })

  test('serialized type with serial number is accepted', async () => {
    const { res } = await createEquipment({ description: 'Pump', type_code: 'PUMP', serialNumber: 'SN-1' })
    assert.equal(res.status, 201)
  })

  test('non-serialized type without serial number is accepted', async () => {
    const { res } = await createEquipment({ description: 'Valve', type_code: 'VALVE' })
    assert.equal(res.status, 201)
  })
})

describe('Action install (rule 3)', () => {
  test('missing installation data is rejected (400) with field targets', async () => {
    const res = await action(SEED.NEW, 'install')
    assert.equal(res.status, 400)
    const details = res.data.error.details ?? [res.data.error]
    assert.deepEqual(details.map(d => d.target).sort(), ['in/installationDate', 'in/location', 'in/responsiblePerson'])
    assert.ok(details.some(d => d.message === 'Installation date is required for installation.'))
    assert.equal(await statusOf(SEED.NEW), 'NEW')
  })

  test('NEW -> INSTALLED with complete installation data', async () => {
    const edit = await editEquipment(SEED.NEW, { installationDate: '2026-01-15', location: 'Hall A', responsiblePerson: 'Anna Schmidt' })
    assert.equal(edit.status, 200)
    const res = await action(SEED.NEW, 'install')
    assert.ok(res.status < 300, JSON.stringify(res.data))
    assert.equal(await statusOf(SEED.NEW), 'INSTALLED')
  })

  test('install from another status is rejected (409)', async () => {
    const res = await action(SEED.INSTALLED, 'install')
    assert.equal(res.status, 409)
    assert.equal(res.data.error.message, 'Action install is not allowed in status INSTALLED.')
  })
})

describe('Action startOperation', () => {
  test('INSTALLED -> IN_OPERATION', async () => {
    const res = await action(SEED.INSTALLED, 'startOperation')
    assert.ok(res.status < 300, JSON.stringify(res.data))
    assert.equal(await statusOf(SEED.INSTALLED), 'IN_OPERATION')
  })

  test('startOperation from NEW is rejected (409), status unchanged', async () => {
    const res = await action(SEED.NEW, 'startOperation')
    assert.equal(res.status, 409)
    assert.equal(await statusOf(SEED.NEW), 'NEW')
  })
})

describe('Actions startMaintenance / completeMaintenance', () => {
  test('IN_OPERATION -> MAINTENANCE -> IN_OPERATION', async () => {
    let res = await action(SEED.IN_OPERATION, 'startMaintenance')
    assert.ok(res.status < 300, JSON.stringify(res.data))
    assert.equal(await statusOf(SEED.IN_OPERATION), 'MAINTENANCE')
    res = await action(SEED.IN_OPERATION, 'completeMaintenance')
    assert.ok(res.status < 300, JSON.stringify(res.data))
    assert.equal(await statusOf(SEED.IN_OPERATION), 'IN_OPERATION')
  })

  test('startMaintenance only from IN_OPERATION (409 otherwise)', async () => {
    for (const status of ['NEW', 'INSTALLED', 'MAINTENANCE', 'RETIRED']) {
      const res = await action(SEED[status], 'startMaintenance')
      assert.equal(res.status, 409, status)
      assert.equal(res.data.error.message, `Action startMaintenance is not allowed in status ${status}.`)
    }
  })

  test('completeMaintenance from IN_OPERATION is rejected (409)', async () => {
    const res = await action(SEED.IN_OPERATION, 'completeMaintenance')
    assert.equal(res.status, 409)
    assert.equal(await statusOf(SEED.IN_OPERATION), 'IN_OPERATION')
  })
})

describe('Action retire (rules 5 and 6)', () => {
  // seed: INSTALLED = HIGH, MAINTENANCE = MEDIUM, IN_OPERATION = HIGH
  test('HIGH criticality without reason fails (400, target reason), status unchanged', async () => {
    const res = await action(SEED.INSTALLED, 'retire', {})
    assert.equal(res.status, 400)
    assert.equal(res.data.error.target, 'reason')
    assert.equal(res.data.error.message, 'A reason for retirement is required for equipment with HIGH criticality.')
    assert.equal(await statusOf(SEED.INSTALLED), 'INSTALLED')
  })

  test('HIGH criticality with reason succeeds and stores reason and timestamp', async () => {
    const res = await action(SEED.INSTALLED, 'retire', { reason: 'Replaced by newer model' })
    assert.ok(res.status < 300, JSON.stringify(res.data))
    const { data: row } = await GET(eq(SEED.INSTALLED))
    assert.equal(row.status, 'RETIRED')
    assert.equal(row.retirementReason, 'Replaced by newer model')
    assert.ok(row.retiredAt)
  })

  test('non-HIGH criticality can retire without reason (MAINTENANCE -> RETIRED)', async () => {
    const res = await action(SEED.MAINTENANCE, 'retire', {})
    assert.ok(res.status < 300, JSON.stringify(res.data))
    assert.equal(await statusOf(SEED.MAINTENANCE), 'RETIRED')
  })

  test('retire from IN_OPERATION, NEW or RETIRED is rejected (409), even without reason', async () => {
    for (const status of ['NEW', 'IN_OPERATION', 'RETIRED']) {
      const res = await action(SEED[status], 'retire', {})
      assert.equal(res.status, 409, status)
      assert.equal(res.data.error.message, `Action retire is not allowed in status ${status}.`)
    }
  })
})

describe('Function checkInstallation', () => {
  test('returns the missing installation fields and does not change data', async () => {
    const res = await GET(`${eq(SEED.NEW)}/EquipmentService.checkInstallation()`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.data.value.sort(), ['installationDate', 'location', 'responsiblePerson'])
    assert.equal(await statusOf(SEED.NEW), 'NEW')
  })

  test('returns an empty list when installation data is complete', async () => {
    const res = await GET(`${eq(SEED.INSTALLED)}/EquipmentService.checkInstallation()`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.data.value, [])
  })
})

describe('Validation: maintenance log (rule 7)', () => {
  // Add a log in a draft of an existing record and activate it
  async function addLog(id) {
    const edit = await POST(`${eq(id)}/EquipmentService.draftEdit`, { PreserveChanges: true })
    assert.equal(edit.status, 201, JSON.stringify(edit.data))
    const log = await POST(`${eq(id, false)}/logs`, { maintenanceDate: '2026-11-20', maintenanceType: 'INSPECTION', technician: 'Test', notes: 'n' })
    assert.equal(log.status, 201, JSON.stringify(log.data))
    return POST(`${eq(id, false)}/EquipmentService.draftActivate`, {})
  }
  const logCount = async id => (await GET(`${eq(id)}/logs`)).data.value.length

  test('log in MAINTENANCE succeeds', async () => {
    const before = await logCount(SEED.MAINTENANCE)
    const res = await addLog(SEED.MAINTENANCE)
    assert.equal(res.status, 200, JSON.stringify(res.data))
    assert.equal(await logCount(SEED.MAINTENANCE), before + 1)
  })

  test('log in another status fails (409, target logs)', async () => {
    for (const status of ['INSTALLED', 'IN_OPERATION', 'RETIRED']) {
      const res = await addLog(SEED[status])
      assert.equal(res.status, 409, status)
      assert.equal(res.data.error.message, 'Maintenance logs can only be created while the equipment is in status MAINTENANCE.')
      assert.equal(await logCount(SEED[status]), 0, status)
    }
  })

  test('direct POST of a log to an active record outside MAINTENANCE fails', async () => {
    const res = await POST(`${eq(SEED.INSTALLED)}/logs`, { maintenanceDate: '2026-11-20', maintenanceType: 'INSPECTION', technician: 'Test' })
    assert.equal(res.status, 409)
    assert.equal(await logCount(SEED.INSTALLED), 0)
  })

  test('direct POST of a log to an active record in MAINTENANCE succeeds', async () => {
    const res = await POST(`${eq(SEED.MAINTENANCE)}/logs`, { maintenanceDate: '2026-11-20', maintenanceType: 'INSPECTION', technician: 'Test' })
    assert.equal(res.status, 201, JSON.stringify(res.data))
  })

  test('existing logs do not block saving a record that is no longer in MAINTENANCE', async () => {
    await action(SEED.MAINTENANCE, 'completeMaintenance')
    const res = await editEquipment(SEED.MAINTENANCE, { description: 'Renamed compressor' })
    assert.equal(res.status, 200, JSON.stringify(res.data))
    assert.equal(await logCount(SEED.MAINTENANCE), 1)
  })
})

describe('Service metadata: feature control, side effects, buttons', () => {
  const actions = ['install', 'startOperation', 'startMaintenance', 'completeMaintenance', 'retire']

  test('every action has OperationAvailable, SideEffects and an Identification button', async () => {
    const { data: edmx } = await GET(`${base}/$metadata`)
    for (const name of actions) {
      const block = edmx.split(`Target="EquipmentService.${name}(EquipmentService.Equipment)"`)[1]?.split('</Annotations>')[0]
      assert.ok(block, `${name}: annotations missing`)
      assert.match(block, /Core\.OperationAvailable/, `${name}: OperationAvailable`)
      assert.match(block, /Common\.SideEffects/, `${name}: SideEffects`)
      assert.ok(block.includes('<String>in/status</String>'), `${name}: side effect target in/status`)
      assert.ok(!block.includes('_it/'), `${name}: side effect must not use _it/`)
      assert.ok(edmx.includes(`<PropertyValue Property="Action" String="EquipmentService.${name}"/>`), `${name}: button`)
    }
  })
})
