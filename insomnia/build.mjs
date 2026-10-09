// Builds insomnia/collection.yaml, one collection with every API, from the per-service
// collections in services/*/insomnia/collection.yaml. Edit those, then run `yarn build` here.
//
// - One top folder per service (api-gateway first) holding that service's folders.
// - GraphQL operations go through Apollo Router, like the mobile app. Federation queries
//   (_service, _entities) and plain HTTP endpoints (/health, /ready, JWKS) go straight to the
//   service, because the router doesn't expose them.
// - Each service's `baseUrl` becomes `<service>Url` (auth → authUrl), so every service keeps
//   its own address in one environment.
// - Every id is derived from the source id, so importing this next to a service collection
//   doesn't move requests between the two, and rebuilding gives the same ids.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const servicesDir = join(here, '..', 'services');
const outFile = join(here, 'collection.yaml');

const GATEWAY = 'api-gateway';
const ROUTER_VAR = urlVar(GATEWAY);
// The root collection always goes through the router, so a service's own `gateway`
// sub-environment (its baseUrl pointed at :4000) means nothing here.
const SKIP_SUB_ENVS = new Set(['gateway']);
const FEDERATION_QUERY = /\b_(service|entities)\b/;

function urlVar(service) {
  return service.replace(/-(\w)/g, (_, c) => c.toUpperCase()) + 'Url';
}

function hash(value) {
  return createHash('md5').update(`root:${value}`).digest('hex');
}

function rootId(id) {
  return `${id.split('_')[0]}_${hash(id)}`;
}

// Points every `baseUrl` reference (templates and script lookups) at `target`.
function retarget(value, target) {
  if (typeof value === 'string') {
    return value
      .replace(/\{\{\s*(_\.)?baseUrl\s*\}\}/g, `{{ _.${target} }}`)
      .replace(/(['"])baseUrl\1/g, `$1${target}$1`);
  }
  if (Array.isArray(value)) return value.map((v) => retarget(v, target));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, retarget(v, target)]));
  }
  return value;
}

function convert(node, serviceVar) {
  const meta = { ...node.meta, id: rootId(node.meta.id) };
  if (node.children) {
    return { ...node, meta, children: node.children.map((child) => convert(child, serviceVar)) };
  }
  const isGraphql = node.url?.includes('graphqlPath');
  const direct = !isGraphql || FEDERATION_QUERY.test(node.body?.text ?? '');
  return retarget({ ...node, meta }, direct ? serviceVar : ROUTER_VAR);
}

// Sets data[key], keeping the first value and warning when two services disagree.
function merge(data, key, value, source) {
  if (key in data && data[key] !== value) {
    console.warn(`! ${source}: ${key}=${JSON.stringify(value)} ignored, keeping ${JSON.stringify(data[key])}`);
    return;
  }
  data[key] = value;
}

const services = readdirSync(servicesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(servicesDir, d.name, 'insomnia', 'collection.yaml')))
  .map((d) => d.name)
  .sort((a, b) => (a === GATEWAY ? -1 : b === GATEWAY ? 1 : a.localeCompare(b)));

if (!services.includes(GATEWAY)) {
  throw new Error(`services/${GATEWAY}/insomnia/collection.yaml is missing; the root collection routes GraphQL through it`);
}

const folders = [];
const baseData = { graphqlPath: '/graphql', userAgent: 'Insomnia (root collection)' };
const subEnvs = new Map();
let created = Infinity;
let modified = 0;

services.forEach((service, index) => {
  const source = parse(readFileSync(join(servicesDir, service, 'insomnia', 'collection.yaml'), 'utf8'));
  const serviceVar = urlVar(service);
  created = Math.min(created, source.meta.created);
  modified = Math.max(modified, source.meta.modified);

  folders.push({
    name: source.name,
    meta: {
      id: `fld_${hash(`service:${service}`)}`,
      created: source.meta.created,
      modified: source.meta.modified,
      sortKey: index,
      description: source.meta.description,
    },
    children: source.collection.map((node) => convert(node, serviceVar)),
  });

  const { baseUrl, userAgent, ...vars } = source.environments.data;
  merge(baseData, serviceVar, baseUrl, service);
  for (const [key, value] of Object.entries(vars)) merge(baseData, key, value, service);

  for (const sub of source.environments.subEnvironments ?? []) {
    if (SKIP_SUB_ENVS.has(sub.name)) continue;
    if (!subEnvs.has(sub.name)) {
      subEnvs.set(sub.name, {
        name: sub.name,
        meta: { ...sub.meta, id: `env_${hash(`subenv:${sub.name}`)}` },
        data: {},
        color: sub.color,
      });
    }
    const target = subEnvs.get(sub.name).data;
    for (const [key, value] of Object.entries(sub.data ?? {})) {
      merge(target, key === 'baseUrl' ? serviceVar : key, value, `${service} (${sub.name})`);
    }
  }
});

const collection = {
  type: 'collection.insomnia.rest/5.0',
  name: 'E-commerce API',
  meta: {
    id: `wrk_${hash('workspace')}`,
    created,
    modified,
    description: [
      '# E-commerce API',
      '',
      'Every API in one collection, generated from `services/*/insomnia/collection.yaml` by `insomnia/build.mjs`. **Don\'t edit it in Insomnia:** the next build overwrites it. Edit a service\'s collection and run `yarn build` in `insomnia/`.',
      '',
      `**Routing:** GraphQL operations go through Apollo Router (\`${ROUTER_VAR}\`), like the mobile app. Federation queries (\`_service\`, \`_entities\`) and plain HTTP endpoints go straight to each service (\`authUrl\`, ...), because the router doesn't expose them.`,
      '',
      '**Start:** `podman compose --profile apps up -d` for the router, `yarn dev` in each service, then pick the **local** environment.',
    ].join('\n'),
  },
  collection: folders,
  cookieJar: {
    name: 'Default Jar',
    meta: { id: `jar_${hash('cookie-jar')}`, created, modified },
  },
  environments: {
    name: 'Base Environment',
    meta: { id: `env_${hash('base-environment')}`, created, modified, isPrivate: false },
    data: baseData,
    subEnvironments: [...subEnvs.values()],
  },
};

const header = [
  '# GENERATED by insomnia/build.mjs from services/*/insomnia/collection.yaml. Do not edit by hand:',
  '# edit a service collection and run `yarn build` in insomnia/.',
  '# Import: Insomnia → Create → Import → this file (or use Git Sync on this repo).',
];

// The header goes after `type:`, never above it: Insomnia only tries its v5 importer when the
// file starts with `type: `, otherwise the import fails with "No importers found for file".
const [typeLine, ...rest] = stringify(collection, { lineWidth: 0, aliasDuplicateObjects: false }).split('\n');
writeFileSync(outFile, [typeLine, ...header, ...rest].join('\n'));
console.log(`Wrote ${outFile} from: ${services.join(', ')}`);
