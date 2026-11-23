// The pool imports main even when tests call server modules directly.
export default {
	fetch: () => new Response(null, { status: 404 })
};
