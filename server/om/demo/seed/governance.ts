import { fqn, ref, store, type Entity } from '../store'

/**
 * People, teams, classifications (tags), the business glossary, domains and
 * data products. The catalog seed tags and assigns assets with these.
 */

export const PEOPLE = [
  { name: 'admin', displayName: 'Admin', email: 'admin@example.com', isAdmin: true, teams: ['Data Platform'] },
  { name: 'ada.park', displayName: 'Ada Park', email: 'ada.park@example.com', teams: ['Data Platform'] },
  { name: 'sam.okafor', displayName: 'Sam Okafor', email: 'sam.okafor@example.com', teams: ['Analytics Engineering'] },
  { name: 'lena.ruiz', displayName: 'Lena Ruiz', email: 'lena.ruiz@example.com', teams: ['Analytics Engineering'] },
  { name: 'ravi.menon', displayName: 'Ravi Menon', email: 'ravi.menon@example.com', teams: ['Marketing Analytics'] },
  { name: 'june.kim', displayName: 'June Kim', email: 'june.kim@example.com', teams: ['Finance'] },
  { name: 'ingestion-bot', displayName: 'Ingestion Bot', email: 'ingestion-bot@example.com', isBot: true, teams: [] },
] as const

const TEAMS = [
  { name: 'Data Platform', description: 'Runs the warehouse, ingestion and this catalog.' },
  { name: 'Analytics Engineering', description: 'Owns the staging and marts layers in BigQuery.' },
  { name: 'Marketing Analytics', description: 'Attribution, campaigns and traffic analysis.' },
  { name: 'Finance', description: 'Revenue reporting and reconciliation.' },
]

const CLASSIFICATIONS: { name: string; description: string; mutuallyExclusive?: boolean; tags: [string, string][] }[] = [
  {
    name: 'Tier',
    description: 'How critical an asset is. Tier 1 feeds executive reporting and has an on-call owner.',
    mutuallyExclusive: true,
    tags: [
      ['Tier1', 'Critical. Used in external or executive reporting; breaks page someone.'],
      ['Tier2', 'Important. Used by several teams for decisions.'],
      ['Tier3', 'Team-level. Used within one team.'],
      ['Tier4', 'Exploratory. Ad-hoc or experimental.'],
      ['Tier5', 'Unused or scheduled for removal.'],
    ],
  },
  {
    name: 'PII',
    description: 'Whether data identifies a person.',
    mutuallyExclusive: true,
    tags: [
      ['Sensitive', 'Directly identifies a person: name, email, street address, precise location.'],
      ['NonSensitive', 'Does not identify a person on its own.'],
    ],
  },
  {
    name: 'PersonalData',
    description: 'GDPR personal data categories.',
    mutuallyExclusive: true,
    tags: [
      ['Personal', 'Personal data under GDPR.'],
      ['SpecialCategory', 'Special category data under GDPR Article 9.'],
    ],
  },
  {
    name: 'Certification',
    description: 'Trust level an owner has signed off on.',
    mutuallyExclusive: true,
    tags: [
      ['Gold', 'Certified: documented, tested, owned, and monitored.'],
      ['Silver', 'Documented and owned; tests partial.'],
      ['Bronze', 'Raw or lightly modeled. Use with care.'],
    ],
  },
  {
    name: 'DataLayer',
    description: 'Where a table sits in the warehouse.',
    mutuallyExclusive: true,
    tags: [
      ['Raw', 'Loaded as-is from a source system.'],
      ['Staging', 'Cleaned and typed, one-to-one with a source table.'],
      ['Mart', 'Modeled facts and dimensions.'],
      ['Reporting', 'Aggregated for dashboards.'],
    ],
  },
]

