const Promise = require('bluebird');
const BaseDeviceBridge = require('homie-sdk/lib/Bridge/BaseDevice');
const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
const { CONNECTION_ERROR, UNKNOWN_ERROR } = require('homie-sdk/lib/utils/errors');
const { reporting } = require('./utils/herdsman');
const NodeBridge = require('./node');
const { herdsmanOnEvent, herdsmanShouldConfigure } = require('./utils/herdsman');

const { create : createTransport } = require('./transport');
const { create : createParser } = require('./parser');

const { create : createNode } = NodeBridge;
const PropertyBridge = require('./property');

class DeviceBridge extends BaseDeviceBridge {
    constructor(config, { debug } = {}) {
        super(config, { debug });
        this.handleHerdsmanStarted = this.handleHerdsmanStarted.bind(this);
        this.handleHerdsmanStopped = this.handleHerdsmanStopped.bind(this);
        this.handleHerdsmanDeviceLeave = this.handleHerdsmanDeviceLeave.bind(this);
        this.handleHerdsmanDeviceJoined = this.handleHerdsmanDeviceJoined.bind(this);
        this.handleHerdsmanDeviceInterview = this.handleHerdsmanDeviceInterview.bind(this);
        this.handleHerdsmanDeviceAnnounce = this.handleHerdsmanDeviceAnnounce.bind(this);
        this.handleHerdsmanMessage = this.handleHerdsmanMessage.bind(this);
        this.handleHomieNodeDelete = this.handleHomieNodeDelete.bind(this);

        this.herdsmanConfiguring = {};
        this.herdsmanReporting = {
            configuring    : new Set(),
            failed         : new Set(),
            pollDebouncers : {}
        };

        if (config.zigbeeConnectionIp) {
            this.addTelemetry(new PropertyBridge({
                'id'       : 'ip',
                'unit'     : '',
                'retained' : 'true',
                'settable' : 'false',
                'name'     : 'Ip address',
                'value'    : config.zigbeeConnectionIp
            }, {
                type  : 'telemetry',
                debug : this.debug
            }));
        }
        this.addOption(new PropertyBridge({
            'id'       : 'permitjoin',
            'unit'     : '',
            'retained' : 'true',
            'settable' : 'true',
            'name'     : 'Permit Join'
        }, {
            type      : 'option',
            transport : createTransport({
                type             : 'custom',
                pollInterval     : 0,
                pollErrorTimeout : 10000,
                methods          : {
                    async handleHerdsmanStarted() {
                        this.pulled = false;
                        this.enablePolling();
                    },
                    async handleHerdsmanStopped() {
                        this.pulled = false;
                        this.disablePolling();
                    },
                    async get() {
                        if (!this.bridge.herdsmanStarted) throw new CONNECTION_ERROR('Zigbee is not connected');
                        const data = await this.bridge.herdsman.getPermitJoin();

                        this.handleNewData(data);
                        return data;
                    },
                    async set(value) {
                        if (!this.bridge.herdsmanStarted) throw new CONNECTION_ERROR('Zigbee is not connected');
                        try {
                            await this.bridge.herdsman.permitJoin(value);
                            this.handleNewData(value);
                        } catch (e) {
                            throw new CONNECTION_ERROR({ message: 'Could not update device value', fields: { error: e.message } });
                        }
                        return value;
                    }
                },
                attachBridge(bridge) {
                    this.bridge.on('herdsman.started', this.handleHerdsmanStarted);
                    this.bridge.on('herdsman.stopped', this.handleHerdsmanStopped);
                    this.bridge.on('herdsman.permitjoin', this.handleNewData);
                    if (this.bridge.herdsmanStarted) this.handleHerdsmanStarted();
                },
                detachBridge() {
                    this.disablePolling();
                    this.bridge.off('herdsman.started', this.handleHerdsmanStarted);
                    this.bridge.off('herdsman.stopped', this.handleHerdsmanStopped);
                    this.bridge.off('herdsman.permitjoin', this.handleNewData);
                }
            }),
            parser : createParser({ type: 'boolean' }),
            debug  : this.debug
        }));

        this.addOption(new PropertyBridge({
            'id'       : 'soft-reset',
            'unit'     : '',
            'retained' : 'false',
            'settable' : 'true',
            'name'     : 'Soft reset'
        }, {
            type      : 'option',
            transport : createTransport({
                type    : 'custom',
                methods : {
                    async set(value) {
                        if (!this.bridge.herdsmanStarted) throw new CONNECTION_ERROR('Zigbee is not connected');
                        try {
                            this.bridge.softReset();
                            this.handleNewData(value, true);
                        } catch (e) {
                            throw new CONNECTION_ERROR({ message: 'Device did not respond to soft reset', fields: { error: e.message } });
                        }
                        return value;
                    }
                }
            }),
            parser : createParser({ type: 'boolean' }),
            debug  : this.debug
        }));
    }

