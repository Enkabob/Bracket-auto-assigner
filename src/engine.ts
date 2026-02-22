import { State } from './state';
import { CONFIG } from './config';

// 1. DEFINE THE INTERFACES
interface EventMetric {
  id: string;
  weight: number;
  cap: number;
}

interface PoolMonitor {
  event: string;
  phase: string;
  pool: string;
  state: 'UNSTARTED' | 'ACTIVE' | 'DONE';
}

export interface SetInfo {
  id: string;
  eventName: string;
  friendlyName: string;
  eventWeight: number;
  isWinners: boolean;
  isPreview: boolean;
  isFullyReady: boolean;
  round: number;
  state: number;
  slots: any[];
  station: any;
  fullRoundText?: string;
  startedAt?: number;
}

export interface StationStatus {
  number: number;
  id: string;
  status: string;
  match: string;
  eventName: string;
  isStream: boolean;
  percent: number;
  elapsed: number;
  matchId: string | null;
}

export interface ProcessMatchesResult {
  sortedQueue: SetInfo[];
  stationStatus: StationStatus[];
  busyPlayerIds: Set<string>;
  alerts: string[];
  monitorStatus: PoolMonitor[];
}

function getPlayerName(slot: any, allSets: any[], currentSetRound: number): string {
  if (slot?.entrant?.name) return slot.entrant.name;

  if (slot?.prereqType === 'set') {
    const sourceSet = allSets.find(s => s.id.toString() === slot.prereqId?.toString());
    const isLoserSlot = currentSetRound < 0 && (sourceSet ? sourceSet.round > 0 : false);
    const label = isLoserSlot ? "L" : "W";

    if (sourceSet) {
      const p1 = sourceSet.slots?.[0]?.entrant?.name;
      const p2 = sourceSet.slots?.[1]?.entrant?.name;

      if (p1 && p2) {
        // Use very low opacity for the labels
        return `<span class="opacity-20 font-black mr-1">${label}:</span><span class="opacity-40">${p1}/${p2}</span>`;
      }
    }
    // Very clean fallback for unknown sets
    return `<span class="opacity-20 font-black mr-1">${label}:</span><span class="opacity-30">Set#${slot.prereqId}</span>`;
  }
  return '<span class="opacity-20 italic">Waiting...</span>';
}

