const _ = require('underscore');
const BaseParser = require('homie-sdk/lib/Bridge/BaseParser');

class RGB2XY extends BaseParser {
    constructor(conf) {
        conf = (conf === undefined) ? {} : (typeof conf === 'string') ? { type: conf } : conf;
        super(_.defaults(_.clone(conf), {
            homieDataType : 'color',
            type          : 'rgb2xy'
        }));
        this.on = ('on' in conf) ? conf.on : true;
        this.off = ('off' in conf) ? conf.off : false;
    }
    fromHomie(data) {
        return [ { rgb: data } ];
    }
    toHomie(data) {
        console.log(data);
        const x = data.x;
        const y = data.y;
        const z = 1-y-x;

        let r = 1.6565*x-0.3549*y-0.2550*z;
        let g = -0.7072*x+1.6554*y+0.0362*z;
        let b = 0.0517*x-0.1214*y+1.0116*z;

        if (r<0) r=0;
        if (g<0) g=0;
        if (b<0) b=0;

        let R = (r>0.0021308)?1.055*Math.pow(r, 1/2.4)-0.055:12.92*r;
        let G = (g>0.0021308)?1.055*Math.pow(g, 1/2.4)-0.055:12.92*g;
        let B = (b>0.0021308)?1.055*Math.pow(b, 1/2.4)-0.055:12.92*b;

        if (R>=1) R=0.9999;
        if (G>=1) G=0.9999;
        if (B>=1) B=0.9999;

        return `${Math.floor(R*256)},${Math.floor(G*256)},${Math.floor(B*256)}`;
    }
}

module.exports = RGB2XY;