    // sync
    attachBridge(bridge) {
        super.attachBridge(bridge);
        this.bridge.on('herdsman.started', this.handleHerdsmanStarted);
        this.bridge.on('herdsman.stopped', this.handleHerdsmanStopped);
        this.bridge.on('herdsman.deviceLeave', this.handleHerdsmanDeviceLeave);
        this.bridge.on('herdsman.deviceJoined', this.handleHerdsmanDeviceJoined);
        this.bridge.on('herdsman.deviceInterview', this.handleHerdsmanDeviceInterview);
        this.bridge.on('herdsman.deviceAnnounce', this.handleHerdsmanDeviceAnnounce);
        this.bridge.on('herdsman.message', this.handleHerdsmanMessage);
        this.bridge.on('homie.node.delete', this.handleHomieNodeDelete);
    }

    detachBridge() {
        this.bridge.off('herdsman.started', this.handleHerdsmanStarted);
        this.bridge.off('herdsman.stopped', this.handleHerdsmanStopped);
        this.bridge.off('herdsman.deviceLeave', this.handleHerdsmanDeviceLeave);
        this.bridge.off('herdsman.deviceJoined', this.handleHerdsmanDeviceJoined);
        this.bridge.off('herdsman.deviceInterview', this.handleHerdsmanDeviceInterview);
        this.bridge.off('herdsman.deviceAnnounce', this.handleHerdsmanDeviceAnnounce);
        this.bridge.off('herdsman.message', this.handleHerdsmanMessage);
        this.bridge.on('homie.node.delete', this.handleHomieNodeDelete);
        super.detachBridge();
    }

    // should be in BridgeSDK
    findNodeById(id) {
        return this.nodes.find((n) => n.id === id);
    }