export function processMatches(apiData: any): ProcessMatchesResult {
  const tournament = apiData.tournament;
  const allEvents = tournament?.events || [];
  const allStations = tournament?.stations?.nodes || [];
  const flatSets = allEvents.flatMap((e: any) => e.sets?.nodes || []);

  const readyQueue: any[] = [];
  const calledSets: any[] = [];
  const activeSets: any[] = [];
  const busyPlayerIds = new Set<string>();
  const monitorStatus: any[] = [];
  const alerts: string[] = []; // <--- ADD THIS LINE HERE

  // 1. CALCULATE SEPARATE PROGRESSION CAPS
  const eventMetrics = allEvents.map((e: any) => {
    const sets = e.sets?.nodes || [];

    const activeWinners = sets.filter((s: any) => (s.state === 2 || s.state === 6) && s.round > 0).map((s: any) => s.round);
    const activeLosers = sets.filter((s: any) => (s.state === 2 || s.state === 6) && s.round < 0).map((s: any) => Math.abs(s.round));

    const winMax = activeWinners.length > 0 ? Math.max(...activeWinners) : 1;
    const loseMax = activeLosers.length > 0 ? Math.max(...activeLosers) : 1;

    return {
      id: e.id.toString(),
      weight: 20 - winMax,
      winnersCap: winMax + 1, // Winners move 1 round at a time
      losersCap: loseMax + 2  // Losers move 2 rounds at a time (needed for DE brackets)
    };
  });

  // 2. SORT MATCHES INTO BUCKETS
  allEvents.forEach((event: any) => {
    // Monitor logic...
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

    const sets = event.sets?.nodes || [];
    const metrics = eventMetrics.find((m: any) => m.id === event.id.toString());

    sets.forEach((set: any) => {
      const p1 = getPlayerName(set.slots?.[0], flatSets, set.round);
      const p2 = getPlayerName(set.slots?.[1], flatSets, set.round);

      const hasStationAssigned = set.station && set.station.id;
      const setId = set.id.toString();
      const friendlyName = `${p1} vs ${p2}`;
      const isWinners = set.round > 0;
      const absRound = Math.abs(set.round);
      const isFullyReady = set.slots?.[0]?.entrant?.id && set.slots?.[1]?.entrant?.id;

      const setInfo = {
        ...set,
        id: setId,
        eventName: event.name,
        friendlyName: `${p1} vs ${p2}`,
        eventWeight: metrics?.weight || 0,
        isWinners: set.round > 0,
        isPreview: setId.startsWith('preview_'),
        isFullyReady // We'll use this for the filter
      };

      // 1. Player Conflict Tracking (Busy if playing or called)
      if (set.state === 2 || set.state === 6 || hasStationAssigned) {
        set.slots?.forEach((s: any) => {
          if (s.entrant?.id) busyPlayerIds.add(s.entrant.id.toString());
        });
      }

      // 2. REFINED BUCKETING
      if (set.state === 2) {
        // MATCH IS ACTIVELY BEING PLAYED
        activeSets.push(setInfo);
      }
      else if (set.state === 6 || hasStationAssigned) {
        // MATCH IS CALLED OR MANUALLY ASSIGNED (Crucial fix)
        calledSets.push(setInfo);
      }
      else if (set.state === 1 && !hasStationAssigned) {
        // MATCH IS TRULY WAITING FOR A HOME
        const cap = set.round > 0 ? (metrics?.winnersCap || 99) : (metrics?.losersCap || 99);
        if (Math.abs(set.round) <= cap && isFullyReady) {
          readyQueue.push(setInfo);
        }
      }
    });
  });

  // 3. STATION STATUS MAPPING
  const stationStatus = allStations.map((s: any) => {
    const stationId = s.id.toString();
    const isOffline = State.offlineStations.has(stationId);
    const engaged = activeSets.find(as => as.station?.id?.toString() === stationId);
    const called = calledSets.find(cs => cs.station?.id?.toString() === stationId);

    let status = "EMPTY";
    let matchData = null;

    if (isOffline) status = "OFFLINE";
    else if (engaged) { status = "ENGAGED"; matchData = engaged; }
    else if (called) { status = "CALLED"; matchData = called; }

    const isBo5 = matchData?.fullRoundText?.toLowerCase().includes("finals");
    const duration = isBo5 ? CONFIG.BO5_DURATION : CONFIG.BO3_DURATION;
    const elapsed = matchData?.startedAt ? (Date.now() / 1000 - matchData.startedAt) : 0;

    return {
      number: s.number,
      id: stationId,
      status,
      match: matchData?.friendlyName || "",
      eventName: matchData?.eventName || "",
      isStream: !!s.stream,
      percent: status === "ENGAGED" ? Math.min((elapsed / duration) * 100, 100) : 0,
      elapsed: Math.floor(elapsed / 60),
      matchId: matchData?.id || null
    };
  });

  // 4. QUEUE SORTING (Balanced for Regional Play)
  const sortedQueue = readyQueue.sort((a, b) => {
    // Priority 1: Events that are furthest behind
    if (b.eventWeight !== a.eventWeight) return b.eventWeight - a.eventWeight;

    // Priority 2: Round progress (Lower rounds first)
    if (Math.abs(a.round) !== Math.abs(b.round)) return Math.abs(a.round) - Math.abs(b.round);

    // Priority 3: Winners over Losers if same round number
    if (a.isWinners !== b.isWinners) return a.isWinners ? -1 : 1;

    return parseInt(a.id) - parseInt(b.id);
  });

  // --- OVERTIME ALERTS LOGIC ---
  const now = Math.floor(Date.now() / 1000);
  activeSets.forEach(set => {
    const isBo5 = set.fullRoundText?.toLowerCase().includes("finals") || false;
    const base = isBo5 ? CONFIG.BO5_DURATION : CONFIG.BO3_DURATION;
    const ext = State.timerExtensions.get(set.id) || 0;

    if (set.startedAt && (now - set.startedAt) > (base + CONFIG.DEAD_AIR_THRESHOLD + ext)) {
      alerts.push(`${set.eventName}: ${set.friendlyName} is OVERTIME`);
    }
  });

  return {
    sortedQueue,
    stationStatus,
    busyPlayerIds,
    alerts,
    monitorStatus: monitorStatus || [] // Always return at least an empty list
  };
}