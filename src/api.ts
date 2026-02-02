import axios from 'axios';

export class StartGGClient {
  constructor(private token: string) {}
  public lastCredits = 80; // Tracks X-RateLimit-Remaining

  async query(query: string, variables: any = {}) {
    try {
      const res = await axios.post('https://api.start.gg/gql/alpha', 
        { query, variables },
        { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } }
      );

      // Extract Rate Limit Headers
      const remaining = res.headers['x-ratelimit-remaining'];
      if (remaining) {
        this.lastCredits = parseInt(remaining);
        if (this.lastCredits < 10) console.warn(`⚠️ API WARNING: Only ${this.lastCredits} credits remaining!`);
      }

      return res.data.data;
    } catch (e: any) {
      console.error("API Error:", e.message);
      return null;
    }
  }



  async callMatch(setId: string, stationId: string) {
    const mutation = `
      mutation CallMatch($setId: ID!, $stationId: ID!) {
        markSetCalled(setId: $setId) { id state }
        assignStation(setId: $setId, stationId: $stationId) { id }
      }
    `;
    return this.query(mutation, { setId, stationId });
  }
  async unassignStation(setId: string) {
  const mutation = `
    mutation UnassignStation($setId: ID!) {
      assignStation(setId: $setId, stationId: null) {
        id
      }
    }
  `;
    return this.query(mutation, { setId });
  }
}