    findOrAddNewHerdsmanDevice(device) {
        if (this.debug) this.debug.info('DeviceBridge.findOrAddNewHerdsmanDevice');
        let node = this.findNodeById(device.ieeeAddr);

        if (node && (node instanceof NodeBridge)) {
            if (node.deleted) {
                this.removeNode(node.id);
                node = null;
            } else {
                if (device.modelID && !node.modelID) node.setHerdsmanDevice(device);
                return node;
            }
        }

        let homieNode;

        if (node) {
            if (this.debug) this.debug.info('DeviceBridge.findOrAddNewHerdsmanDevice 1');

            homieNode = node.homieEntity;
            node.detachBridge();
            this.removeNode(node.id);

            if (this.debug) this.debug.info('DeviceBridge.findOrAddNewHerdsmanDevice 2');
        } else {
            homieNode = this.homieEntity.nodes.find((n) => n.id === device.ieeeAddr);
        }

        if (this.debug) this.debug.info('DeviceBridge.findOrAddNewHerdsmanDevice 3');

        node = createNode(homieNode, { debug: this.debug, herdsmanDevice: device });

        this.addNode(node);
        return node;
    }
    // async
    async configureHerdsmanDeviceIfNeeded(device) {
        if (!device) return;
        const coordinator = this.bridge.herdsman.getDevicesByType('Coordinator')[0];
        const coordinatorEndpoint = coordinator.getEndpoint(1);
        const mappedDevice = zigbeeHerdsmanConverters.findByDevice(device);

        try {
            if (!herdsmanShouldConfigure(device, mappedDevice) || this.herdsmanConfiguring[device.ieeeAddr]) return;

            this.herdsmanConfiguring[device.ieeeAddr] = true;

            if (this.debug) this.debug.info('DeviceBridge.configureHerdsmanDeviceIfNeeded', `Configuring '${device.ieeeAddr}'`);

            await Promise.race([
                Promise.delay(60000),
                await mappedDevice.configure(device, coordinatorEndpoint)
            ]);

            if (this.debug) this.debug.info('DeviceBridge.configureHerdsmanDeviceIfNeeded', `Successfully configured '${device.ieeeAddr}'`);

            device.meta.configured = mappedDevice.meta.configureKey;
            device.save();
        } catch (e) {
            if (this.debug) this.debug.warning('DeviceBridge.configureHerdsmanDeviceIfNeeded', `Failed to configure '${device.ieeeAddr}'`);
            this.handleErrorPropagate(e);
        }
        delete this.herdsmanConfiguring[device.ieeeAddr];
    }

    async setupHerdsmanReportingIfNeeded(device, messageType) {
        if (this.debug) this.debug.info('DeviceBridge.setupHerdsmanReportingIfNeeded', { modelID: this.modelID });
        if (!device) {
            this.debug.warning('DeviceBridge.setupHerdsmanReportingIfNeeded', 'Device is required for report setup!');
            return;
        }
        const coordinator = this.bridge.herdsman.getDevicesByType('Coordinator')[0];
        const coordinatorEndpoint = coordinator.getEndpoint(1);
        const mappedDevice = zigbeeHerdsmanConverters.findByDevice(device);

        try {
            if (reporting.shouldSetupReporting(mappedDevice, device, messageType)) {
                if (this.debug) this.debug.info('DeviceBridge.setupHerdsmanReportingIfNeeded', `Setup report - ${device.ieeeAddr}`);

                await reporting.setupReporting(device, mappedDevice, coordinatorEndpoint, this.herdsmanReporting.configuring, this.herdsmanReporting.failed);

                if (this.herdsmanReporting.failed.has(device.ieeeAddr)) throw new UNKNOWN_ERROR(`Failed to setup reporting for device '${device.ieeeAddr}'`);

                if (this.debug) this.debug.info('DeviceBridge.setupHerdsmanReportingIfNeeded', `Finish setup report - ${device.ieeeAddr}`);
            }
        } catch (e) {
            if (this.debug) this.debug.warning('DeviceBridge.setupHerdsmanReportingIfNeeded', e);
        }
    }

