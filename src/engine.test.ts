import { describe, it, expect } from 'vitest';
import { processMatches } from './engine';

describe('processMatches', () => {
    const mockApiData = {
        tournament: {
            events: [
                {
                    id: '1',
                    name: 'Melee Singles',
                    sets: {
                        nodes: [
                            {
                                id: 'set1',
                                state: 1, // READY
                                round: 1,
                                slots: [
                                    { entrant: { id: 'p1', name: 'Player 1' } },
                                    { entrant: { id: 'p2', name: 'Player 2' } }
                                ],
                                station: null
                            },
                            {
                                id: 'set2',
                                state: 2, // ENGAGED
                                round: 1,
                                slots: [
                                    { entrant: { id: 'p3', name: 'Player 3' } },
                                    { entrant: { id: 'p4', name: 'Player 4' } }
                                ],
                                station: { id: 's1', number: 1 }
                            }
                        ]
                    }
                }
            ],
            stations: {
                nodes: [
                    { id: 's1', number: 1, state: 1 },
                    { id: 's2', number: 2, state: 1 }
                ]
            }
        }
    };

    it('correctly identifies ready matches and station status', () => {
        const result = processMatches(mockApiData);

        // Set 1 should be in the queue
        expect(result.sortedQueue.length).toBe(1);
        expect(result.sortedQueue[0].id).toBe('set1');

        // Station 1 should be ENGAGED, Station 2 should be EMPTY
        expect(result.stationStatus.find(s => s.id === 's1')?.status).toBe('ENGAGED');
        expect(result.stationStatus.find(s => s.id === 's2')?.status).toBe('EMPTY');
    });

    it('respects progression caps for winners and losers', () => {
        const dataWithCaps = {
            tournament: {
                events: [
                    {
                        id: '1',
                        name: 'Melee Singles',
                        sets: {
                            nodes: [
                                {
                                    id: 'w_round1',
                                    state: 2, // ENGAGED
                                    round: 1,
                                    slots: [{ entrant: { id: 'p1' } }, { entrant: { id: 'p2' } }],
                                    station: { id: 's1' }
                                },
                                {
                                    id: 'w_round2',
                                    state: 1, // WAITING
                                    round: 2,
                                    slots: [{ entrant: { id: 'p3' } }, { entrant: { id: 'p4' } }],
                                    station: null
                                },
                                {
                                    id: 'w_round3',
                                    state: 1, // WAITING (Should be capped)
                                    round: 3,
                                    slots: [{ entrant: { id: 'p5' } }, { entrant: { id: 'p6' } }],
                                    station: null
                                }
                            ]
                        }
                    }
                ],
                stations: { nodes: [{ id: 's1', number: 1 }] }
            }
        };

        const result = processMatches(dataWithCaps);

        // Furthest active winners round is 1. Cap is 1 + 1 = 2.
        // Round 2 should be allowed, Round 3 should be filtered out.
        const queueIds = result.sortedQueue.map(q => q.id);
        expect(queueIds).toContain('w_round2');
        expect(queueIds).not.toContain('w_round3');
    });

    it('prevents player double-booking', () => {
        const doubleBookingData = {
            tournament: {
                events: [
                    {
                        id: '1',
                        name: 'Melee Singles',
                        sets: {
                            nodes: [
                                {
                                    id: 'set_active',
                                    state: 2, // ENGAGED
                                    round: 1,
                                    slots: [{ entrant: { id: 'p1' } }, { entrant: { id: 'p2' } }],
                                    station: { id: 's1' }
                                },
                                {
                                    id: 'set_waiting',
                                    state: 1, // WAITING
                                    round: 1,
                                    slots: [{ entrant: { id: 'p1' } }, { entrant: { id: 'p3' } }],
                                    station: null
                                }
                            ]
                        }
                    }
                ],
                stations: { nodes: [{ id: 's1', number: 1 }] }
            }
        };

        const result = processMatches(doubleBookingData);

        // Player 1 is busy in set_active
        expect(result.busyPlayerIds.has('p1')).toBe(true);

        // set_waiting should still be in sortedQueue (engine doesn't filter by busy players yet, 
        // server.ts handles that, but busyPlayerIds should be correct)
        expect(result.sortedQueue.length).toBe(1);
        expect(result.sortedQueue[0].id).toBe('set_waiting');
    });

    it('sorts queue by event weight, then round, then winners over losers', () => {
        const complexData = {
            tournament: {
                events: [
                    {
                        id: 'e1',
                        name: 'Melee',
                        sets: {
                            nodes: [
                                { id: 'm_w_r2', state: 1, round: 2, slots: [{ entrant: { id: 'a' } }, { entrant: { id: 'b' } }] },
                                { id: 'm_l_r2', state: 1, round: -2, slots: [{ entrant: { id: 'c' } }, { entrant: { id: 'd' } }] },
                                { id: 'm_w_r1', state: 1, round: 1, slots: [{ entrant: { id: 'e' } }, { entrant: { id: 'f' } }] }
                            ]
                        }
                    }
                ],
                stations: { nodes: [] }
            }
        };

        const result = processMatches(complexData);

        // Sort order: Round 1 (lower absolute) -> Round 2 Winners -> Round 2 Losers
        const queueIds = result.sortedQueue.map(q => q.id);
        expect(queueIds[0]).toBe('m_w_r1');
        expect(queueIds[1]).toBe('m_w_r2');
        expect(queueIds[2]).toBe('m_l_r2');
    });
});
