import type { StarterWorld, PageDef } from './dsl';
import { arc, gated, wn } from './dsl';

/** Original, invented setting. No real series, names or text. */
const SECRET = {
  kaelCore: 'his core is a splinter of the Cold Furnace',
  orrinDeath: 'Orrin Vale falls at the Siege of Keld Pass',
  sableIdentity: 'Sable is the part of Kael that the Quench cut away',
  haskelOath: 'Old Haskel swore the first Pyre Oath',
  unlitLeader: 'The Unlit are led by Corvane herself',
  furnaceTruth: 'The Cold Furnace was never a forge; it is a sealed core',
  hollowFlame: 'Hollow Flame burns the user’s own memories',
  crownTruth: 'The Crown of Ash is assembled from every Quenched core',
  quenchTruth: 'The Great Quench was staged by the Ember Ledger',
  zenith: 'Zenith is reachable only by surrendering the Ledger',
  sisterTwist: 'Mira is Kael’s sister by blood in the web novel',
  valdrinDebt: 'House Valdrin owes its fortune to the Unlit',
};
export const SERIES_SECRETS = Object.values(SECRET);

const P = (type: string, title: string, d: Omit<PageDef, 'type' | 'title'>): PageDef => ({ type, title, ...d });

const pages: PageDef[] = [
  // ---------- characters ----------
  P('character', 'Kael Marrow', {
    aliases: ['The Ashen Apprentice', 'Marrow'], status: 'complete', tags: ['protagonist'],
    fields: {
      species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 1',
      affiliations: ['Cinder Guild', 'Order of the Pale Lantern'], allies: ['Mira Ashgrove', 'Tamsin Quill'], enemies: ['Ilex Thorne'], mentor: 'Orrin Vale',
      abilities: ['Ember Step', 'Cinder Sight', 'Ashbind'], items: ['Marrow Blade', 'Ember Ledger'],
      tier: gated('Cinder', wn(100), { adapt: 'Ember' }),
    },
    body: `{{infobox}}

Kael Marrow is the protagonist of the series, a debt-ridden forge sweeper in [[Ashmere]] who awakens a damaged core {{src: Web Novel ch 1}}.

## Appearance

Lean, soot-stained, with a pale scar across the left palm where his first spark failed.

## History

Kael is taken in by [[Orrin Vale]] after the [[Night of Cold Fires]] and enrolled in the [[Cinder Guild]]'s trials. His rise through the [[Tempering]] realms drives the first three arcs.

:::spoiler{src="wn" at=120}
Chapter 120 reveals that ${SECRET.kaelCore}, which is why every [[Ember Ledger]] reading of him is unstable.
:::

## Continuity differences

:::diff
:::continuity{ids="wn"}
In the web novel Kael reaches [[Cinder]] realm by chapter 100 {{src: Web Novel ch 100}}.
:::
:::continuity{ids="adapt"}
In the adaptation Kael is still only [[Ember]] realm at the end of the trials {{src: Adaptation ep 11}}.
:::
:::

## Trivia

{{claim: inferred}}His surname hints at the Marrow Blade's origin.{{/claim}}
`,
  }),
  P('character', 'Mira Ashgrove', {
    aliases: ['Mir'], status: 'complete', fields: { species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 2', allies: ['Kael Marrow'], affiliations: ['Order of the Pale Lantern'], abilities: ['Quench'] },
    body: `{{infobox}}

Mira is Kael's constant companion and the first person he trusts.

:::diff
:::continuity{ids="wn"}
In the web novel she is introduced as Kael's younger sister {{src: Web Novel ch 2}}.
:::
:::continuity{ids="adapt"}
In the adaptation she is a childhood friend from the same alley {{src: Adaptation ep 1}}.
:::
:::

:::spoiler{src="wn" at=180}
In the web novel, ${SECRET.sisterTwist}.
:::
`,
  }),
  P('character', 'Tamsin Quill', {
    status: 'draft', fields: { species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 14', affiliations: ['Cinder Guild'], allies: ['Kael Marrow'], items: ['Ember Ledger'] },
    body: `{{infobox}}

Archivist of the [[Cinder Guild]] and keeper of the [[Ember Ledger]]. Dry-witted and perpetually behind on paperwork.

## History

Tamsin audits Kael's trial scores in the [[Lantern Trials]] arc {{src: Web Novel ch 52}}.
`,
  }),
  P('character', 'Orrin Vale', {
    status: 'complete', tags: ['mentor'], fields: { species: 'Human', status: gated('dead', wn(140), { adapt: 'alive' }), firstAppearance: 'Web Novel ch 6', affiliations: ['Wardens of Keld Pass', 'Cinder Guild'], allies: ['Kael Marrow', 'Brannoch Keld'], abilities: ['Pyre Oath', 'Ember Step'], tier: 'Pyre' },
    body: `{{infobox}}

A scarred veteran who becomes Kael's teacher. Gruff, patient, and fond of terrible tea.

## History

Orrin trains Kael through the [[Lantern Trials]] and later takes command of the line at [[Keld Pass]].

:::continuity{ids="wn"}
:::spoiler{src="wn" at=140}
In the web novel, ${SECRET.orrinDeath}.
:::
:::

:::continuity{ids="adapt"}
In the adaptation Orrin survives the siege and retires to [[Ashmere]] {{src: Adaptation ep 16}}.
:::
`,
  }),
  P('character', 'Ilex Thorne', {
    status: 'complete', tags: ['rival'], fields: { species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 22', affiliations: ['House Valdrin'], enemies: ['Kael Marrow'], abilities: ['Ember Step'], tier: 'Cinder' },
    body: `{{infobox}}

Heir of [[House Valdrin]] and Kael's first true rival. Proud, precise, and quietly lonely.

## Relationships

His mother, [[Lady Corvane]], drives his ambition. Ilex later questions the family's methods during the [[Siege of Keld Pass]].

:::spoiler{src="wn" at=160}
He discovers that ${SECRET.valdrinDebt}.
:::
`,
  }),
  P('character', 'Dovan Reth', {
    status: 'draft', fields: { species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 9', affiliations: ['Cinder Guild'], enemies: ['Lady Corvane'], tier: 'Blaze' },
    body: `{{infobox}}\n\nMaster of the [[Cinder Guild]]. Publicly neutral, privately keeping a tally of every favor owed to him in [[Ashmere]].\n`,
  }),
  P('character', 'Sable', {
    aliases: ['Sable the Hollow'], status: 'draft', reveal: arc('a4'), tags: ['antagonist'],
    fields: { species: 'Unknown', status: 'unknown', firstAppearance: 'Web Novel ch 160', affiliations: ['The Unlit'], enemies: ['Kael Marrow'], abilities: ['Hollow Flame'], tier: gated('Pyre', wn(220)) },
    body: `{{infobox}}

A masked figure who stalks the borders of [[Ashmere]], leaving cold fires behind.

:::spoiler{src="wn" at=210}
${SECRET.sableIdentity}.
:::

{{claim: theory}}Sable may be the missing half of Kael's core.{{/claim}} See [[Is Sable Kael's other half?]].
`,
  }),
  P('character', 'Brannoch Keld', {
    status: 'draft', fields: { species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 88', affiliations: ['Wardens of Keld Pass'], allies: ['Orrin Vale'], tier: 'Blaze' },
    body: `{{infobox}}\n\nCommander of the [[Wardens of Keld Pass]]. Holds the pass with discipline and very little sleep.\n`,
  }),
  P('character', 'Yesenna Fray', {
    status: 'stub', fields: { species: 'Human', status: 'alive', affiliations: ['Order of the Pale Lantern'], abilities: ['Quench'] },
    body: `{{infobox}}\n\nA healer of the [[Order of the Pale Lantern]]. This page needs a history and sources.\n`,
  }),
  P('character', 'Pell Anwick', { status: 'stub', fields: { species: 'Human', status: 'alive' }, body: `{{infobox}}\n\nStreet informant in [[Ashmere]]. Knows a rumor about the [[Third Lantern]].\n` }),
  P('character', 'Joro Wyn', { aliases: ['Captain Wyn'], status: 'stub', fields: { species: 'Human', status: 'alive' }, body: `{{infobox}}\n\nCaravan captain who ferries supplies to [[Keld Pass]].\n` }),
  P('character', 'Lady Corvane', {
    status: 'draft', fields: { species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 30', affiliations: ['House Valdrin'], tier: 'Pyre' },
    body: `{{infobox}}\n\nMatriarch of [[House Valdrin]]; patron of the [[Vale Estate]] hunt.\n\n:::spoiler{src="wn" at=190}\n${SECRET.unlitLeader}.\n:::\n`,
  }),
  P('character', 'Old Haskel', {
    status: 'stub', fields: { species: 'Human', status: 'alive', firstAppearance: 'Web Novel ch 3', abilities: ['Pyre Oath'] },
    body: `{{infobox}}\n\nCrotchety keeper of [[The Sunken Forge]].\n\n:::spoiler{src="wn" at=175}\n${SECRET.haskelOath}.\n:::\n`,
  }),

  // ---------- factions ----------
  P('faction', 'Cinder Guild', { status: 'complete', fields: { kind: 'Guild', leaders: ['Dovan Reth'], members: ['Kael Marrow', 'Tamsin Quill', 'Orrin Vale'], territory: ['Ashmere'], enemies: ['House Valdrin'] }, body: `{{infobox}}\n\n## Overview\n\nThe merchant-warrior guild that runs the trials in [[Ashmere]] and records every adept in the [[Ember Ledger]].\n\n## History\n\nFounded after the [[Night of Cold Fires]] to prevent another unchecked [[Tempering]] disaster.\n` }),
  P('faction', 'Order of the Pale Lantern', { status: 'draft', fields: { kind: 'Religious order', members: ['Yesenna Fray', 'Mira Ashgrove'], territory: ['Lantern Hall'] }, body: `{{infobox}}\n\nA healing order whose members carry the [[Pale Lantern]] and teach [[Quench]].\n\n## Hierarchy\n\nHeaded from [[Lantern Hall]]. The rumored [[Third Lantern]] is not officially acknowledged.\n` }),
  P('faction', 'House Valdrin', { status: 'draft', fields: { kind: 'Noble house', leaders: ['Lady Corvane'], members: ['Ilex Thorne'], territory: ['Vale Estate'], enemies: ['Cinder Guild'] }, body: `{{infobox}}\n\nOld money with a taste for [[Cores]] collecting.\n` }),
  P('faction', 'The Unlit', { status: 'stub', reveal: wn(150), fields: { kind: 'Secret society', members: ['Sable'] }, body: `{{infobox}}\n\nCult of the cold fires.\n\n:::spoiler{src="wn" at=190}\n${SECRET.unlitLeader}.\n:::\n` }),
  P('faction', 'Wardens of Keld Pass', { status: 'draft', fields: { kind: 'Border garrison', leaders: ['Brannoch Keld'], members: ['Orrin Vale'], territory: ['Keld Pass'] }, body: `{{infobox}}\n\nThe garrison that held [[Keld Pass]] for three generations before the [[Siege of Keld Pass]].\n` }),

  // ---------- locations ----------
  P('location', 'Verrow', { status: 'draft', fields: { kind: 'Continent' }, body: `{{infobox}}\n\nThe continent where the series takes place, shaped by seven realms of [[Tempering]].\n` }),
  P('location', 'Ashmere', { status: 'complete', fields: { kind: 'City', region: 'Verrow', inhabitants: ['Kael Marrow', 'Pell Anwick', 'Dovan Reth'] }, body: `{{infobox}}\n\nA smoke-stained forge city and seat of the [[Cinder Guild]].\n\n## Notable events\n\n- [[Night of Cold Fires]]\n- The [[Lantern Trials]]\n` }),
  P('location', 'Keld Pass', { status: 'draft', fields: { kind: 'Mountain pass', region: 'Verrow' }, body: `{{infobox}}\n\nA narrow road through the Keld range, held by the [[Wardens of Keld Pass]]. Site of the [[Siege of Keld Pass]].\n` }),
  P('location', 'The Sunken Forge', { status: 'stub', fields: { kind: 'Ruin', region: 'Ashmere', inhabitants: ['Old Haskel'] }, body: `{{infobox}}\n\nA flooded forge beneath [[Ashmere]] where Kael first meets [[Old Haskel]].\n` }),
  P('location', 'Lantern Hall', { status: 'stub', fields: { kind: 'Temple', region: 'Ashmere' }, body: `{{infobox}}\n\nSeat of the [[Order of the Pale Lantern]].\n` }),
  P('location', 'The Cold Furnace', { status: 'draft', reveal: arc('a4'), fields: { kind: 'Sealed vault', region: 'Verrow' }, body: `{{infobox}}\n\nThe sealed heart beneath the northern ash fields.\n\n:::spoiler{src="wn" at=200}\n${SECRET.furnaceTruth}.\n:::\n` }),
  P('location', 'Vale Estate', { status: 'stub', fields: { kind: 'Manor', region: 'Verrow' }, body: `{{infobox}}\n\nCountry seat of [[House Valdrin]].\n` }),

  // ---------- abilities ----------
  P('ability', 'Ember Step', { status: 'complete', fields: { kind: 'Movement technique', tier: 'Ember', cost: 'Burns stamina quickly.', users: ['Kael Marrow', 'Orrin Vale', 'Ilex Thorne'] }, body: `{{infobox}}\n\n## Mechanics\n\nShort-range burst of speed powered by a lit [[Cores|core]]. Taught at [[Ashmere]] to every first-year adept {{src: Web Novel ch 10}}.\n\n## Evolution\n\nBecomes a chained technique at the [[Cinder]] realm.\n` }),
  P('ability', 'Cinder Sight', { status: 'draft', fields: { kind: 'Perception', tier: 'Cinder', cost: 'Eye strain; headaches.', users: ['Kael Marrow'] }, body: `{{infobox}}\n\nLets the user see residual heat of past techniques.\n` }),
  P('ability', 'Ashbind', { status: 'draft', fields: { kind: 'Binding', tier: 'Cinder', users: ['Kael Marrow'], counters: ['Quench'] }, body: `{{infobox}}\n\nAsh clings to a target and slows its core output.\n` }),
  P('ability', 'Pyre Oath', { status: 'draft', fields: { kind: 'Vow', tier: 'Pyre', cost: 'A vow that cannot be broken.', users: ['Orrin Vale', 'Old Haskel'] }, body: `{{infobox}}\n\nA binding vow that multiplies power at the price of freedom. Rare; see [[Tempering]].\n` }),
  P('ability', 'Quench', { status: 'draft', fields: { kind: 'Suppression', tier: 'Flame', users: ['Mira Ashgrove', 'Yesenna Fray'], counters: ['Ashbind'] }, body: `{{infobox}}\n\nCalms a runaway core. Taught by the [[Order of the Pale Lantern]]. See also [[The Great Quench]].\n` }),
  P('ability', 'Hollow Flame', { status: 'draft', reveal: wn(200), fields: { kind: 'Forbidden technique', tier: 'Pyre', users: ['Sable'] }, body: `{{infobox}}\n\nA cold, colorless flame.\n\n:::spoiler{src="wn" at=215}\n${SECRET.hollowFlame}.\n:::\n` }),

  // ---------- items ----------
  P('item', 'Marrow Blade', { status: 'draft', fields: { owners: ['Kael Marrow'], tier: 'Ember', effects: 'Holds a lit core without burning the wielder.', origin: 'Forged in The Sunken Forge' }, body: `{{infobox}}\n\nA short blade Kael inherits from [[Old Haskel]].\n` }),
  P('item', 'Pale Lantern', { status: 'stub', fields: { owners: ['Yesenna Fray'] }, body: `{{infobox}}\n\nRitual lamp of the [[Order of the Pale Lantern]].\n` }),
  P('item', 'Ember Ledger', { status: 'draft', fields: { owners: ['Tamsin Quill'], effects: 'Records every adept’s realm and score.' }, body: `{{infobox}}\n\nThe [[Cinder Guild]]'s master record. It is also the source of [[The Ledger System]].\n\n:::spoiler{src="wn" at=240}\n${SECRET.quenchTruth}.\n:::\n` }),
  P('item', 'Crown of Ash', { status: 'draft', reveal: wn(250), fields: { tier: gated('Zenith', wn(250)) }, body: `{{infobox}}\n\n:::spoiler{src="wn" at=270}\n${SECRET.crownTruth}.\n:::\n` }),

  // ---------- concepts ----------
  P('concept', 'Tempering', { status: 'complete', aliases: ['Core tempering'], fields: { kind: 'Power system' }, body: `{{infobox}}\n\n{{toc}}\n\n## Explanation\n\nAdepts strengthen the [[Cores|core]] in their chest through seven realms: [[Spark]], [[Ember]], [[Cinder]], Flame, Blaze, Pyre and Zenith.\n\n## Rules\n\n1. Each realm needs a fresh trial.\n2. The [[Ember Ledger]] records the result.\n3. Skipping a realm is possible but dangerous.\n\n## Loopholes\n\n{{claim: theory}}The Pyre Oath may bypass the third rule.{{/claim}}\n\n:::spoiler{src="wn" at=260}\n${SECRET.zenith}.\n:::\n` }),
  P('concept', 'The Ledger System', { status: 'draft', fields: { kind: 'Game-like interface' }, body: `{{infobox}}\n\nA status interface visible only to those registered in the [[Ember Ledger]].\n\n:::continuity{ids="adapt"}\nThe adaptation renders the interface as glowing glyphs rather than text {{src: Adaptation ep 3}}.\n:::\n` }),
  P('concept', 'Cores', { status: 'draft', aliases: ['Spirit core'], fields: { kind: 'Mechanic' }, body: `{{infobox}}\n\nA core is the seat of an adept's power. See [[Tempering]].\n` }),

  // ---------- events ----------
  P('event', 'Night of Cold Fires', { status: 'complete', fields: { when: 'Year 0', participants: ['Kael Marrow', 'Orrin Vale'], where: 'Ashmere' }, body: `{{infobox}}\n\nThe disaster that left half of [[Ashmere]] burning with colorless flames and orphaned Kael.\n` }),
  P('event', 'Siege of Keld Pass', { status: 'draft', fields: { when: 'Year 6', participants: ['Orrin Vale', 'Brannoch Keld', 'Ilex Thorne'], where: 'Keld Pass' }, body: `{{infobox}}\n\nThe three-week siege that ends the third arc.\n\n:::continuity{ids="wn"}\n:::spoiler{src="wn" at=140}\n${SECRET.orrinDeath}.\n:::\n:::\n` }),
  P('event', 'The Great Quench', { status: 'draft', reveal: arc('a5'), fields: { when: 'Year 9' }, body: `{{infobox}}\n\nThe finale event.\n\n:::spoiler{src="wn" at=285}\n${SECRET.quenchTruth}.\n:::\n` }),

  // ---------- arcs ----------
  P('arc', 'Spark in Ashmere', { status: 'complete', fields: { arcId: 'a1', source: 'wn', characters: ['Kael Marrow', 'Mira Ashgrove', 'Old Haskel'] }, body: `{{infobox}}\n\n## Summary\n\nKael awakens a damaged core and is pulled into the [[Cinder Guild]] {{src: Web Novel ch 1-40}}.\n` }),
  P('arc', 'Lantern Trials', { status: 'complete', fields: { arcId: 'a2', source: 'wn', characters: ['Kael Marrow', 'Tamsin Quill', 'Ilex Thorne'] }, body: `{{infobox}}\n\n## Summary\n\nThe guild trials in [[Lantern Hall]] pit Kael against [[Ilex Thorne]].\n` }),
  P('arc', 'Keld Pass Arc', { status: 'draft', fields: { arcId: 'a3', source: 'wn', characters: ['Orrin Vale', 'Brannoch Keld'] }, body: `{{infobox}}\n\n## Summary\n\nWar comes to [[Keld Pass]]; see the [[Siege of Keld Pass]].\n` }),
  P('arc', 'The Cold Furnace Arc', { status: 'draft', reveal: arc('a4'), fields: { arcId: 'a4', source: 'wn' }, body: `{{infobox}}\n\n## Summary\n\nKael descends into [[The Cold Furnace]] and meets [[Sable]].\n` }),
  P('arc', 'Crown of Ash Arc', { status: 'stub', reveal: arc('a5'), fields: { arcId: 'a5', source: 'wn' }, body: `{{infobox}}\n\n## Summary\n\nFinal arc. Involves the [[Crown of Ash]] and [[The Great Quench]].\n` }),

  // ---------- misc ----------
  P('theory', "Is Sable Kael's other half?", { status: 'draft', tags: ['theory'], fields: { confidence: 'plausible' }, reveal: arc('a4'), body: `## Claim\n\n{{claim: theory}}Sable and [[Kael Marrow]] share a split core.{{/claim}}\n\n## Evidence\n\n- Matching scars {{src: Web Novel ch 165}}\n\n## Counter-evidence\n\nNone confirmed.\n` }),
  P('glossary', 'Ash-mark', { status: 'stub', body: `**Ash-mark** — the scar left when a core is lit for the first time. See [[Tempering]].\n` }),
  P('concept', 'Spark', { status: 'stub', body: `First realm of [[Tempering]].\n` }),
  P('concept', 'Ember', { status: 'stub', body: `Second realm of [[Tempering]].\n` }),
  P('concept', 'Cinder', { status: 'stub', body: `Third realm of [[Tempering]].\n` }),
];

export const SERIES: StarterWorld = {
  slug: 'the-ashen-ascent',
  pack: 'series-lore',
  secrets: SERIES_SECRETS,
  world: {
    name: 'The Ashen Ascent', slug: 'the-ashen-ascent', accent: '#f08a4b',
    description: 'An invented system web-novel setting used to demo every Worldloom feature: two continuities, spoiler gates, citations and claims.',
    theme: { readingFont: 'serif' },
    continuities: [
      { id: 'wn', name: 'Web Novel', color: '#f08a4b', order: 0, isPrimary: true },
      { id: 'adapt', name: 'Adaptation', color: '#38bdf8', order: 1, isPrimary: false },
    ],
    sources: [
      { id: 'wn', name: 'Web Novel', kind: 'web_novel', continuityId: 'wn', units: { label: 'Chapter', count: 300 }, notes: '' },
      { id: 'adapt', name: 'Adaptation', kind: 'anime', continuityId: 'adapt', units: { label: 'Episode', count: 24 }, notes: '' },
      { id: 'recap', name: 'Recap Videos', kind: 'video', continuityId: 'wn', units: { label: 'Episode', count: 6 }, notes: 'Third-party recaps; unreliable for details.' },
    ],
    arcs: [
      { id: 'a1', name: 'Spark in Ashmere', order: 1, ranges: { wn: { from: 1, to: 40 }, adapt: { from: 1, to: 5 }, recap: { from: 1, to: 1 } }, summary: 'Kael awakens his core.' },
      { id: 'a2', name: 'The Lantern Trials', order: 2, ranges: { wn: { from: 41, to: 95 }, adapt: { from: 6, to: 11 }, recap: { from: 2, to: 3 } }, summary: 'Guild trials.' },
      { id: 'a3', name: 'Keld Pass', order: 3, ranges: { wn: { from: 96, to: 150 }, adapt: { from: 12, to: 16 }, recap: { from: 4, to: 4 } }, summary: 'The siege.' },
      { id: 'a4', name: 'The Cold Furnace', order: 4, ranges: { wn: { from: 151, to: 220 }, adapt: { from: 17, to: 21 }, recap: { from: 5, to: 5 } }, summary: 'Descent into the furnace.' },
      { id: 'a5', name: 'Crown of Ash', order: 5, ranges: { wn: { from: 221, to: 300 }, adapt: { from: 22, to: 24 }, recap: { from: 6, to: 6 } }, summary: 'Finale.' },
    ],
    tierSystems: [{
      id: 'tempering', name: 'Tempering Realms', scale: 'ordinal',
      tiers: [
        { id: 'spark', name: 'Spark', order: 1, description: 'First lit core.', color: '#9aa0b8' },
        { id: 'ember', name: 'Ember', order: 2, description: '', color: '#f5b84a' },
        { id: 'cinder', name: 'Cinder', order: 3, description: '', color: '#f08a4b' },
        { id: 'flame', name: 'Flame', order: 4, description: '', color: '#ff6b81' },
        { id: 'blaze', name: 'Blaze', order: 5, description: '', color: '#f0a5ff' },
        { id: 'pyre', name: 'Pyre', order: 6, description: '', color: '#7c5cff' },
        { id: 'zenith', name: 'Zenith', order: 7, description: 'Final realm.', color: '#38bdf8' },
      ],
    }],
    progress: { sources: { wn: 60, adapt: 8 }, showAll: false, revealed: [], impliedFloor: 'conservative' },
  },
  pages,
  relations: [
    { from: 'Kael Marrow', to: 'Mira Ashgrove', kind: 'family', label: 'sister', continuityIds: ['wn'] },
    { from: 'Kael Marrow', to: 'Mira Ashgrove', kind: 'ally', label: 'childhood friend', continuityIds: ['adapt'] },
    { from: 'Orrin Vale', to: 'Kael Marrow', kind: 'master_student' },
    { from: 'Kael Marrow', to: 'Ilex Thorne', kind: 'rival' },
    { from: 'Kael Marrow', to: 'Dovan Reth', kind: 'subordinate' },
    { from: 'Sable', to: 'Kael Marrow', kind: 'enemy', label: 'bound', reveal: wn(210) },
    { from: 'Ilex Thorne', to: 'Lady Corvane', kind: 'family', label: 'mother' },
    { from: 'Lady Corvane', to: 'Sable', kind: 'ally', label: 'patron', reveal: wn(190) },
    { from: 'Dovan Reth', to: 'Lady Corvane', kind: 'enemy', timeSpan: { toArcId: 'a4' } },
  ],
};
