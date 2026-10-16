// Skrytý vstup správce: PIN je jen zámek proti omylu (hash leží ve veřejném repozitáři).
// Skutečná ochrana úprav je přístupový token k GitHubu, který zná jen správce.

export const PIN_RE = /^\d{4,8}$/;
const ITER = 200000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

export async function makeAdminFile(pin) {
  if (!PIN_RE.test(pin)) throw new Error('PIN má mít 4 až 8 číslic.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), hash: b64(await derive(pin, salt, ITER)) }) + '\n';
}

// text admin.json -> { iter, salt, hash } nebo null (žádný / neplatný = bez PINu)
export function parseAdminFile(text) {
  try {
    const d = JSON.parse(text);
    if (d && d.v === 1 && Number.isInteger(d.iter) && d.iter >= 1000 && d.iter <= 1000000 && typeof d.salt === 'string' && typeof d.hash === 'string') return d;
  } catch { /* nic */ }
  return null;
}

export async function checkPin(pin, admin) {
  if (!PIN_RE.test(pin)) return false;
  const got = new Uint8Array(await derive(pin, unb64(admin.salt), admin.iter));
  const want = unb64(admin.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
