import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: 'src/graphql/schema.graphql',
  generates: {
    'src/graphql/generated.ts': {
      plugins: ['typescript', 'typescript-resolvers'],
      config: {
        federation: true,
        useIndexSignature: true,
        useTypeImports: true,
        enumsAsTypes: true,
        contextType: './context.js#GraphQLContext',
        // Resolvers return service-layer objects; field resolvers map them to the SDL shape.
        mappers: {
          User: '../modules/users/users.repository.js#UserRow',
          Session: '../modules/sessions/sessions.repository.js#SessionRow',
          AuthEvent: '../modules/events/auth-events.repository.js#AuthEventRow',
        },
        scalars: {
          DateTime: 'Date',
        },
        resolversNonOptionalTypename: { unionMember: true },
      },
    },
  },
};

export default config;
