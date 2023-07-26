const fs = require('fs-extra');

class Config {
    constructor() {
        this.config = null;
    }
    init(configPath) {
        this.configPath = configPath;
        this.loadConfig();
    }
    loadConfig() {
        if (this.config) return this.config;
        try {
            // eslint-disable-next-line no-sync
            this.config = JSON.parse(fs.readFileSync(this.configPath));
        } catch (e) {
            if (e.code === 'ENOENT') {
                this.config = {};
                this.saveConfig();
            } else throw e;
        }
        return this.config;
    }
    saveConfig() {
        // eslint-disable-next-line no-sync
        fs.writeFileSync(this.configPath, JSON.stringify(this.config||{}, null, 4));
    }
}
module.exports = {
    config2smart : new Config()
};
