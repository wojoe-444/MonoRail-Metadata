import { fqn, ref, store, tagLabel, type Entity } from '../store'
import { domainRef, ownerRef, seedDataProducts, userRef } from './governance'
import { DAY, rng, today } from './random'

/**
 * A BigQuery catalog as OpenMetadata's BigQuery connector would ingest it:
 * service "bigquery" > database = GCP project > schema = dataset > tables.
 *
 * - bigquery-public-data.thelook_ecommerce: the raw source (real schema).
 * - acme-analytics.staging / marts / reporting: a modeled layer built on it,
 *   with lineage, profiles, sample data and queries.
 */

const SERVICE = 'bigquery'

type Col = [name: string, type: string, description?: string, tags?: string[], children?: Col[]]

interface TableDef {
  project: string
  dataset: string
  name: string
  description: string
  tableType?: 'Regular' | 'View' | 'MaterializedView' | 'Partitioned'
  columns: Col[]
  owner?: string
  domain?: string
  tags?: string[]
  glossary?: string[]
  rows: number
  growth?: number
  partition?: string
  cluster?: string[]
  sql?: string
  usage?: number
}

const PUB = 'bigquery-public-data'
const RAW = 'thelook_ecommerce'
const ACME = 'acme-analytics'

const OM_TYPE: Record<string, string> = {
  INT64: 'BIGINT',
  FLOAT64: 'FLOAT',
  NUMERIC: 'NUMERIC',
  BIGNUMERIC: 'BIGNUMERIC',
  STRING: 'STRING',
  BOOL: 'BOOLEAN',
  DATE: 'DATE',
  DATETIME: 'DATETIME',
  TIMESTAMP: 'TIMESTAMP',
  GEOGRAPHY: 'GEOGRAPHY',
  JSON: 'JSON',
  RECORD: 'STRUCT',
}

const S = ['PII.Sensitive', 'PersonalData.Personal']

