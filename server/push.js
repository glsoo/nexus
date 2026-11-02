import crypto from 'node:crypto';
import path from 'node:path';
import { httpError } from './projects.js';
import { NEXUS_HOME, readJson, writeAtomic } from './util.js';

// Web Push with node:crypto alone (RFC 8291 encryption, RFC 8292 VAPID), so a phone hears from Nexus with the app closed.
// The server's key pair and the browsers' subscriptions live in ~/.nexus/push.json.
const file = () => path.join(NEXUS_HOME, 'push.json');
const b64 = buf => Buffer.from(buf).toString('base64url');

function load() {
  const data = readJson(file(), null);
  if (data?.privateKey) return data;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  // The last 65 bytes of a P-256 SPKI key are the uncompressed point browsers want.
  const fresh = { publicKey: b64(publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)), privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), subscriptions: [] };
  writeAtomic(file(), JSON.stringify(fresh));
  return fresh;
}
const save = data => writeAtomic(file(), JSON.stringify(data));

export const publicKey = () => load().publicKey;

export function subscribe(sub) {
  let url;
  try { url = new URL(sub?.endpoint); } catch { url = null; }
  const key = Buffer.from(String(sub?.keys?.p256dh), 'base64url'), auth = Buffer.from(String(sub?.keys?.auth), 'base64url');
  if (url?.protocol !== 'https:' || key.length !== 65 || auth.length !== 16) throw httpError(400, 'That is not a valid push subscription.');
  const data = load();
  data.subscriptions = [...data.subscriptions.filter(s => s.endpoint !== url.href), { endpoint: url.href, keys: { p256dh: b64(key), auth: b64(auth) } }];
  save(data);
}

export function unsubscribe(endpoint) {
  const data = load();
  data.subscriptions = data.subscriptions.filter(s => s.endpoint !== endpoint);
  save(data);
}

const newKeys = () => { const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); return ecdh; };
const hkdf = (ikm, salt, info, length) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));

// One aes128gcm record: salt, record size, our public key, then the ciphertext with its padding delimiter.
export function encrypt(sub, text, salt = crypto.randomBytes(16), ecdh = newKeys()) {
  const ua = Buffer.from(sub.keys.p256dh, 'base64url'), as = ecdh.getPublicKey();
  const ikm = hkdf(ecdh.computeSecret(ua), Buffer.from(sub.keys.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const cipher = crypto.createCipheriv('aes-128-gcm', hkdf(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hkdf(ikm, salt, 'Content-Encoding: nonce\0', 12));
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head);
  head.writeUInt32BE(4096, 16);
  head[20] = as.length;
  return Buffer.concat([head, as, body]);
}

export function vapid(endpoint, data = load()) {
  const part = o => b64(JSON.stringify(o));
  // Apple rejects a mailto: at a domain that doesn't exist, so the contact is the project page.
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://github.com/glsoo/nexus' })}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: data.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64(sig)}, k=${data.publicKey}`;
}

// Sends to every subscribed browser; ones the push service says are gone (404/410) are dropped.
export async function notify(message) {
  const data = load();
  const gone = [];
  await Promise.all(data.subscriptions.map(async sub => {
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST', body: encrypt(sub, JSON.stringify(message)), signal: AbortSignal.timeout(15000),
        headers: { authorization: vapid(sub.endpoint, data), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' },
      });
      if (res.status === 404 || res.status === 410) gone.push(sub.endpoint);
      else if (!res.ok) console.error(`Web Push to ${new URL(sub.endpoint).host} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
      console.error(`Web Push to ${new URL(sub.endpoint).host} failed: ${err.message}`);
    }
  }));
  for (const endpoint of gone) unsubscribe(endpoint);
}
