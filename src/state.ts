import fs from 'fs';

const CONFIG_PATH = './config.json';

export const State = {
  // Persistence logic
  config: {
    apiKey: '',
    slug: '',
    isConfigured: false
  },
  
  // App Logic State
  offlineStations: new Set<string>(),
  stationZones: new Map<string, string>(), // stationId -> Zone Name
  timerExtensions: new Map<string, number>(),
  isBotActive: false,

  savePersistence() {
    const data = {
      apiKey: this.config.apiKey,
      slug: this.config.slug,
      zones: Array.from(this.stationZones.entries())
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data));
  },

  loadPersistence() {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      this.config.apiKey = data.apiKey;
      this.config.slug = data.slug;
      this.config.isConfigured = !!(data.apiKey && data.slug);
      this.stationZones = new Map(data.zones || []);
      return true;
    }
    return false;
  }
};

State.loadPersistence();