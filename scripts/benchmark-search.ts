// Bilingual search benchmark against a running Lmacaw server and AI worker.
//
// Seeds a disposable account with openly licensed Openverse images for a fixed set of topics,
// waits for AI analysis, then measures recall@5 for English and Vietnamese queries: a query
// counts as a hit when one of the top five results came from its topic. Run it only against a
// throwaway server and database; it adds items to the signed-in account.
//
//   BENCH_URL=http://127.0.0.1:5199 BENCH_EMAIL=... BENCH_PASSWORD=... bun run scripts/benchmark-search.ts

const base = process.env.BENCH_URL;
const email = process.env.BENCH_EMAIL, password = process.env.BENCH_PASSWORD;
if (!base || !email || !password) throw new Error('BENCH_URL, BENCH_EMAIL, and BENCH_PASSWORD are required');
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Run the benchmark against a local, disposable server');

const perTopic = Number(process.env.BENCH_PER_TOPIC ?? 3);
const topics = [
	{ seed: 'cat', en: ['kitten', 'a cat'], vi: ['con mèo', 'mèo con'] },
	{ seed: 'dog', en: ['puppy', 'a dog'], vi: ['con chó', 'chó con'] },
	{ seed: 'coffee cup', en: ['espresso', 'hot drink in a mug'], vi: ['cà phê', 'ly cà phê'] },
	{ seed: 'office desk', en: ['workplace', 'working at the office'], vi: ['văn phòng', 'bàn làm việc'] },
	{ seed: 'rain umbrella', en: ['rainy day', 'storm weather'], vi: ['trời mưa', 'cái ô'] },
	{ seed: 'pizza', en: ['fast food', 'italian food'], vi: ['bánh pizza', 'đồ ăn nhanh'] },
	{ seed: 'beach', en: ['seaside', 'ocean shore'], vi: ['bãi biển', 'biển'] },
	{ seed: 'car', en: ['automobile', 'vehicle on the road'], vi: ['xe hơi', 'ô tô'] },
	{ seed: 'baby', en: ['infant', 'newborn child'], vi: ['em bé', 'trẻ sơ sinh'] },
	{ seed: 'laptop computer', en: ['notebook pc', 'programming'], vi: ['máy tính', 'máy tính xách tay'] }
];

const login = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`Sign-in failed: ${login.status}`);
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const headers = { cookie, origin: base };
type Item = { id: string; ai_state?: string | null };
const list = async (q = '') => (await (await fetch(`${base}/api/v1/items?${new URLSearchParams({ q })}`, { headers })).json()) as { items: Item[]; semanticAvailable: boolean };

const topicOf = new Map<string, string>();
for (const topic of topics) {
	const found = (await (await fetch(`${base}/api/v1/discover?${new URLSearchParams({ q: topic.seed })}`, { headers })).json()) as { items?: { id: string }[] };
	let saved = 0;
	for (const candidate of found.items ?? []) {
		if (saved >= perTopic) break;
		const response = await fetch(`${base}/api/v1/discover/save`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ id: candidate.id }) });
		if (!response.ok) continue;
		// A duplicate is an item seeded by an earlier run; reuse it.
		const { item } = (await response.json()) as { item: Item };
		if (topicOf.has(item.id)) continue;
		topicOf.set(item.id, topic.seed); saved++;
	}
	console.log(`seeded ${saved} × ${topic.seed}`);
}

const started = Date.now();
for (;;) {
	const pending = (await list()).items.filter((item) => topicOf.has(item.id) && item.ai_state !== 'complete' && item.ai_state !== 'failed').length;
	if (!pending) break;
	if (Date.now() - started > 30 * 60_000) throw new Error(`${pending} items still unanalysed after 30 minutes`);
	await Bun.sleep(5000);
}
console.log(`analysis finished in ${Math.round((Date.now() - started) / 1000)} s for ${topicOf.size} images`);

const rows: { lang: string; query: string; topic: string; hit: boolean; ms: number }[] = [];
for (const topic of topics) for (const [lang, queries] of [['en', topic.en], ['vi', topic.vi]] as const) for (const query of queries) {
	const t = Date.now();
	const result = await list(query);
	if (!result.semanticAvailable) throw new Error('Semantic search unavailable; is the worker running?');
	const hit = result.items.slice(0, 5).some((item) => topicOf.get(item.id) === topic.seed);
	rows.push({ lang, query, topic: topic.seed, hit, ms: Date.now() - t });
}
for (const lang of ['en', 'vi']) {
	const subset = rows.filter((row) => row.lang === lang);
	const median = subset.map((row) => row.ms).sort((a, b) => a - b)[Math.floor(subset.length / 2)];
	console.log(`${lang}: recall@5 ${subset.filter((row) => row.hit).length}/${subset.length}, median query ${median} ms`);
}
for (const row of rows.filter((row) => !row.hit)) console.log(`miss ${row.lang} "${row.query}" (topic ${row.topic})`);
