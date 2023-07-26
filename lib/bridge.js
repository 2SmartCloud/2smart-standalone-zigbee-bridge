const _ = require('underscore');
const ZigbeeHerdsman = require('zigbee-herdsman');

const BaseBridge = require('homie-sdk/lib/Bridge/Base');
const BaseDeviceBridge = require('homie-sdk/lib/Bridge/BaseDevice');
const DeviceBridge = require('./device');

const HERDSMAN_CONNECT_INTERVAL = 5000;

class ZigbeeBridge extends BaseBridge {
    constructor(config) {
        super({ ...config, device: null });
        this.handleHerdsmanAdapterDisconnected = this.handleHerdsmanAdapterDisconnected.bind(this);
        this.handleHerdsmanDeviceLeave = this.handleHerdsmanDeviceLeave.bind(this);
        this.handleHerdsmanDeviceJoined = this.handleHerdsmanDeviceJoined.bind(this);
        this.handleHerdsmanDeviceInterview = this.handleHerdsmanDeviceInterview.bind(this);
        this.handleHerdsmanDeviceAnnounce = this.handleHerdsmanDeviceAnnounce.bind(this);
        this.handleHerdsmanMessage = this.handleHerdsmanMessage.bind(this);
        this.handleNodeDelete = this.handleNodeDelete.bind(this);

        this.herdsmanConfig = config.herdsman;
        this.herdsmanStarting = false;
        this.herdsmanStarted = false;

        if (config.device) {
            let deviceBridge = config.device;

            if (!(deviceBridge instanceof BaseDeviceBridge)) deviceBridge = new DeviceBridge({ ...deviceBridge }, { debug: config.debug });
            this.setDeviceBridge(deviceBridge);
        }
    }
    // sync
    init() {
        super.init();
        this.startHerdsman();

        this.homie.on('events.delete.success', this.handleNodeDelete);
    }
    destroy() {
        this.stopHerdsman();
        super.destroy();

        this.homie.off('events.delete.success', this.handleNodeDelete);
    }
    setHerdsman(herdsman) {
        if (this.herdsman) throw new Error('Herdsman is already here.');
        this.herdsman = herdsman;
        this.herdsman.on('error', this.handleErrorPropagate);
        this.herdsman.on('adapterDisconnected', this.handleHerdsmanAdapterDisconnected);
        this.herdsman.on('deviceLeave', this.handleHerdsmanDeviceLeave);
        this.herdsman.on('deviceJoined', this.handleHerdsmanDeviceJoined);
        this.herdsman.on('deviceInterview', this.handleHerdsmanDeviceInterview);
        this.herdsman.on('deviceAnnounce', this.handleHerdsmanDeviceAnnounce);
        this.herdsman.on('message', this.handleHerdsmanMessage);
    }
    async unsetHerdsman() {
        if (!this.herdsman) return;
        this.herdsman.off('error', this.handleErrorPropagate);
        this.herdsman.off('adapterDisconnected', this.handleHerdsmanAdapterDisconnected);
        this.herdsman.off('deviceLeave', this.handleHerdsmanDeviceLeave);
        this.herdsman.off('deviceJoined', this.handleHerdsmanDeviceJoined);
        this.herdsman.off('deviceInterview', this.handleHerdsmanDeviceInterview);
        this.herdsman.off('deviceAnnounce', this.handleHerdsmanDeviceAnnounce);
        this.herdsman.off('message', this.handleHerdsmanMessage);

        const { adapter, permitJoinTimer } = this.herdsman;

        try {
            await adapter.stop();
        } catch (e) {
            if (this.debug) this.debug.warning('ZigbeeBridge.unsetHerdsman.adapter.stop', e);
        }

        /**
         * remove permit join req interval
         * can't use `this.herdsman.permitJoin(false)` in case when znp adapter is not initialized
         */
        if (permitJoinTimer) clearInterval(permitJoinTimer);

        delete this.herdsman;
    }

    async softReset() {
        if (this.debug) this.debug.info('ZigbeeBridge.handleSoftReset', 'Start...');

        try {
            this.herdsmanStarted = false;

            try {
                await this.herdsman.reset('soft');
            } catch (e) {
                if (this.debug) this.debug.warning('ZigbeeBridge.handleSoftReset.resetError', e);
            }
            await this.startHerdsman();
        } catch (e) {
            this.emit('exit', e, 1);
        }

        if (this.debug) this.debug.info('ZigbeeBridge.handleSoftReset', 'Finish');
    }

