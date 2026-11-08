import { SQL } from 'bun';
import { databaseUrl } from './config';

let client: SQL | undefined;

export function db(): SQL {
	// A transaction left open (for example by a client bug) holds its locks until the session ends.
	// Let PostgreSQL end such sessions instead of letting every pooled connection queue behind them.
	return (client ??= new SQL(databaseUrl(process.env), { connection: { idle_in_transaction_session_timeout: 60_000 } }));
}