const TABLES: TableDef[] = [
  // ---------- Raw: bigquery-public-data.thelook_ecommerce ----------
  {
    project: PUB,
    dataset: RAW,
    name: 'users',
    rows: 100_000,
    growth: 0.002,
    owner: 'Data Platform',
    domain: 'Customer',
    tags: ['Tier.Tier2', 'DataLayer.Raw', 'Certification.Bronze'],
    glossary: ['Business.Customer'],
    usage: 140,
    description:
      'Customer accounts on theLook, the fictitious clothing storefront. One row per account, including demographics, location and how the customer first arrived.',
    columns: [
      ['id', 'INT64', 'Customer id. Joins to orders.user_id and events.user_id.'],
      ['first_name', 'STRING', 'Given name.', S],
      ['last_name', 'STRING', 'Family name.', S],
      ['email', 'STRING', 'Login and contact email.', S],
      ['age', 'INT64', 'Age in years at signup.'],
      ['gender', 'STRING', '"M" or "F".'],
      ['state', 'STRING', 'State or province.'],
      ['street_address', 'STRING', 'Street address.', S],
      ['postal_code', 'STRING', 'Postal code.', ['PII.Sensitive']],
      ['city', 'STRING', 'City.'],
      ['country', 'STRING', 'Country name.'],
      ['latitude', 'FLOAT64', 'Latitude of the address.', ['PII.Sensitive']],
      ['longitude', 'FLOAT64', 'Longitude of the address.', ['PII.Sensitive']],
      ['traffic_source', 'STRING', 'Channel of the first visit: Search, Organic, Email, Facebook or Display.', ['Business.Traffic Source']],
      ['created_at', 'TIMESTAMP', 'When the account was created.'],
      ['user_geom', 'GEOGRAPHY', 'Point geometry of the address.', ['PII.Sensitive']],
    ],
  },
  {
    project: PUB,
    dataset: RAW,
    name: 'orders',
    rows: 125_000,
    growth: 0.004,
    owner: 'Data Platform',
    domain: 'Commerce',
    tags: ['Tier.Tier2', 'DataLayer.Raw', 'Certification.Bronze'],
    glossary: ['Business.Order'],
    usage: 220,
    description: 'One row per order (checkout). Status moves Processing → Shipped → Complete, or to Cancelled / Returned.',
    columns: [
      ['order_id', 'INT64', 'Order id.'],
      ['user_id', 'INT64', 'The customer who placed the order. Joins to users.id.'],
      ['status', 'STRING', 'Processing, Shipped, Complete, Cancelled or Returned.'],
      ['gender', 'STRING', 'Customer gender, copied at order time.'],
      ['created_at', 'TIMESTAMP', 'When the order was placed.'],
      ['returned_at', 'TIMESTAMP', 'When the order was returned, if it was.'],
      ['shipped_at', 'TIMESTAMP', 'When the order shipped.'],
      ['delivered_at', 'TIMESTAMP', 'When the order was delivered.'],
      ['num_of_item', 'INT64', 'Number of items in the order.'],
    ],
  },
  {
    project: PUB,
    dataset: RAW,
    name: 'order_items',
    rows: 181_000,
    growth: 0.004,
    owner: 'Data Platform',
    domain: 'Commerce',
    tags: ['Tier.Tier2', 'DataLayer.Raw', 'Certification.Bronze'],
    glossary: ['Business.Order.Order Item'],
    usage: 310,
    description: 'One row per item in an order, with its sale price and fulfillment timestamps.',
    columns: [
      ['id', 'INT64', 'Order item id.'],
      ['order_id', 'INT64', 'Joins to orders.order_id.'],
      ['user_id', 'INT64', 'Joins to users.id.'],
      ['product_id', 'INT64', 'Joins to products.id.'],
      ['inventory_item_id', 'INT64', 'The physical unit shipped. Joins to inventory_items.id.'],
      ['status', 'STRING', 'Item status; mirrors the order status.'],
      ['created_at', 'TIMESTAMP', 'When the item was ordered.'],
      ['shipped_at', 'TIMESTAMP', 'When the item shipped.'],
      ['delivered_at', 'TIMESTAMP', 'When the item was delivered.'],
      ['returned_at', 'TIMESTAMP', 'When the item was returned.'],
      ['sale_price', 'FLOAT64', 'Price charged, in USD.'],
    ],
  },
  {
    project: PUB,
    dataset: RAW,
    name: 'products',
    rows: 29_120,
    growth: 0,
    owner: 'Data Platform',
    domain: 'Commerce',
    tags: ['Tier.Tier2', 'DataLayer.Raw'],
    usage: 95,
    description: 'The product catalog: one row per SKU with cost, retail price, brand and category.',
    columns: [
      ['id', 'INT64', 'Product id.'],
      ['cost', 'FLOAT64', 'Unit cost to theLook, in USD.'],
      ['category', 'STRING', 'Product category, e.g. Jeans, Swim.'],
      ['name', 'STRING', 'Product name.'],
      ['brand', 'STRING', 'Brand.'],
      ['retail_price', 'FLOAT64', 'List price, in USD.'],
      ['department', 'STRING', 'Men or Women.'],
      ['sku', 'STRING', 'Stock keeping unit.'],
      ['distribution_center_id', 'INT64', 'Home warehouse. Joins to distribution_centers.id.'],
    ],
  },
  {
    project: PUB,
    dataset: RAW,
    name: 'inventory_items',
    rows: 490_000,
    growth: 0.003,
    owner: 'Data Platform',
    domain: 'Operations',
    tags: ['Tier.Tier3', 'DataLayer.Raw'],
    usage: 30,
    description: 'Physical units in stock or sold, with product attributes copied in at receipt.',
    columns: [
      ['id', 'INT64', 'Inventory item id.'],
      ['product_id', 'INT64', 'Joins to products.id.'],
      ['created_at', 'TIMESTAMP', 'When the unit was received.'],
      ['sold_at', 'TIMESTAMP', 'When the unit sold; null while in stock.'],
      ['cost', 'FLOAT64', 'Unit cost, in USD.'],
      ['product_category', 'STRING', ''],
      ['product_name', 'STRING', ''],
      ['product_brand', 'STRING', ''],
      ['product_retail_price', 'FLOAT64', ''],
      ['product_department', 'STRING', ''],
      ['product_sku', 'STRING', ''],
      ['product_distribution_center_id', 'INT64', ''],
    ],
  },
  {
    project: PUB,
    dataset: RAW,
    name: 'distribution_centers',
    rows: 10,
    growth: 0,
    owner: 'Data Platform',
    domain: 'Operations',
    tags: ['Tier.Tier3', 'DataLayer.Raw'],
    glossary: ['Business.Distribution Center'],
    usage: 12,
    description: 'The ten US distribution centers that ship orders.',
    columns: [
      ['id', 'INT64', 'Distribution center id.'],
      ['name', 'STRING', 'City and state, e.g. "Memphis TN".'],
      ['latitude', 'FLOAT64', ''],
      ['longitude', 'FLOAT64', ''],
      ['distribution_center_geom', 'GEOGRAPHY', 'Point geometry.'],
    ],
  },
  {
    project: PUB,
    dataset: RAW,
    name: 'events',
    rows: 2_430_000,
    growth: 0.005,
    owner: 'Data Platform',
    domain: 'Marketing',
    tags: ['Tier.Tier3', 'DataLayer.Raw'],
    usage: 60,
    description: 'Web events from the storefront: page views, cart adds, purchases. About 2.4M rows.',
    columns: [
      ['id', 'INT64', 'Event id.'],
      ['user_id', 'INT64', 'Customer id when signed in; null for anonymous visitors.'],
      ['sequence_number', 'INT64', 'Position of the event in its session.'],
      ['session_id', 'STRING', 'Session id.'],
      ['created_at', 'TIMESTAMP', 'Event time.'],
      ['ip_address', 'STRING', 'Visitor IP address.', S],
      ['city', 'STRING', ''],
      ['state', 'STRING', ''],
      ['postal_code', 'STRING', '', ['PII.Sensitive']],
      ['browser', 'STRING', 'Browser family.'],
      ['traffic_source', 'STRING', 'Channel for this session.', ['Business.Traffic Source']],
      ['uri', 'STRING', 'Page path.'],
      ['event_type', 'STRING', 'home, department, product, cart, purchase or cancel.'],
    ],
  },

  // ---------- Staging: acme-analytics.staging ----------
  {
    project: ACME,
    dataset: 'staging',
    name: 'stg_orders',
    tableType: 'View',
    rows: 125_000,
    growth: 0.004,
    owner: 'Analytics Engineering',
    domain: 'Commerce',
    tags: ['Tier.Tier3', 'DataLayer.Staging'],
    usage: 40,
    description: 'Orders, typed and renamed. Adds `order_date` and an `is_cancelled` flag.',
    sql: `select order_id, user_id, status, created_at, date(created_at) as order_date, shipped_at, delivered_at, returned_at, num_of_item, status = 'Cancelled' as is_cancelled\nfrom \`bigquery-public-data.thelook_ecommerce.orders\``,
    columns: [
      ['order_id', 'INT64', ''],
      ['user_id', 'INT64', ''],
      ['status', 'STRING', ''],
      ['created_at', 'TIMESTAMP', ''],
      ['order_date', 'DATE', 'Order date in UTC.'],
      ['shipped_at', 'TIMESTAMP', ''],
      ['delivered_at', 'TIMESTAMP', ''],
      ['returned_at', 'TIMESTAMP', ''],
      ['num_of_item', 'INT64', ''],
      ['is_cancelled', 'BOOL', 'True when status is Cancelled.'],
    ],
  },
  {
    project: ACME,
    dataset: 'staging',
    name: 'stg_order_items',
    tableType: 'View',
    rows: 181_000,
    growth: 0.004,
    owner: 'Analytics Engineering',
    domain: 'Commerce',
    tags: ['Tier.Tier3', 'DataLayer.Staging'],
    usage: 52,
    description: 'Order items with the product cost joined in, so margin can be computed downstream.',
    sql: `select oi.id as order_item_id, oi.order_id, oi.user_id, oi.product_id, oi.status, oi.created_at, oi.returned_at, oi.sale_price, p.cost\nfrom \`bigquery-public-data.thelook_ecommerce.order_items\` oi\njoin \`bigquery-public-data.thelook_ecommerce.products\` p on p.id = oi.product_id`,
    columns: [
      ['order_item_id', 'INT64', ''],
      ['order_id', 'INT64', ''],
      ['user_id', 'INT64', ''],
      ['product_id', 'INT64', ''],
      ['status', 'STRING', ''],
      ['created_at', 'TIMESTAMP', ''],
      ['returned_at', 'TIMESTAMP', ''],
      ['sale_price', 'FLOAT64', 'Price charged, USD.'],
      ['cost', 'FLOAT64', 'Product unit cost, USD.'],
    ],
  },
  {
    project: ACME,
    dataset: 'staging',
    name: 'stg_users',
    tableType: 'View',
    rows: 100_000,
    growth: 0.002,
    owner: 'Analytics Engineering',
    domain: 'Customer',
    tags: ['Tier.Tier3', 'DataLayer.Staging', 'PII.Sensitive'],
    usage: 33,
    description: 'Customers with names and emails hashed. Use this, not the raw table, for analysis.',
    sql: `select id as user_id, to_hex(sha256(email)) as email_hash, age, gender, country, state, city, traffic_source, created_at\nfrom \`bigquery-public-data.thelook_ecommerce.users\``,
    columns: [
      ['user_id', 'INT64', ''],
      ['email_hash', 'STRING', 'SHA-256 of the email, hex. Stable join key without the email.'],
      ['age', 'INT64', ''],
      ['gender', 'STRING', ''],
      ['country', 'STRING', ''],
      ['state', 'STRING', ''],
      ['city', 'STRING', ''],
      ['traffic_source', 'STRING', ''],
      ['created_at', 'TIMESTAMP', ''],
    ],
  },
  {
    project: ACME,
    dataset: 'staging',
    name: 'stg_products',
    tableType: 'View',
    rows: 29_120,
    owner: 'Analytics Engineering',
    domain: 'Commerce',
    tags: ['Tier.Tier3', 'DataLayer.Staging'],
    usage: 21,
    description: 'Products with distribution center name joined in.',
    sql: `select p.id as product_id, p.name, p.brand, p.category, p.department, p.cost, p.retail_price, dc.name as distribution_center\nfrom \`bigquery-public-data.thelook_ecommerce.products\` p\nleft join \`bigquery-public-data.thelook_ecommerce.distribution_centers\` dc on dc.id = p.distribution_center_id`,
    columns: [
      ['product_id', 'INT64', ''],
      ['name', 'STRING', ''],
      ['brand', 'STRING', ''],
      ['category', 'STRING', ''],
      ['department', 'STRING', ''],
      ['cost', 'FLOAT64', ''],
      ['retail_price', 'FLOAT64', ''],
      ['distribution_center', 'STRING', ''],
    ],
  },
  {
    project: ACME,
    dataset: 'staging',
    name: 'stg_events',
    tableType: 'View',
    rows: 2_430_000,
    growth: 0.005,
    owner: 'Marketing Analytics',
    domain: 'Marketing',
    tags: ['Tier.Tier3', 'DataLayer.Staging'],
    usage: 18,
    description: 'Web events without IP addresses.',
    sql: `select id as event_id, user_id, session_id, sequence_number, created_at, traffic_source, event_type, uri, browser\nfrom \`bigquery-public-data.thelook_ecommerce.events\``,
    columns: [
      ['event_id', 'INT64', ''],
      ['user_id', 'INT64', ''],
      ['session_id', 'STRING', ''],
      ['sequence_number', 'INT64', ''],
      ['created_at', 'TIMESTAMP', ''],
      ['traffic_source', 'STRING', ''],
      ['event_type', 'STRING', ''],
      ['uri', 'STRING', ''],
      ['browser', 'STRING', ''],
    ],
  },

  // ---------- Marts: acme-analytics.marts ----------
  {
    project: ACME,
    dataset: 'marts',
    name: 'fct_order_items',
    tableType: 'Partitioned',
    rows: 181_000,
    growth: 0.004,
    owner: 'lena.ruiz',
    domain: 'Commerce',
    tags: ['Tier.Tier1', 'DataLayer.Mart', 'Certification.Gold'],
    glossary: ['Business.Order.Order Item', 'Business.Revenue.Gross Revenue'],
    usage: 410,
    partition: 'order_date',
    cluster: ['product_id', 'user_id'],
    description:
      'The certified line-level fact for revenue. One row per order item, with gross and net revenue and margin. Partitioned by `order_date`.\n\nUse this for any revenue number; `reporting.daily_revenue` is built from it.',
    sql: `select i.order_item_id, i.order_id, i.user_id, i.product_id, o.order_date, i.status,\n  i.sale_price as gross_revenue,\n  if(i.returned_at is null, i.sale_price, 0) as net_revenue,\n  i.cost, i.sale_price - i.cost as gross_margin, i.returned_at is not null as is_returned\nfrom staging.stg_order_items i join staging.stg_orders o using (order_id)\nwhere not o.is_cancelled`,
    columns: [
      ['order_item_id', 'INT64', 'Primary key.'],
      ['order_id', 'INT64', 'Joins to fct_orders.'],
      ['user_id', 'INT64', 'Joins to dim_customers.'],
      ['product_id', 'INT64', 'Joins to dim_products.'],
      ['order_date', 'DATE', 'Partition column.'],
      ['status', 'STRING', ''],
      ['gross_revenue', 'NUMERIC', 'Sale price. See the Gross Revenue glossary term.', ['Business.Revenue.Gross Revenue']],
      ['net_revenue', 'NUMERIC', 'Sale price, or 0 when returned.', ['Business.Revenue.Net Revenue']],
      ['cost', 'NUMERIC', 'Product cost.'],
      ['gross_margin', 'NUMERIC', 'gross_revenue - cost.', ['Business.Gross Margin']],
      ['is_returned', 'BOOL', ''],
    ],
  },
  {
    project: ACME,
    dataset: 'marts',
    name: 'fct_orders',
    tableType: 'Partitioned',
    rows: 118_000,
    growth: 0.004,
    owner: 'lena.ruiz',
    domain: 'Commerce',
    tags: ['Tier.Tier1', 'DataLayer.Mart', 'Certification.Gold'],
    glossary: ['Business.Order'],
    usage: 260,
    partition: 'order_date',
    description: 'One row per non-cancelled order with item counts and revenue rolled up from `fct_order_items`.',
    sql: `select order_id, any_value(user_id) as user_id, any_value(order_date) as order_date, count(*) as items,\n  sum(gross_revenue) as gross_revenue, sum(net_revenue) as net_revenue, logical_or(is_returned) as has_return\nfrom marts.fct_order_items group by order_id`,
    columns: [
      ['order_id', 'INT64', 'Primary key.'],
      ['user_id', 'INT64', ''],
      ['order_date', 'DATE', ''],
      ['items', 'INT64', 'Items in the order.'],
      ['gross_revenue', 'NUMERIC', ''],
      ['net_revenue', 'NUMERIC', ''],
      ['has_return', 'BOOL', 'At least one item returned.'],
    ],
  },
  {
    project: ACME,
    dataset: 'marts',
    name: 'dim_customers',
    rows: 100_000,
    growth: 0.002,
    owner: 'sam.okafor',
    domain: 'Customer',
    tags: ['Tier.Tier1', 'DataLayer.Mart', 'Certification.Gold'],
    glossary: ['Business.Customer'],
    usage: 190,
    description:
      'One row per customer with first and last order dates, order count and lifetime revenue. A customer is active if they ordered in the last 90 days.',
    sql: `select u.user_id, u.email_hash, u.age, u.gender, u.country, u.traffic_source as acquisition_channel, u.created_at,\n  min(o.order_date) as first_order_date, max(o.order_date) as last_order_date, count(o.order_id) as orders,\n  coalesce(sum(o.net_revenue), 0) as lifetime_net_revenue,\n  max(o.order_date) >= date_sub(current_date(), interval 90 day) as is_active\nfrom staging.stg_users u left join marts.fct_orders o using (user_id) group by 1,2,3,4,5,6,7`,
    columns: [
      ['user_id', 'INT64', 'Primary key.'],
      ['email_hash', 'STRING', '', ['PII.NonSensitive']],
      ['age', 'INT64', ''],
      ['gender', 'STRING', ''],
      ['country', 'STRING', ''],
      ['acquisition_channel', 'STRING', 'Traffic source of the first visit.', ['Business.Traffic Source']],
      ['created_at', 'TIMESTAMP', ''],
      ['first_order_date', 'DATE', ''],
      ['last_order_date', 'DATE', ''],
      ['orders', 'INT64', ''],
      ['lifetime_net_revenue', 'NUMERIC', '', ['Business.Revenue.Net Revenue']],
      ['is_active', 'BOOL', 'Ordered in the last 90 days.', ['Business.Customer.Active Customer']],
    ],
  },
  {
    project: ACME,
    dataset: 'marts',
    name: 'dim_products',
    rows: 29_120,
    owner: 'lena.ruiz',
    domain: 'Commerce',
    tags: ['Tier.Tier2', 'DataLayer.Mart', 'Certification.Silver'],
    usage: 120,
    description: 'Product dimension.',
    sql: `select * from staging.stg_products`,
    columns: [
      ['product_id', 'INT64', 'Primary key.'],
      ['name', 'STRING', ''],
      ['brand', 'STRING', ''],
      ['category', 'STRING', ''],
      ['department', 'STRING', ''],
      ['cost', 'FLOAT64', ''],
      ['retail_price', 'FLOAT64', ''],
      ['distribution_center', 'STRING', ''],
    ],
  },
  {
    project: ACME,
    dataset: 'marts',
    name: 'fct_sessions',
    tableType: 'Partitioned',
    rows: 680_000,
    growth: 0.005,
    owner: 'ravi.menon',
    domain: 'Marketing',
    tags: ['Tier.Tier2', 'DataLayer.Mart', 'Certification.Silver'],
    glossary: ['Business.Session'],
    usage: 75,
    partition: 'session_date',
    description: 'One row per web session with entry channel, page count and whether it ended in a purchase.',
    sql: `select session_id, any_value(user_id) as user_id, date(min(created_at)) as session_date, any_value(traffic_source) as traffic_source,\n  count(*) as events, logical_or(event_type = 'purchase') as converted\nfrom staging.stg_events group by session_id`,
    columns: [
      ['session_id', 'STRING', 'Primary key.'],
      ['user_id', 'INT64', ''],
      ['session_date', 'DATE', ''],
      ['traffic_source', 'STRING', '', ['Business.Traffic Source']],
      ['events', 'INT64', ''],
      ['converted', 'BOOL', 'Session had a purchase event.'],
    ],
  },

  // ---------- Reporting: acme-analytics.reporting ----------
  {
    project: ACME,
    dataset: 'reporting',
    name: 'daily_revenue',
    tableType: 'MaterializedView',
    rows: 2_400,
    growth: 0.0005,
    owner: 'june.kim',
    domain: 'Commerce',
    tags: ['Tier.Tier1', 'DataLayer.Reporting', 'Certification.Gold'],
    glossary: ['Business.Revenue'],
    usage: 520,
    description: 'Daily gross and net revenue, orders and return rate. Feeds the executive revenue dashboard.',
    sql: `select order_date, count(distinct order_id) as orders, sum(gross_revenue) as gross_revenue, sum(net_revenue) as net_revenue,\n  safe_divide(countif(is_returned), count(*)) as return_rate\nfrom marts.fct_order_items group by order_date`,
    columns: [
      ['order_date', 'DATE', ''],
      ['orders', 'INT64', ''],
      ['gross_revenue', 'NUMERIC', '', ['Business.Revenue.Gross Revenue']],
      ['net_revenue', 'NUMERIC', '', ['Business.Revenue.Net Revenue']],
      ['return_rate', 'FLOAT64', '', ['Business.Return Rate']],
    ],
  },
  {
    project: ACME,
    dataset: 'reporting',
    name: 'customer_ltv',
    rows: 100_000,
    growth: 0.002,
    owner: 'sam.okafor',
    domain: 'Customer',
    tags: ['Tier.Tier2', 'DataLayer.Reporting'],
    usage: 88,
    description: '',
    sql: `select acquisition_channel, date_trunc(date(created_at), month) as cohort_month, count(*) as customers, avg(lifetime_net_revenue) as avg_ltv\nfrom marts.dim_customers group by 1, 2`,
    columns: [
      ['acquisition_channel', 'STRING', ''],
      ['cohort_month', 'DATE', ''],
      ['customers', 'INT64', ''],
      ['avg_ltv', 'NUMERIC', ''],
    ],
  },
  {
    project: ACME,
    dataset: 'reporting',
    name: 'marketing_attribution',
    rows: 9_500,
    growth: 0.001,
    domain: 'Marketing',
    tags: ['Tier.Tier3', 'DataLayer.Reporting'],
    usage: 14,
    description: 'Last-touch attribution of orders to traffic source by day.',
    sql: `select s.session_date, s.traffic_source, count(*) as sessions, countif(s.converted) as conversions, sum(o.net_revenue) as attributed_revenue\nfrom marts.fct_sessions s left join marts.fct_orders o on o.user_id = s.user_id and o.order_date = s.session_date group by 1, 2`,
    columns: [
      ['session_date', 'DATE', ''],
      ['traffic_source', 'STRING', ''],
      ['sessions', 'INT64', ''],
      ['conversions', 'INT64', ''],
      ['attributed_revenue', 'NUMERIC', ''],
    ],
  },
]

