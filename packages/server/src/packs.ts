import { TypePackSchema, type EntityType, type FieldDef, type TypePack } from '@worldloom/shared';

const f = (key: string, label: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type, perContinuity: false, ...extra });
const rel = (key: string, label: string, to: string, kind: string, multiple = true, extra: Partial<FieldDef> = {}) =>
  f(key, label, 'relation', { relationTo: to, relationKind: kind, multiple, ...extra });
const T = (slug: string, name: string, icon: string, fields: FieldDef[], bodyTemplate: string): EntityType => ({ id: slug, slug, name, icon, fields, bodyTemplate });

export const SERIES_PACK: TypePack = TypePackSchema.parse({
  name: 'Series lore',
  description: 'Characters, factions, power systems and arcs for manhwa, anime and novel series.',
  types: [
    T('character', 'Character', 'user', [
      f('species', 'Species / race', 'text'),
      f('status', 'Status', 'select', { options: ['alive', 'dead', 'unknown'], perContinuity: true }),
      f('firstAppearance', 'First appearance', 'text'),
      rel('affiliations', 'Affiliations', 'faction', 'member_of'),
      rel('allies', 'Allies', 'character', 'ally'),
      rel('enemies', 'Enemies', 'character', 'enemy'),
      rel('mentor', 'Mentor', 'character', 'master_student', false),
      rel('abilities', 'Abilities', 'ability', 'knows'),
      rel('items', 'Items', 'item', 'owns'),
      f('tier', 'Tier', 'tier', { perContinuity: true, tierSystemId: 'tempering' }),
    ], '{{infobox}}\n\n## Appearance\n\n## Personality\n\n## History\n\n## Abilities\n\n## Relationships\n\n## Trivia\n\n## Quotes\n'),
    T('faction', 'Faction', 'flag', [
      f('kind', 'Kind', 'text'), rel('leaders', 'Leaders', 'character', 'leader'), rel('members', 'Notable members', 'character', 'member'),
      rel('territory', 'Territory', 'location', 'holds'), rel('allies', 'Allies', 'faction', 'ally'), rel('enemies', 'Enemies', 'faction', 'enemy'),
    ], '{{infobox}}\n\n## Overview\n\n## Hierarchy\n\n## History\n'),
    T('location', 'Location', 'map-pin', [
      f('kind', 'Kind', 'text'), rel('region', 'Region', 'location', 'parent', false), rel('inhabitants', 'Inhabitants', 'character', 'lives_in'),
    ], '{{infobox}}\n\n## Description\n\n## Notable events\n'),
    T('ability', 'Ability', 'zap', [
      f('kind', 'Kind', 'text'), f('tier', 'Tier', 'tier', { tierSystemId: 'tempering' }), f('cost', 'Cost / limits', 'longtext'),
      rel('users', 'Users', 'character', 'used_by'), rel('counters', 'Counters', 'ability', 'counter'),
    ], '{{infobox}}\n\n## Mechanics\n\n## Users\n\n## Evolution\n\n## Counters\n'),
    T('item', 'Item', 'gem', [rel('owners', 'Owners', 'character', 'owned_by'), f('tier', 'Tier', 'tier', { tierSystemId: 'tempering' }), f('effects', 'Effects', 'longtext'), f('origin', 'Origin', 'text')],
      '{{infobox}}\n\n## Effects\n\n## Origin\n'),
    T('race', 'Race / species', 'users', [f('habitat', 'Habitat', 'text'), f('traits', 'Traits', 'longtext')], '{{infobox}}\n\n## Traits\n\n## Notable members\n'),
    T('concept', 'Concept / power system', 'book', [f('kind', 'Kind', 'text')], '{{infobox}}\n\n## Explanation\n\n## Rules\n\n## Loopholes\n\n## Examples\n'),
    T('arc', 'Arc summary', 'bookmark', [f('arcId', 'Arc', 'arc'), f('source', 'Primary source', 'source'), rel('characters', 'Characters involved', 'character', 'appears')],
      '{{infobox}}\n\n## Summary\n\n## Key events\n'),
    T('event', 'Event', 'calendar', [f('when', 'When', 'inWorldDate'), rel('participants', 'Participants', 'character', 'participant'), rel('where', 'Location', 'location', 'at', false)],
      '{{infobox}}\n\n## Summary\n\n## Aftermath\n'),
    T('theory', 'Theory', 'lightbulb', [f('confidence', 'Confidence', 'select', { options: ['wild', 'plausible', 'likely'] })], '## Claim\n\n## Evidence\n\n## Counter-evidence\n'),
    T('glossary', 'Glossary term', 'tag', [], '**Term** — definition.\n'),
  ],
});

export const CAMPAIGN_PACK: TypePack = TypePackSchema.parse({
  name: 'TTRPG campaign',
  description: 'NPCs, locations, quests and session logs, with DM-only content support.',
  types: [
    T('pc', 'Player character', 'user', [f('player', 'Player', 'text'), f('class', 'Class / role', 'text'), f('level', 'Level', 'number'), rel('allies', 'Allies', 'npc', 'ally')], '{{infobox}}\n\n## Backstory\n\n## Notes\n'),
    T('npc', 'NPC', 'user', [
      f('role', 'Role', 'text'), f('attitude', 'Attitude', 'select', { options: ['friendly', 'neutral', 'hostile'] }), rel('location', 'Found at', 'location', 'found_at', false),
      rel('faction', 'Faction', 'faction', 'member_of', false),
    ], '{{infobox}}\n\n## Description\n\n## Personality\n\n## Secrets\n\n:::dm\nDM-only notes.\n:::\n'),
    T('location', 'Location', 'map-pin', [f('kind', 'Kind', 'text'), rel('region', 'Region', 'location', 'parent', false)], '{{infobox}}\n\n## Description\n\n## Points of interest\n\n:::dm\nDM-only notes.\n:::\n'),
    T('faction', 'Faction', 'flag', [f('goal', 'Goal', 'text'), rel('leaders', 'Leaders', 'npc', 'leader')], '{{infobox}}\n\n## Overview\n\n:::dm\nTrue agenda.\n:::\n'),
    T('quest', 'Quest', 'scroll', [f('state', 'State', 'select', { options: ['rumor', 'active', 'completed', 'failed'] }), rel('giver', 'Given by', 'npc', 'given_by', false), f('reward', 'Reward', 'text')], '{{infobox}}\n\n## Hook\n\n## Objectives\n\n## Outcome\n'),
    T('session-log', 'Session log', 'notebook', [f('session', 'Session #', 'number'), f('played', 'Date played', 'date'), rel('present', 'Present', 'pc', 'present')], '## Recap\n\n## Key moments\n\n## Loose threads\n'),
    T('item', 'Item', 'gem', [rel('holder', 'Holder', 'npc', 'held_by', false), f('effects', 'Effects', 'longtext')], '{{infobox}}\n\n## Description\n\n:::dm\nTrue properties.\n:::\n'),
    T('lore', 'Lore', 'book', [], '## Summary\n\n## Details\n'),
  ],
});

export const BUILTIN_PACKS: Record<string, TypePack> = { 'series-lore': SERIES_PACK, 'ttrpg-campaign': CAMPAIGN_PACK };
