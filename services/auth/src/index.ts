import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/client.js';
import { initGeo } from './lib/geo.js';
import { logger } from './lib/logger.js';
import { initTokenKeys } from './modules/tokens/token.service.js';
import { redis } from './redis.js';

async function main() {
  await initTokenKeys();
  await initGeo();

  const httpServer = createServer();
  const { app, apollo } = await createApp(httpServer);
  httpServer.on('request', app);
  httpServer.listen(env.PORT, () => {
    logger.info(`Auth subgraph ready at http://localhost:${env.PORT}/graphql`);
  });

  // Graceful shutdown: stop accepting requests, let in-flight ones finish, then close connections.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    try {
      await apollo.stop(); // drains the HTTP server via the drain plugin
      await Promise.allSettled([pool.end(), redis.quit()]);
      clearTimeout(force);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