/** Table-level lineage: [from, to] as "dataset.table". Column lineage below. */
const EDGES: [string, string][] = [
  ['thelook_ecommerce.orders', 'staging.stg_orders'],
  ['thelook_ecommerce.order_items', 'staging.stg_order_items'],
  ['thelook_ecommerce.products', 'staging.stg_order_items'],
  ['thelook_ecommerce.users', 'staging.stg_users'],
  ['thelook_ecommerce.products', 'staging.stg_products'],
  ['thelook_ecommerce.distribution_centers', 'staging.stg_products'],
  ['thelook_ecommerce.events', 'staging.stg_events'],
  ['staging.stg_order_items', 'marts.fct_order_items'],
  ['staging.stg_orders', 'marts.fct_order_items'],
  ['marts.fct_order_items', 'marts.fct_orders'],
  ['staging.stg_users', 'marts.dim_customers'],
  ['marts.fct_orders', 'marts.dim_customers'],
  ['staging.stg_products', 'marts.dim_products'],
  ['staging.stg_events', 'marts.fct_sessions'],
  ['marts.fct_order_items', 'reporting.daily_revenue'],
  ['marts.dim_customers', 'reporting.customer_ltv'],
  ['marts.fct_sessions', 'reporting.marketing_attribution'],
  ['marts.fct_orders', 'reporting.marketing_attribution'],
]

