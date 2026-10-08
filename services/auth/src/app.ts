import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { unwrapResolverError } from '@apollo/server/errors';
import { buildSubgraphSchema, type GraphQLResolverMap } from '@apollo/subgraph';
import { expressMiddleware } from '@as-integrations/express5';
import express, { type Express } from 'express';
import { gql } from 'graphql-tag';
import { pinoHttp } from 'pino-http';
import { env, isProd } from './config/env.js';
import { pool } from './db/client.js';
import { buildContext, type GraphQLContext } from './graphql/context.js';
import { resolvers } from './graphql/resolvers.js';
import { logger } from './lib/logger.js';
import { globalRateLimit } from './lib/rate-limit.js';
import { requestContext } from './lib/request-context.js';
import { jwks } from './modules/tokens/token.service.js';
import { redis } from './redis.js';

const typeDefs = gql(readFileSync(new URL('./graphql/schema.graphql', import.meta.url), 'utf8'));

export async function createApp(httpServer: Server): Promise<{ app: Express; apollo: ApolloServer<GraphQLContext> }> {
  const app = express();

  // Behind N proxies (Apollo Router, ALB), take the client IP from X-Forwarded-For. 0 = socket address.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).clientInfo?.requestId,
      customProps: (req) => ({ ip: (req as express.Request).clientInfo?.ip }),
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    }),
  );

  // --- REST: probes and public keys ---------------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await Promise.all([pool.query('select 1'), redis.ping()]);
      res.json({ status: 'ready' });
    } catch (err) {
      logger.warn({ err }, 'Readiness check failed');
      res.status(503).json({ status: 'not_ready' });
    }
  });
  app.get('/.well-known/jwks.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json(jwks());
  });

  // --- GraphQL subgraph ---------------------------------------------------------------------------
  const apollo = new ApolloServer<GraphQLContext>({
    schema: buildSubgraphSchema([{ typeDefs, resolvers: resolvers as GraphQLResolverMap<GraphQLContext> }]),
    introspection: !isProd,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      ...(isProd ? [ApolloServerPluginLandingPageDisabled()] : []),
    ],
    // Unexpected errors: log the details, send the client a generic message in production.
    formatError: (formatted, error) => {
      const code = formatted.extensions?.code;
      if (code === 'INTERNAL_SERVER_ERROR' || code === undefined) {
        logger.error({ err: unwrapResolverError(error) }, 'GraphQL resolver error');
        if (isProd) return { message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } };
      }
      return formatted;
    },
  });
  await apollo.start();

  app.use(
    '/graphql',
    globalRateLimit,
    express.json({ limit: '100kb' }),
    expressMiddleware(apollo, { context: buildContext }),
  );

  return { app, apollo };
}
