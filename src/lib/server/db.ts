import { SQL } from 'bun';
import { databaseUrl } from './config';

let client: SQL | undefined;

export function db(): SQL {
	return (client ??= new SQL(databaseUrl(process.env)));
}
