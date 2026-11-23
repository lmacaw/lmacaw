// Public mode has no members: sharing there puts the item on the public site.
export function shareTitle(shared: boolean, publicMode: boolean): string {
	if (publicMode) return shared ? 'Shown on public site' : 'Show on public site';
	return shared ? 'Shared with members' : 'Share with members';
}