const COLUMN_LINEAGE: Record<string, { from: string[]; to: string }[]> = {
  'marts.fct_order_items->reporting.daily_revenue': [
    { from: ['order_date'], to: 'order_date' },
    { from: ['order_id'], to: 'orders' },
    { from: ['gross_revenue'], to: 'gross_revenue' },
    { from: ['net_revenue'], to: 'net_revenue' },
    { from: ['is_returned'], to: 'return_rate' },
  ],
  'staging.stg_order_items->marts.fct_order_items': [
    { from: ['order_item_id'], to: 'order_item_id' },
    { from: ['sale_price'], to: 'gross_revenue' },
    { from: ['sale_price', 'returned_at'], to: 'net_revenue' },
    { from: ['sale_price', 'cost'], to: 'gross_margin' },
    { from: ['returned_at'], to: 'is_returned' },
  ],
  'thelook_ecommerce.order_items->staging.stg_order_items': [
    { from: ['id'], to: 'order_item_id' },
    { from: ['sale_price'], to: 'sale_price' },
    { from: ['returned_at'], to: 'returned_at' },
  ],
  'thelook_ecommerce.users->staging.stg_users': [
    { from: ['id'], to: 'user_id' },
    { from: ['email'], to: 'email_hash' },
    { from: ['traffic_source'], to: 'traffic_source' },
  ],
}

