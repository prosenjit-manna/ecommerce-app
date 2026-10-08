/**
 * Generates an Ed25519 key pair for signing access tokens and prints .env lines.
 * Usage: yarn keys:generate >> .env   (or copy the lines by hand)
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n');
const kid = `auth-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;

console.log(`JWT_KEY_ID=${kid}`);
console.log(`JWT_PRIVATE_KEY="${oneLine(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())}"`);
console.log(`JWT_PUBLIC_KEY="${oneLine(publicKey.export({ type: 'spki', format: 'pem' }).toString())}"`);
