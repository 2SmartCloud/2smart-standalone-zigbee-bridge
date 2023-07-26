FROM node:12.5-alpine

RUN apk update \
    && apk add bash git make gcc g++ python linux-headers udev \
    && npm install serialport --build-from-source

COPY etc/node_mapping.json etc/node_mapping.json
COPY etc/zigbee2mqtt_configuration.yaml etc/zigbee2mqtt_configuration.yaml
COPY lib lib
COPY package.json package.json
COPY package-lock.json package-lock.json
COPY app.js app.js

RUN npm i --production

CMD npm start