const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
const zigbee2mqtt_utils = require('zigbee2mqtt/lib/util/utils');
const DeviceReport = require('zigbee2mqtt/lib/extension/report');

function canHandleEvent(data, mappedDevice, coordinator) {
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
    // eslint-disable-next-line eqeqeq
    // const hasGroupID = data.hasOwnProperty('groupID') && data.groupID != 0;

    if (zigbee2mqtt_utils.isXiaomiDevice(data.device) && data.device.type === 'Router' && data.groupID) {
        console.debug('Skipping re-transmitted Xiaomi message');

        return false;
    }

    if (data.device.modelID === null && data.device.interviewing) {
        console.debug('Skipping message, modelID is undefined and still interviewing');

        return false;
    }

    if (!mappedDevice) {
        console.warn(`Received message from unsupported device with Zigbee model '${data.device.modelID}'`);
        console.warn('Please see: https://www.zigbee2mqtt.io/how_tos/how_to_support_new_devices.html.');

        return false;
    }

    return true;
}
function convertMessage(data, coordinator, publish, options = {}) {
    const mappedDevice = zigbeeHerdsmanConverters.findByDevice(data.device);

    if (!canHandleEvent(data, mappedDevice, coordinator)) return;

    const converters = mappedDevice.fromZigbee.filter((c) => {
        return c.cluster === data.cluster && (Array.isArray(c.type) ? c.type.includes(data.type) : c.type === data.type);
    });

    let converted = {};

    // eslint-disable-next-line no-unused-vars
    for (const converter of converters) {
        converted = {
            ...converted,
            ...converter.convert(
                mappedDevice,
                data,
                publish,
                options,
                {
                    device : data.device,
                    logger : {
                        warn : msg => { console.log(msg); }
                    }
                })
        };
    }
    if (data.linkquality) converted.linkquality = data.linkquality;
    return converted;
}
function getToZigbeeConverter(mapped, key) {
    const res = (mapped && mapped.toZigbee || []).find((c) => {
        return c.key.find((_key) => {
            return (_key === key);
            // if (_key === key) return true;
            // return _key.split('_')[0] === key;
        });
    });

    return res;
}

function herdsmanOnEvent(type, data) {
    if (!data.device) return;

    zigbeeHerdsmanConverters.onEvent(type, data, data.device);

    const mappedDevice = zigbeeHerdsmanConverters.findByDevice(data.device);

    if (mappedDevice && mappedDevice.onEvent) {
        mappedDevice.onEvent(type, data, data.device);
    }
}
function herdsmanShouldConfigure(device, mappedDevice) {
    if (!device || !mappedDevice || !mappedDevice.configure) {
        return false;
    }

    if (device.meta &&
        device.meta.hasOwnProperty('configured') &&
        device.meta.configured === mappedDevice.meta.configureKey) {
        return false;
    }

    if (device.interviewing === true) {
        return false;
    }

    return true;
}

const reporting = {
    shouldIgnoreClusterForDevice(cluster, mappedDevice) {
        return DeviceReport.prototype.shouldIgnoreClusterForDevice.call({}, cluster, mappedDevice);
    },
    shouldSetupReporting(mappedDevice, device, messageType) {
        return DeviceReport.prototype.shouldSetupReporting.call({}, mappedDevice, device, messageType);
    },
    async setupReporting(device, mappedDevice, coordinatorEndpoint, configuring, failed) {
        return DeviceReport.prototype.setupReporting.call({
            configuring                  : configuring || new Set(),
            failed                       : failed || new Set(),
            shouldIgnoreClusterForDevice : reporting.shouldIgnoreClusterForDevice,
            coordinatorEndpoint
        }, device, mappedDevice);
    },
    poll(data, pollDebouncers, herdsman) {
        return DeviceReport.prototype.poll.call({
            pollDebouncers,
            zigbee : { getGroupByID: herdsman.getGroupByID.bind(herdsman) }
        }, data);
    }
};

module.exports = {
    convertMessage,
    getToZigbeeConverter,
    herdsmanOnEvent,
    herdsmanShouldConfigure,
    reporting
};