    resetHerdsmanConnectionTimeout() {
        if (this.debug) this.debug.info('ZigbeeBridge.resetHerdsmanConnectionTimeout');

        clearTimeout(this.herdsmanConnectionTimeout);

        this.herdsmanConnectionTimeout = setTimeout(async () => {
            if (this.debug) this.debug.info('ZigbeeBridge.resetHerdsmanConnectionTimeout.timeout');

            await this.softReset();
        }, 10 * 60 * 1000);
    }

    // async
    async startHerdsman() {
        if (this.herdsman) {
            /**
             * this.herdsman.stop() - caused problem with backup
             * Calling this.herdsman.stop() before initialization will create duplicate Coordinator entry in database.db
             */
            await this.unsetHerdsman();
        }

        if (this.debug) this.debug.info('ZigbeeBridge.startHerdsman');
        if (this.herdsmanStarted || this.herdsmanStarting) return;

        clearTimeout(this.herdsmanStartTimeout);

        this.herdsmanStarting = true;

        try {
            if (this.debug) this.debug.info('ZigbeeBridge.startHerdsman 1');

            this.setHerdsman(new ZigbeeHerdsman.Controller(this.herdsmanConfig));

            await this.herdsman.start();
            await this.herdsman.permitJoin(false);

            this.emit('herdsman.permitjoin', false);

            if (this.debug) this.debug.info('ZigbeeBridge.startHerdsman 3.2');

            this.herdsmanStarted = true;

            this.emit('herdsman.started');

            // start timeout for "soft" reset
            this.resetHerdsmanConnectionTimeout();
        } catch (e) {
            if (this.debug) this.debug.info('ZigbeeBridge.startHerdsman 4');

            this.handleErrorPropagate(e);
            this.herdsmanStartTimeout = setTimeout(this.startHerdsman.bind(this), HERDSMAN_CONNECT_INTERVAL);

            clearTimeout(this.herdsmanConnectionTimeout);

            this.herdsmanStarted = false;

            this.emit('herdsman.stopped');
            this.emit('herdsman.start.error', e);
        }
        this.herdsmanStarting = false;
    }
    async stopHerdsman() {
        try {
            if (this.herdsmanStarting) {
                await new Promise((resolve, reject) => {
                    const onConnectedOrError = () => {
                        clear();
                        resolve();
                    };

                    const clear = () => {
                        this.off('herdsman.started', onConnectedOrError);
                        this.off('herdsman.start.error', onConnectedOrError);
                        clearTimeout(timeout);
                    };

                    this.on('herdsman.started', onConnectedOrError);
                    this.on('herdsman.start.error', onConnectedOrError);
                    // eslint-disable-next-line prefer-const
                    let timeout = setTimeout(() => {
                        clear();
                        reject(new Error('Timeout error on stop zigbee.'));
                    }, HERDSMAN_CONNECT_INTERVAL);
                });
            }
            clearTimeout(this.herdsmanStartTimeout);
            if (!this.herdsmanStarted) return;
            await this.herdsman.stop();
            this.herdsmanStarted = false;
            this.emit('herdsman.stopped');
        } catch (e) {
            this.handleErrorPropagate(e);
            this.emit('exit', e, 1);
        }
    }
    // handlers~
    async handleHerdsmanAdapterDisconnected() {
        if (this.debug) this.debug.info('ZigbeeBridge.handleHerdsmanAdapterDisconnected');
        clearTimeout(this.herdsmanConnectionTimeout);
        this.herdsmanStarted = false;
        this.emit('herdsman.stopped');
        await this.startHerdsman();
    }
    async handleHerdsmanDeviceLeave(data) {
        this.emit('herdsman.deviceLeave', data);
    }
    async handleHerdsmanDeviceJoined(data) {
        this.emit('herdsman.deviceJoined', data);
    }
    async handleHerdsmanDeviceInterview(data) {
        this.emit('herdsman.deviceInterview', data);
    }
    async handleHerdsmanDeviceAnnounce(data) {
        this.emit('herdsman.deviceAnnounce', data);
    }
    async handleHerdsmanMessage(data) {
        this.resetHerdsmanConnectionTimeout();
        this.emit('herdsman.message', data);
    }
    async handleNodeDelete(data) {
        const { type, nodeId } = data;

        if (type === 'NODE') this.emit('homie.node.delete', nodeId);
    }
    // ~handlers
}

module.exports = ZigbeeBridge;
