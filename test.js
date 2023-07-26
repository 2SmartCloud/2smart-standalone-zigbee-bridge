var async = require('async');
var path = require('path');
/*
var zigbee2mqtt_utils = require('zigbee2mqtt/lib/util/utils');
ZigbeeHerdsman = require('zigbee-herdsman');
zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
process.env.ZIGBEE2MQTT_CONFIG = path.resolve('./etc/zigbee2mqtt_configuration.yaml');

herdsmanSettings = {
    databasePath: path.resolve('./temp/database.db'),
    databaseBackupPath: path.resolve('./temp/database.db.backup'),
    backupPath: path.resolve('./temp/coordinator_backup.json'),
    serialPort: {
        path: 'COM7'
//path: 'tcp://192.168.2.166:1775'
    }
}

herdsman = new ZigbeeHerdsman.Controller(herdsmanSettings);

herdsman._emit = herdsman.emit;
herdsman.emit = function(type, ...args) {
    console.log(type + " emitted")
    this._emit(type, ...args);
};

herdsman.on('deviceLeave', ({ device }) => {
    console.log('deviceLeave '+device.ieeeAddr);
});
herdsman.on('deviceJoined', ({ device }) => {
    console.log('deviceJoined '+device.ieeeAddr);
});
herdsman.on('adapterDisconnected', () => {
    console.log('adapterDisconnected')
});
herdsman.on('deviceAnnounce', ({ device }) => {
    console.log('deviceAnnounce '+device.ieeeAddr);
});
herdsman.on('deviceInterview', ({ status, device }) => {
    console.log('deviceInterview '+status);
    console.log('device.ieeeAddr =  '+device.ieeeAddr);
    if (status === 'successful' && device.modelID) {
        console.log('device.modelID =  '+device.modelID);
        const mapped = zigbeeHerdsmanConverters.findByZigbeeModel(device.modelID);
        console.log(mapped);
    }
});
function canHandleEvent(data, mappedDevice) {
    const coordinator = herdsman.getDevicesByType('Coordinator')[0];
    if (data.device.ieeeAddr === coordinator.ieeeAddr) {
        logger.debug('Ignoring message from coordinator');
        return false;
    }

    /**
     * Don't handle re-transmitted Xiaomi messages.
     * https://github.com/Koenkk/zigbee2mqtt/issues/1238
     *
     * Some Xiaomi router devices re-transmit messages from Xiaomi end devices.
     * The source address of these message is set to the one of the Xiaomi router.
     * Therefore it looks like if the message came from the Xiaomi router, while in
     * fact it came from the end device.
     * Handling these message would result in false state updates.
     * The group ID attribute of these message defines the source address of the end device.
     * As the same message is also received directly from the end device, it makes no sense
     * to handle these messages.
     */
    /*const hasGroupID = data.hasOwnProperty('groupID') && data.groupID != 0;
    if (zigbee2mqtt_utils.isXiaomiDevice(data.device) && zigbee2mqtt_utils.isRouter(data.device) && hasGroupID) {
        logger.debug('Skipping re-transmitted Xiaomi message');
        return false;
    }

    if (data.device.modelID === null && data.device.interviewing) {
        logger.debug(`Skipping message, modelID is undefined and still interviewing`);
        return false;
    }

    if (!mappedDevice) {
        logger.warn(`Received message from unsupported device with Zigbee model '${data.device.modelID}'`);
        logger.warn(`Please see: https://www.zigbee2mqtt.io/how_tos/how_to_support_new_devices.html.`);
        return false;
    }

    return true;
}
herdsman.on('message', (data) => {
    console.log('message '+data.device.ieeeAddr);
    console.log(data);
    const mappedDevice = zigbeeHerdsmanConverters.findByZigbeeModel(data.device.modelID);
    const can_handle = canHandleEvent(data,mappedDevice);
    console.log('can_handle');
    console.log(can_handle);

    if (can_handle) {
        const converters = mappedDevice.fromZigbee.filter((c) => {
            return c.cluster === data.cluster && (Array.isArray(c.type) ? c.type.includes(data.type) : c.type === data.type);
        });
        console.log('converters.length = '+converters.length);
        for(const converter of converters) {
            console.log('converter');
            const converted = converter.convert(mappedDevice, data, console.log, {}, {device: data.device});
            console.log(converted);
        }
    }
});
herdsman.on('error', (error) => {
    console.log('on error');
    console.log(error);
});

herdsman.start().then(() => {
    console.log('started');
    console.log(herdsman.getDevices());
    herdsman.permitJoin(true).then(() => console.log('permitJoin ok'))
}, console.error)
*/

