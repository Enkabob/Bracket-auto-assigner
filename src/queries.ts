export const TOURNAMENT_QUERY = `
query AutoManagerData($slug: String!) {
  tournament(slug: $slug) {
    events {
      id
      name
      sets(filters: {state: [1, 2]}) {
        nodes {
          id
          state
          startedAt
          round
          fullRoundText
          slots {
            entrant {
              id
              name
            }
          }
          station {
            id
            number
          }
        }
      }
    }
    stations {
      nodes {
        id
        number
        state
      }
    }
  }
}
`;