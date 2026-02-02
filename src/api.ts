import axios from 'axios';

export class StartGGClient {
  public lastCredits = 80;
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  // Allow the server to update the token after the Setup Wizard runs
  setToken(newToken: string) {
    this.token = newToken;
  }

  async query(query: string, variables: any = {}) {
    // SAFETY: If no token or no slug, don't fire the request
    if (!this.token || !variables.slug) {
      return null;
    }

    try {
      const res = await axios.post('https://api.start.gg/gql/alpha', 
        { query, variables },
        { 
          headers: { 
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json' 
          } 
        }
      );

      const remaining = res.headers['x-ratelimit-remaining'];
      if (remaining) this.lastCredits = parseInt(remaining);

      if (res.data.errors) {
        console.error("❌ GraphQL Error:", res.data.errors[0].message);
        return null;
      }

      return res.data.data;
    } catch (e: any) {
      // 400 Errors usually mean bad credentials
      if (e.response?.status === 400) {
        console.error("❌ API Error 400: Check your Tournament Slug and API Key.");
      } else {
        console.error("❌ API Error:", e.message);
      }
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