import type { EntityType, FieldDef } from '@worldloom/shared';

const f = (key: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type,
  perContinuity: false,
  ...extra,
});

/** Default entity types (full templates/type packs arrive in M4). */
export function defaultEntityTypes(): EntityType[] {
  return [
    {
      id: 'character',
      name: 'Character',
      slug: 'character',
      icon: 'user',
      fields: [
        f('species', 'Species', 'text'),
        f('status', 'Status', 'select', { options: ['alive', 'dead', 'unknown'], perContinuity: true }),
        f('firstAppearance', 'First appearance', 'text'),
        f('affiliations', 'Affiliations', 'relation', { relationTo: 'faction', multiple: true, relationKind: 'member_of' }),
        f('allies', 'Allies', 'relation', { relationTo: 'character', multiple: true, relationKind: 'ally' }),
        f('abilities', 'Abilities', 'relation', { relationTo: 'ability', multiple: true, relationKind: 'knows' }),
        f('tier', 'Tier', 'tier'),
      ],
      bodyTemplate: '{{infobox}}\n\n## Appearance\n\n## Personality\n\n## History\n\n## Trivia\n',
    },
    {
      id: 'faction',
      name: 'Faction',
      slug: 'faction',
      icon: 'flag',
      fields: [
        f('kind', 'Kind', 'text'),
        f('leaders', 'Leaders', 'relation', { relationTo: 'character', multiple: true, relationKind: 'leader' }),
        f('territory', 'Territory', 'relation', { relationTo: 'location', multiple: true, relationKind: 'holds' }),
      ],
      bodyTemplate: '{{infobox}}\n\n## Overview\n\n## History\n',
    },
    {
      id: 'location',
      name: 'Location',
      slug: 'location',
      icon: 'map-pin',
      fields: [f('kind', 'Kind', 'text'), f('region', 'Region', 'relation', { relationTo: 'location', relationKind: 'parent' })],
      bodyTemplate: '{{infobox}}\n\n## Description\n\n## Notable events\n',
    },
    {
      id: 'ability',
      name: 'Ability',
      slug: 'ability',
      icon: 'zap',
      fields: [f('kind', 'Kind', 'text'), f('tier', 'Tier', 'tier'), f('cost', 'Cost / limits', 'longtext')],
      bodyTemplate: '{{infobox}}\n\n## Mechanics\n\n## Users\n',
    },
    {
      id: 'item',
      name: 'Item',
      slug: 'item',
      icon: 'gem',
      fields: [f('owners', 'Owners', 'relation', { relationTo: 'character', multiple: true, relationKind: 'owns' }), f('tier', 'Tier', 'tier')],
      bodyTemplate: '{{infobox}}\n\n## Effects\n\n## Origin\n',
    },
    { id: 'concept', name: 'Concept', slug: 'concept', icon: 'book', fields: [], bodyTemplate: '{{infobox}}\n\n## Explanation\n' },
    {
      id: 'event',
      name: 'Event',
      slug: 'event',
      icon: 'calendar',
      fields: [f('when', 'When', 'inWorldDate'), f('participants', 'Participants', 'relation', { relationTo: 'character', multiple: true })],
      bodyTemplate: '{{infobox}}\n\n## Summary\n',
    },
  ];
}
