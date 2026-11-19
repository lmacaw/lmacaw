import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

export function foldText(value: string): string {
	return value.toLowerCase().replace(/đ/g, 'd').normalize('NFC');
}

export function ftsQuery(input: string): string | null {
	const terms = foldText(input).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
	return terms.map((term) => {
		// Match unicode61's Latin diacritic folding while preserving other scripts.
		const folded = term.normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
		return `"${folded}"*`;
	}).join(' ') || null;
}

export function indexItem(db: D1Database, itemId: string, ownerId?: string): D1PreparedStatement[] {
	// unicode61 handles case and diacritics during indexing. It needs an explicit mapping for đ.
	const ownership = ownerId === undefined ? '' : ' AND i.owner_id = ?';
	const params = ownerId === undefined ? [itemId] : [itemId, ownerId];
	return [
		db.prepare(`
			DELETE FROM item_search WHERE item_id IN (SELECT i.id FROM items i WHERE i.id = ?${ownership})
		`).bind(...params),
		db.prepare(`
			INSERT INTO item_search (item_id, owner_id, shared, body)
			SELECT i.id, i.owner_id, i.shared, replace(replace(lower(
				coalesce(nullif(i.description, ''), a.description, '') || ' ' ||
				coalesce((
					SELECT group_concat(value, ' ')
					FROM json_each(CASE WHEN json_array_length(i.tags) > 0 THEN i.tags ELSE a.suggested_tags END)
				), '') || ' ' ||
				coalesce(i.ocr_override, a.extracted_text, '') || ' ' ||
				coalesce(json_extract(i.source_metadata, '$.creator'), '') || ' ' ||
				coalesce(json_extract(i.source_metadata, '$.title'), '')
			), 'đ', 'd'), 'Đ', 'd')
			FROM items i LEFT JOIN item_analysis a ON a.item_id = i.id
			WHERE i.id = ?${ownership}
		`).bind(...params)
	];
}
