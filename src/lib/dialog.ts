/**
 * A modal <dialog> ignores clicks on its ::backdrop; those clicks land on the <dialog> element itself.
 * Close only when the press both starts and ends there, so a text selection dragged out of a field
 * onto the backdrop does not close the dialog.
 */
export function lightDismiss(dialog: HTMLDialogElement) {
	let pressedBackdrop = false;
	const down = (event: PointerEvent) => { pressedBackdrop = event.target === dialog; };
	const click = (event: MouseEvent) => {
		if (pressedBackdrop && event.target === dialog) dialog.close();
		pressedBackdrop = false;
	};
	dialog.addEventListener('pointerdown', down);
	dialog.addEventListener('click', click);
	return { destroy() { dialog.removeEventListener('pointerdown', down); dialog.removeEventListener('click', click); } };
}
