import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ locals }) => ({ user: locals.user, aiEnabled: Boolean(process.env.AI_WORKER_TOKEN) });
