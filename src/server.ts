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
const recentlyCalledSets = new Set<string>();
const recentlyCalledSetIds = new Set<string>();

const stripHtml = (text: string) => text.replace(/<[^>]*>?/gm, '');

// Serve the GUI files
app.use(express.static('public'));

// The Main Loop (Modified for Web)
// src/server.ts

async function runUpdate() {
  clearTimeout(updateTimer);
  
  try {
    // 1. Fetch
    const data = await client.query(TOURNAMENT_QUERY, { slug: State.config.slug || CONFIG.TOURNAMENT_SLUG });
    if (!data?.tournament) return;

    // 2. Process
    const processed = processMatches(data);

    // 3. Update Cache & Last Sync Time
    lastUpdateTimestamp = Date.now();
    lastCache = {
      stations: processed.stationStatus,
      queue: processed.sortedQueue.slice(0, 10),
      alerts: processed.alerts,
      monitorStatus: processed.monitorStatus || [],
      timestamp: new Date().toLocaleTimeString(),
      nextUpdateIn: CONFIG.POLL_INTERVAL_MS,
      lastUpdate: lastUpdateTimestamp,
      isBotActive: State.isBotActive,
      isConfigured: State.config.isConfigured,
      apiCredits: client.lastCredits
    };

    // 4. Push to GUI (Single emit with everything)
    io.emit('update', lastCache);

    // 5. Automation Logic
    if (State.isBotActive) {
  const availableStations = processed.stationStatus.filter((s: any) => s.status === 'EMPTY');
  
  if (availableStations.length > 0 && processed.sortedQueue.length > 0) {
    console.log(`🤖 Bot analyzing ${availableStations.length} stations and ${processed.sortedQueue.length} matches...`);
  }

  // Create an array to hold our API promises
  const callPromises = [];

  for (const station of availableStations) {
    const targetMatch = processed.sortedQueue.find(q => 
      !recentlyCalledSetIds.has(q.id) && 
      !processed.busyPlayerIds.has(q.slots[0]?.entrant?.id?.toString()) &&
      !processed.busyPlayerIds.has(q.slots[1]?.entrant?.id?.toString())
    );

    if (targetMatch) {
      const cleanName = stripHtml(targetMatch.friendlyName);
      console.log(`🚀 [QUEUED] ${cleanName} -> Station ${station.number}`);
      
      // Add to memory immediately to prevent the next loop iteration from picking it
      recentlyCalledSetIds.add(targetMatch.id);
      
      // Push the API call to our promise array (don't 'await' yet!)
      callPromises.push(
        client.callMatch(targetMatch.id, station.id)
          .then(() => console.log(`✅ [CONFIRMED] ${cleanName} on Station ${station.number}`))
          .catch(e => {
            recentlyCalledSetIds.delete(targetMatch.id); // Remove from memory if it failed
            console.error(`❌ [FAILED] ${cleanName}: ${e.message}`);
          })
      );

      // Remove from local queue so the next station doesn't pick it
      const idx = processed.sortedQueue.indexOf(targetMatch);
      if (idx > -1) processed.sortedQueue.splice(idx, 1);
    }
    processed.sortedQueue.forEach(q => {
      if (processed.busyPlayerIds.has(q.slots[0]?.entrant?.id?.toString())) {
          // This will tell you exactly which player is holding up the queue
          // console.log(`DEBUG: ${q.friendlyName} is blocked because ${q.slots[0].entrant.name} is busy.`);
      }
  });
}

  // Fire all API calls at once!
  if (callPromises.length > 0) {
    await Promise.all(callPromises);
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
  socket.emit('config-status', State.config.isConfigured);

  socket.on('save-config', (data) => {
    State.config.apiKey = data.apiKey;
    State.config.slug = data.slug;
    State.config.isConfigured = true;
    State.savePersistence();
    
    // Re-initialize the API client with the new key
    // (You'll need to update your client instance here)
    console.log("✅ Configuration Saved. Restarting Sync...");
    runUpdate();
  });

  socket.on('set-zone', ({ stationId, zoneName }) => {
    State.stationZones.set(stationId, zoneName);
    State.savePersistence();
    runUpdate();
  });

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
      const data = await client.query(TOURNAMENT_QUERY, { 
          slug: State.config.slug || CONFIG.TOURNAMENT_SLUG 
      });
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

  socket.on('save-config', (data) => {
    console.log(`🔄 Switching Tournament to: ${data.slug}`);
    
    // 1. Update Config
    State.config.apiKey = data.apiKey;
    State.config.slug = data.slug;
    State.config.isConfigured = true;
    State.savePersistence();

    // 2. CLEAR ALL CACHES & MEMORY
    lastCache = null;               // Wipe the GUI data
    recentlyCalledSetIds.clear();   // Wipe the "recently called" memory
    State.offlineStations.clear();  // Wipe disabled setups
    State.timerExtensions.clear();  // Wipe +5m extensions
    State.isBotActive = false;      // Pause bot for safety on new tourney

    // 3. Trigger immediate fresh sync
    runUpdate();
    
    // Tell the client to close the modal
    socket.emit('config-status', true);
  });

  // A dedicated "Emergency Wipe" for the cache
  socket.on('clear-cache', () => {
      console.log("🧹 Manual Cache Wipe Initiated");
      lastCache = null;
      State.timerExtensions.clear();
      runUpdate();
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