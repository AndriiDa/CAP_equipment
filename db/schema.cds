using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';

namespace equipment.mgmt;

entity Equipment : cuid, managed {
  description      : String(80);
  type             : Association to EquipmentTypes;
  manufacturer     : String(40);
  model            : String(40);
  serialNumber     : String(40);
  installationDate : Date;
  location         : String(40);
  responsiblePerson: String(80);
  status           : String(20) default 'NEW';
  criticality      : String(10) default 'MEDIUM';
  retirementReason : String(255);
  retiredAt        : Timestamp;
  // UI helper fields: 0 neutral, 1 negative, 2 critical, 3 positive
  statusCriticality : Integer = case status
    when 'IN_OPERATION' then 3
    when 'MAINTENANCE'  then 2
    when 'RETIRED'      then 1
    else 0
  end;
  criticalityLevel  : Integer = case criticality
    when 'HIGH'   then 1
    when 'MEDIUM' then 2
    when 'LOW'    then 3
  end;
  logs            : Composition of many MaintenanceLogs on logs.parent = $self;
}

type MaintenanceType : String(20) enum {
  INSPECTION;
  REPAIR;
  SERVICE;
  CALIBRATION;
}

entity MaintenanceLogs : cuid, managed {
  parent          : Association to Equipment;
  maintenanceDate : Date;
  maintenanceType : MaintenanceType;
  technician      : String(80);
  notes           : String(255);
}

// value help source for maintenanceType (values must match the enum above)
entity MaintenanceTypes : CodeList {
  key code : String(20);
}

entity EquipmentTypes : CodeList {
  key code   : String(10);
  serialized : Boolean;
}
