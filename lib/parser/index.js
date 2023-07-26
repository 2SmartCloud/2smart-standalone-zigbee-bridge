module.exports = {
    create(config) {
        if (typeof config === 'string') config = { type: config };
        if (config.type === 'index') throw new Error('Bad transport type.');
        const ParserClass = require(`./${config.type}`);

        return new ParserClass({ ...config });
    }
};
