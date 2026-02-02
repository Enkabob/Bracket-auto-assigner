export const TOURNAMENT_QUERY = `
query AutoManagerData($slug: String!) {
  tournament(slug: $slug) {
    id
    name
    events {
      id
      name
      state
      phases {
        id
        name
        phaseGroups {
          nodes {
            id
            displayIdentifier
            state
          }
        }
      }
      sets(filters: {state: [1, 2, 6]}) {
        nodes {
          id
          state
          startedAt
          round
          fullRoundText
          slots {
            entrant { id name }
            prereqType
            prereqId
          }
          station { id number }
        }
      }
    }
    stations {
      nodes { 
        id 
        number 
        state 
        stream { id streamName }
      }
    }
  }
}
`;