    // handlers
    async handleHerdsmanStarted() {
        if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanStarted');
        this.connected = true;
        const coordinator = this.bridge.herdsman.getDevicesByType('Coordinator')[0];

        if (this.debug) this.debug.info('BaseDevice.handleHerdsmanStarted', 'Process all devices');

        await Promise.all(this.bridge.herdsman.getDevices().map(async device => {
            if (this.debug) this.debug.info('BaseDevice.handleHerdsmanStarted', `Configure and setup report for - ${device.ieeeAddr}`);
            if (device.ieeeAddr === coordinator.ieeeAddr) return;

            const node = this.findOrAddNewHerdsmanDevice(device);

            await this.configureHerdsmanDeviceIfNeeded(device);
            await this.setupHerdsmanReportingIfNeeded(device, null);

            node.connected = true;
        }));
    }
    async handleHerdsmanStopped() {
        if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanStopped');
        this.connected = false;
    }
    async handleHerdsmanDeviceLeave(data) {
        if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanDeviceLeave', { ieeeAddr: data.ieeeAddr });
        await this.specialHandleHerdsmanEvent(data, 'deviceLeave');

        const node = this.nodes.find((n) => n.id === data.ieeeAddr);

        if (node && (node instanceof NodeBridge)) await node.handleHerdsmanDeviceLeave(data);
    }
    async handleHerdsmanDeviceJoined(data) {
        if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanDeviceJoined', { ieeeAddr: data.device.ieeeAddr });

        await this.specialHandleHerdsmanEvent(data, 'deviceJoined');

        const node = this.findOrAddNewHerdsmanDevice(data.device);

        if (node) await node.handleHerdsmanDeviceJoined(data);
    }
    async handleHerdsmanDeviceInterview(data) {
        const { status, device } = data;

        if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanDeviceInterview', { ieeeAddr: device.ieeeAddr });

        await this.specialHandleHerdsmanEvent(data, 'deviceInterview');

        const node = this.findOrAddNewHerdsmanDevice(device);

        switch (status) {
            case 'failed':
                if (this.debug) this.debug.warning('DeviceBridge.handleHerdsmanDeviceInterview', `Interview failed for - ${device.ieeeAddr}`);
                this.removeNode(node.id);
                device.removeFromDatabase();
                break;
            case 'started':
            case 'successful':
                if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanDeviceInterview', `Interview ${status} for - ${device.ieeeAddr}`);
                await node.handleHerdsmanDeviceInterview({ device });
                break;
            default:
                if (this.debug) this.debug.warning('DeviceBridge.handleHerdsmanDeviceInterview', `Unknown status - ${status}`);
                break;
        }
    }
    async handleHerdsmanDeviceAnnounce(data) {
        const { device } = data;

        if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanDeviceAnnounce', { ieeeAddr: device.ieeeAddr });
        await this.specialHandleHerdsmanEvent(data, 'deviceAnnounce');

        const node = this.findOrAddNewHerdsmanDevice(device);

        // required on announce
        await this.setupHerdsmanReportingIfNeeded(device, 'deviceAnnounce');

        if (node) await node.handleHerdsmanDeviceAnnounce(data);
    }
    async handleHerdsmanMessage(data) {
        if (this.debug) this.debug.info('DeviceBridge.handleHerdsmanMessage', { ieeeAddr: data.device.ieeeAddr });

        await this.specialHandleHerdsmanEvent(data, 'message');

        const node = this.findOrAddNewHerdsmanDevice(data.device);

        if (node) await node.handleHerdsmanMessage(data);
    }

    async specialHandleHerdsmanEvent(data, messageType) {
        // herdsman events~
        try {
            herdsmanOnEvent(messageType, data);
        } catch (e) {
            if (this.debug) this.debug.warning('BaseDevice.specialHandleHerdsmanEvent', 'Failed to use herdsman converters onEvent functions');
            this.handleErrorPropagate(e);
        }
        // ~herdsman events

        // ???
        // maybe move to handleHerdsmanDeviceJoined
        // herdsman configure~
        if (messageType !== 'deviceLeave') {
            if (messageType === 'deviceJoined') {
                if (data.device.meta.hasOwnProperty('configured')) {
                    delete data.device.meta.configured;
                    data.device.save();
                }
            }
            this.configureHerdsmanDeviceIfNeeded(data.device); // no throw function
        }
        // ~herdsman configure
    }

    async handleHomieNodeDelete(nodeId) {
        try {
            const { herdsmanDevice } = this.findNodeById(nodeId);

            if (herdsmanDevice) herdsmanDevice.removeFromDatabase();
            this.removeNode(nodeId);
        } catch (e) {
            if (this.debug) this.debug.warning('BaseDevice.handleHomieNodeDelete', e);
        }
    }
}

module.exports = DeviceBridge;
