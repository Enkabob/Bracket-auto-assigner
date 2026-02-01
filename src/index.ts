import { StartGGClient } from './api';
import { processMatches } from './engine';
import { TOURNAMENT_QUERY } from './queries';
import { CONFIG } from './config';
import Table from 'cli-table3';

const client = new StartGGClient(CONFIG.API_KEY);

async function mainLoop() {
  try {
    const data = await client.query(TOURNAMENT_QUERY, { slug: CONFIG.TOURNAMENT_SLUG });
    if (!data?.tournament) return;

    const { sortedQueue, stationStatus, busyPlayerIds, alerts } = processMatches(data);

    // --- GUI RENDERING ---
    console.clear();
    console.log(`=== START.GG AUTO-MANAGER | ${new Date().toLocaleTimeString()} ===`);
    
    // 1. Stations Table
    const stationTable = new Table({ head: ['Setup', 'Status', 'Match Content'] });
    stationStatus.forEach((s: any) => {
      let color = s.status === 'EMPTY' ? '\x1b[32m' : s.status === 'ENGAGED' ? '\x1b[34m' : '\x1b[33m';
      if (s.status === 'OFFLINE') color = '\x1b[31m';
      stationTable.push([s.number, `${color}${s.status}\x1b[0m`, s.match]);
    });
    console.log("\nSETUPS STATUS");
    console.log(stationTable.toString());

    // 2. Queue Info
    console.log(`\nQUEUE: ${sortedQueue.length} matches waiting | ${busyPlayerIds.size} players busy`);

    // 3. Active Alerts
    if (alerts.length > 0) {
      console.log("\n⚠️  ALERTS (OVERTIME)");
      alerts.forEach(a => console.log(`\x1b[31m ${a}\x1b[0m`));
    }

    // --- AUTOMATION LOGIC ---
    const availableStations = stationStatus.filter((s: any) => s.status === 'EMPTY');
    let stationIdx = 0;

    for (const set of sortedQueue) {
      if (stationIdx >= availableStations.length) break;
      if (set.id.toString().startsWith('preview_') || set.station) continue; // Skip if already assigned

      const isConflict = set.slots.some((s: any) => s.entrant && busyPlayerIds.has(s.entrant.id));
      
      if (!isConflict) {
        const targetStation = availableStations[stationIdx];
        console.log(`\n🚀 CALLING: ${set.friendlyName} (${set.eventName}) -> Station ${targetStation.number}`);
        
        await client.callMatch(set.id, targetStation.id);
        
        stationIdx++;
        set.slots.forEach((s: any) => { if (s.entrant) busyPlayerIds.add(s.entrant.id) });
      }
    }

  } catch (e: any) {
    console.error("\n❌ Loop Error:", e.message);
  }
}

setInterval(mainLoop, CONFIG.POLL_INTERVAL_MS);
mainLoop();