import axios from 'axios';

export class StartGGClient {
  constructor(private token: string) {}

  async query(query: string, variables: any = {}) {
    const res = await axios.post('https://api.start.gg/gql/alpha', 
      { query, variables },
      { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } }
    );
    return res.data.data;
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
}