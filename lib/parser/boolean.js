const _ = require('underscore');
const BaseParser = require('homie-sdk/lib/Bridge/BaseParser');

class BooleanToBufferArray extends BaseParser {
    constructor(conf) {
        conf = (conf === undefined) ? {} : (typeof conf === 'string') ? { type: conf } : conf;
        super(_.defaults(_.clone(conf), {
            homieDataType : 'boolean',
            type          : 'boolean'
        }));
        this.on = ('on' in conf) ? conf.on : true;
        this.off = ('off' in conf) ? conf.off : false;
    }
    fromHomie(data) {
        return [ (data === 'true' || data === true) ? this.on : this.off ];
    }
    toHomie(data) {
        return `${data === this.on}`;
    }
}

module.exports = BooleanToBufferArray;
