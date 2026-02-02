import 'dotenv/config';

export const CONFIG = {
  API_KEY: process.env.STARTGG_API_KEY || '',
  TOURNAMENT_SLUG: 'back-to-the-lab-again-34-start-of-2026', // Change this to your tournament slug
  POLL_INTERVAL_MS: 10000,
  BO3_DURATION: 900,
  BO5_DURATION: 1500,
  DEAD_AIR_THRESHOLD: 600,
};