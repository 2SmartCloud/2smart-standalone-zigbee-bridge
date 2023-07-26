const BaseTransport = require('homie-sdk/lib/Bridge/BasePropertyTransport');

class CustomTransport extends BaseTransport {
    constructor(config) {
        super(config);

        if (config.methods) {
            for (const name of Object.keys(config.methods)) {
                this[name] = config.methods[name].bind(this);
            }
        }
        if (config.attachBridge) {
            this._attachBridge = config.attachBridge.bind(this);
        }
        if (config.detachBridge) {
            this._detachBridge = config.detachBridge.bind(this);
        }
    }
    attachBridge(bridge) {
        if (this.bridge) {
            if (bridge === this.bridge) return;
            throw new Error('Another bridge is already attached.');
        }
        super.attachBridge(bridge);
        if (this._attachBridge) this._attachBridge();
    }
    detachBridge() {
        if (this._detachBridge) this._detachBridge();
        super.detachBridge();
    }
    // sync
    // async
    // handlers~
    // ~handlers
}

module.exports = CustomTransport;
