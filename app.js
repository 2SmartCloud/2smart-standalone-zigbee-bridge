require('events').defaultMaxListeners = 100;

const DEBUG_STR = process.env.DEBUG;

delete process.env.DEBUG;

const net = require('net');
const path = require('path');
const fs = require('fs-extra');
const Debugger = require('homie-sdk/lib/utils/debugger');
const { config2smart }  = require('./lib/utils');

const debug = new Debugger(DEBUG_STR || '');

try {
    // eslint-disable-next-line no-sync
    fs.ensureDirSync(path.resolve('./etc/herdsman'));

    config2smart.init(path.resolve('./etc/herdsman/2smart.device.json'));

    process.env.ZIGBEE2MQTT_CONFIG = path.resolve('./etc/zigbee2mqtt_configuration.yaml');

    const ZigbeeBridge = require('./lib/bridge');

    debug.initEvents();

    const herdsmanSerialPort = {
        rtscts : false // https://www.zigbee2mqtt.io/information/cc_sniffer_devices.html#required-configuration-for-cc2530-coordinator
    };

    /**
     * ZIGBEE_CONNECTION_IP is configured from UI and could be a hostname / IP / serial port
     * ZIGBEE_CONNECTION_PATH env for serial port
     */

    let isSerialPort = false;

    if (process.env.ZIGBEE_CONNECTION_IP) isSerialPort = !!process.env.ZIGBEE_CONNECTION_IP.match(/^(COM|\/dev)/g) || false;

    if (isSerialPort) {
        process.env.ZIGBEE_CONNECTION_PATH = process.env.ZIGBEE_CONNECTION_IP;
        process.env.ZIGBEE_CONNECTION_IP = ''; // unset
    }

    debug.info('ZIGBEE.app', { ip: process.env.ZIGBEE_CONNECTION_IP, serial: process.env.ZIGBEE_CONNECTION_PATH, isSerialPort });

    if (process.env.ZIGBEE_CONNECTION_PATH) herdsmanSerialPort.path = process.env.ZIGBEE_CONNECTION_PATH;
    else if (process.env.ZIGBEE_CONNECTION_IP) herdsmanSerialPort.path = `tcp://${process.env.ZIGBEE_CONNECTION_IP}:${process.env.ZIGBEE_CONNECTION_PORT || 1775}`;

    debug.info('ZIGBEE.app', { herdsmanSerialPort });

    const zigbeeChannel = process.env.ZIGBEE_CHANNEL ? [ process.env.ZIGBEE_CHANNEL ] : [ 11 ]; // default -> [ 11 ]

    const deviceBridgeConfig = {
        mqttConnection : {
            username : process.env.MQTT_USER || undefined,
            password : process.env.MQTT_PASS || undefined,
            uri      : process.env.MQTT_URI || undefined
        },
        herdsman : {
            databasePath       : path.resolve('./etc/herdsman/database.db'),
            databaseBackupPath : path.resolve('./etc/herdsman/database.db.backup'),
            backupPath         : path.resolve('./etc/herdsman/coordinator_backup.json'),
            serialPort         : herdsmanSerialPort,
            network            : {
                channelList : zigbeeChannel
            }
        },
        device : {
            id                 : process.env.DEVICE_ID || process.env.MQTT_USER || undefined,
            name               : process.env.DEVICE_NAME || undefined,
            implementation     : process.env.DEVICE_IMPLEMENTATION || undefined,
            mac                : process.env.DEVICE_MAC || undefined,
            firmwareVersion    : process.env.DEVICE_FIRMWARE_VERSION || undefined,
            firmwareName       : process.env.DEVICE_FIRMWARE_NAME || undefined,
            zigbeeConnectionIp : process.env.ZIGBEE_CONNECTION_IP || undefined
        }
    };

    const zigbeeBridge = new ZigbeeBridge({ ...deviceBridgeConfig, debug });

    zigbeeBridge.on('error', (error) => {
        debug.error(error);
    });
    zigbeeBridge.on('exit', (reason, exit_code) => {
        debug.error(reason);
        process.exit(exit_code);
    });
    zigbeeBridge.init();
} catch (e) {
    debug.error(e);

    // delayed process.exit to collect logs with filebeat
    setTimeout(() => process.exit(1), 2000);
}
