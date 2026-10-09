import { performance } from 'node:perf_hooks';
import type { ApolloServerPlugin, BaseContext } from '@apollo/server';
import type { GraphQLError, GraphQLSchema } from 'graphql';
import { Counter, Histogram, type Registry } from 'prom-client';
import { DURATION_BUCKETS } from './buckets.js';

/** The outcome classification from ROADMAP.md ("API metrics"). */
export type Outcome = 'success' | 'user_error' | 'client_error' | 'server_error';

/** Error codes that mean the caller did something wrong. Every other code (or none) is our fault. */
const CLIENT_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'BAD_USER_INPUT',
  'BAD_REQUEST',
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'OPERATION_RESOLUTION_FAILURE',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
  'RATE_LIMITED',
]);

const SEVERITY: Record<Outcome, number> = { success: 0, user_error: 1, client_error: 2, server_error: 3 };

/** The interface every expected-failure union member implements (docs/backend-api.md, "Errors"). */
const USER_ERROR_INTERFACE = 'UserError';

export function errorOutcome(error: Pick<GraphQLError, 'extensions'>): Outcome {
  const code = error.extensions?.code;
  return typeof code === 'string' && CLIENT_ERROR_CODES.has(code) ? 'client_error' : 'server_error';
}

export function worst(a: Outcome, b: Outcome): Outcome {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/**
 * Names of the object types that implement `UserError`. Checked via Symbol.toStringTag instead of
 * graphql's isObjectType(): when this package is linked, it can see a second copy of graphql, and
 * instanceof checks across two copies fail.
 */
export function userErrorTypeNames(schema: GraphQLSchema): Set<string> {
  const names = new Set<string>();
  for (const type of Object.values(schema.getTypeMap())) {
    if ((type as { [Symbol.toStringTag]?: string })[Symbol.toStringTag] !== 'GraphQLObjectType') continue;
    const interfaces = (type as { getInterfaces(): readonly { name: string }[] }).getInterfaces();
    if (interfaces.some((i) => i.name === USER_ERROR_INTERFACE)) names.add(type.name);
  }
  return names;
}

export interface RootField {
  /** Schema field name, used as the `operation` label. Bounded by the schema. */
  name: string;
  /** Response key (the alias, if any), used to match errors by path. Client-controlled, never a label. */
  key: string;
  /** `__typename` of the resolver's raw result: union members carry it (`InvalidCredentials`). */
  typename: string;
}

export interface RootFieldOutcome {
  operation: string;
  outcome: Outcome;
  result: string;
}

/**
 * Classifies each root field of one request. Exported separately from the plugin so the rules
 * can be unit-tested without a server.
 *
 * - An error under the field's path → client_error or server_error, by error code.
 * - Otherwise a result implementing UserError → user_error (an expected business failure).
 * - Otherwise → success.
 * - No root field resolved (parse/validation/variable errors) → one entry, operation `unknown`.
 */
export function classify(
  fields: readonly RootField[],
  errors: readonly Pick<GraphQLError, 'extensions' | 'path'>[],
  userErrorTypes: ReadonlySet<string>,
): RootFieldOutcome[] {
  if (fields.length === 0) {
    const outcome = errors.reduce<Outcome>((acc, e) => worst(acc, errorOutcome(e)), 'success');
    return [{ operation: 'unknown', outcome, result: '' }];
  }
  return fields.map((field) => {
    const fieldErrors = errors.filter((e) => e.path?.[0] === field.key);
    if (fieldErrors.length > 0) {
      const outcome = fieldErrors.reduce<Outcome>((acc, e) => worst(acc, errorOutcome(e)), 'client_error');
      return { operation: field.name, outcome, result: '' };
    }
    const outcome: Outcome = userErrorTypes.has(field.typename) ? 'user_error' : 'success';
    return { operation: field.name, outcome, result: field.typename };
  });
}

/**
 * Apollo Server plugin that records, per root field, what happened:
 *   graphql_operations_total{operation, type, outcome, result}
 *   graphql_operation_duration_seconds{operation, type, outcome}   (per request)
 *
 * `operation` is the root field name (`login`, `_entities`), not the client's operation name:
 * clients can send any name (unbounded series), and through the router it arrives rewritten
 * (`Login__auth__0`).
 */
export function createGraphqlMetricsPlugin(registry: Registry): ApolloServerPlugin<BaseContext> {
  const operations = new Counter({
    name: 'graphql_operations_total',
    help: 'GraphQL root fields executed, by outcome (success, user_error, client_error, server_error) and result type',
    labelNames: ['operation', 'type', 'outcome', 'result'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'graphql_operation_duration_seconds',
    help: 'GraphQL request duration in seconds; operation is the root field, or "multiple"',
    labelNames: ['operation', 'type', 'outcome'] as const,
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  let userErrorTypes: ReadonlySet<string> = new Set();

  return {
    async serverWillStart({ schema }) {
      userErrorTypes = userErrorTypeNames(schema);
    },

    async requestDidStart() {
      const start = performance.now();
      const fields: RootField[] = [];

      return {
        async executionDidStart() {
          return {
            willResolveField({ info }) {
              if (info.path.prev !== undefined) return;
              return (_error, result) => {
                const typename = (result as { __typename?: unknown } | null | undefined)?.__typename;
                fields.push({
                  name: info.fieldName,
                  key: String(info.path.key),
                  typename: typeof typename === 'string' ? typename : '',
                });
              };
            },
          };
        },

        async willSendResponse({ operation, errors }) {
          const type = operation?.operation ?? 'unknown';
          const outcomes = classify(fields, errors ?? [], userErrorTypes);

          let requestOutcome: Outcome = 'success';
          for (const { operation: name, outcome, result } of outcomes) {
            operations.inc({ operation: name, type, outcome, result });
            requestOutcome = worst(requestOutcome, outcome);
          }
          // Errors outside any root field (e.g. while serializing) still count against the request.
          for (const error of errors ?? []) {
            if (error.path === undefined) requestOutcome = worst(requestOutcome, errorOutcome(error));
          }

          const name = outcomes.length === 1 ? outcomes[0]!.operation : 'multiple';
          duration.observe({ operation: name, type, outcome: requestOutcome }, (performance.now() - start) / 1000);
        },
      };
    },
  };
}
