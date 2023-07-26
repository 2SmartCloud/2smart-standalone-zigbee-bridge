const fs = require('fs');
const assert = require('assert');

const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');

const settings = require('./settings');

const endpointNames = [
    'left', 'right', 'center', 'bottom_left', 'bottom_right', 'default',
    'top_left', 'top_right', 'white', 'rgb', 'system', 'top', 'bottom', 'center_left', 'center_right',
    'ep1', 'ep2', 'row_1', 'row_2', 'row_3', 'row_4', 'relay',
    'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'
];
const keyEndpointByNumber = new RegExp('.*/([0-9]*)$');

async function createMap(herdsman) {
    const topology = await networkScan(herdsman);
    const res = graphviz(topology);

    try {fs.mkdirSync('debug');} catch (e) {} // eslint-disable-line
    try {fs.mkdirSync(getDirName('./debug/map.log'));} catch (e) {} // eslint-disable-line

    return new Promise((resolve, reject) => {
        fs.writeFile('./debug/map.log', res, (err) => {
            if (err) {
                return reject();
            }

            return resolve();
        });
    });
}

async function networkScan(herdsman, includeRoutes = true) {
    console.log(`Starting network scan (includeRoutes '${includeRoutes}')`);
    const devices = herdsman.getDevices().filter((d) => d.type !== 'GreenPower');
    const lqis = new Map();
    const routingTables = new Map();
    const failed = new Map();

    for (const device of devices.filter((d) => d.type !== 'EndDevice')) {
        failed.set(device, []);
        const resolvedEntity = resolveEntity(herdsman, device);

        try {
            const result = await device.lqi();

            lqis.set(device, result);
            console.log(`LQI succeeded for '${resolvedEntity.name}'`);
        } catch (error) {
            failed.get(device).push('lqi');
            console.log(`Failed to execute LQI for '${resolvedEntity.name}'`);
        }

        if (includeRoutes) {
            try {
                const result = await device.routingTable();

                routingTables.set(device, result);
                console.log(`Routing table succeeded for '${resolvedEntity.name}'`);
            } catch (error) {
                failed.get(device).push('routingTable');
                console.log(`Failed to execute routing table for '${resolvedEntity.name}'`);
            }
        }
    }

    console.log('Network scan finished');

    const networkMap = { nodes: [], links: [] };
    // Add nodes

    for (const device of devices) {
        const resolvedEntity = resolveEntity(herdsman, device);

        networkMap.nodes.push({
            ieeeAddr         : device.ieeeAddr,
            friendlyName     : resolvedEntity.name,
            type             : device.type,
            networkAddress   : device.networkAddress,
            manufacturerName : device.manufacturerName,
            modelID          : device.modelID,
            failed           : failed.get(device),
            lastSeen         : device.lastSeen
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
                source         : { ieeeAddr: neighbor.ieeeAddr, networkAddress: neighbor.networkAddress },
                target         : { ieeeAddr: device.ieeeAddr, networkAddress: device.networkAddress },
                linkquality    : neighbor.linkquality,
                depth          : neighbor.depth,
                routes         : [],
                // DEPRECATED:
                sourceIeeeAddr : neighbor.ieeeAddr,
                targetIeeeAddr : device.ieeeAddr,
                sourceNwkAddr  : neighbor.networkAddress,
                lqi            : neighbor.linkquality,
                relationship   : neighbor.relationship
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
function resolveEntity(herdsman, key) {
    assert(
        typeof key === 'string' || typeof key === 'number' ||
        key.constructor.name === 'Device', `Wrong type '${typeof key}'`,
    );

    if (typeof key === 'string' || typeof key === 'number') {
        if (typeof key === 'number') {
            key = key.toString();
        }

        if (typeof key === 'string' && key.toLowerCase() === 'coordinator') {
            const coordinator = herdsman.getDevicesByType('Coordinator')[0];

            return {
                type     : 'device',
                device   : coordinator,
                endpoint : coordinator.getEndpoint(1),
                settings : { friendlyName: 'Coordinator' },
                name     : 'Coordinator'
            };
        }

        let endpointKey = endpointNames.find((p) => key.endsWith(`/${p}`));
        const endpointByNumber = key.match(keyEndpointByNumber);

        if (!endpointKey && endpointByNumber) {
            endpointKey = Number(endpointByNumber[1]);
        }
        if (endpointKey) {
            key = key.replace(`/${endpointKey}`, '');
        }

        const entity = settings.getEntity(key);

        if (!entity) {
            return null;
        } else if (entity.type === 'device') {
            const device = herdsman.getDeviceByIeeeAddr(entity.ID);

            if (!device) {
                return null;
            }

            const definition = zigbeeHerdsmanConverters.findByDevice(device);
            const endpoints = definition && definition.endpoint ? definition.endpoint(device) : null;
            let endpoint;

            if (endpointKey) {
                if (endpointByNumber) {
                    endpoint = device.getEndpoint(endpointKey);
                } else {
                    assert(definition !== null, `Endpoint name '${endpointKey}' is given but device is unsupported`);
                    assert(endpoints !== null, `Endpoint name '${endpointKey}' is given but no endpoints defined`);
                    const endpointID = endpoints[endpointKey];

                    assert(endpointID, `Endpoint name '${endpointKey}' is given but device has no such endpoint`);
                    endpoint = device.getEndpoint(endpointID);
                }
            } else if (endpoints && endpoints.default) {
                endpoint = device.getEndpoint(endpoints.default);
            } else {
                endpoint = device.endpoints[0];
            }

            return {
                type : 'device', device, endpoint, settings : entity, name : entity.friendlyName, definition
            };
        }
        let group = herdsman.getGroupByID(entity.ID);

        if (!group) group = herdsman.createGroup(entity.ID);
        return { type: 'group', group, settings: entity, name: entity.friendlyName };
    }
    const setting = settings.getEntity(key.ieeeAddr);

    return {
        type       : 'device',
        device     : key,
        endpoint   : key.endpoints[0],
        settings   : setting,
        name       : setting ? setting.friendlyName : (key.type === 'Coordinator' ? 'Coordinator' : key.ieeeAddr),
        definition : zigbeeHerdsmanConverters.findByDevice(key)
    };
}

function graphviz(topology) {
    const colors = {
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
    };

    let text = 'digraph G {\nnode[shape=record];\n';
    let style = '';

    topology.nodes.forEach((device) => {
        const labels = [];

        // Add friendly name
        labels.push(`${device.friendlyName}`);

        // Add the device short network address, ieeaddr and scan note (if any)
        labels.push(
            `${device.ieeeAddr} (${device.nwkAddr})${
                (device.failed && device.failed.length) ? `failed: ${device.failed.join(',')}` : ''}`,
        );

        // Add the device model
        if (device.type !== 'Coordinator') {
            const definition = zigbeeHerdsmanConverters.findByDevice(device);

            if (definition) {
                labels.push(`${definition.vendor} ${definition.description} (${definition.model})`);
            } else {
                // This model is not supported by zigbee-herdsman-converters, add zigbee model information
                labels.push(`${device.manufName} ${device.modelId}`);
            }
        }

        // Add the device last_seen timestamp
        let lastSeen = 'unknown';
        const date = device.type === 'Coordinator' ? Date.now() : device.lastSeen;

        if (date) {
            lastSeen = new Date(date);
        }

        labels.push(lastSeen);

        // Shape the record according to device type
        if (device.type === 'Coordinator') {
            style = `style="bold, filled", fillcolor="${colors.fill.coordinator}", ` +
                `fontcolor="${colors.font.coordinator}"`;
        } else if (device.type === 'Router') {
            style = `style="rounded, filled", fillcolor="${colors.fill.router}", ` +
                `fontcolor="${colors.font.router}"`;
        } else {
            style = `style="rounded, dashed, filled", fillcolor="${colors.fill.enddevice}", ` +
                `fontcolor="${colors.font.enddevice}"`;
        }

        // Add the device with its labels to the graph as a node.
        text += `  "${device.ieeeAddr}" [${style}, label="{${labels.join('|')}}"];\n`;

        /**
         * Add an edge between the device and its child to the graph
         * NOTE: There are situations where a device is NOT in the topology, this can be e.g.
         * due to not responded to the lqi scan. In that case we do not add an edge for this device.
         */
        topology.links.filter((e) => (e.source.ieeeAddr === device.ieeeAddr)).forEach((e) => {
            const routersCount = e.routes.length;
            const lineStyle = (device.type === 'EndDevice') ? 'penwidth=1, ' :
                !routersCount ? 'penwidth=0.5, ' : 'penwidth=2, ';
            const lineWeight = !routersCount ? `weight=0, color="${colors.line.inactive}", ` :
                `weight=1, color="${colors.line.active}", `;
            const textRoutes = e.routes.map((r) => r.destinationAddress);
            const lineLabels = !routersCount ? `label="${e.linkquality}"` :
                `label="${e.linkquality} (routes: ${textRoutes.join(',')})"`;

            text += `  "${device.ieeeAddr}" -> "${e.target.ieeeAddr}"`;
            text += ` [${lineStyle}${lineWeight}${lineLabels}]\n`;
        });
    });

    text += '}';

    return text.replace(/\0/g, '');
}

module.exports = { createMap };
