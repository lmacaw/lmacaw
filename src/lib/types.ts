export type SourceMetadata = { source?: string; creator?: string; creatorUrl?: string; attribution?: string; license?: string; licenseUrl?: string };
export type Item = {
	id: string; description: string; tags: string[]; favorite: boolean; shared: boolean; content_type: string;
	ai_state?: string | null; ai_description?: string | null; extracted_text?: string | null; suggested_tags?: string[] | null;
	source_metadata?: SourceMetadata | null;
};
export type Collection = { id: string; name: string; hasItem?: boolean };
export type Discovery = { id: string; title: string; thumbnail: string; attribution: string };
export type Scope = 'library' | 'favorites' | 'shared' | 'collection' | 'discover';
