import fs from 'fs';

const CONFIG_PATH = './config.json';

export const State = {
  offlineStations: new Set<string>(),
  timerExtensions: new Map<string, number>(),
  isBotActive: false, // Start with the bot OFF for safety
  
  // Save local configuration to a file so it persists after a restart
  saveConfig: (data: { apiKey: string, slug: string }) => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data));
  },
  
  loadConfig: () => {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
    return null;
  }
};