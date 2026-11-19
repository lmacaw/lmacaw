import type { Env } from './env';

export interface Mailer {
	send(to: string, subject: string, text: string): Promise<void>;
}

export class ResendMailer implements Mailer {
	constructor(private readonly apiKey: string, private readonly from: string | undefined) {}

	async send(to: string, subject: string, text: string): Promise<void> {
		if (!this.from) throw new Error('MAIL_FROM is required');
		const response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ from: this.from, to: [to], subject, text })
		});
		if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}`);
	}
}

export class ConsoleMailer implements Mailer {
	async send(_to: string, subject: string, text: string): Promise<void> {
		console.log(subject, text);
	}
}

export function mailerFromEnv(env: Env): Mailer {
	return env.RESEND_API_KEY ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : new ConsoleMailer();
}
