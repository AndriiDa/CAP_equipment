using equipment.mgmt as db from '../db/schema';

service EquipmentService @(path: '/odata/v4/equipment') {

  @odata.draft.enabled
  entity Equipment as projection on db.Equipment actions {
    @Core.OperationAvailable: ( $self.status = 'NEW' )
    @Common.SideEffects: { TargetProperties: [ 'in/status', 'in/statusCriticality' ] }
    action install();

    @Core.OperationAvailable: ( $self.status = 'INSTALLED' )
    @Common.SideEffects: { TargetProperties: [ 'in/status', 'in/statusCriticality' ] }
    action startOperation();

    @Core.OperationAvailable: ( $self.status = 'IN_OPERATION' )
    @Common.SideEffects: { TargetProperties: [ 'in/status', 'in/statusCriticality' ] }
    action startMaintenance();

    @Core.OperationAvailable: ( $self.status = 'MAINTENANCE' )
    @Common.SideEffects: { TargetProperties: [ 'in/status', 'in/statusCriticality' ] }
    action completeMaintenance();

    @Core.OperationAvailable: ( $self.status = 'INSTALLED' or $self.status = 'MAINTENANCE' )
    @Common.SideEffects: { TargetProperties: [ 'in/status', 'in/statusCriticality', 'in/retirementReason', 'in/retiredAt' ] }
    action retire(reason : String(255));

    // read-only: names of the installation fields that are still empty
    function checkInstallation() returns array of String;
  };

  entity MaintenanceLogs as projection on db.MaintenanceLogs;

  @readonly
  entity EquipmentTypes as projection on db.EquipmentTypes;

  @readonly
  entity MaintenanceTypes as projection on db.MaintenanceTypes;
}

// status changes only through bound actions
annotate EquipmentService.Equipment with {
  status @readonly;
};
