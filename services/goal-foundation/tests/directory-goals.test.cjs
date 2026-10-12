const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.FARQ_CONSTRUCTION_SOURCE;
const { PGlite } = require(path.join(root, 'node_modules/@electric-sql/pglite'));
const { unifiedPort, createDirectoryGoals } = require('../directory-goals.cjs');
const port = unifiedPort(root, path.resolve('services/goal-foundation/.runtime'));
const { createSupabaseConstructionRepository } = require(path.join(root, 'lib/construction/supabase-repository'));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(901);
const pilot = require('../fixtures/public-evidence.json');
const schema = `
  create schema construction;
  create table construction.items(id uuid primary key, name_ar text, farq_spec_id text, is_custom boolean default false, owner_user_id uuid, active boolean default true);
  create table construction.suppliers(id uuid primary key, external_key text, name_ar text, name_en text, city text, active boolean default true,
    directory_visibility text default 'PUBLIC', owner_scope_user_id uuid, source_system text default 'UNRESOLVED', qualification_status text default 'WEBSITE_EVIDENCED',
    business_type text, directory_metadata jsonb default '{}'::jsonb, supplied_items_text text);
  create table construction.supplier_contacts(supplier_id uuid primary key, contact_name text, emails text[], whatsapp_e164 text, phone_e164 text);
  create table construction.supplier_item_capabilities(supplier_id uuid, item_id uuid, match_status text, confidence numeric, active boolean default true, expires_at timestamptz, source_ref text);
  create table construction.supplier_product_evidence(owner_user_id uuid, supplier_id uuid, item_id uuid, status text, confidence numeric, source_kind text, expires_at timestamptz);
  create table construction.supplier_product_intelligence(supplier_id uuid, product_id text, confidence_level text, confidence_score numeric, evidence_status text, evidence_source text, commercial_role text, model_version text, expires_at timestamptz);
  create table construction.supplier_product_suppressions(supplier_id uuid, product_id text, family_id text, lifted_at timestamptz);
  create table construction.intelligence_supplier_state(owner_user_id uuid, supplier_id uuid, blocked boolean default false);
create table construction.supplier_profile_facts(supplier_id uuid, fact_type text, status text, normalized_value text, relationship text, scope_owner_user_id uuid, raw_evidence text, confidence numeric, expires_at timestamptz);
`;
test('unified CPO resolves extension through original authority', () => {
  for (const objective of ['purchase', 'availability', 'marketing', 'partnership']) {
    const g = port.analyze({ objective, productText: 'حبوب قهوة' });
    assert.equal(g.product.verdict.canonical_intent_id, 'coffee_beans_product');
    assert.equal(g.ontologyVersion, 'cpo-v27-goals-experiment-1');
  }
});
test('same coffee product: actual directory SQL separates seller, possible buyer and possible partner', async () => {
 const db = new PGlite();
 try {
  await db.exec(schema);
  for (const [i, entity] of pilot.entities.entries()) {
   await db.query('insert into construction.suppliers(id,external_key,name_ar) values ($1,$2,$3)', [id(i+1),entity.id,entity.name]);
   await db.query('insert into construction.supplier_contacts(supplier_id,emails) values ($1,$2)', [id(i+1),['fixture@example.invalid']]);
  }
  // Only explicit wholesale beans proof feeds seller intelligence. Generic coffee distribution does not prove beans.
  await db.query("insert into construction.supplier_product_intelligence(supplier_id,product_id,confidence_level,confidence_score,commercial_role,model_version) values ($1,'coffee_beans_product','confirmed',0.9,'SELLER','public-pilot')", [id(1)]);
  for (const [index, relation] of [[1,'BUYER_USES_PRODUCT'],[2,'DISTRIBUTES_PRODUCT']]) {
   const entity = pilot.entities[index];
   const proof = { product:'coffee_beans_product', relationship:relation, url:entity.url, reason_ar:entity.reason_ar,
     limitations:entity.does_not_prove, inferred:true, productFormVerified:index===1 };
   await db.query("insert into construction.supplier_profile_facts values ($1,'SUPPLIER_INFO','OBSERVED','coffee_beans_product',$2,$3,$4,0.6,now()+interval '1 day')", [id(index+1),relation,owner,JSON.stringify(proof)]);
  }
  let reads = 0;
  const query = async (sql, params) => {
   assert.match(sql.trim(), /^(select|with)\b/i); reads++;
   const r = await db.query(sql,params); return {...r,rowCount:r.rows.length};
  };
  const repository = createSupabaseConstructionRepository({pool:{query},dispatcher:{dispatch(){throw Error('OUTBOUND_DISABLED')}}});
  const engine = createDirectoryGoals({port,repository,query});
  const run = (objective, actorId=owner, productText='حبوب قهوة') => engine.discover({objective, productText,actor:{actorId}});
  const purchase = await run('purchase');
  assert.deepEqual(purchase.candidates.map(c=>c.entity.id),['sulalat']);
  assert.equal(purchase.candidates[0].availability,'unknown');
  assert.deepEqual((await run('availability')).candidates.map(c=>c.entity.id),['sulalat']);
  const buyer = await run('marketing');
  assert.deepEqual(buyer.candidates.map(c=>c.entity.id),['barns']);
  assert.equal(buyer.candidates[0].classification,'potential_only');
  assert.equal(buyer.candidates[0].purchaseIntent,'unknown');
  const partner = await run('partnership');
  assert.deepEqual(partner.candidates,[], 'TBA coffee distribution is not verified beans distribution');
  // Synthetic positive: verify mechanics without relabelling a real company fact.
  await db.query("insert into construction.suppliers(id,external_key,name_ar) values ($1,'synthetic-partner','جهة اختبار وهمية')", [id(4)]);
  const proof={product:'coffee_beans_product', relationship:'DISTRIBUTES_PRODUCT',url:'https://fixture.example.invalid/evidence',reason_ar:'دليل وهمي لاختبار توزيع الحبوب تحديدًا',productFormVerified:true};
  await db.query("insert into construction.supplier_profile_facts values ($1,'SUPPLIER_INFO','OBSERVED','coffee_beans_product','DISTRIBUTES_PRODUCT',$2,$3,0.8,now()+interval '1 day')",[id(4),owner,JSON.stringify(proof)]);
  const synthetic=await run('partnership');
  assert.deepEqual(synthetic.candidates.map(c=>c.entity.id),['synthetic-partner']);
  assert.equal(synthetic.candidates[0].partnershipAcceptance,'unknown');
  assert.deepEqual((await run('marketing',id(902))).candidates,[]);
  assert.deepEqual((await run('marketing',owner,'أكواب ورقية')).candidates,[]);
  assert.deepEqual((await run('purchase',owner,'قهوة')).candidates,[]);
  assert.equal((await run('marketing',owner,'green coffee beans')).state,'product_form_evidence_gap');
  await db.query('insert into construction.supplier_product_suppressions(supplier_id,product_id) values ($1,$2)',[id(4),'coffee_beans_product']);
  assert.deepEqual((await run('partnership')).candidates,[], 'negative product evidence overrides positive relationship');
  await db.query('update construction.suppliers set owner_scope_user_id=$1 where id=$2',[id(902),id(2)]);
  assert.deepEqual((await run('marketing')).candidates,[], 'private directory identity is never leaked');
  await db.query("update construction.supplier_profile_facts set expires_at=now()-interval '1 day'");
  assert.deepEqual((await run('marketing')).candidates,[]);
  assert.deepEqual((await run('partnership')).candidates,[]);
  assert.ok(reads>10);
 } finally {await db.close();}
});