async function networkScan(includeRoutes) {
    console.log(`Starting network scan (includeRoutes '${includeRoutes}')`);
    const devices = herdsman.getDevices();
    const lqis = new Map();
    const routingTables = new Map();
    const failed = new Map();

    for (const device of devices.filter((d) => d.type != 'EndDevice')) {
        failed.set(device, []);
        try {
            const result = await device.lqi();
            lqis.set(device, result);
            console.log(`LQI succeeded for '${device.ID}'`);
        } catch (error) {
            failed.get(device).push('lqi');
            console.log(`Failed to execute LQI for '${device.ID+device.type}'`);
        }

        if (includeRoutes) {
            try {
                const result = await device.routingTable();
                routingTables.set(device, result);
                console.log(`Routing table succeeded for '${device.ID+device.type}'`);
            } catch (error) {
                failed.get(device).push('routingTable');
                console.log(`Failed to execute routing table for '${device.ID+device.type}'`);
            }
        }
    }

    console.log(`Network scan finished`);

    const networkMap = {nodes: [], links: []};
    // Add nodes
    for (const device of devices) {
        networkMap.nodes.push({
            ieeeAddr: device.ieeeAddr, friendlyName: device.ID, type: device.type,
            networkAddress: device.networkAddress, manufacturerName: device.manufacturerName,
            modelID: device.modelID, failed: failed.get(device), lastSeen: device.lastSeen,
        });
    }

    // Add links
    lqis.forEach((lqi, device) => {
        for (const neighbor of lqi.neighbors) {
            if (neighbor.relationship > 3) {
                // Relationship is not active, skip it
                continue;
            }

            const link = {
                source: {ieeeAddr: neighbor.ieeeAddr, networkAddress: neighbor.networkAddress},
                target: {ieeeAddr: device.ieeeAddr, networkAddress: device.networkAddress},
                linkquality: neighbor.linkquality, depth: neighbor.depth, routes: [],
                // DEPRECATED:
                sourceIeeeAddr: neighbor.ieeeAddr, targetIeeeAddr: device.ieeeAddr,
                sourceNwkAddr: neighbor.networkAddress, lqi: neighbor.linkquality,
                relationship: neighbor.relationship,
            };

            const routingTable = routingTables.get(device);
            if (routingTable) {
                link.routes = routingTable.table
                    .filter((t) => t.status === 'ACTIVE' && t.nextHop === neighbor.networkAddress);
            }

            networkMap.links.push(link);
        }
    });

    return networkMap;
}
var net  = null;
/*networkScan(true).then((n) => net = n);*/

//const zigbee2mqtt_homeassistant = require('./node_modules/zigbee2mqtt/lib/extension/homeassistant');


