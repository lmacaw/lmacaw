export type SourceMetadata = { source?: string; creator?: string; creatorUrl?: string; attribution?: string; license?: string; licenseUrl?: string };
export type Item = {
	id: string; description: string; tags: string[]; favorite: boolean; shared: boolean; content_type: string; width: number; height: number;
	ai_state?: string | null; ai_description?: string | null; extracted_text?: string | null; suggested_tags?: string[] | null;
	source_metadata?: SourceMetadata | null;
	/** From the list: a signed R2 URL, or the media route when signing is off. */
	thumbnail_url?: string;
};
export type Collection = { id: string; name: string; hasItem?: boolean };
export type Discovery = { id: string; title: string; thumbnail: string; attribution: string; saved: boolean };
export type Scope = 'library' | 'favorites' | 'shared' | 'collection' | 'discover';
