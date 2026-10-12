'use strict';
// Test runner preloader: loopback test HTTP only; no cloud credentials or outbound TCP.
for (const key of ['DATABASE_URL', 'CONSTRUCTION_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
const net = require('node:net');
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = args[0];
  const options = Array.isArray(a) ? a[0] : a;
  const host = typeof options === 'object' ? options?.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (typeof options === 'string' || options?.path || !['localhost', '127.0.0.1', '::1', undefined].includes(host)) {
    throw new Error('PHASE0_EXTERNAL_CONNECTION_BLOCKED');
  }
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, ...rest) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('PHASE0_EXTERNAL_FETCH_BLOCKED');
  return originalFetch(input, ...rest);
};