const GLOSSARY_TERMS: { name: string; description: string; synonyms?: string[]; parent?: string; owner?: string; status?: string }[] = [
  {
    name: 'Customer',
    description: 'A person with an account on the storefront, whether or not they have ordered.',
    synonyms: ['User', 'Shopper'],
    owner: 'sam.okafor',
  },
  {
    name: 'Active Customer',
    parent: 'Customer',
    description: 'A customer with at least one completed order in the last 90 days.',
    owner: 'sam.okafor',
  },
  {
    name: 'Order',
    description: 'One checkout. An order has one or more order items and a single status.',
    synonyms: ['Purchase'],
    owner: 'lena.ruiz',
  },
  {
    name: 'Order Item',
    parent: 'Order',
    description: 'One unit of a product within an order, priced at its sale price.',
    owner: 'lena.ruiz',
  },
  { name: 'Revenue', description: 'Money from sales. Always say which kind: gross or net.', owner: 'june.kim' },
  {
    name: 'Gross Revenue',
    parent: 'Revenue',
    description: 'Sum of sale_price over order items, excluding cancelled orders. Returns are not subtracted.',
    synonyms: ['GMV'],
    owner: 'june.kim',
  },
  { name: 'Net Revenue', parent: 'Revenue', description: 'Gross revenue minus returned items.', owner: 'june.kim' },
  {
    name: 'Gross Margin',
    description: 'Net revenue minus the cost of the items sold, over net revenue.',
    owner: 'june.kim',
    status: 'In Review',
  },
  {
    name: 'Return Rate',
    description: 'Returned order items over delivered order items in the same period.',
    owner: 'lena.ruiz',
    status: 'Draft',
  },
  { name: 'Session', description: 'A run of web events by one visitor with no gap over 30 minutes.', owner: 'ravi.menon' },
  { name: 'Traffic Source', description: 'How a visitor arrived: Search, Organic, Email, Facebook or Display.', owner: 'ravi.menon' },
  { name: 'Distribution Center', description: 'A warehouse that holds inventory and ships orders.', owner: 'ada.park' },
]

const DOMAINS = [
  {
    name: 'Commerce',
    description: 'Orders, products, inventory and revenue.',
    owner: 'Analytics Engineering',
    domainType: 'Aggregate',
    experts: ['lena.ruiz', 'june.kim'],
  },
  {
    name: 'Customer',
    description: 'Customer accounts, profiles and lifetime value.',
    owner: 'Analytics Engineering',
    domainType: 'Consumer-aligned',
    experts: ['sam.okafor'],
  },
  {
    name: 'Marketing',
    description: 'Web sessions, traffic sources and attribution.',
    owner: 'Marketing Analytics',
    domainType: 'Source-aligned',
    experts: ['ravi.menon'],
  },
  {
    name: 'Operations',
    description: 'Distribution centers and fulfillment.',
    owner: 'Data Platform',
    domainType: 'Source-aligned',
    experts: ['ada.park'],
  },
]

export function userRef(name: string) {
  const u = store.byFqn('users', name)
  if (!u) throw new Error(`No demo user ${name}`)
  return ref(u, 'user')
}

export function teamRef(name: string) {
  const t = store.byFqn('teams', name)
  if (!t) throw new Error(`No demo team ${name}`)
  return ref(t, 'team')
}

export function ownerRef(name: string) {
  return store.byFqn('users', name) ? userRef(name) : teamRef(name)
}

export function domainRef(name: string) {
  const d = store.byFqn('domains', name)
  if (!d) throw new Error(`No demo domain ${name}`)
  return ref(d, 'domain')
}

