const path = require('path');
const objectAssignDeep = require('object-assign-deep');

const defaults = {
    whitelist   : [],
    ban         : [],
    permit_join : false,
    mqtt        : {
        include_device_information : false
    },
    serial : {
        disable_led : false
    },
    device_options : {},
    map_options    : {
        graphviz : {
            colors : {
                fill : {
                    enddevice   : '#fff8ce',
                    coordinator : '#e04e5d',
                    router      : '#4ea3e0'
                },
                font : {
                    coordinator : '#ffffff',
                    router      : '#ffffff',
                    enddevice   : '#000000'
                },
                line : {
                    active   : '#009900',
                    inactive : '#994444'
                }
            }
        }
    },
    experimental : {
        // json or attribute or attribute_and_json
        output : 'json'
    },
    advanced : {
        legacy_api         : true,
        log_rotation       : true,
        log_output         : [ 'console', 'file' ],
        // log_directory: path.join(data.getPath(), 'log', '%TIMESTAMP%'),
        log_file           : 'log.txt',
        log_level          : /* istanbul ignore next */ process.env.DEBUG ? 'debug' : 'info',
        soft_reset_timeout : 0,
        pan_id             : 0x1a62,
        ext_pan_id         : [ 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD, 0xDD ],
        channel            : 11,
        baudrate           : 115200,
        rtscts             : true,
        adapter_concurrent : null,

        // Availability timeout in seconds, disabled by default.
        availability_timeout   : 0,
        availability_blacklist : [],
        availability_whitelist : [],

        /**
         * Home Assistant requires ALL attributes to be present in ALL MQTT messages send by the device.
         * https://community.home-assistant.io/t/missing-value-with-mqtt-only-last-data-set-is-shown/47070/9
         *
         * Therefore zigbee2mqtt BY DEFAULT caches all values and resend it with every message.
         * advanced.cache_state in configuration.yaml allows to configure this.
         * https://www.zigbee2mqtt.io/configuration/configuration.html
         */
        cache_state : true,

        /**
         * Add a last_seen attribute to mqtt messages, contains date/time of zigbee message arrival
         * "ISO_8601": ISO 8601 format
         * "ISO_8601_local": Local ISO 8601 format (instead of UTC-based)
         * "epoch": milliseconds elapsed since the UNIX epoch
         * "disable": no last_seen attribute (default)
         */
        last_seen : 'disable',

        // Optional: Add an elapsed attribute to MQTT messages, contains milliseconds since the previous msg
        elapsed : false,

        /**
         * https://github.com/Koenkk/zigbee2mqtt/issues/685#issuecomment-449112250
         *
         * Network key will serve as the encryption key of your network.
         * Changing this will require you to repair your devices.
         */
        network_key : [ 1, 3, 5, 7, 9, 11, 13, 15, 0, 2, 4, 6, 8, 10, 12, 13 ],

        /**
         * Enables reporting feature
         */
        report : false,

        /**
         * Home Assistant discovery topic
         */
        homeassistant_discovery_topic : 'homeassistant',

        /**
         * Home Assistant status topic
         */
        homeassistant_status_topic : 'hass/status',

        /**
         * Home Assistant legacy triggers, when enabled:
         * - Zigbee2mqt will send an empty 'action' or 'click' after one has been send
         * - A 'sensor_action' and 'sensor_click' will be discoverd
         */
        homeassistant_legacy_triggers : true,

        /**
         * Configurable timestampFormat
         * https://github.com/Koenkk/zigbee2mqtt/commit/44db557a0c83f419d66755d14e460cd78bd6204e
         */
        timestamp_format : 'YYYY-MM-DD HH:mm:ss'
    }
};