function columnEntities(tableFqn: string, cols: Col[], r: ReturnType<typeof rng>): Entity[] {
  // One primary key per table, as OpenMetadata requires: "id", else a known key, else a leading *_id column.
  const names = cols.map((c) => c[0])
  const pk =
    names.find((n) => n === 'id') ??
    names.find((n) => /^(order_item_id|session_id)$/.test(n)) ??
    (names[0]?.endsWith('_id') ? names[0] : undefined)
  return cols.map(([name, type, description, tags, children], i) => ({
    name,
    displayName: name,
    fullyQualifiedName: `${tableFqn}.${name}`,
    dataType: OM_TYPE[type] ?? type,
    dataTypeDisplay: type === 'RECORD' ? `STRUCT<${(children ?? []).map((c) => `${c[0]}:${c[1]}`).join(',')}>` : type,
    description: description ?? '',
    ordinalPosition: i + 1,
    constraint: name === pk ? 'PRIMARY_KEY' : 'NULL',
    tags: (tags ?? []).map((t) => tagLabel(t, t.startsWith('Business.') ? 'Glossary' : 'Classification')),
    children: children ? columnEntities(`${tableFqn}.${name}`, children, r) : undefined,
  })) as unknown as Entity[]
}

export function seedCatalog() {
  const r = rng(42)
  const t0 = today()

  const service = store.add('services/databaseServices', {
    name: SERVICE,
    displayName: 'BigQuery',
    serviceType: 'BigQuery',
    description: 'Google BigQuery: the public theLook dataset and the acme-analytics warehouse project.',
    owners: [ownerRef('Data Platform')],
    connection: {
      config: {
        type: 'BigQuery',
        scheme: 'bigquery',
        hostPort: 'bigquery.googleapis.com',
        credentials: {
          gcpConfig: {
            type: 'service_account',
            projectId: [PUB, ACME],
            clientEmail: 'openmetadata@acme-analytics.iam.gserviceaccount.com',
          },
        },
        taxonomyProjectID: [],
        usageLocation: 'us',
        supportsMetadataExtraction: true,
        supportsUsageExtraction: true,
        supportsLineageExtraction: true,
        supportsDBTExtraction: true,
        supportsProfiler: true,
        supportsQueryComment: true,
      },
    },
  })
  const svcRef = ref(service, 'databaseService')

  const databases = new Map<string, Entity>()
  const schemas = new Map<string, Entity>()
  for (const project of [PUB, ACME]) {
    databases.set(
      project,
      store.add('databases', {
        name: project,
        fullyQualifiedName: fqn(SERVICE, project),
        service: svcRef,
        serviceType: 'BigQuery',
        description: project === PUB ? 'Google-hosted public datasets.' : 'The company warehouse project. Modeled with dbt.',
        owners: project === ACME ? [ownerRef('Data Platform')] : [],
      }),
    )
  }
  const datasetInfo: Record<string, [string, string, string]> = {
    [RAW]: [PUB, 'theLook eCommerce: a fictitious clothing store, regenerated daily by Google.', 'Data Platform'],
    staging: [ACME, 'One view per source table: typed, renamed, PII removed.', 'Analytics Engineering'],
    marts: [ACME, 'Facts and dimensions. Certified tables live here.', 'Analytics Engineering'],
    reporting: [ACME, 'Aggregates that feed dashboards.', 'Analytics Engineering'],
  }
  for (const [dataset, [project, description, owner]] of Object.entries(datasetInfo)) {
    const db = databases.get(project)!
    schemas.set(
      dataset,
      store.add('databaseSchemas', {
        name: dataset,
        fullyQualifiedName: fqn(SERVICE, project, dataset),
        service: svcRef,
        serviceType: 'BigQuery',
        database: ref(db, 'database'),
        description,
        owners: [ownerRef(owner)],
      }),
    )
  }

  const tables = new Map<string, Entity>()
  for (const def of TABLES) {
    const tableFqn = fqn(SERVICE, def.project, def.dataset, def.name)
    const db = databases.get(def.project)!
    const schema = schemas.get(def.dataset)!
    const tags = [...(def.tags ?? []).map((t) => tagLabel(t)), ...(def.glossary ?? []).map((t) => tagLabel(t, 'Glossary'))]
    const usage = def.usage ?? 0
    const sizeInByte = Math.round(def.rows * def.columns.length * 18)
    const table = store.add('tables', {
      name: def.name,
      fullyQualifiedName: tableFqn,
      description: def.description,
      tableType: def.tableType ?? 'Regular',
      columns: columnEntities(tableFqn, def.columns, r),
      service: svcRef,
      serviceType: 'BigQuery',
      database: ref(db, 'database'),
      databaseSchema: ref(schema, 'databaseSchema'),
      owners: def.owner ? [ownerRef(def.owner)] : [],
      domains: def.domain ? [domainRef(def.domain)] : [],
      tags,
      followers: usage > 200 ? [userRef('june.kim')] : [],
      schemaDefinition: def.sql,
      tablePartition: def.partition ? { columns: [{ columnName: def.partition, intervalType: 'TIME-UNIT', interval: 'DAY' }] } : undefined,
      tableConstraints: def.cluster ? [{ constraintType: 'CLUSTER_KEY', columns: def.cluster }] : undefined,
      sourceUrl: `https://console.cloud.google.com/bigquery?project=${def.project}&ws=!1m5!1m4!4m3!1s${def.project}!2s${def.dataset}!3s${def.name}`,
      usageSummary: {
        date: new Date(t0).toISOString().slice(0, 10),
        dailyStats: { count: Math.round(usage / 7), percentileRank: Math.min(99, usage / 6) },
        weeklyStats: { count: usage, percentileRank: Math.min(99, usage / 6) },
        monthlyStats: { count: usage * 4, percentileRank: Math.min(99, usage / 6) },
      },
      profile: { timestamp: t0, rowCount: def.rows, columnCount: def.columns.length, sizeInByte },
      lifeCycle: {
        created: { timestamp: t0 - 400 * DAY, accessedBy: userRef('ingestion-bot') },
        accessed: { timestamp: t0 - (usage ? 0 : 40) * DAY },
      },
      updatedAt: t0 - r.int(1, 20) * DAY,
      updatedBy: 'ingestion-bot',
    })
    tables.set(`${def.dataset}.${def.name}`, table)
    seedProfiles(table, def, r)
  }

  for (const [from, to] of EDGES) {
    const a = tables.get(from)!
    const b = tables.get(to)!
    const def = TABLES.find((t) => `${t.dataset}.${t.name}` === to)
    const cols = COLUMN_LINEAGE[`${from}->${to}`]
    store.lineage.set(`${a.id}->${b.id}`, {
      fromEntity: { id: a.id, type: 'table', fullyQualifiedName: a.fullyQualifiedName },
      toEntity: { id: b.id, type: 'table', fullyQualifiedName: b.fullyQualifiedName },
      source: to.startsWith('staging') ? 'ViewLineage' : 'QueryLineage',
      sqlQuery: def?.sql,
      columns: cols?.map((c) => ({
        fromColumns: c.from.map((f) => `${a.fullyQualifiedName}.${f}`),
        toColumn: `${b.fullyQualifiedName}.${c.to}`,
      })),
    })
  }

  seedQueries(tables, r)

  seedDataProducts({
    'Orders 360': ['marts.fct_order_items', 'marts.fct_orders', 'reporting.daily_revenue'].map((k) => tables.get(k)!),
    'Customer 360': ['marts.dim_customers', 'reporting.customer_ltv'].map((k) => tables.get(k)!),
    'Web Attribution': ['marts.fct_sessions', 'reporting.marketing_attribution'].map((k) => tables.get(k)!),
  })

  store.threads.push(
    thread(
      'Conversation',
      tables.get('reporting.daily_revenue')!,
      'june.kim',
      'Does net_revenue here subtract returns on the return date or the order date?',
      [
        ['lena.ruiz', 'Order date. A return in March for a February order lowers February. See the Net Revenue glossary term.'],
        ['june.kim', 'Thanks, that matches finance. Adding a note to the description.'],
      ],
      2,
    ),
    thread(
      'Conversation',
      tables.get('reporting.customer_ltv')!,
      'ravi.menon',
      'This table has no description or owner yet. Sam, is this yours?',
      [],
      1,
    ),
    thread(
      'Announcement',
      tables.get('marts.fct_order_items')!,
      'lena.ruiz',
      'From next Monday, fct_order_items excludes cancelled orders at the source. Downstream counts drop about 15%.',
      [],
      5,
    ),
  )
}

