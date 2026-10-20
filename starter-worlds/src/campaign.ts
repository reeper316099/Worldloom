import type { StarterWorld, PageDef } from './dsl';

/** Original TTRPG campaign demo with DM-only content and session logs. */
const SECRET = {
  pikeSmuggler: 'Ossian Pike runs the Saltglass Syndicate’s smuggling ring',
  velune: 'Sister Velune is the Syndicate’s informant inside the temple',
  vault: 'A vault of drowned-bell relics sits beneath the lighthouse',
  keyTrue: 'The Saltglass Key opens the lighthouse vault and nothing else',
  rookPlan: 'Captain Rook plans to sink the harbor chain at the next spring tide',
  bellTruth: 'The Drowned Bell tolls when a Syndicate courier dies',
};
const SPOILERS = ['Rook is seen leaving the lighthouse at night', 'a courier is found dead at the door'];
export const CAMPAIGN_SECRETS = [...Object.values(SECRET), ...SPOILERS];
const ses = (at: number) => ({ sourceId: 'sessions', at });
const P = (type: string, title: string, d: Omit<PageDef, 'type' | 'title'>): PageDef => ({ type, title, ...d });

const pages: PageDef[] = [
  P('location', 'Brinemouth', { status: 'complete', fields: { kind: 'Port city' }, body: `{{infobox}}\n\nA fog-bound harbor town where the Gloam Marsh meets the sea. Home of [[The Drowned Bell Inn]] and the [[Tidewardens]].\n\n:::dm\nThe harbor chain is rusting through; ${SECRET.rookPlan}.\n:::\n` }),
  P('location', 'The Drowned Bell Inn', { status: 'complete', fields: { kind: 'Inn', region: 'Brinemouth' }, body: `{{infobox}}\n\nThe party's base. Run by [[Marta Brine]]. A cracked ship's bell hangs over the door.\n\n:::dm\n${SECRET.bellTruth}.\n:::\n` }),
  P('location', 'Gloam Marsh', { status: 'draft', fields: { kind: 'Wetland', region: 'Brinemouth' }, body: `{{infobox}}\n\nA tangle of reed and sinkholes east of [[Brinemouth]]. The party crosses it in [[Session 2: The Marsh Road]].\n` }),
  P('location', 'Skerry Point Lighthouse', { status: 'draft', dmOnly: true, fields: { kind: 'Lighthouse', region: 'Brinemouth' }, body: `{{infobox}}\n\n${SECRET.vault}. The players only know the lamp has been dark for years.\n` }),
  P('faction', 'Tidewardens', { status: 'complete', fields: { goal: 'Keep the harbor lawful', leaders: ['Ossian Pike'] }, body: `{{infobox}}\n\nThe harbor watch. Underfunded, over-trusted.\n\n:::dm\nHalf the watch takes coin from the [[Saltglass Syndicate]].\n:::\n` }),
  P('faction', 'Saltglass Syndicate', { status: 'draft', dmOnly: true, fields: { goal: 'Control the harbor trade' }, body: `{{infobox}}\n\nSmugglers who trade in sea-glass relics. ${SECRET.pikeSmuggler}.\n` }),
  P('npc', 'Marta Brine', { status: 'complete', fields: { role: 'Innkeeper', attitude: 'friendly', location: 'The Drowned Bell Inn' }, body: `{{infobox}}\n\nWarm, nosy, and always listening. Gives the party their first job in [[Session 1: Arrival in Brinemouth]].\n` }),
  P('npc', 'Ossian Pike', { status: 'complete', fields: { role: 'Harbormaster', attitude: 'neutral', location: 'Brinemouth', faction: 'Tidewardens' }, body: `{{infobox}}\n\nStern harbormaster who offers the [[The Missing Ledger]] quest.\n\n:::dm\n${SECRET.pikeSmuggler}.\n:::\n` }),
  P('npc', 'Sister Velune', { status: 'draft', fields: { role: 'Temple priest', attitude: 'friendly', location: 'Brinemouth' }, body: `{{infobox}}\n\nKeeper of the tide shrine.\n\n:::dm\n${SECRET.velune}.\n:::\n` }),
  P('npc', 'Captain Rook', { status: 'draft', fields: { role: 'Rival captain', attitude: 'hostile', location: 'Brinemouth' }, body: `{{infobox}}\n\nA swaggering privateer who shadows the party.\n\n:::spoiler{src="sessions" at=3}\nRook is seen leaving the lighthouse at night.\n:::\n` }),
  P('item', 'Saltglass Key', { status: 'draft', dmOnly: true, fields: { holder: 'Ossian Pike' }, body: `{{infobox}}\n\n${SECRET.keyTrue}.\n` }),
  P('quest', 'The Missing Ledger', { status: 'complete', fields: { state: 'active', giver: 'Ossian Pike', reward: '200 gp' }, body: `{{infobox}}\n\n## Hook\n\nA harbor ledger has vanished. [[Ossian Pike]] wants it found quietly.\n\n## Objectives\n\n- Question [[Marta Brine]]\n- Search the [[Gloam Marsh]]\n` }),
  P('quest', 'Lamps of Skerry Point', { status: 'stub', fields: { state: 'rumor' }, body: `{{infobox}}\n\nVillagers say the lighthouse lamp lit itself last month.\n` }),
  P('session-log', 'Session 1: Arrival in Brinemouth', { status: 'complete', fields: { session: 1 }, body: `## Recap\n\nThe party arrives at [[The Drowned Bell Inn]] and meets [[Marta Brine]].\n\n## Loose threads\n\n- Who stole the [[The Missing Ledger]]?\n` }),
  P('session-log', 'Session 2: The Marsh Road', { status: 'complete', fields: { session: 2 }, body: `## Recap\n\nA tense crossing of the [[Gloam Marsh]].\n\n:::dm\nThe reeds hid a Syndicate dead-drop the party walked past.\n:::\n` }),
  P('session-log', 'Session 3: A Bell Tolls', { status: 'draft', fields: { session: 3 }, reveal: ses(3), body: `## Recap\n\nThe inn bell tolls at midnight and a courier is found dead at the door.\n` }),
  P('lore', 'The Tide Calendar', { status: 'stub', body: `## Summary\n\nBrinemouth marks time by the tides, not the sun. See [[Brinemouth]].\n` }),
];

