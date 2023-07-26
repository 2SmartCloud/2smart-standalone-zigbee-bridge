/* eslint-disable no-cond-assign */
const _ = require('underscore');
const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
const zigbee2mqtt_homeassistant_mapping = require('zigbee2mqtt/lib/extension/homeassistant').prototype._getMapping();
const BaseNodeBridge = require('homie-sdk/lib/Bridge/BaseNode');
const Property = require('homie-sdk/lib/Property');
const BasePropertyBridge = require('homie-sdk/lib/Bridge/BaseProperty');
const nodeMapping = require('../etc/node_mapping');
const herdsmanUtils = require('./utils/herdsman');
const { config2smart } = require('./utils');
const { create : createTransport } = require('./transport');
const CustomTransport = require('./transport/custom');
const { create : createParser } = require('./parser');
const PropertyBridge = require('./property');

function key2id(key) {
    return key.replace(/_/g, '-');
}
// next function maybe source of errors, when key contains -
function id2key(id) {
    return id.replace(/-/g, '_');
}
function getTypeAndIdOfIdOfHerdsmanOptionProperty(id) {
    id = id.split('-');

    const type = id.pop();

    id = id.join('-');
    if ([ 'illuminance', 'illuminance-lux', 'pressure', 'illuminance', 'temperature', 'humidity' ].includes(id)
        && [ 'precision', 'calibration' ].includes(type)) {
        return { id, type };
    }
    return null;
}
function isBasePropertyFromSDK(property) {
    return property && property.transport && [ 'base_transport', 'static' ].includes(property.transport.type);
}
function get2smartMappedNode(modelID) {
    let mappednode = nodeMapping.nodes[modelID];

    if (!mappednode) return mappednode;
    mappednode = {
        extensions : {},
        sensors    : [],
        telemetry  : [],
        options    : [],
        ...mappednode
    };
    mappednode.telemetry = mappednode.telemetry.map((p) => { return { ...p }; });
    mappednode.options = mappednode.options.map((p) => { return { ...p }; });
    mappednode.sensors = mappednode.sensors.map((p) => { return { ...p }; });

    if (mappednode.extensions.mapping) {
        // eslint-disable-next-line more/no-duplicated-chains
        for (const key of Object.keys(mappednode.extensions.mapping)) {
            const keys = key.split('/');
            const value = mappednode.extensions.mapping[key];

            let properties;
            let id;

            if (keys[0] === '$options') {
                properties = mappednode.options;
                id = keys[1];
            } else if (keys[0] === '$telemetry') {
                properties = mappednode.telemetry;
                id = keys[1];
            } else {
                properties = mappednode.sensors;
                id = keys[0];
            }
            const ind = properties.findIndex((p) => p.id === id);
            const property = { id, ...value, ...properties[ind] };

            if (ind === -1) properties.push(property);
            else properties[ind] = property;
        }
    }
    return mappednode;
}
function isIgnoredSensor(deviceId, sensorId) {
    const config = get2smartMappedNode(deviceId);

    return config && config.ignoreSensors && config.ignoreSensors.includes(sensorId);
}
class NodeBridge extends BaseNodeBridge {
    constructor(config, { debug } = {}) {
        super(config, { debug });
        this.modelID = null;
        this.handleHerdsmanDeviceLeave = this.handleHerdsmanDeviceLeave.bind(this);
        this.handleHerdsmanDeviceJoined = this.handleHerdsmanDeviceJoined.bind(this);
        this.handleHerdsmanDeviceInterview = this.handleHerdsmanDeviceInterview.bind(this);
        this.handleHerdsmanDeviceAnnounce = this.handleHerdsmanDeviceAnnounce.bind(this);
        this.handleHerdsmanMessage = this.handleHerdsmanMessage.bind(this);

        let data;

        for (const property of [ ...this.sensors, ...this.options, ...this.telemetry ]) {
            if (isBasePropertyFromSDK(property) && (data = getTypeAndIdOfIdOfHerdsmanOptionProperty(property.id))) {
                this.getOrCreateHerdsmanOptionProperty(data.id, data.type);
            }
        }
    }
    // sync
    setHerdsmanDevice(device) {
        if (this.debug) this.debug.info('NodeBridge.setHerdsmanDevice');
        const modelID = device.modelID;

        if (this.modelID === modelID) return;
        if (this.modelID) throw new Error('modelID is already set.');
        this.herdsmanDevice = device;
        this.modelID = modelID;

        if (this.debug) this.debug.info('NodeBridge.setHerdsmanDevice 1');
        // mapping
        const zhc_mapped = zigbeeHerdsmanConverters.findByDevice(device);

        if (this.debug) this.debug.info('NodeBridge.setHerdsmanDevice 1.1', `modelID = ${ modelID}`);
        if (this.debug) this.debug.info('NodeBridge.setHerdsmanDevice 1.2', 'zhc_mapped = ', zhc_mapped);
        let ha_mapped;

        if (zhc_mapped) ha_mapped = zigbee2mqtt_homeassistant_mapping[zhc_mapped.model];
        const mapped = get2smartMappedNode(modelID);

        // node attributes
        const toUpdate = _.pick(mapped, 'name', 'value', '');

        if (zhc_mapped) {
            if (toUpdate.type && zhc_mapped.model) toUpdate.type = zhc_mapped.model;

            if (!toUpdate.name) {
                let name = '';

                if (zhc_mapped.vendor) name +=zhc_mapped.vendor;
                if (zhc_mapped.model) if (name) name += ` (${zhc_mapped.model})`; else name += zhc_mapped.model;
                if (name) toUpdate.name = name;
            }
            for (const key of Object.keys(toUpdate)) this.publishAttribute(key, toUpdate[key]);
        } else {
            this.publishAttribute('name', `Unknown model(${modelID})`);
            return;
        }

        for (const key of Object.keys(toUpdate)) this.publishAttribute(key, toUpdate[key]);

        this.modelID = modelID;

        // node properties
        if (mapped) {
            if (mapped.options) for (const p of mapped.options) this.getOrCreateHerdsmanProperty(p.id, 'option');
            if (mapped.telemetry) for (const p of mapped.telemetry) this.getOrCreateHerdsmanProperty(p.id, 'telemetry');
            if (mapped.sensors) for (const p of mapped.sensors) this.getOrCreateHerdsmanProperty(p.id, 'sensor');
        }
        if (ha_mapped) {
            const regexp = /{{.*value_json\.([A-Za-z][A-Za-z_0-9]*).*}}/;

            for (const p of ha_mapped) {
                let key = regexp.exec(p.discovery_payload && p.discovery_payload.value_template);

                key = key && key[1];
                // ignore sensor if specified
                if (key) this.getOrCreateHerdsmanProperty(key2id(key));
            }
        }
        if (zhc_mapped && zhc_mapped.toZigbee) {
            for (const c of zhc_mapped.toZigbee) {
                if (c.attr && c.attr.length === 0) continue;
                for (const key of c.key) {
                    // ignore sensor if specified
                    this.getOrCreateHerdsmanProperty(key2id(key));
                }
            }
        }

        this.emit('modelIdDiscovered', this.modelID);
    }
    // eslint-disable-next-line complexity
    getOrCreateHerdsmanProperty(id, type, value, mapped, homeassistant_mapped, settable) {
        if (this.debug) this.debug.info('NodeBridge.getOrCreateHerdsmanProperty', { id });

        if (!this.modelID) return;

        // check for ignored sensor
        if (isIgnoredSensor(this.modelID, id)) return;
        const deviceMapped = zigbeeHerdsmanConverters.findByDevice(this.herdsmanDevice);
        let property;

        // check if we already have this property
        if (mapped === undefined) {
            const mappednode = get2smartMappedNode(this.modelID);

            if (mappednode) {
                if (mapped = mappednode.sensors.find(({ id: _id }) => _id === id)) type = type || 'sensor';
                else if (mapped = mappednode.telemetry.find(({ id: _id }) => _id === id)) type = type || 'telemetry';
                else if (mapped = mappednode.options.find(({ id: _id }) => _id === id)) type = type || 'option';
            }
        }
        // default telemetry
        if ([ 'battery', 'voltage', 'linkquality' ].includes(id)) type = 'telemetry';

        if (property === undefined) {
            if ((!type || type === 'sensor') && (property = this.sensors.find(({ id: _id }) => _id === id))) type = type || 'sensor';
            else if ((!type || type === 'telemetry') && (property = this.telemetry.find(({ id: _id }) => _id === id))) type = type || 'telemetry';
            else if ((!type || type === 'option') && (property = this.options.find(({ id: _id }) => _id === id))) type = type || 'option';
        }
        if (property && (property instanceof PropertyBridge && property.transport.type === 'zigbee')) {
            return property;
        }
        if (this.debug) this.debug.info('NodeBridge.getOrCreateHerdsmanProperty 4', homeassistant_mapped);
        if (deviceMapped && homeassistant_mapped === undefined) {
            homeassistant_mapped = zigbee2mqtt_homeassistant_mapping[deviceMapped.model];
            const regexp = /{{.*value_json\.([A-Za-z][A-Za-z_0-9]*).*}}/;

            if (homeassistant_mapped) {
                homeassistant_mapped = homeassistant_mapped.find((p) => {
                    let key = regexp.exec(p.discovery_payload && p.discovery_payload.value_template);

                    key = key && key[1];
                    return key && (key2id(key) === id);
                });
            }
        }
        let key;

        if (deviceMapped && settable === undefined) {
            const converter = (deviceMapped && deviceMapped.toZigbee || []).find((c) => {
                return c.key.find((k) => key2id(k) === id);
            });

            settable = !!converter;
            if (converter) key = converter.key.find((k) => key2id(k) === id);
        }
        key = key || id2key(id);


        type = type || 'sensor';

        let parser = null;
        let toUpdate = {
            name     : id.split(/[_-]/).map((s) => s[0].toUpperCase()+s.slice(1)).join(' '),
            settable : settable?'true':'false'
        };

        if (id === 'selftest') {
            toUpdate = {
                ...toUpdate,
                'dataType' : 'boolean',
                'settable' : 'true',
                'retained' : 'false'
            };
        } else if ([ 'click', 'action', 'side', 'angle' ].includes(id)) {
            toUpdate.retained = 'false';
        } else if (id === 'color') {
            toUpdate = {
                ...toUpdate,
                'dataType' : 'color',
                'format'   : 'rgb'
            };
            parser = createParser('rgb2xy');
        }

        if (homeassistant_mapped) {
            if (homeassistant_mapped.type === 'binary_sensor' || homeassistant_mapped.type === 'switch') {
                toUpdate.dataType = 'boolean';
                parser = { type: 'boolean' };
                if (homeassistant_mapped.discovery_payload) {
                    if ('payload_on' in homeassistant_mapped.discovery_payload) parser.on = homeassistant_mapped.discovery_payload.payload_on;
                    if ('payload_off' in homeassistant_mapped.discovery_payload) parser.off = homeassistant_mapped.discovery_payload.payload_off;
                }
                parser = createParser(parser);
            }
            else if (homeassistant_mapped.type === 'sensor' && homeassistant_mapped.discovery_payload && homeassistant_mapped.discovery_payload.unit_of_measurement) toUpdate.dataType = 'float';
            else toUpdate.dataType = 'string';

            // eslint-disable-next-line more/no-duplicated-chains
            if (homeassistant_mapped.discovery_payload && homeassistant_mapped.discovery_payload.unit_of_measurement) toUpdate.unit = homeassistant_mapped.discovery_payload.unit_of_measurement;
        }

        if (mapped && mapped.dataTypeBridge) {
            parser = createParser(mapped.dataTypeBridge);
            toUpdate.dataType = parser.homieDataType;
        }

        value = value || toUpdate.value;

        delete toUpdate.value;

        if (value) this.updatePropertyConfigWithZigbeeData(id, value);

        const propertyConfig = this.getPropertyConfig(id);

        toUpdate = { ...toUpdate, ..._.pick(propertyConfig, 'dataType', 'settable', 'name', 'retained', 'format'), ..._.pick(mapped, 'dataType', 'settable', 'name', 'retained', 'format') };
        let homieProperty;

        if (property) {
            homieProperty = property.homieEntity;
            if (property.bridge) property.detachBridge();

            if (property.type === 'sensor') this.removeSensor(property.id);
            else if (property.type === 'option') this.removeOption(property.id);
            else if (property.type === 'telemetry') this.removeTelemetry(property.id);
            homieProperty.updateAttribute(toUpdate);
        } else {
            if (type === 'sensor') homieProperty = this.homieEntity.sensors.find((p) => p.id === id);
            else if (type === 'option') homieProperty = this.homieEntity.options.find((p) => p.id === id);
            else if (type === 'telemetry') homieProperty = this.homieEntity.telemetry.find((p) => p.id === id);
            if (homieProperty) homieProperty.updateAttribute(toUpdate);
            else homieProperty = { ...toUpdate, id };
        }

        property = new PropertyBridge(homieProperty, {
            type,
            transport         : createTransport({ type: 'zigbee', pollInterval: null, key, modelID: this.modelID,  data: value || null, device: this.herdsmanDevice, debug: this.debug }),
            parser,
            debug             : this.debug,
            dynamicAttributes : mapped && mapped.extensions && mapped.extensions.dynamicProperies === false
        });

        if (type === 'sensor') this.addSensor(property);
        else if (type === 'option') this.addOption(property);
        else if (type === 'telemetry') this.addTelemetry(property);

        for (const k of Object.keys(toUpdate)) property.publishAttribute(k, toUpdate[k], true);

        return property;
    }
    getOrCreateHerdsmanOptionProperty(id, herdsman_converter_option_type) {
        const option_id = `${id}-${herdsman_converter_option_type}`;
        let property = [ ...this.sensors, ...this.telemetry, ...this.options ].find(({ id: _id }) => _id === option_id);

        if (property) {
            if (property.transport.type === 'herdsman_converter_option') {
                return property;
                // eslint-disable-next-line more/no-duplicated-chains
            } else if (!isBasePropertyFromSDK(property)) {
                return null;
            } // skip if it was not created by sdk
        }

        let homieProperty;

        const toUpdate = {
            'unit'     : '',
            'retained' : 'true',
            'settable' : 'true',
            'name'     : `${id.split(/[_-]/).map((s) => s[0].toUpperCase()+s.slice(1)).join(' ')} ${herdsman_converter_option_type}`
        };
        const option_type = (property)?property.type:'option';

        // default values should be the same as in zigbee-converters
        if (herdsman_converter_option_type === 'precision') {
            toUpdate.dataType = 'enum';
            toUpdate.format = '0,1,2';
        } else if (herdsman_converter_option_type === 'calibration') {
            toUpdate.dataType = 'float';
        } else {
            toUpdate.dataType = 'string';
        }
        if (property) {
            homieProperty = property.homieEntity;
            if (property.bridge) property.detachBridge();

            if (property.type === 'sensor') this.removeSensor(property.id);
            else if (property.type === 'option') this.removeOption(property.id);
            else if (property.type === 'telemetry') this.removeTelemetry(property.id);
            homieProperty.updateAttribute(toUpdate);
        } else {
            if (option_type === 'sensor') homieProperty = this.homieEntity.sensors.find((p) => p.id === option_id);
            else if (option_type === 'option') homieProperty = this.homieEntity.options.find((p) => p.id === option_id);
            else if (option_type === 'telemetry') homieProperty = this.homieEntity.telemetry.find((p) => p.id === option_id);
            if (homieProperty) homieProperty.updateAttribute(toUpdate);
            else homieProperty = { ...toUpdate, id: option_id };
        }

        let value = null;
        let parser = null;

        if (herdsman_converter_option_type === 'precision') {
            const defaultPrecision = {
                temperature : 2,
                humidity    : 2,
                pressure    : 1
            };

            if ([ 0, 1, 2, '1', '2', '3' ].includes(homieProperty.value)) value = parseInt(homieProperty.value, 10);
            else value = defaultPrecision[id] || 0;
            parser = createParser({ type: 'integer' });
        } else if (herdsman_converter_option_type === 'calibration') {
            value = parseFloat(homieProperty.value);
            if (isNaN(value)) value = 0;

            parser = createParser({ type: 'float' });
        } else {
            value = homieProperty.value || 0;
        }

        const node = this;

        property = new BasePropertyBridge(homieProperty, {
            type      : option_type,
            transport : new CustomTransport({
                type             : 'herdsman_converter_option',
                pollInterval     : 0,
                pollErrorTimeout : 10000,
                data             : value,
                methods          : {
                    async get() {
                        this.handleNewData(this.data || 0);

                        return this.data;
                    },
                    async set(data) {
                        if (!this.zigbeeData) throw new Error('Please, wait for data changes');
                        this.handleNewData(data, true);
                        node.handleHerdsmanMessage(this.zigbeeData);
                    },
                    setDataFromZigbee(data) {
                        this.zigbeeData = data;
                    }
                },
                attachBridge(bridge) {
                    this.enablePolling();
                },
                detachBridge() {
                    this.disablePolling();
                },
                debug : this.debug
            }),
            parser,
            debug : this.debug
        });

        if (option_type === 'sensor') this.addSensor(property);
        else if (option_type === 'option') this.addOption(property);
        else if (option_type === 'telemetry') this.addTelemetry(property);

        for (const k of Object.keys(toUpdate)) property.publishAttribute(k, toUpdate[k], true);
    }
    updatePropertyConfigWithZigbeeData(propertyId, data) {
        const config = this.getPropertyConfig(propertyId);

        if (!config) return;
        if (typeof data === 'number' && config.dataType !== 'float') {
            config.dataType = 'float';
            this.savePropertyConfig(propertyId, config);
        }

        return config;
    }
    getPropertyConfig(propertyId) {
        if (!this.modelID) return;

        const config = config2smart.config.models;

        return config && config[this.modelID] && config[this.modelID][propertyId] || {};
    }
    savePropertyConfig(propertyId, propertyConfig) {
        if (!this.modelID) return;
        let config = config2smart.config;

        config.models = config.models || {};

        config = config.models;
        config[this.modelID] = config[this.modelID] || {};

        config = config[this.modelID];
        config[propertyId] = propertyConfig;
        config2smart.saveConfig();
    }
    // async
    // handlers~
    async handleHerdsmanDeviceLeave({ ieeeAddr }) {
        // if (this.id !== ieeeAddr) return;
        if (this.debug) this.debug.info('NodeBridge.handleHerdsmanDeviceLeave', { ieeeAddr });
        this.connected = false;
    }
    async handleHerdsmanDeviceJoined({ device }) {
        // if (this.id !== device.ieeeAddr) return;
        if (this.debug) this.debug.info('NodeBridge.handleHerdsmanDeviceJoined', { ieeeAddr: device.ieeeAddr });
        this.connected = (device.interviewCompleted) ? true : null;
    }
    async handleHerdsmanDeviceInterview({ device }) {
        // if (this.id !== device.ieeeAddr) return;
        if (this.debug) this.debug.info('NodeBridge.handleHerdsmanDeviceInterview', { ieeeAddr: device.ieeeAddr });
        this.connected = (device.interviewCompleted) ? true : null;
    }
    async handleHerdsmanDeviceAnnounce({ device }) {
        // if (this.id !== device.ieeeAddr) return;
        if (this.debug) this.debug.info('NodeBridge.handleHerdsmanDeviceAnnounce', { ieeeAddr: device.ieeeAddr });
        this.connected = (device.interviewCompleted) ? true : null;
    }
    async handleHerdsmanMessage(data) {
        // if (this.id !== data.device.ieeeAddr) return;
        if (this.debug) this.debug.info('NodeBridge.handleHerdsmanMessage', data);

        /*
        if (!data.device.modelID) {
            try {
                if (data.device.interviewing) {
                    await new Promise((resolve, reject) => {
                        const clear = () => {
                            clearTimeout(timeout);
                            this.off('modelIdDiscovered', func);
                        };
                        const func = (modelID) => {
                            resolve(modelID);
                        };

                        // eslint-disable-next-line prefer-const
                        let timeout = setTimeout(() => {
                            clear();
                            reject(new Error('Timeout error while waiting for modelID.'));
                        }, 10000);

                        this.on('modelIdDiscovered', func);
                    });
                } else {
                    await data.device.interview();
                }
                if (this.bridge) {
                    const device = this.bridge.herdsman.getDeviceByIeeeAddr(data.device.ieeeAddr);

                    if (device) data.device = device;
                }
            } catch (e) {
                this.handleErrorPropagate(e);
                return;
            }
        }
        */

        const publish = async (converted) => {
            if (this.debug) this.debug.info('NodeBridge.handleHerdsmanMessage 2', converted);

            if (converted) {
                for (const key of Object.keys(converted)) {
                    if ((typeof converted[key] === 'number') && isNaN(converted[key])) continue;
                    const id  = key.replace(/_/g, '-');
                    const property = this.getOrCreateHerdsmanProperty(id, null, converted[key]);

                    if (property) {
                        if (this.bridge && this.bridge.homie &&  this.bridge.homie.synced
                            && [ 'illuminance', 'illuminance-lux', 'pressure', 'illuminance', 'temperature', 'humidity' ].includes(id)) {
                            let optionProperty;

                            optionProperty = this.getOrCreateHerdsmanOptionProperty(id, 'precision');
                            if (optionProperty && optionProperty.transport.type === 'herdsman_converter_option') optionProperty.transport.setDataFromZigbee(data);

                            optionProperty = this.getOrCreateHerdsmanOptionProperty(id, 'calibration');
                            // eslint-disable-next-line more/no-duplicated-chains
                            if (optionProperty && optionProperty.transport.type === 'herdsman_converter_option') optionProperty.transport.setDataFromZigbee(data);
                        }
                        await property.handleZigbeeData(converted[key]);
                        await property.transport.handleNewData(converted[key], true);
                    }
                }
            }
        };

        const options = {};

        for (const property of [ ...this.sensors, ...this.options, ...this.telemetry ]) {
            if (getTypeAndIdOfIdOfHerdsmanOptionProperty(property.id) && property.transport.type === 'herdsman_converter_option') {
                options[id2key(property.id)] = property.transport.data;
            }
        }
        const converted = herdsmanUtils.convertMessage(data, this.bridge.herdsman.getDevicesByType('Coordinator')[0], publish, options);

        await publish(converted);
    }
    addSensor(property) {
        let data;

        if ((property instanceof Property) && (data = getTypeAndIdOfIdOfHerdsmanOptionProperty(property.id))) {
            this.getOrCreateHerdsmanOptionProperty(data.id, data.type);

            return;
        }
        super.addSensor(property);
    }
    addOption(property) {
        let data;

        if ((property instanceof Property) && (data = getTypeAndIdOfIdOfHerdsmanOptionProperty(property.id))) {
            this.getOrCreateHerdsmanOptionProperty(data.id, data.type);

            return;
        }
        super.addOption(property);
    }
    addTelemetry(property) {
        let data;

        if ((property instanceof Property) && (data = getTypeAndIdOfIdOfHerdsmanOptionProperty(property.id))) {
            this.getOrCreateHerdsmanOptionProperty(data.id, data.type);

            return;
        }
        super.addTelemetry(property);
    }
}

NodeBridge.create = function (config={}, options) {
    const { herdsmanDevice } = options;

    delete options.herdsmanDevice;

    if (herdsmanDevice) config.id = herdsmanDevice.ieeeAddr;

    const node = new NodeBridge(config, options);

    if (herdsmanDevice) {
        if (herdsmanDevice.modelID) node.setHerdsmanDevice(herdsmanDevice);
        // if (herdsmanDevice.interviewCompleted) node.connected = true;
    }

    return node;
};

module.exports = NodeBridge;
