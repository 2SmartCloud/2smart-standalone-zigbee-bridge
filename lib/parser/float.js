const _ = require('underscore');
const BaseParser = require('homie-sdk/lib/Bridge/BaseParser');

class FloatParser extends BaseParser {
    constructor(conf) {
        conf = (conf === undefined) ? {} : (typeof conf === 'string') ? { type: conf } : conf;
        super(_.defaults(_.clone(conf), {
            homieDataType : 'float',
            type          : 'float'
        }));
    }
    fromHomie(data) {
        const result = parseFloat(data);

        if (isNaN(result)) throw new Error('Wrong format');
        return [ result ];
    }
    toHomie(data) {
        return `${data}`;
    }
}

module.exports = FloatParser;
