import { State } from './state';
import { CONFIG } from './config';

// Define the shape of our progress map to satisfy the TS compiler
interface EventPriorityMap {
  id: string;
  minRound: number;
}

export function processMatches(apiData: any) {
  const allEvents = apiData.tournament?.events || [];
  const allStations = apiData.tournament?.stations?.nodes || [];
  
  const readySets: any[] = [];
  const activeSets: any[] = [];
  const busyPlayerIds = new Set<string>();

  // 1. Calculate Event Priority (Explicitly typed as EventPriorityMap[])
  const eventProgress: EventPriorityMap[] = allEvents.map((e: any) => {
    const rounds = e.sets?.nodes?.map((s: any) => Math.abs(s.round)) || [];
    return { 
      id: e.id, 
      minRound: rounds.length > 0 ? Math.min(...rounds) : 99 
    };
  });

  allEvents.forEach((event: any) => {
    const sets = event.sets?.nodes || [];
    
    // Explicitly type 'p' here to fix your error
    const eventPriority = eventProgress.find((p: EventPriorityMap) => p.id === event.id)?.minRound || 0;

    sets.forEach((set: any) => {
      const p1 = set.slots?.[0]?.entrant?.name || "TBD";
      const p2 = set.slots?.[1]?.entrant?.name || "TBD";
      const friendlyName = `${p1} vs ${p2}`;
      
      const setInfo = { 
        ...set, 
        eventName: event.name, 
        friendlyName,
        eventPriority 
      };

      if (set.state === 2) { // IN PROGRESS
        activeSets.push(setInfo);
        set.slots?.forEach((s: any) => { 
          if (s.entrant?.id) busyPlayerIds.add(s.entrant.id); 
        });
      } else if (set.state === 1) { // WAITING/CALLED
        readySets.push(setInfo);
      }
    });
  });

  // 2. Multi-Level Priority Sorting
  const sortedQueue = readySets.sort((a, b) => {
    if (a.eventPriority !== b.eventPriority) return a.eventPriority - b.eventPriority;
    if ((a.round > 0) !== (b.round > 0)) return a.round > 0 ? -1 : 1;
    if (Math.abs(a.round) !== Math.abs(b.round)) return Math.abs(a.round) - Math.abs(b.round);
    return parseInt(a.id) - parseInt(b.id);
  });

  // 3. Station Status Mapping
  const stationStatus = allStations.map((s: any) => {
    const isOffline = State.offlineStations.has(s.id);
    const occupiedBy = activeSets.find(as => as.station?.id === s.id);
    const calledFor = readySets.find(rs => rs.station?.id === s.id);

    let status = "EMPTY";
    let match = "";

    if (isOffline) status = "OFFLINE";
    else if (occupiedBy) {
      status = "ENGAGED";
      match = `[${occupiedBy.eventName}] ${occupiedBy.friendlyName}`;
    } else if (calledFor) {
      status = "CALLED";
      match = `[${calledFor.eventName}] ${calledFor.friendlyName}`;
    }

    return { number: s.number, id: s.id, status, match };
  });

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

  return { sortedQueue, stationStatus, busyPlayerIds, alerts };
}