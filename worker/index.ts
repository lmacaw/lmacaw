import { workerConfig } from './config';
import { analyzeImage, embedDocument, embedQuery } from './models';

const config = workerConfig(process.env);
const headers = { authorization: `Bearer ${config.token}` };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Job = { id: string; kind: 'image' | 'query' | 'document'; itemId: string | null; query: string | null; text: string | null; leaseToken: string };

async function postJob(job: Job, body: object) {
	const response = await fetch(`${config.serverUrl}/api/v1/worker/jobs/${job.id}`, { method: 'POST', headers: { ...headers, 'x-job-lease': job.leaseToken, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error('Job request failed');
}

for (;;) {
	let job: Job | null = null;
	try {
		const response = await fetch(`${config.serverUrl}/api/v1/worker/jobs/claim`, { method: 'POST', headers, signal: AbortSignal.timeout(15_000) });
		if (!response.ok) throw new Error('Worker authentication or connection failed');
		job = ((await response.json()) as { job: Job | null }).job;
		if (!job) { await sleep(2000); continue; }
		const active = job;
		const heartbeat = setInterval(() => void postJob(active, { action: 'heartbeat' }).catch(() => {}), 60_000);
		try {
			if (job.kind === 'image') {
				const media = await fetch(`${config.serverUrl}/api/v1/worker/jobs/${job.id}/media`, { headers: { ...headers, 'x-job-lease': job.leaseToken }, signal: AbortSignal.timeout(30_000) });
				if (!media.ok) throw new Error('Media unavailable');
				await postJob(job, { action: 'image', result: await analyzeImage(new Uint8Array(await media.arrayBuffer()), config) });
			} else if (job.kind === 'document') {
				await postJob(job, { action: 'document', embedding: await embedDocument(job.text ?? '', config), model: config.embeddingModel });
			} else {
				if (!job.query) throw new Error('Query missing');
				await postJob(job, { action: 'query', embedding: await embedQuery(job.query, config), model: config.embeddingModel });
			}
		} finally { clearInterval(heartbeat); }
	} catch (error) {
		if (job) await postJob(job, { action: 'fail' }).catch(() => {});
		console.error(`Worker could not process a task (${error instanceof Error ? error.message : 'unknown error'}); retrying.`);
		await sleep(5000);
	}
}