function thread(type: string, about: Entity, from: string, message: string, posts: [string, string][], daysAgo: number): Entity {
  const ts = today() - daysAgo * DAY + 10 * 3_600_000
  return {
    id: crypto.randomUUID(),
    name: message.slice(0, 40),
    type,
    about: `<#E::table::${about.fullyQualifiedName}>`,
    entityRef: ref(about, 'table'),
    message,
    createdBy: from,
    threadTs: ts,
    updatedAt: ts + posts.length * 3_600_000,
    updatedBy: posts.at(-1)?.[0] ?? from,
    posts: posts.map(([who, msg], i) => ({
      id: crypto.randomUUID(),
      from: who,
      message: msg,
      postTs: ts + (i + 1) * 3_600_000,
      reactions: [],
    })),
    postsCount: posts.length,
    reactions: [],
    resolved: false,
  }
}

function seedProfiles(table: Entity, def: TableDef, r: ReturnType<typeof rng>) {
  const t0 = today()
  const days = 30
  const growth = def.growth ?? 0
  const series = []
  for (let d = days - 1; d >= 0; d--) {
    const rowCount = Math.round(def.rows / Math.pow(1 + growth, d))
    series.push({
      timestamp: t0 - d * DAY,
      rowCount,
      columnCount: def.columns.length,
      sizeInByte: rowCount * def.columns.length * 18,
      createDateTime: new Date(t0 - d * DAY).toISOString(),
    })
  }
  store.tableProfiles.set(table.fullyQualifiedName!, series)

  for (const col of table.columns as Entity[]) {
    const type = col.dataTypeDisplay as string
    const nullable = /_at$|returned|sold|user_id|delivered|shipped/.test(col.name) && !/created_at/.test(col.name)
    const nullBase = nullable ? (col.name.includes('returned') ? 0.9 : col.name.includes('user_id') ? 0.55 : 0.3) : 0
    const rows = []
    for (let d = days - 1; d >= 0; d--) {
      const valuesCount = Math.round(def.rows / Math.pow(1 + growth, d))
      const nullProportion = Math.max(0, Math.min(1, nullBase + (nullBase ? r.normal(0, 0.01) : 0)))
      const isKey = col.constraint === 'PRIMARY_KEY'
      const distinct = isKey
        ? valuesCount
        : type === 'STRING'
          ? Math.min(valuesCount, r.int(5, 3000))
          : type === 'BOOL'
            ? 2
            : Math.min(valuesCount, r.int(50, 50_000))
      const numeric = ['INT64', 'FLOAT64', 'NUMERIC'].includes(type)
      const max = numeric
        ? col.name.includes('price') || col.name.includes('revenue')
          ? 999
          : col.name === 'age'
            ? 70
            : valuesCount
        : undefined
      rows.push({
        name: col.name,
        timestamp: t0 - d * DAY,
        valuesCount,
        nullCount: Math.round(valuesCount * nullProportion),
        nullProportion,
        uniqueCount: isKey ? valuesCount : Math.round(distinct * 0.3),
        uniqueProportion: isKey ? 1 : distinct / valuesCount / 3,
        distinctCount: distinct,
        distinctProportion: distinct / valuesCount,
        ...(numeric ? { min: col.name === 'age' ? 12 : 0, max, mean: max! / 2.4, median: max! / 2.8, stddev: max! / 5 } : {}),
        ...(type === 'STRING' ? { minLength: 1, maxLength: r.int(8, 60) } : {}),
      })
    }
    store.columnProfiles.set(col.fullyQualifiedName!, rows)
  }

  const sample = SAMPLES[`${def.dataset}.${def.name}`]
  if (sample) store.sampleData.set(table.id, sample(r))
}

