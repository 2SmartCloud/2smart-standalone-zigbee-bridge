const BasePropertyBridge = require('homie-sdk/lib/Bridge/BaseProperty');

class PropertyBridge extends BasePropertyBridge {
    /* {
     config,
     { type, transport, parser }
    } */
    constructor(config, { type, transport, parser, debug }) {
        super(config, { type, transport, parser, debug });

        // handlers
        this.handleZigbeeData = this.handleZigbeeData.bind(this);
    }
    // sync
    attachTransport(transport) {
        super.attachTransport(transport);
        transport.on('zigbeeData', this.handleZigbeeData);
    }
    detachTransport() {
        const transport = this.transport;

        transport.off('zigbeeData', this.handleZigbeeData);
        super.detachTransport();
    }
    // async
    // handlers~
    async handleZigbeeData(data) {
        if (this.debug) this.debug.info('PropertyBridge.handleZigbeeData', { id: this.id, data });
        if (!this.node) return;
        const config = this.node.updatePropertyConfigWithZigbeeData(this.id, data);

        if (!config) return;

        if (config.dataType && config.dataType !== this.getAttribute('dataType')) {
            if (this.debug) this.debug.info('PropertyBridge.handleZigbeeData 1', { id: this.id, from: this.getAttribute('dataType'), to: config.dataType });
            this.publishAttribute('dataType', config.dataType);
        }
    }
    // ~handlers
}

module.exports = PropertyBridge;
