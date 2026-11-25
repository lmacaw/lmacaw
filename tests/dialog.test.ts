import { expect, test } from 'vitest';
import { lightDismiss } from '$lib/dialog';

function fakeDialog() {
	const listeners: Record<string, (event: { target: unknown }) => void> = {};
	const dialog = { closed: 0, close() { dialog.closed++; }, addEventListener: (type: string, listener: never) => { listeners[type] = listener; }, removeEventListener() {} };
	lightDismiss(dialog as unknown as HTMLDialogElement);
	const press = (down: unknown, up: unknown) => { listeners.pointerdown({ target: down }); listeners.click({ target: up }); };
	return { dialog, press };
}

test('a backdrop click closes the dialog; clicks in its content or drags out of it do not', () => {
	const { dialog, press } = fakeDialog();
	const content = {};
	press(content, content);
	press(content, dialog); // a text selection dragged onto the backdrop
	press(dialog, content);
	expect(dialog.closed).toBe(0);
	press(dialog, dialog);
	expect(dialog.closed).toBe(1);
});