async.series([
    function(callback) {
        return callback();
        var zigbee2mqtt_utils = require('zigbee2mqtt/lib/util/utils');
        ZigbeeHerdsman = require('zigbee-herdsman');
        zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
        process.env.ZIGBEE2MQTT_CONFIG = path.resolve('./etc/zigbee2mqtt_configuration.yaml');

        herdsmanSettings = {
            databasePath: path.resolve('./temp/database.db'),
            databaseBackupPath: path.resolve('./temp/database.db.backup'),
            backupPath: path.resolve('./temp/coordinator_backup.json'),
            serialPort: {
                //path: 'COM7'
                path: 'tcp://192.168.0.100:1775'
            }
        };

        herdsman = new ZigbeeHerdsman.Controller(herdsmanSettings);

        herdsman._emit = herdsman.emit;
        herdsman.emit = function(type, ...args) {
            console.log(new Date(), '||||||||||||||||||||||||||||||||||||||||||||||||||'+type + " emitted");
            this._emit(type, ...args);
        };

        herdsman.on('deviceLeave', ({ device }) => {
            console.log('deviceLeave '+device.ieeeAddr+', interviewCompleted =  '+device.interviewCompleted+', interviewing =  '+device.interviewing);
        });
        herdsman.on('deviceJoined', ({ device }) => {
            console.log('deviceJoined '+device.ieeeAddr+', interviewCompleted =  '+device.interviewCompleted+', interviewing =  '+device.interviewing);
        });
        herdsman.on('adapterDisconnected', () => {
            console.log('adapterDisconnected')
        });
        herdsman.on('deviceAnnounce', ({ device }) => {
            console.log('deviceAnnounce '+device.ieeeAddr+', interviewCompleted =  '+device.interviewCompleted+', interviewing =  '+device.interviewing);
        });
        herdsman.on('deviceInterview', ({ status, device }) => {
            console.log('deviceInterview '+status+', ieeeAddr = '+device.ieeeAddr+', interviewCompleted =  '+device.interviewCompleted+', interviewing =  '+device.interviewing);
            if (status === 'successful' && device.modelID) {
                console.log('modelID =  '+device.modelID);
                //const mapped = zigbeeHerdsmanConverters.findByZigbeeModel(device.modelID);
                //console.log(mapped);
            }
        });
        function canHandleEvent(data, mappedDevice) {
            const coordinator = herdsman.getDevicesByType('Coordinator')[0];
            if (data.device.ieeeAddr === coordinator.ieeeAddr) {
                console.debug('Ignoring message from coordinator');
                return false;
            }

            /**
             * Don't handle re-transmitted Xiaomi messages.
             * https://github.com/Koenkk/zigbee2mqtt/issues/1238
             *
             * Some Xiaomi router devices re-transmit messages from Xiaomi end devices.
             * The source address of these message is set to the one of the Xiaomi router.
             * Therefore it looks like if the message came from the Xiaomi router, while in
             * fact it came from the end device.
             * Handling these message would result in false state updates.
             * The group ID attribute of these message defines the source address of the end device.
             * As the same message is also received directly from the end device, it makes no sense
             * to handle these messages.
             */
            const hasGroupID = data.hasOwnProperty('groupID') && data.groupID != 0;
            if (zigbee2mqtt_utils.isXiaomiDevice(data.device) && zigbee2mqtt_utils.isRouter(data.device) && hasGroupID) {
                console.debug('Skipping re-transmitted Xiaomi message');
                return false;
            }

            if (data.device.modelID === null && data.device.interviewing) {
                console.debug(`Skipping message, modelID is undefined and still interviewing`);
                return false;
            }

            if (!mappedDevice) {
                console.warn(`Received message from unsupported device with Zigbee model '${data.device.modelID}'`);
                console.warn(`Please see: https://www.zigbee2mqtt.io/how_tos/how_to_support_new_devices.html.`);
                return false;
            }

            return true;
        }
        herdsman.on('message', (data) => {
            console.log('message '+data.device.ieeeAddr+', lnkq = '+data.linkquality+', interviewCompleted =  '+data.device.interviewCompleted+', interviewing =  '+data.device.interviewing);
            //console.log(data);
            const mappedDevice = zigbeeHerdsmanConverters.findByZigbeeModel(data.device.modelID);
            const can_handle = canHandleEvent(data,mappedDevice);
            console.log('can_handle = '+can_handle);
            //console.log(can_handle);

            if (can_handle) {
                const converters = mappedDevice.fromZigbee.filter((c) => {
                    return c.cluster === data.cluster && (Array.isArray(c.type) ? c.type.includes(data.type) : c.type === data.type);
                });
                console.log('converters.length = '+converters.length);
                for(const converter of converters) {
                    console.log('converter');
                    const converted = converter.convert(mappedDevice, data, console.log, {}, {device: data.device});
                    console.log(converted);
                }
            }
        });
        herdsman.on('error', (error) => {
            console.log('on error');
            console.log(error);
        });

        herdsman.start().then(() => {
            console.log('started');
            herdsman.permitJoin(true).then(() => console.log('permitJoin ok'))
        }, console.error);
        setInterval(async () => {
            try {
                const pj = await herdsman.getPermitJoin();
                console.log(new Date(), 'PERMIT JOIN = '+pj);
            } catch (e) {
                console.log(new Date(), 'PERMIT JOIN ERROR:');
                console.log(e);
            }
        }, 600000)
        // d.interview().then(() => console.log('finished'))
    },
    function(callback) {
        require('events').defaultMaxListeners = 100;
        const path = require('path');
        process.env.ZIGBEE2MQTT_CONFIG = path.resolve('./etc/zigbee2mqtt_configuration.yaml');
        //process.env.DEBUG = '*';
        const { config2smart }  = require('./lib/utils');

        config2smart.init(path.resolve('./temp/2smart.device.json'));

        const ZigbeeBridge = require('./lib/bridge');

        const deviceBridgeConfig = {
            mqttConnection : {
                username : '2smart',
                // password : 'JzbnGLJedjD4ceUb',
                password : '123',
                //uri      : 'mqtt://172.30.106.111'
            },
            herdsman : {
                databasePath: path.resolve('./temp/database.db'),
                databaseBackupPath: path.resolve('./temp/database.db.backup'),
                backupPath: path.resolve('./temp/coordinator_backup.json'),
                serialPort: {
                    // path: 'COM7' || process.env.HEARDSMAN_PATH || undefined
                    //path: 'tcp://192.168.2.166:1775'
                    path: 'tcp://192.168.0.105:1775'
                }
            },
            device : {
                id              : 'zigbeetest',
                name            : 'AZIGBEE',
                zigbeeConnectionIp : '192.168.0.105',
                configPath         : path.resolve('./temp/2smart.device.json')
            }
        };

        let debug = null;

        console.log('DEBUG MODE IS ON');
        const Debugger = require('homie-sdk/lib/utils/debugger');

        debug = new Debugger();

        debug.on('*', (address, message) => {
            console.log(new Date());
            console.log('\x1b[36m%s\x1b[0m', address);
            if (message!==undefined)console.log(message);
        });
        debug.ignore('homie-sdk.*');
        //debug.ignore('NodeBridge.*');
        debug.ignore('DeviceBridge.*');
        debug.ignore('ZigbeeTransport.*');
        debug.ignore('ZigbeeBridge.*');
        try {
            const zigbeeBridge = new ZigbeeBridge({ ...deviceBridgeConfig, debug });

            zigbeeBridge.on('error', (error) => {
                console.error(error);
            });
            zigbeeBridge.on('exit', (reason, exit_code) => {
                console.log(reason);
                process.exit(exit_code);
            });
            zigbeeBridge.init();
        } catch (e) {
            console.log(e);
            process.exit(1);
        }
    },
], function(){
    console.log('finish');
});
