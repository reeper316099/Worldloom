import { z } from 'zod';

const id = z.string().min(1).max(100);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'invalid slug').max(120);
const iso = z.string();

export const RevealSchema = z.union([
  z.object({ sourceId: id, at: z.number() }),
  z.object({ arcId: id }),
]);
export type Reveal = z.infer<typeof RevealSchema>;

export const ContinuitySchema = z.object({
  id,
  name: z.string().min(1),
  color: z.string().default('#888888'),
  order: z.number().default(0),
  isPrimary: z.boolean().default(false),
});
export type Continuity = z.infer<typeof ContinuitySchema>;

export const SourceKinds = [
  'web_novel', 'light_novel', 'manga', 'manhwa', 'manhua', 'anime',
  'game', 'campaign', 'video', 'wiki', 'other',
] as const;
export const SourceSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(SourceKinds),
  continuityId: id,
  units: z.object({
    label: z.enum(['Chapter', 'Episode', 'Volume', 'Session']),
    count: z.number().int().positive().optional(),
  }),
  url: z.string().optional(),
  notes: z.string().default(''),
});
export type Source = z.infer<typeof SourceSchema>;

export const ArcSchema = z.object({
  id,
  name: z.string().min(1),
  order: z.number(),
  ranges: z.record(z.object({ from: z.number(), to: z.number() })).default({}),
  summary: z.string().default(''),
});
export type Arc = z.infer<typeof ArcSchema>;

export const TierSystemSchema = z.object({
  id,
  name: z.string().min(1),
  scale: z.enum(['ordinal', 'numeric']).default('ordinal'),
  tiers: z.array(
    z.object({
      id,
      name: z.string(),
      order: z.number(),
      description: z.string().default(''),
      color: z.string().optional(),
    }),
  ),
  reveal: RevealSchema.optional(),
});
export type TierSystem = z.infer<typeof TierSystemSchema>;

export const ProgressSchema = z.object({
  sources: z.record(z.number()).default({}),
  arcCheckpoint: id.optional(),
  showAll: z.boolean().default(false),
  /** Item keys the user clicked "reveal this" on. */
  revealed: z.array(z.string()).default([]),
  /** 'conservative' = checkpoint implies only the lowest (range start) floor for non-primary sources. */
  impliedFloor: z.enum(['conservative', 'full']).default('conservative'),
});
export type Progress = z.infer<typeof ProgressSchema>;

export const WorldSchema = z.object({
  schemaVersion: z.number().default(1),
  name: z.string().min(1),
  slug,
  description: z.string().default(''),
  cover: z.string().optional(),
  accent: z.string().default('#7c5cff'),
  theme: z.object({ readingFont: z.enum(['serif', 'sans']).default('sans') }).default({}),
  createdAt: iso,
  continuities: z.array(ContinuitySchema).default([]),
  sources: z.array(SourceSchema).default([]),
  arcs: z.array(ArcSchema).default([]),
  tierSystems: z.array(TierSystemSchema).default([]),
  calendar: z.unknown().optional(),
  progress: ProgressSchema.default({}),
});
export type World = z.infer<typeof WorldSchema>;

export const FieldTypes = [
  'text', 'longtext', 'number', 'select', 'multiselect', 'boolean', 'date',
  'inWorldDate', 'relation', 'tier', 'stat', 'image', 'url', 'source', 'arc',
] as const;
export const FieldDefSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string(),
  type: z.enum(FieldTypes),
  options: z.array(z.string()).optional(),
  relationTo: z.string().optional(),
  relationKind: z.string().optional(),
  multiple: z.boolean().optional(),
  tierSystemId: z.string().optional(),
  max: z.number().optional(),
  perContinuity: z.boolean().default(false),
  defaultReveal: RevealSchema.optional(),
});
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const EntityTypeSchema = z.object({
  id,
  name: z.string().min(1),
  slug,
  icon: z.string().optional(),
  color: z.string().optional(),
  fields: z.array(FieldDefSchema).default([]),
  bodyTemplate: z.string().default(''),
});
export type EntityType = z.infer<typeof EntityTypeSchema>;
export const EntityTypesFileSchema = z.object({
  schemaVersion: z.number().default(1),
  types: z.array(EntityTypeSchema),
});

export const PageStatus = z.enum(['stub', 'draft', 'complete']);
/** Frontmatter of a page .md file (body is stored after the frontmatter). */
export const PageMetaSchema = z.object({
  id,
  type: z.string(), // entity type slug
  title: z.string().min(1),
  slug,
  aliases: z.array(z.string()).default([]),
  redirectsTo: z.string().optional(),
  status: PageStatus.default('stub'),
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  fields: z.record(z.unknown()).default({}),
  appliesTo: z.union([z.literal('all'), z.array(z.string())]).default('all'),
  reveal: RevealSchema.optional(),
  dmOnly: z.boolean().default(false),
  createdAt: iso,
  updatedAt: iso,
});
export type PageMeta = z.infer<typeof PageMetaSchema>;
export type Page = PageMeta & { body: string };

export const PageCreateSchema = z.object({
  type: z.string(),
  title: z.string().min(1),
  slug: slug.optional(),
  aliases: z.array(z.string()).optional(),
  status: PageStatus.optional(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  fields: z.record(z.unknown()).optional(),
  appliesTo: PageMetaSchema.shape.appliesTo.optional(),
  reveal: RevealSchema.optional(),
  dmOnly: z.boolean().optional(),
  redirectsTo: z.string().optional(),
  body: z.string().default(''),
});
export const PagePatchSchema = PageCreateSchema.partial();

export const RelationSchema = z.object({
  id,
  fromId: id,
  toId: id,
  kind: z.string(),
  label: z.string().optional(),
  reveal: RevealSchema.optional(),
  timeSpan: z.object({ fromArcId: z.string().optional(), toArcId: z.string().optional() }).optional(),
  continuityIds: z.array(z.string()).optional(),
});
export type Relation = z.infer<typeof RelationSchema>;
export const RelationsFileSchema = z.object({
  schemaVersion: z.number().default(1),
  relations: z.array(RelationSchema).default([]),
});

export const RevisionSchema = z.object({
  pageId: id,
  ts: z.string(),
  summary: z.string().default(''),
  name: z.string().optional(),
  snapshot: PageMetaSchema.extend({ body: z.string() }),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const ReadMode = z.enum(['reader', 'author']);
export type ReadModeT = z.infer<typeof ReadMode>;

/** Shareable bundle of entity types (import/export as JSON). */
export const TypePackSchema = z.object({
  schemaVersion: z.number().default(1),
  kind: z.literal('worldloom-type-pack').default('worldloom-type-pack'),
  name: z.string().min(1),
  description: z.string().default(''),
  types: z.array(EntityTypeSchema).min(1),
});
export type TypePack = z.infer<typeof TypePackSchema>;
