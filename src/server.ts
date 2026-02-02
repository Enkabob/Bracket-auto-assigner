import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import { StartGGClient } from './api';
import { processMatches } from './engine';
import { TOURNAMENT_QUERY } from './queries';
import { CONFIG } from './config';
import { State } from './state';

let updateTimer: NodeJS.Timeout;
let lastUpdateTimestamp = Date.now();
let lastCache: any = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const client = new StartGGClient(CONFIG.API_KEY);

// Serve the GUI files
app.use(express.static('public'));

// The Main Loop (Modified for Web)
// src/server.ts

async function runUpdate() {
  
  clearTimeout(updateTimer);
  
  try {
    const data = await client.query(TOURNAMENT_QUERY, { slug: CONFIG.TOURNAMENT_SLUG });
    if (!data?.tournament) return;

    // This defines the variable "processed"
    const processed = processMatches(data); 
       lastCache = {
      stations: processed.stationStatus,
      queue: processed.sortedQueue.slice(0, 10),
      alerts: processed.alerts,
      timestamp: new Date().toLocaleTimeString(),
      nextUpdateIn: CONFIG.POLL_INTERVAL_MS,
      lastUpdate: Date.now(),
      isBotActive: State.isBotActive
    };
    io.emit('update', lastCache);
    lastUpdateTimestamp = Date.now();

    if (State.isBotActive) {
  console.log(`🤖 Bot checking queue: ${processed.sortedQueue.length} matches pending...`);
  
  let stationIdx = 0;
  const availableStations = processed.stationStatus.filter((s: any) => s.status === 'EMPTY');

  if (availableStations.length === 0) {
    console.log("ℹ️ Bot: No empty stations available. Standing by.");
  }
  

  for (const set of processed.sortedQueue) {
    if (stationIdx >= availableStations.length) {
      console.log("ℹ️ Bot: All free stations for this cycle have been filled.");
      break;
    }

    const setId = set.id.toString();

    // 1. Check for Preview IDs
    if (setId.startsWith('preview_')) {
      // Now it will say: ⏩ Bot: Skipping Mango vs Zain (Singles) - Bracket Not Started
      console.log(`⏩ Bot: Skipping ${set.friendlyName} (${set.eventName}) - Bracket Not Started`);
      continue;
    }

    // 2. Check if already has a station (prevents double-calling)
    if (set.station) {
      console.log(`⏩ Bot: Skipping Match ${set.friendlyName} (Already has station ${set.station.number})`);
      continue;
    }

    // 3. Check for Player Conflicts
    const conflict = set.slots?.find((s: any) => s.entrant?.id && processed.busyPlayerIds.has(s.entrant.id));
    
    if (conflict) {
      console.log(`⏳ Bot: Conflict for ${set.friendlyName} (${conflict.entrant.name} is busy)`);
      continue;
    }

    // 4. EXECUTE CALL
    const target = availableStations[stationIdx];
    console.log(`🚀 BOT CALLING: ${set.friendlyName} -> Setup ${target.number}`);
    
    try {
      await client.callMatch(setId, target.id);
      stationIdx++;
      // Mark players busy immediately for this cycle
      set.slots?.forEach((s: any) => { if (s.entrant?.id) processed.busyPlayerIds.add(s.entrant.id); });
    } catch (err: any) {
      console.error(`❌ Bot: Failed to call ${setId}:`, err.message);
    }
  }
}

    // 1. PUSH TO GUI
    io.emit('update', {
      stations: processed.stationStatus,
      queue: processed.sortedQueue.slice(0, 10),
      alerts: processed.alerts,
      timestamp: new Date().toLocaleTimeString(),
      nextUpdateIn: CONFIG.POLL_INTERVAL_MS,
      lastUpdate: lastUpdateTimestamp,
      isBotActive: State.isBotActive // Ensure this is sent!
    });

    // 2. AUTOMATION LOGIC (Actual Calling)
    if (State.isBotActive) {
      let stationIdx = 0;
      const availableStations = processed.stationStatus.filter((s: any) => s.status === 'EMPTY');

      for (const set of processed.sortedQueue) {
        if (stationIdx >= availableStations.length) break;
        if (set.id.toString().startsWith('preview_') || set.station) continue;

        const isConflict = set.slots?.some((s: any) => s.entrant?.id && processed.busyPlayerIds.has(s.entrant.id));
        
        if (!isConflict) {
          const target = availableStations[stationIdx];
          console.log(`🚀 [AUTO] Calling ${set.friendlyName} -> Station ${target.number}`);
          await client.callMatch(set.id, target.id);
          stationIdx++;
        }
      }
    }
  } catch (e) {
    console.error("Loop Error:", e);
  } finally {
    updateTimer = setTimeout(runUpdate, CONFIG.POLL_INTERVAL_MS);
  }
}

// GUI Interactions (Buttons clicked on the web page)
io.on('connection', (socket) => {
  console.log('CONNECTED: A TO has joined the dashboard');

  if (lastCache) {
    socket.emit('update', lastCache);
  } else {
    // If it's the very first run, trigger a sync now
    runUpdate();
  }

  socket.onAny((eventName, args) => {
    console.log(`DEBUG INCOMING: [${eventName}]`, args);
  });

  // --- TOGGLE STATION ---
  socket.on('toggle-station', (stationId) => {
    const idString = stationId.toString(); // Force to string
    
    if (State.offlineStations.has(idString)) {
      State.offlineStations.delete(idString);
      console.log(`State: Station ${idString} removed from offline list`);
    } else {
      State.offlineStations.add(idString);
      console.log(`State: Station ${idString} added to offline list`);
    }
    
    runUpdate(); // This will trigger engine.ts and then io.emit('update')
  });

  // --- BOT TOGGLE ---
  socket.on('toggle-bot', (active: boolean) => {
    console.log(`REQ: Bot Status -> ${active ? 'RUNNING' : 'PAUSED'}`);
    State.isBotActive = active;
    runUpdate();
  });

  // --- ADD TIMER ---
  socket.on('add-timer', (setId: string) => {
    console.log(`REQ: Extension for Set ${setId}`);
    const current = State.timerExtensions.get(setId) || 0;
    State.timerExtensions.set(setId, current + 300);
    runUpdate();
  });

  // --- NUCLEAR RESET ---
  socket.on('reset-all-called', async () => {
    console.log('☢️ REQ: NUCLEAR RESET INITIATED');
    
    // Pause bot first
    State.isBotActive = false;
    
    try {
      const data = await client.query(TOURNAMENT_QUERY, { slug: CONFIG.TOURNAMENT_SLUG });
      const allEvents = data?.tournament?.events || [];

      for (const event of allEvents) {
        const sets = event.sets?.nodes || [];
        // State 6 = CALLED, State 4 = READY
        const calledSets = sets.filter((s: any) => s.state === 6 || s.station !== null);
        
        for (const set of calledSets) {
          console.log(`  - Unassigning: ${set.id}`);
          await client.unassignStation(set.id);
        }
      }
      console.log('✅ Reset Complete');
      runUpdate();
    } catch (err: any) {
      console.error('Reset failed:', err.message);
    }
  });

  socket.on('force-update', () => {
    console.log('REQ: Manual Force Sync');
    runUpdate();
  });
});

// Start the loop
setInterval(runUpdate, CONFIG.POLL_INTERVAL_MS);
httpServer.listen(3000, () => {
  console.log('✅ Dashboard running at http://localhost:3000');
  runUpdate();
});