const schema = {
    type       : 'object',
    properties : {
        device_options : { type: 'object' },
        homeassistant  : { type: 'boolean' },
        permit_join    : { type: 'boolean' },
        mqtt           : {
            type       : 'object',
            properties : {
                base_topic                 : { type: 'string' },
                server                     : { type: 'string' },
                keepalive                  : { type: 'number' },
                ca                         : { type: 'string' },
                key                        : { type: 'string' },
                cert                       : { type: 'string' },
                user                       : { type: 'string' },
                password                   : { type: 'string' },
                client_id                  : { type: 'string' },
                reject_unauthorized        : { type: 'boolean' },
                include_device_information : { type: 'boolean' },
                version                    : { type: 'number' }
            },
            required : [ 'base_topic', 'server' ]
        },
        serial : {
            type       : 'object',
            properties : {
                port        : { type: [ 'string', 'null' ] },
                disable_led : { type: 'boolean' },
                adapter     : { type: 'string', enum: [ 'deconz', 'zstack' ] }
            }
        },
        ban          : { type: 'array', items: { type: 'string' } },
        whitelist    : { type: 'array', items: { type: 'string' } },
        experimental : {
            type       : 'object',
            properties : {
                transmit_power : { type: 'number' }
            }
        },
        advanced : {
            type       : 'object',
            properties : {
                legacy_api                    : { type: 'boolean' },
                pan_id                        : { type: 'number' },
                ext_pan_id                    : { type: 'array', items: { type: 'number' } },
                channel                       : { type: 'number', minimum: 11, maximum: 26 },
                cache_state                   : { type: 'boolean' },
                log_rotation                  : { type: 'boolean' },
                log_level                     : { type: 'string', enum: [ 'info', 'warn', 'error', 'debug' ] },
                log_output                    : { type: 'array', items: { type: 'string' } },
                log_directory                 : { type: 'string' },
                log_file                      : { type: 'string' },
                baudrate                      : { type: 'number' },
                rtscts                        : { type: 'boolean' },
                soft_reset_timeout            : { type: 'number', minimum: 0 },
                network_key                   : { type: [ 'array', 'string' ], items: { type: 'number' } },
                last_seen                     : { type: 'string', enum: [ 'disable', 'ISO_8601', 'ISO_8601_local', 'epoch' ] },
                elapsed                       : { type: 'boolean' },
                availability_timeout          : { type: 'number', minimum: 0 },
                availability_blacklist        : { type: 'array', items: { type: 'string' } },
                availability_whitelist        : { type: 'array', items: { type: 'string' } },
                report                        : { type: 'boolean' },
                homeassistant_discovery_topic : { type: 'string' },
                homeassistant_status_topic    : { type: 'string' },
                timestamp_format              : { type: 'string' },
                adapter_concurrent            : { type: 'number' }
            }
        },
        map_options : {
            type       : 'object',
            properties : {
                graphviz : {
                    type       : 'object',
                    properties : {
                        colors : {
                            type       : 'object',
                            properties : {
                                fill : {
                                    type       : 'object',
                                    properties : {
                                        enddevice   : { type: 'string' },
                                        coordinator : { type: 'string' },
                                        router      : { type: 'string' }
                                    }
                                },
                                font : {
                                    type       : 'object',
                                    properties : {
                                        enddevice   : { type: 'string' },
                                        coordinator : { type: 'string' },
                                        router      : { type: 'string' }
                                    }
                                },
                                line : {
                                    type       : 'object',
                                    properties : {
                                        active   : { type: 'string' },
                                        inactive : { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        devices : {
            type          : 'object',
            propertyNames : {
                pattern : '^0x[\\d\\w]{16}$'
            },
            patternProperties : {
                '^.*$' : {
                    type       : 'object',
                    properties : {
                        friendly_name       : { type: 'string' },
                        retain              : { type: 'boolean' },
                        retention           : { type: 'number' },
                        qos                 : { type: 'number' },
                        filtered_attributes : { type: 'array', items: { type: 'string' } }
                    },
                    required : [ 'friendly_name' ]
                }
            }
        },
        groups : {
            type          : 'object',
            propertyNames : {
                pattern : '^[\\w].*$'
            },
            patternProperties : {
                '^.*$' : {
                    type       : 'object',
                    properties : {
                        friendly_name       : { type: 'string' },
                        retain              : { type: 'boolean' },
                        devices             : { type: 'array', items: { type: 'string' } },
                        optimistic          : { type: 'boolean' },
                        qos                 : { type: 'number' },
                        filtered_attributes : { type: 'array', items: { type: 'string' } }
                    },
                    required : [ 'friendly_name' ]
                }
            }
        }
    },
    required : [ 'homeassistant', 'permit_join', 'mqtt' ]
};

const data = [
    { 'id': 1, 'type': 'Coordinator', 'ieeeAddr': '0x00124b000cc0aea8', 'nwkAddr': 0, 'manufId': 0, 'epList': [ 1, 2, 3, 4, 5, 6, 8, 11, 12, 13, 110 ], 'endpoints': { '1': { 'profId': 260, 'epId': 1, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '2': { 'profId': 257, 'epId': 2, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '3': { 'profId': 261, 'epId': 3, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '4': { 'profId': 263, 'epId': 4, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '5': { 'profId': 264, 'epId': 5, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '6': { 'profId': 265, 'epId': 6, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '8': { 'profId': 260, 'epId': 8, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '11': { 'profId': 260, 'epId': 11, 'devId': 1024, 'inClusterList': [], 'outClusterList': [ 1280 ], 'clusters': {}, 'binds': [] }, '12': { 'profId': 49246, 'epId': 12, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '13': { 'profId': 260, 'epId': 13, 'devId': 5, 'inClusterList': [ 25 ], 'outClusterList': [], 'clusters': {}, 'binds': [] }, '110': { 'profId': 260, 'epId': 110, 'devId': 5, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] } }, 'interviewCompleted': false, 'meta': {}, 'lastSeen': null },
    { 'id': 2, 'ieeeAddr': '0x00158d00029aaa46', 'nwkAddr': 45906, 'epList': [], 'endpoints': {}, 'interviewCompleted': false, 'meta': {}, 'lastSeen': 1589279059389 },
    { 'id': 3, 'type': 'EndDevice', 'ieeeAddr': '0x00158d00031c77a0', 'nwkAddr': 43094, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.sensor_magnet', 'epList': [ 1 ], 'endpoints': { '1': { 'epId': 1, 'inClusterList': [], 'outClusterList': [], 'clusters': { 'genBasic': { 'attributes': { '65282': [ { 'elmType': 16, 'elmVal': 1 }, { 'elmType': 33, 'elmVal': 3015 }, { 'elmType': 33, 'elmVal': 17320 }, { 'elmType': 36, 'elmVal': [ 0, 10 ] }, { 'elmType': 33, 'elmVal': 15 }, { 'elmType': 32, 'elmVal': 89 } ], 'appVersion': 10, 'modelId': 'lumi.sensor_magnet' } }, 'genOnOff': { 'attributes': { 'onOff': 1 } } }, 'binds': [] } }, 'appVersion': 10, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1587545558361 },
    { 'id': 4, 'type': 'EndDevice', 'ieeeAddr': '0x00158d0002b88d5e', 'nwkAddr': 43825, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.sensor_switch', 'epList': [ 1 ], 'endpoints': { '1': { 'epId': 1, 'inClusterList': [], 'outClusterList': [], 'clusters': { 'genOnOff': { 'attributes': { '32768': 2, 'onOff': 1 } }, 'genBasic': { 'attributes': { '65282': [ { 'elmType': 16, 'elmVal': 1 }, { 'elmType': 33, 'elmVal': 3032 }, { 'elmType': 33, 'elmVal': 17320 }, { 'elmType': 36, 'elmVal': [ 0, 1 ] }, { 'elmType': 33, 'elmVal': 351 }, { 'elmType': 32, 'elmVal': 92 } ], 'modelId': 'lumi.sensor_switch' } } }, 'binds': [] } }, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1587654746020 },
    { 'id': 5, 'ieeeAddr': '0x00158d00045b26d9', 'nwkAddr': 12298, 'epList': [ 1 ], 'endpoints': { '1': { 'epId': 1, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] } }, 'interviewCompleted': false, 'meta': {}, 'lastSeen': 1589279374554 },
    { 'id': 6, 'ieeeAddr': '0x00158d00045b26d9', 'nwkAddr': 35282, 'epList': [ 1 ], 'endpoints': { '1': { 'epId': 1, 'inClusterList': [], 'outClusterList': [], 'clusters': {}, 'binds': [] } }, 'interviewCompleted': false, 'meta': {}, 'lastSeen': 1589279443765 },
    { 'id': 7, 'type': 'EndDevice', 'ieeeAddr': '0x00158d00045b26d9', 'nwkAddr': 39375, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.weather', 'epList': [ 1 ], 'endpoints': { '1': { 'profId': 260, 'epId': 1, 'devId': 24321, 'inClusterList': [ 0, 3, 65535, 1026, 1027, 1029 ], 'outClusterList': [ 0, 4, 65535 ], 'clusters': { 'msTemperatureMeasurement': { 'attributes': { 'measuredValue': 2211 } }, 'msRelativeHumidity': { 'attributes': { 'measuredValue': 3378 } }, 'msPressureMeasurement': { 'attributes': { '16': 9954, '20': -1, 'measuredValue': 995 } }, 'genBasic': { 'attributes': { '65281': { '1': 2995, '4': 5032, '5': 5, '6': [ 0, 1 ], '10': 0, '100': 2232, '101': 3361, '102': 99448 }, 'manufacturerName': 'LUMI', 'powerSource': 3, 'zclVersion': 1, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001' } } }, 'binds': [] } }, 'appVersion': 3, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001', 'zclVersion': 1, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1589279617401 },
    { 'id': 8, 'type': 'EndDevice', 'ieeeAddr': '0x00158d00029aaa46', 'nwkAddr': 45906, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.sensor_cube.aqgl01', 'epList': [ 1, 2, 3 ], 'endpoints': { '1': { 'epId': 1, 'inClusterList': [], 'outClusterList': [], 'clusters': { 'genBasic': { 'attributes': { '65281': { '1': 2975, '3': 22, '4': 5032, '5': 186, '6': [ 0, 10 ], '10': 0, '151': 0, '152': 205, '153': 176, '154': 4 }, 'modelId': 'lumi.sensor_cube.aqgl01', 'appVersion': 5 } } }, 'binds': [] }, '2': { 'epId': 2, 'inClusterList': [], 'outClusterList': [], 'clusters': { 'genMultistateInput': { 'attributes': { 'presentValue': 2 } } }, 'binds': [] }, '3': { 'epId': 3, 'inClusterList': [], 'outClusterList': [], 'clusters': { 'genAnalogInput': { 'attributes': { '65285': 500, 'presentValue': -13.580000877380371 } } }, 'binds': [] } }, 'appVersion': 5, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1589282696186 },
    { 'id': 9, 'type': 'EndDevice', 'ieeeAddr': '0x00158d000465c4a1', 'nwkAddr': 19582, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.weather', 'epList': [ 1 ], 'endpoints': { '1': { 'profId': 260, 'epId': 1, 'devId': 24321, 'inClusterList': [ 0, 3, 65535, 1026, 1027, 1029 ], 'outClusterList': [ 0, 4, 65535 ], 'clusters': { 'msTemperatureMeasurement': { 'attributes': { 'measuredValue': 2512 } }, 'msRelativeHumidity': { 'attributes': { 'measuredValue': 4398 } }, 'msPressureMeasurement': { 'attributes': { '16': 9953, '20': -1, 'measuredValue': 995 } }, 'genBasic': { 'attributes': { 'manufacturerName': 'LUMI', 'powerSource': 3, 'zclVersion': 1, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001' } } }, 'binds': [] } }, 'appVersion': 3, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001', 'zclVersion': 1, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1589304294651 },
    { 'id': 10, 'type': 'EndDevice', 'ieeeAddr': '0x00158d000464b1a9', 'nwkAddr': 33826, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.weather', 'epList': [ 1 ], 'endpoints': { '1': { 'profId': 260, 'epId': 1, 'devId': 24321, 'inClusterList': [ 0, 3, 65535, 1026, 1027, 1029 ], 'outClusterList': [ 0, 4, 65535 ], 'clusters': { 'msTemperatureMeasurement': { 'attributes': { 'measuredValue': 2341 } }, 'msRelativeHumidity': { 'attributes': { 'measuredValue': 4025 } }, 'msPressureMeasurement': { 'attributes': { '16': 9954, '20': -1, 'measuredValue': 995 } }, 'genBasic': { 'attributes': { 'manufacturerName': 'LUMI', 'powerSource': 3, 'zclVersion': 1, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001' } } }, 'binds': [] } }, 'appVersion': 3, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001', 'zclVersion': 1, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1589304567628 },
    { 'id': 11, 'type': 'EndDevice', 'ieeeAddr': '0x00158d0004889e1e', 'nwkAddr': 9301, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.weather', 'epList': [ 1 ], 'endpoints': { '1': { 'profId': 260, 'epId': 1, 'devId': 770, 'inClusterList': [ 0, 3, 65535, 1026, 1027, 1029 ], 'outClusterList': [ 0, 4, 65535 ], 'clusters': { 'msTemperatureMeasurement': { 'attributes': { 'measuredValue': 2356 } }, 'msRelativeHumidity': { 'attributes': { 'measuredValue': 4224 } }, 'msPressureMeasurement': { 'attributes': { '16': 9953, '20': -1, 'measuredValue': 995 } }, 'genBasic': { 'attributes': { 'manufacturerName': 'LUMI', 'powerSource': 3, 'zclVersion': 1, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20191205', 'swBuildId': '3000-0001' } } }, 'binds': [] } }, 'appVersion': 5, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20191205', 'swBuildId': '3000-0001', 'zclVersion': 1, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1589304656287 },
    { 'id': 12, 'type': 'EndDevice', 'ieeeAddr': '0x00158d00046611fe', 'nwkAddr': 63158, 'manufId': 4151, 'manufName': 'LUMI', 'powerSource': 'Battery', 'modelId': 'lumi.weather', 'epList': [ 1 ], 'endpoints': { '1': { 'profId': 260, 'epId': 1, 'devId': 24321, 'inClusterList': [ 0, 3, 65535, 1026, 1027, 1029 ], 'outClusterList': [ 0, 4, 65535 ], 'clusters': { 'msTemperatureMeasurement': { 'attributes': { 'measuredValue': 2311 } }, 'msRelativeHumidity': { 'attributes': { 'measuredValue': 4829 } }, 'msPressureMeasurement': { 'attributes': { '16': 9952, '20': -1, 'measuredValue': 995 } }, 'genBasic': { 'attributes': { 'manufacturerName': 'LUMI', 'powerSource': 3, 'zclVersion': 1, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001' } } }, 'binds': [] } }, 'appVersion': 3, 'stackVersion': 2, 'hwVersion': 30, 'dateCode': '20161129', 'swBuildId': '3000-0001', 'zclVersion': 1, 'interviewCompleted': true, 'meta': {}, 'lastSeen': 1589304719073 }
];


let _settings;
let _settingsWithDefaults;

function read() {
    const s = { devices: {} };

    data.forEach(d => {
        s.devices[d.ieeeAddr] = d;
    });

    return s;
}

function get() {
    if (!_settings) {
        _settings = read();
    }

    return _settings;
}

function getWithDefaults() {
    if (!_settingsWithDefaults) {
        _settingsWithDefaults = objectAssignDeep.noMutate(defaults, get());
    }

    if (!_settingsWithDefaults.devices) {
        _settingsWithDefaults.devices = {};
    }

    if (!_settingsWithDefaults.groups) {
        _settingsWithDefaults.groups = {};
    }

    return _settingsWithDefaults;
}

// function getGroup(IDorName) {
//     const settings = getWithDefaults();
//     const byID = settings.groups[IDorName];
//     if (byID) {
//         return {optimistic: true, devices: [], ...byID, ID: Number(IDorName), friendlyName: byID.friendly_name};
//     }

//     for (const [ID, group] of Object.entries(settings.groups)) {
//         if (group.friendly_name === IDorName) {
//             return {optimistic: true, devices: [], ...group, ID: Number(ID), friendlyName: group.friendly_name};
//         }
//     }

//     return null;
// }

// function getGroups() {
//     const settings = getWithDefaults();
//     return Object.entries(settings.groups).map(([ID, group]) => {
//         return {optimistic: true, devices: [], ...group, ID: Number(ID), friendlyName: group.friendly_name};
//     });
// }

function getDevice(IDorName) {
    const settings = getWithDefaults();
    const byID = settings.devices[IDorName];

    if (byID) {
        return { ...byID, ID: IDorName, friendlyName: `${byID.ieeeAddr} ${byID.modelId}` };
    }

    for (const [ ID, device ] of Object.entries(settings.devices)) {
        if (device.friendly_name === IDorName) {
            return { ...device, ID, friendlyName: `${device.modelId} ${device.friendly_name}` };
        }
    }

    return null;
}

function getEntity(IDorName) {
    const device = getDevice(IDorName);

    if (device) {
        return { ...device, type: 'device' };
    }

    return null;
}

module.exports = {
    // validate,
    get : getWithDefaults,
    // set,
    getDevice,
    // getGroup,
    // getGroups,
    getEntity
    // whitelistDevice,
    // banDevice,
    // addDevice,
    // removeDevice,
    // addGroup,
    // removeGroup,
    // addDeviceToGroup,
    // removeDeviceFromGroup,
    // changeDeviceOptions,
    // changeFriendlyName,

    // For tests only
    // _write: write,
    // _reRead: () => {
    //     _settings = read();
    //     _settingsWithDefaults = objectAssignDeep.noMutate(defaults, get());
    // },
    // _getDefaults: () => defaults,
};
