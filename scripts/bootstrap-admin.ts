import { bootstrapAdmin } from '../src/lib/server/auth';
import { db } from '../src/lib/server/db';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
const sql = db();
try {
	const user = await bootstrapAdmin(sql, email, password);
	console.log(`Created administrator ${user.email}`);
} finally {
	await sql.close();
}
