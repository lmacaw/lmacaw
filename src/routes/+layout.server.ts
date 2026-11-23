import { authMode } from '$lib/server/env';
import type { LayoutServerLoad } from './$types';

// Every page needs the mode for the footer, including the link pages that have no loader of their own.
export const load: LayoutServerLoad = ({ platform }) => ({ mode: platform?.env ? authMode(platform.env) : 'password' as const });