export function seedGovernance() {
  for (const t of TEAMS) store.add('teams', { ...t, teamType: 'Group', email: `${t.name.toLowerCase().replace(/ /g, '-')}@example.com` })
  for (const p of PEOPLE) {
    store.add('users', {
      name: p.name,
      displayName: p.displayName,
      email: p.email,
      isAdmin: 'isAdmin' in p ? p.isAdmin : false,
      isBot: 'isBot' in p ? p.isBot : false,
      teams: p.teams.map((t) => teamRef(t)),
      roles: [],
    })
  }
  for (const team of store.all('teams')) {
    const users = store.all('users').filter((u) => u.teams.some((t: Entity) => t.id === team.id))
    store.replace({ ...team, users: users.map((u) => ref(u, 'user')), userCount: users.length })
  }

  for (const c of CLASSIFICATIONS) {
    const cls = store.add('classifications', {
      name: c.name,
      description: c.description,
      mutuallyExclusive: c.mutuallyExclusive ?? false,
      provider: 'user',
      termCount: c.tags.length,
    })
    for (const [name, description] of c.tags) {
      store.add('tags', {
        name,
        description,
        fullyQualifiedName: fqn(c.name, name),
        classification: ref(cls, 'classification'),
        provider: 'user',
        style: {},
      })
    }
  }

  const glossary = store.add('glossaries', {
    name: 'Business',
    displayName: 'Business Glossary',
    description:
      'The shared vocabulary for commerce, customer and marketing reporting. If a dashboard uses one of these words, it means this.',
    owners: [teamRef('Analytics Engineering')],
    reviewers: [userRef('june.kim')],
    mutuallyExclusive: false,
    termCount: GLOSSARY_TERMS.length,
  })
  for (const t of GLOSSARY_TERMS) {
    const parent = t.parent ? store.byFqn('glossaryTerms', fqn('Business', t.parent)) : undefined
    store.add('glossaryTerms', {
      name: t.name,
      description: t.description,
      fullyQualifiedName: parent ? `${parent.fullyQualifiedName}.${t.name}` : fqn('Business', t.name),
      glossary: ref(glossary, 'glossary'),
      parent: parent ? ref(parent, 'glossaryTerm') : undefined,
      synonyms: t.synonyms ?? [],
      relatedTerms: [],
      references: [],
      reviewers: [userRef('june.kim')],
      owners: t.owner ? [userRef(t.owner)] : [],
      status: t.status ?? 'Approved',
      entityStatus: t.status ?? 'Approved',
      childrenCount: GLOSSARY_TERMS.filter((x) => x.parent === t.name).length,
    })
  }
  const term = (n: string) => store.all('glossaryTerms').find((t) => t.name === n)!
  // OpenMetadata 2.x stores related terms as typed TermRelations; "relatedTo" is symmetric.
  const relate = (a: string, b: string) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const tx = term(x)
      store.replace({ ...tx, relatedTerms: [...tx.relatedTerms, { relationType: 'relatedTo', term: ref(term(y), 'glossaryTerm') }] })
    }
  }
  relate('Gross Revenue', 'Net Revenue')
  relate('Net Revenue', 'Gross Margin')
  relate('Return Rate', 'Order Item')
  relate('Session', 'Traffic Source')

  for (const d of DOMAINS) {
    store.add('domains', {
      name: d.name,
      description: d.description,
      domainType: d.domainType,
      owners: [teamRef(d.owner)],
      experts: d.experts.map((e) => userRef(e)),
    })
  }
}

/** Data products need the catalog's tables, so the catalog seed calls this at its end. */
export function seedDataProducts(assets: Record<string, Entity[]>) {
  const products = [
    {
      name: 'Orders 360',
      domain: 'Commerce',
      owner: 'lena.ruiz',
      description: 'Everything about orders in one place: line-level facts, daily revenue and returns, certified for finance reporting.',
    },
    {
      name: 'Customer 360',
      domain: 'Customer',
      owner: 'sam.okafor',
      description: 'One row per customer with lifetime value, first and last order, and acquisition channel.',
    },
    {
      name: 'Web Attribution',
      domain: 'Marketing',
      owner: 'ravi.menon',
      description: 'Sessions and last-touch attribution of orders to traffic sources.',
    },
  ]
  for (const p of products) {
    const tables = assets[p.name] ?? []
    const dp = store.add('dataProducts', {
      name: p.name,
      description: p.description,
      domains: [domainRef(p.domain)],
      owners: [userRef(p.owner)],
      experts: [],
      assets: tables.map((t) => ref(t, 'table')),
    })
    for (const t of tables) {
      const current = store.get(t.id)!.entity
      store.replace({ ...current, dataProducts: [...(current.dataProducts ?? []), ref(dp, 'dataProduct')] })
    }
  }
}
