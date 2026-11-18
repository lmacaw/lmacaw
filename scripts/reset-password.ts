// Sets a new password for an existing account and ends its sessions.
//   EMAIL=you@example.com NEW_PASSWORD=... bun run reset-password
import { resetPassword } from '../src/lib/server/auth';
import { db } from '../src/lib/server/db';

const email = process.env.EMAIL;
const password = process.env.NEW_PASSWORD;
if (!email || !password) throw new Error('EMAIL and NEW_PASSWORD are required');
const sql = db();
try {
	if (await resetPassword(sql, email, password)) console.log(`Password reset for ${email.trim().toLowerCase()}; its sessions were signed out`);
	else {
		const users = await sql`SELECT email FROM users ORDER BY created_at`;
		console.error(`No account for ${email}. Accounts: ${users.map((user: { email: string }) => user.email).join(', ') || 'none (run bootstrap-admin)'}`);
		process.exitCode = 1;
	}
} finally {
	await sql.close();
}