const FIRST = ['Avery', 'Jordan', 'Riley', 'Quinn', 'Morgan', 'Casey', 'Rowan', 'Emery', 'Hayden', 'Parker']
const LAST = ['Example', 'Sample', 'Testcase', 'Placeholder', 'Demo']
const STATES = ['California', 'Texas', 'New York', 'Illinois', 'Florida', 'Washington']
const SOURCES = ['Search', 'Organic', 'Email', 'Facebook', 'Display']
const STATUSES = ['Complete', 'Shipped', 'Processing', 'Cancelled', 'Returned']
const CATEGORIES = ['Jeans', 'Tops & Tees', 'Swim', 'Outerwear & Coats', 'Sweaters', 'Accessories']
const BRANDS = ['Northfield', 'Calder & Co', 'Bluebird', 'Moss Lane', 'Harbor']

function iso(ts: number) {
  return new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC')
}

const SAMPLES: Record<string, (r: ReturnType<typeof rng>) => { columns: string[]; rows: unknown[][] }> = {
  'thelook_ecommerce.users': (r) => ({
    columns: ['id', 'first_name', 'last_name', 'email', 'age', 'gender', 'state', 'city', 'country', 'traffic_source', 'created_at'],
    rows: Array.from({ length: 25 }, (_, i) => {
      const f = r.pick(FIRST)
      const l = r.pick(LAST)
      return [
        1000 + i * 37,
        f,
        l,
        `${f}.${l}${i}@example.com`.toLowerCase(),
        r.int(16, 70),
        r.pick(['M', 'F']),
        r.pick(STATES),
        'Springfield',
        'United States',
        r.pick(SOURCES),
        iso(today() - r.int(1, 1200) * DAY),
      ]
    }),
  }),
  'thelook_ecommerce.orders': (r) => ({
    columns: ['order_id', 'user_id', 'status', 'gender', 'created_at', 'shipped_at', 'num_of_item'],
    rows: Array.from({ length: 25 }, (_, i) => {
      const created = today() - r.int(0, 400) * DAY
      const status = r.pick(STATUSES)
      return [
        50_000 + i * 13,
        r.int(1, 100_000),
        status,
        r.pick(['M', 'F']),
        iso(created),
        status === 'Processing' || status === 'Cancelled' ? null : iso(created + 2 * DAY),
        r.int(1, 4),
      ]
    }),
  }),
  'thelook_ecommerce.order_items': (r) => ({
    columns: ['id', 'order_id', 'user_id', 'product_id', 'status', 'created_at', 'sale_price'],
    rows: Array.from({ length: 25 }, (_, i) => [
      90_000 + i,
      50_000 + Math.floor(i / 2) * 13,
      r.int(1, 100_000),
      r.int(1, 29_120),
      r.pick(STATUSES),
      iso(today() - r.int(0, 400) * DAY),
      Math.round(r.next() * 25000) / 100 + 5,
    ]),
  }),
  'thelook_ecommerce.products': (r) => ({
    columns: ['id', 'cost', 'category', 'name', 'brand', 'retail_price', 'department'],
    rows: Array.from({ length: 25 }, (_, i) => {
      const price = Math.round(r.next() * 20000) / 100 + 8
      const cat = r.pick(CATEGORIES)
      return [
        i + 1,
        Math.round(price * 45) / 100,
        cat,
        `${r.pick(BRANDS)} ${cat.split(' ')[0]} ${i + 1}`,
        r.pick(BRANDS),
        price,
        r.pick(['Men', 'Women']),
      ]
    }),
  }),
  'marts.fct_order_items': (r) => ({
    columns: [
      'order_item_id',
      'order_id',
      'user_id',
      'product_id',
      'order_date',
      'status',
      'gross_revenue',
      'net_revenue',
      'cost',
      'gross_margin',
      'is_returned',
    ],
    rows: Array.from({ length: 25 }, (_, i) => {
      const price = Math.round(r.next() * 20000) / 100 + 8
      const cost = Math.round(price * 45) / 100
      const returned = r.next() < 0.1
      return [
        90_000 + i,
        50_000 + Math.floor(i / 2) * 13,
        r.int(1, 100_000),
        r.int(1, 29_120),
        new Date(today() - r.int(0, 60) * DAY).toISOString().slice(0, 10),
        returned ? 'Returned' : 'Complete',
        price,
        returned ? 0 : price,
        cost,
        Math.round((price - cost) * 100) / 100,
        returned,
      ]
    }),
  }),
  'reporting.daily_revenue': (r) => ({
    columns: ['order_date', 'orders', 'gross_revenue', 'net_revenue', 'return_rate'],
    rows: Array.from({ length: 25 }, (_, i) => {
      const gross = Math.round(r.normal(48_000, 6000))
      const rr = Math.round(r.normal(0.1, 0.01) * 1000) / 1000
      return [new Date(today() - (i + 1) * DAY).toISOString().slice(0, 10), r.int(280, 420), gross, Math.round(gross * (1 - rr)), rr]
    }),
  }),
  'marts.dim_customers': (r) => ({
    columns: [
      'user_id',
      'age',
      'gender',
      'country',
      'acquisition_channel',
      'first_order_date',
      'last_order_date',
      'orders',
      'lifetime_net_revenue',
      'is_active',
    ],
    rows: Array.from({ length: 25 }, (_, i) => {
      const orders = r.int(0, 6)
      const last = today() - r.int(1, 500) * DAY
      return [
        1000 + i * 37,
        r.int(16, 70),
        r.pick(['M', 'F']),
        'United States',
        r.pick(SOURCES),
        orders ? new Date(last - r.int(30, 700) * DAY).toISOString().slice(0, 10) : null,
        orders ? new Date(last).toISOString().slice(0, 10) : null,
        orders,
        Math.round(orders * r.normal(85, 30) * 100) / 100,
        orders > 0 && last > today() - 90 * DAY,
      ]
    }),
  }),
}

