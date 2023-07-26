const _ = require('underscore');
const BaseParser = require('homie-sdk/lib/Bridge/BaseParser');

class IntegerParser extends BaseParser {
    constructor(conf) {
        conf = (conf === undefined) ? {} : (typeof conf === 'string') ? { type: conf } : conf;
        super(_.defaults(_.clone(conf), {
            homieDataType : 'integer',
            type          : 'integer'
        }));
    }
    fromHomie(data) {
        const result = parseInt(data, 10);

        if (isNaN(result)) throw new Error('Wrong format');
        return [ result ];
    }
    toHomie(data) {
        return `${data}`;
    }
}

module.exports = IntegerParser;
