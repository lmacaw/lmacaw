// ORIGIN may list several browser addresses, comma-separated, e.g. a public domain and a LAN IP.
// adapter-node accepts exactly one, so it gets the first; the whole list is kept for the Origin
// check in src/lib/server/request.ts.
const origins = (process.env.ORIGIN ?? '').split(',').map((entry) => entry.trim().replace(/\/+$/, '')).filter(Boolean);
if (origins.length) {
	process.env.ORIGIN = origins[0];
	process.env.LMACAW_ORIGINS = origins.join(',');
}
await import('../build/index.js');
