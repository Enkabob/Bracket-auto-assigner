import { State } from './state';
import { CONFIG } from './config';

interface EventPriorityMap {
  id: string;
  name: string;
  maxRounds: number;
  currentMinRound: number;
  weight: number;
}

export function processMatches(apiData: any) {
  const allEvents = apiData.tournament?.events || [];
  const allStations = apiData.tournament?.stations?.nodes || [];
  
  const readySets: any[] = [];
  const activeSets: any[] = [];
  const busyPlayerIds = new Set<string>();
  const monitorStatus: any[] = []; // NEW: Tracks Pool Status

  // 1. Calculate Bottleneck Scores
  const eventPriorityMap: EventPriorityMap[] = allEvents.map((e: any) => {
    const sets = e.sets?.nodes || [];
    const allRounds = sets.map((s: any) => Math.abs(s.round));
    const maxRounds = allRounds.length > 0 ? Math.max(...allRounds) : 1;
    const pendingRounds = sets
      .filter((s: any) => s.state === 1 || s.state === 2 || s.state === 6)
      .map((s: any) => Math.abs(s.round));
    
    const currentMinRound = pendingRounds.length > 0 ? Math.min(...pendingRounds) : maxRounds;
    const weight = maxRounds - currentMinRound;

    return { id: e.id, name: e.name, maxRounds, currentMinRound, weight };
  });

  // 2. Process Events (Sets, Busy Players, and Pool Monitor)
  allEvents.forEach((event: any) => {
    // --- BUILD POOL MONITOR ---
    event.phases?.forEach((phase: any) => {
      phase.phaseGroups?.nodes?.forEach((group: any) => {
        monitorStatus.push({
          event: event.name,
          phase: phase.name,
          pool: group.displayIdentifier,
          state: group.state === 1 ? 'UNSTARTED' : group.state === 2 ? 'ACTIVE' : 'DONE'
        });
      });
    });

    // --- PROCESS SETS ---
    const sets = event.sets?.nodes || [];
    const metrics = eventPriorityMap.find(p => p.id === event.id);

    sets.forEach((set: any) => {
      const p1 = set.slots?.[0]?.entrant?.name || "TBD";
      const p2 = set.slots?.[1]?.entrant?.name || "TBD";
      const setIdStr = set.id.toString();
      
      const setInfo = { 
        ...set, 
        id: setIdStr,
        eventName: event.name, 
        friendlyName: `${p1} vs ${p2}`,
        eventWeight: metrics?.weight || 0,
        isPreview: setIdStr.startsWith('preview_')
      };

      if (set.state === 2) { // IN PROGRESS
        activeSets.push(setInfo);
        set.slots?.forEach((s: any) => { if (s.entrant?.id) busyPlayerIds.add(s.entrant.id.toString()); });
      } 
      else if (set.state === 1 || set.state === 6) { // WAITING OR CALLED
        readySets.push(setInfo);
        if (set.state === 6) { // Mark called players as busy too
           set.slots?.forEach((s: any) => { if (s.entrant?.id) busyPlayerIds.add(s.entrant.id.toString()); });
        }
      }
    });
  });

  // 3. Sorting Logic
  const sortedQueue = readySets.sort((a, b) => {
    if (b.eventWeight !== a.eventWeight) return b.eventWeight - a.eventWeight;
    if ((a.round > 0) !== (b.round > 0)) return a.round > 0 ? -1 : 1;
    return parseInt(a.id) - parseInt(b.id);
  });

  // 4. Station Status Mapping
  const stationStatus = allStations.map((s: any) => {
    const currentId = s.id.toString();
    const isOffline = State.offlineStations.has(currentId);
    const occupiedBy = activeSets.find(as => as.station?.id === currentId);
    const calledFor = readySets.find(rs => rs.station?.id === currentId);

    let status = "EMPTY";
    let match = "";
    let eventName = "";
    let startedAt = null;

    if (isOffline) status = "OFFLINE";
    else if (occupiedBy) {
      status = "ENGAGED";
      match = occupiedBy.friendlyName;
      eventName = occupiedBy.eventName;
      startedAt = occupiedBy.startedAt;
    } else if (calledFor) {
      status = "CALLED";
      match = calledFor.friendlyName;
      eventName = calledFor.eventName;
    }

    // Calculate progress percentage
    const isBo5 = match.toLowerCase().includes("finals");
    const duration = isBo5 ? CONFIG.BO5_DURATION : CONFIG.BO3_DURATION;
    const elapsed = startedAt ? (Date.now()/1000 - startedAt) : 0;
    const percent = startedAt ? Math.min((elapsed / duration) * 100, 100) : 0;

    return { 
      number: s.number, 
      id: currentId, 
      status, 
      match, 
      eventName, 
      percent,
      matchId: occupiedBy?.id || calledFor?.id || null 
    };
  });

  // 5. Overtime Alerts
  const alerts: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  activeSets.forEach(set => {
    const isBo5 = set.fullRoundText?.includes("Finals") || false;
    const base = isBo5 ? CONFIG.BO5_DURATION : CONFIG.BO3_DURATION;
    const ext = State.timerExtensions.get(set.id) || 0;
    if (set.startedAt && (now - set.startedAt) > (base + CONFIG.DEAD_AIR_THRESHOLD + ext)) {
      alerts.push(`${set.eventName}: ${set.friendlyName} is OVERTIME`);
    }
  });

  return { sortedQueue, stationStatus, busyPlayerIds, alerts, monitorStatus };
}