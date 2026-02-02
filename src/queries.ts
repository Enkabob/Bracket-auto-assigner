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
            state # 1=Created, 2=Active, 3=Completed
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
          slots { entrant { id name } }
          station { id number }
        }
      }
    }
    stations {
      nodes { id number state }
    }
  }
}
`;