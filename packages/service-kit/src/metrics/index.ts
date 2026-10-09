import type { ApolloServerPlugin, BaseContext } from '@apollo/server';
import type { RequestHandler } from 'express';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { createGraphqlMetricsPlugin } from './graphql.js';
import { createHttpMetrics } from './http.js';

export { classify, errorOutcome, userErrorTypeNames, type Outcome, type RootField, type RootFieldOutcome } from './graphql.js';
export { routeLabel } from './http.js';

export interface MetricsOptions {
  /** Added as a `service` label to every series, e.g. `auth`. */
  service: string;
}

export interface Metrics {
  registry: Registry;
  /** Express middleware: `http_requests_total`, `http_request_duration_seconds`. Mount it early. */
  httpMetrics: RequestHandler;
  /** `GET /metrics` handler in the Prometheus text format. */
  metricsHandler: RequestHandler;
  /** Apollo Server plugin: `graphql_operations_total`, `graphql_operation_duration_seconds`. */
  graphqlPlugin: ApolloServerPlugin<BaseContext>;
}

/**
 * One registry per service with HTTP, GraphQL and Node.js runtime metrics.
 *
 *   const metrics = createMetrics({ service: 'auth' });
 *   app.use(metrics.httpMetrics);
 *   app.get('/metrics', metrics.metricsHandler);
 *   new ApolloServer({ plugins: [metrics.graphqlPlugin] });
 */
export function createMetrics({ service }: MetricsOptions): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  // Event-loop lag, heap, GC, CPU, open handles: nodejs_* and process_* series.
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    httpMetrics: createHttpMetrics(registry),
    metricsHandler: async (_req, res) => {
      res.set('Content-Type', registry.contentType).end(await registry.metrics());
    },
    graphqlPlugin: createGraphqlMetricsPlugin(registry),
  };
}
