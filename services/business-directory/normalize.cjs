'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.env.FARQ_CONSTRUCTION_SOURCE;if(!root)throw Error('Explicit Construction source required');
const geo=require(path.join(root,'lib/city-districts.js'));
const authority=require(path.join(root,'lib/construction/line-intent-authority.js'));
const out=process.argv[2];const rows=JSON.parse(fs.readFileSync(path.join(out,'sample-raw.json')));
const locations=[],aliases=[];
for(const city of geo.districtCities()){
 locations.push({canonical_id:'city:'+city,type:'city',authority_status:'REFERENCE_IMPORT_PENDING_LICENSE_REVIEW',source:path.join(root,'data/districts',city+'.geojson')});
 for(const f of geo.loadDistricts(city).features){const p=f.properties;locations.push({canonical_id:p.district_id,parent_id:'city:'+city,type:'district',...p,source_codes:p.source_codes,verification:'REFERENCE_IMPORT'});for(const name of [p.name_ar,p.name_en])aliases.push({parent_id:'city:'+city,alias:name,canonical_id:p.district_id});}
}
const results=rows.map(r=>{
 // City admission comes from the source city field, never phone/name.
 const city='riyadh';const loaded=geo.loadDistricts(city);
 const named=geo.findDistrictByName(city,r.district_ar||r.district_en||'');
 const coordinatesValid=typeof r.latitude==='number'&&typeof r.longitude==='number';
 const spatial=coordinatesValid?geo.districtOfPoint(city,r.longitude,r.latitude):null;
 const conflict=Boolean(named&&spatial&&named.district_id!==spatial);
 // Existing resolver permits prefix matches; name-only matches stay INFERRED.
 const district=conflict?null:spatial;
 const product=authority.bindLineToIntent({lineText:[r.category,r.secondary_category].filter(Boolean).join(' ')});
 const primary=(r.category||'').split('|')[0];
 const potentials=/coffee|cafe|مقهى|مقاهي/i.test(primary)?[{product:'paper_cups',role:'POTENTIAL_BUYER',decision:'POTENTIAL',reason:'نشاط مقهى قد يستخدم الأكواب؛ لا دليل على مادة الكوب أو طلب شراء حالي',source_type:'directory_activity'}]:[];
 return {...r,source_record_id:r.poi_key,entity_id:null,city_canonical_id:'city:riyadh',city_verification:'SOURCE_ASSERTED',district_canonical_id:district,district_name_candidate:named?.district_id||null,location_decision:conflict?'CONFLICTED':district?'INFERRED':'UNRESOLVED',location_reason:conflict?'اسم الحي والإحداثيات مختلفان':district?'داخل حدود المرجع؛ دقة إحداثيات سجل المصدر لم تتحقق مستقلاً':'لا إحداثيات مطابقة مؤكدة',product_resolution:product,product_roles:potentials.length?potentials:[{role:'UNKNOWN',product:null,decision:'UNKNOWN',reason:'تصنيف الدليل لا يثبت بيع أو شراء منتج محدد'}],confidence:null,independently_reviewed:false};
});
fs.writeFileSync(path.join(out,'sample-normalized.json'),JSON.stringify(results,null,2));fs.writeFileSync(path.join(out,'location-dictionary.json'),JSON.stringify({locations,aliases,license_status:'Source repository attribution exists; redistribution license not confirmed; local pilot only'},null,2));
const stats={records:results.length,location_decisions:{},verified_sellers:0,verified_buyers:0,potential_buyers:results.filter(r=>r.product_roles.some(x=>x.role==='POTENTIAL_BUYER')).length,independent_precision:null,independent_recall:null};for(const r of results)stats.location_decisions[r.location_decision]=(stats.location_decisions[r.location_decision]||0)+1;
fs.writeFileSync(path.join(out,'pilot-summary.json'),JSON.stringify(stats,null,2));console.log(stats);