export const CAMPAIGN: StarterWorld = {
  slug: 'gloamreach-campaign',
  pack: 'ttrpg-campaign',
  secrets: CAMPAIGN_SECRETS,
  spoilerSecrets: SPOILERS,
  world: {
    name: 'Gloamreach Campaign', slug: 'gloamreach-campaign', accent: '#38bdf8',
    description: 'An invented TTRPG campaign demo with DM-only content and session logs.',
    theme: { readingFont: 'sans' },
    continuities: [{ id: 'campaign', name: 'Campaign canon', color: '#38bdf8', order: 0, isPrimary: true }],
    sources: [{ id: 'sessions', name: 'Sessions', kind: 'campaign', continuityId: 'campaign', units: { label: 'Session', count: 12 }, notes: '' }],
    arcs: [
      { id: 'act1', name: 'Act I: Fog', order: 1, ranges: { sessions: { from: 1, to: 4 } }, summary: '' },
      { id: 'act2', name: 'Act II: Tide', order: 2, ranges: { sessions: { from: 5, to: 8 } }, summary: '' },
    ],
    tierSystems: [],
    progress: { sources: { sessions: 2 }, showAll: false, revealed: [], impliedFloor: 'conservative' },
  },
  pages,
  relations: [
    { from: 'Ossian Pike', to: 'Saltglass Syndicate', kind: 'member_of', reveal: ses(6) },
    { from: 'Marta Brine', to: 'Ossian Pike', kind: 'ally' },
  ],
};