function seedQueries(tables: Map<string, Entity>, r: ReturnType<typeof rng>) {
  const queries: [string, string[], string][] = [
    [
      'select order_date, net_revenue from `acme-analytics.reporting.daily_revenue` where order_date >= date_sub(current_date(), interval 28 day) order by 1',
      ['reporting.daily_revenue'],
      'june.kim',
    ],
    [
      'select p.category, sum(f.net_revenue) as net_revenue\nfrom `acme-analytics.marts.fct_order_items` f join `acme-analytics.marts.dim_products` p using (product_id)\nwhere f.order_date >= "2026-01-01" group by 1 order by 2 desc',
      ['marts.fct_order_items', 'marts.dim_products'],
      'lena.ruiz',
    ],
    [
      'select acquisition_channel, countif(is_active) / count(*) as active_share from `acme-analytics.marts.dim_customers` group by 1',
      ['marts.dim_customers'],
      'sam.okafor',
    ],
    [
      'select traffic_source, sum(conversions) / sum(sessions) as cvr from `acme-analytics.reporting.marketing_attribution` group by 1',
      ['reporting.marketing_attribution'],
      'ravi.menon',
    ],
    ['select status, count(*) from `bigquery-public-data.thelook_ecommerce.orders` group by 1', ['thelook_ecommerce.orders'], 'ada.park'],
    [
      'select date(created_at) as d, count(*) from `bigquery-public-data.thelook_ecommerce.events` where event_type = "purchase" group by 1',
      ['thelook_ecommerce.events'],
      'ravi.menon',
    ],
  ]
  for (const [sql, used, user] of queries) {
    const refs = used.map((u) => ref(tables.get(u)!, 'table'))
    store.add('queries', {
      name: `q_${Math.abs(hash(sql))}`,
      query: sql,
      checksum: String(Math.abs(hash(sql))),
      queryUsedIn: refs,
      users: [userRef(user)],
      duration: Math.round(r.next() * 9000) / 1000,
      queryDate: today() - r.int(0, 6) * DAY,
      service: SERVICE,
      owners: [userRef(user)],
      votes: { upVotes: r.int(0, 5), downVotes: 0 },
    })
  }
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}
