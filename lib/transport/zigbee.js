/* eslint-disable no-cond-assign */
const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
const postfixes = require('zigbee2mqtt/lib/util/utils').getEndpointNames();
const BaseTransport = require('homie-sdk/lib/Bridge/BasePropertyTransport');
const { CONNECTION_ERROR, VALIDATION } = require('homie-sdk/lib/utils/errors');
const herdsmanUtils = require('../utils/herdsman');

const isPostfixNumber = /^([0-9]*)$/;

const regexpSREQ = /\(Error: SREQ/;
const regexpErrorDataRequest = /\(Error: SRSP - AF - dataRequest after 6000ms\)/;
const regexpMACnoack = /\(Error: Data request failed with error: 'MAC no ack' \([0-9]+\)\)/;
const regexpRangeError = /\(RangeError \[ERR_OUT_OF_RANGE\]:([^)]+)/;

class ZigbeeTransport extends BaseTransport {
    constructor(config) {
        super(config);
        this.handleHerdsmanStarted = this.handleHerdsmanStarted.bind(this);
        this.handleHerdsmanStopped = this.handleHerdsmanStopped.bind(this);

        this.modelID = config.modelID;
        let key = config.key;
        const device = config.device;
        const mapped = zigbeeHerdsmanConverters.findByDevice(device);
        const endpoints = mapped && mapped.endpoint ? mapped.endpoint(device) : null;
        let endpoint;

        if (key.includes('_')) {
            const underscoreIndex = key.lastIndexOf('_');
            const possiblePostfix = key.substring(underscoreIndex + 1, key.length);

            if (postfixes.includes(possiblePostfix)) {
                const postfix = possiblePostfix;

                key = key.substring(0, underscoreIndex);
                if (isPostfixNumber.exec(postfix)) {
                    endpoint = device.getEndpoint(postfix);
                } else {
                    if (mapped === null) throw new Error(`Postfix '${postfix}' is given but device is unsupported`);
                    if (endpoints === null) throw new Error(`Postfix '${postfix}' is given but device defines no endpoints`);

                    const endpointID = endpoints[postfix];

                    if (!endpointID) throw new Error(`Postfix '${postfix}' is given but device has no such endpoint`);
                    endpoint = device.getEndpoint(endpointID);
                }
            }
        }
        if (!endpoint) {
            if (endpoints && endpoints.default) {
                endpoint = device.getEndpoint(endpoints.default);
            } else {
                endpoint = device.endpoints[0];
            }
        }
        this.key = key;
        this.converter = herdsmanUtils.getToZigbeeConverter(mapped, key);
        this.mapped = mapped;
        this.device = device;
        this.endpoint = endpoint;

        if (this.converter && this.converter.convertGet) {
            this.pollInterval = 0;
            this.pollErrorTimeout = 20000;
        } else {
            this.pollInterval = null;
            this.pollErrorTimeout = 20000;
        }
    }
    // sync
    attachBridge(bridge) {
        if (this.bridge) {
            if (bridge === this.bridge) return;
            throw new Error('Another bridge is already attached.');
        }
        super.attachBridge(bridge);
        this.bridge.on('herdsman.started', this.handleHerdsmanStarted);
        this.bridge.on('herdsman.stopped', this.handleHerdsmanStopped);
        if (this.bridge.herdsmanStarted) this.handleHerdsmanStarted();
    }
    detachBridge() {
        this.disablePolling();

        if (this.bridge) {
            this.bridge.off('herdsman.started', this.handleHerdsmanStarted);
            this.bridge.off('herdsman.stopped', this.handleHerdsmanStopped);
        }

        super.detachBridge();
    }
    // async
    async get() {
        if (!this.bridge.herdsmanStarted) throw new CONNECTION_ERROR('Zigbee is not connected');
        if (!this.converter) throw new Error('No such converter. Cannot get.');
        if (!this.converter.convertGet) throw new Error('convertGet is not supported. Cannot set.');
        const state = {};

        state[this.key] = this.data;

        const meta = {
            device  : this.device,
            state,
            mapped  : this.mapped,
            message : state,
            options : {},
            logger  : {
                warn : (message) => { this.debug.info('ZigbeeTransport.get.meta', message); }
            }
        };

        try {
            await this.converter.convertGet(this.endpoint, this.key, meta);
            this.emit('connected');
        } catch (e) {
            this.emit('disconnected');
        }
    }
    async set(value) {
        if (!this.bridge.herdsmanStarted) throw new CONNECTION_ERROR('Zigbee is not connected');
        if (!this.converter) throw new Error('No such converter. Cannot set.');
        if (!this.converter.convertSet) throw new Error('convertSet is not supported. Cannot set.');
        const state = {};

        state[this.key] = value;

        const meta = {
            device  : this.device,
            state,
            mapped  : this.mapped,
            message : state,
            options : {},
            logger  : {
                warn : (message) => { this.debug.info('ZigbeeTransport.set.meta', message); }
            }
        };

        let result;

        try {
            if (this.debug) this.debug.info('ZigbeeTransport.set 11');
            result = await this.converter.convertSet(this.endpoint, this.key, value, meta);

            if (this.debug) this.debug.info('ZigbeeTransport.set 12', result);
            if (this.debug) this.debug.info('ZigbeeTransport.set 14');
            if (result && result.state && (this.key in result.state)) {
                if (this.debug) this.debug.info('ZigbeeTransport.set 15');
                this.emit('zigbeeData', result.state[this.key]);
                this.handleNewData(result.state[this.key], true);
            } else {
                this.handleNewData(value, true);
                if (this.debug) this.debug.info('ZigbeeTransport.set 16');
                if (this.converter.convertGet) {
                    // this.forceNext = true;
                    await this.converter.convertGet(this.endpoint, this.key, meta);
                }
                if (this.debug) this.debug.info('ZigbeeTransport.set 17');
            }
            this.emit('connected');
        } catch (e) {
            let match;

            if (this.debug) this.debug.info('ZigbeeTransport.set 13', e);
            this.emit('disconnected');
            if (match = regexpRangeError.exec(e.message)) throw new VALIDATION(match[1].trim());

            throw new CONNECTION_ERROR({ message: 'Could not update device value', fields: { error: e.message } });
        }

        return value;
    }
    // handlers~
    async handleHerdsmanStarted() {
        if (this.debug) this.debug.info('ZigbeeTransport.handleHerdsmanStarted');
        this.pulled = false;
        this.enablePolling();
    }
    async handleHerdsmanStopped() {
        if (this.debug) this.debug.info('ZigbeeTransport.handleHerdsmanStopped');
        this.pulled = false;
        this.disablePolling();
    }
    // ~handlers
}

module.exports = ZigbeeTransport;
