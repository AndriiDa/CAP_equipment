using EquipmentService as service from '../../srv/equipment-service';

annotate service.Equipment with {
  description       @title: 'Description';
  type              @title: 'Equipment Type'
                    @Common.Text: type.name
                    @Common.TextArrangement: #TextFirst
                    @Common.ValueListWithFixedValues;
  manufacturer      @title: 'Manufacturer';
  model             @title: 'Model';
  serialNumber      @title: 'Serial Number';
  installationDate  @title: 'Installation Date';
  location          @title: 'Location';
  responsiblePerson @title: 'Responsible Person';
  status            @title: 'Status';
  criticality       @title: 'Criticality';
  retirementReason  @title: 'Retirement Reason';
  retiredAt         @title: 'Retired At';
  logs              @title: 'Maintenance Logs';
  statusCriticality @UI.Hidden;
  criticalityLevel  @UI.Hidden;
};

annotate service.Equipment with {
  type @Common.ValueList: {
    CollectionPath: 'EquipmentTypes',
    Parameters    : [
      { $Type: 'Common.ValueListParameterInOut',      LocalDataProperty: type_code, ValueListProperty: 'code' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' },
      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'serialized' }
    ]
  };
};

annotate service.EquipmentTypes with {
  code       @title: 'Code';
  name       @title: 'Name';
  descr      @title: 'Description';
  serialized @title: 'Serialized';
};

annotate service.MaintenanceLogs with {
  maintenanceDate @title: 'Maintenance Date';
  maintenanceType @title: 'Maintenance Type'
                  @Common.ValueListWithFixedValues
                  @Common.ValueList: {
                    CollectionPath: 'MaintenanceTypes',
                    Parameters    : [
                      { $Type: 'Common.ValueListParameterInOut',       LocalDataProperty: maintenanceType, ValueListProperty: 'code' },
                      { $Type: 'Common.ValueListParameterDisplayOnly', ValueListProperty: 'name' }
                    ]
                  };
  technician      @title: 'Technician';
  notes           @title: 'Notes';
};

annotate service.Equipment with @(
  UI.HeaderInfo: {
    TypeName      : 'Equipment',
    TypeNamePlural: 'Equipment',
    Title         : { $Type: 'UI.DataField', Value: description },
    Description   : { $Type: 'UI.DataField', Value: status }
  },

  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'EquipmentService.install',             Label: 'Install' },
    { $Type: 'UI.DataFieldForAction', Action: 'EquipmentService.startOperation',      Label: 'Start Operation' },
    { $Type: 'UI.DataFieldForAction', Action: 'EquipmentService.startMaintenance',    Label: 'Start Maintenance' },
    { $Type: 'UI.DataFieldForAction', Action: 'EquipmentService.completeMaintenance', Label: 'Complete Maintenance' },
    { $Type: 'UI.DataFieldForAction', Action: 'EquipmentService.retire',              Label: 'Retire' }
  ],

  UI.SelectionFields: [ type_code, status, criticality, location ],

  UI.LineItem: [
    { $Type: 'UI.DataField', Value: description,       ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: type_code,         ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: serialNumber },
    { $Type: 'UI.DataField', Value: location },
    { $Type: 'UI.DataField', Value: responsiblePerson },
    { $Type: 'UI.DataField', Value: status,            Criticality: statusCriticality, ![@UI.Importance]: #High },
    { $Type: 'UI.DataField', Value: criticality,       Criticality: criticalityLevel }
  ],

  UI.FieldGroup #General: {
    $Type: 'UI.FieldGroupType',
    Data : [
      { $Type: 'UI.DataField', Value: description },
      { $Type: 'UI.DataField', Value: type_code },
      { $Type: 'UI.DataField', Value: manufacturer },
      { $Type: 'UI.DataField', Value: model },
      { $Type: 'UI.DataField', Value: serialNumber },
      { $Type: 'UI.DataField', Value: criticality, Criticality: criticalityLevel }
    ]
  },

  UI.FieldGroup #Installation: {
    $Type: 'UI.FieldGroupType',
    Data : [
      { $Type: 'UI.DataField', Value: installationDate },
      { $Type: 'UI.DataField', Value: location },
      { $Type: 'UI.DataField', Value: responsiblePerson }
    ]
  },

  UI.FieldGroup #Lifecycle: {
    $Type: 'UI.FieldGroupType',
    Data : [
      { $Type: 'UI.DataField', Value: status, Criticality: statusCriticality },
      { $Type: 'UI.DataField', Value: retirementReason },
      { $Type: 'UI.DataField', Value: retiredAt }
    ]
  },

  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'General',      Label: 'General',      Target: '@UI.FieldGroup#General' },
    { $Type: 'UI.ReferenceFacet', ID: 'Installation', Label: 'Installation', Target: '@UI.FieldGroup#Installation' },
    { $Type: 'UI.ReferenceFacet', ID: 'Lifecycle',    Label: 'Lifecycle',    Target: '@UI.FieldGroup#Lifecycle' },
    { $Type: 'UI.ReferenceFacet', ID: 'Logs',         Label: 'Maintenance Logs', Target: 'logs/@UI.LineItem' }
  ]
);

annotate service.MaintenanceLogs with @(
  UI.HeaderInfo: {
    TypeName      : 'Maintenance Log',
    TypeNamePlural: 'Maintenance Logs'
  },
  UI.LineItem: [
    { $Type: 'UI.DataField', Value: maintenanceDate },
    { $Type: 'UI.DataField', Value: maintenanceType },
    { $Type: 'UI.DataField', Value: technician },
    { $Type: 'UI.DataField', Value: notes }
  ]
);
