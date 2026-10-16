"""Map layers icon mapping (owner 2026-10-16): one icon per main activity (layer 1) and per subcategory (layer 2), Tabler icons (MIT).
Specialties (layer 3) are text chips, not icons. Validated against @tabler/icons@3.19.0 icons.json."""
MAIN = {
 'food':'tools-kitchen-2','agri':'plant-2','build':'wall','contract':'crane','ind':'building-factory-2','equip':'bulldozer',
 'elec':'device-laptop','auto':'car','home':'sofa','fashion':'shirt','beauty':'brush','health':'stethoscope','edu':'school',
 'hosp':'building-castle','log':'truck-delivery','biz':'briefcase','re':'building-estate','fin':'building-bank','retail':'shopping-bag',
 'energy':'bolt','sports':'ball-football','media':'movie','personal':'user-heart','noncom':'building-community','unc':'help-circle'}
SUB = {
 # food
 'food.restaurant':'tools-kitchen-2','food.fast_food':'burger','food.buffet_popular':'bowl','food.cafe':'coffee','food.juice_icecream':'ice-cream',
 'food.hookah':'smoking','food.bakery':'bread','food.sweets':'candy','food.catering':'chef-hat','food.cloud_kitchen':'soup','food.food_truck':'truck',
 'food.supermarket':'shopping-cart','food.grocery':'basket','food.butcher':'meat','food.fish_market':'fish','food.fruits_veg':'apple','food.dates':'plant',
 'food.nuts_spices':'pepper','food.honey':'droplet','food.health_food':'salad','food.ready_meals_retail':'microwave','food.roastery':'coffee',
 'food.coffee_tea_supplier':'cup','food.food_wholesale':'packages','food.beverage_distributor':'bottle','food.meat_poultry_wholesale':'meat',
 'food.produce_wholesale':'carrot','food.food_factory':'building-factory','food.meat_processing':'meat','food.fish_processing':'fish',
 'food.fruit_veg_processing':'lemon','food.oils_fats':'droplet-half-2','food.dairy':'milk','food.grain_mills':'grain','food.confectionery_mfg':'candy',
 'food.pasta_snacks_mfg':'cookie','food.water_factory':'droplet','food.beverage_mfg':'bottle','food.frozen':'snowflake',
 'food.packaging_disposables':'paper-bag','food.restaurant_equipment':'tools-kitchen','food.tobacco_wholesale':'smoking',
 # agri
 'agri.farm':'plant-2','agri.dates_farm':'trees','agri.greenhouse':'plant','agri.nursery':'seeding','agri.supplies':'shovel',
 'agri.feed':'grain','agri.livestock':'horse','agri.cattle_dairy_farm':'milk','agri.camels_horses':'horse','agri.poultry':'egg',
 'agri.birds_pets_trading':'feather','agri.fisheries':'fish-hook','agri.equipment':'tractor','agri.forestry_charcoal':'flame','agri.services':'plant',
 'agri.vet_supplies':'vaccine',
 # build
 'build.general_materials':'wall','build.cement_blocks':'box','build.ready_mix':'truck','build.steel_rebar':'grid-pattern','build.aggregates':'mountain',
 'build.timber':'wood','build.plumbing_supply':'droplet','build.pipes_fittings':'arrows-split','build.pumps_tanks':'engine','build.electrical_supply':'plug',
 'build.cables_wires':'plug-connected','build.lighting_supply':'bulb','build.hvac_supply':'air-conditioning','build.insulation':'stack-2','build.paint':'paint',
 'build.tiles_ceramic':'layout-grid','build.marble_stone':'diamond','build.gypsum':'wall','build.doors_windows':'door','build.aluminum_glass':'window',
 'build.kitchens_cabinets':'fridge','build.flooring_parquet':'layout-board','build.wallpaper_decor':'wallpaper','build.hardware_tools':'tool',
 'build.fasteners':'nut','build.roofing_cladding':'home','build.interlock_pavers':'grid-dots','build.scaffolding':'building-skyscraper',
 'build.safety_fire_supply':'fire-extinguisher','build.elevators':'elevator','build.landscaping_supply':'plant','build.pools_supply':'pool',
 'build.prefab':'building-warehouse','build.construction_chemicals':'flask','build.metal_fabrication':'hammer','build.carpentry':'axe',
 'build.marble_workshop':'diamond','build.glass_workshop':'window',
 # contract
 'contract.general':'crane','contract.residential_builder':'home-2','contract.roads':'road','contract.utilities_projects':'building-tunnel',
 'contract.civil_infra':'building-bridge-2','contract.plumbing':'droplet-cog','contract.electrical':'bolt','contract.hvac':'air-conditioning',
 'contract.fire_safety':'fire-extinguisher','contract.finishing':'paint','contract.painting':'brush','contract.gypsum':'wall','contract.tiling':'layout-grid',
 'contract.aluminum_glass':'window','contract.steel_structures':'building-factory','contract.waterproofing':'umbrella','contract.landscaping':'trees',
 'contract.pools':'pool','contract.demolition_excavation':'bulldozer','contract.well_drilling':'droplet-down','contract.smart_home':'home-signal',
 'contract.maintenance':'tool','contract.facility_mgmt':'building','contract.handyman':'hammer','contract.interior_design':'armchair',
 'contract.engineering_consult':'ruler-measure','contract.surveying':'map-pin','contract.project_mgmt':'checklist',
 # ind
 'ind.plastic':'bottle','ind.rubber':'circle-dot','ind.metal':'hammer','ind.aluminum_mfg':'building-factory','ind.structural_metal':'building-factory-2',
 'ind.tanks_mfg':'cylinder','ind.metal_coating':'spray','ind.chemicals':'flask-2','ind.paint_mfg':'paint','ind.fertilizer_mfg':'plant-2',
 'ind.petrochemicals':'gas-station','ind.packaging':'package','ind.paper_tissue':'file','ind.textile_mfg':'needle-thread','ind.garment_mfg':'shirt',
 'ind.textile_articles_mfg':'needle-thread','ind.leather_footwear_mfg':'shoe','ind.furniture_mfg':'armchair','ind.wood_products':'wood',
 'ind.concrete_products':'box','ind.cement_mfg':'building-factory','ind.ceramics_mfg':'layout-grid','ind.glass_mfg':'glass','ind.insulation_mfg':'stack-2',
 'ind.electrical_mfg':'plug','ind.cables_mfg':'plug-connected','ind.lighting_mfg':'bulb','ind.batteries_mfg':'battery','ind.appliances_mfg':'wash-machine',
 'ind.electronics_mfg':'cpu','ind.machinery_mfg':'settings','ind.pumps_valves_mfg':'engine','ind.vehicle_parts_mfg':'car','ind.boats_mfg':'sailboat',
 'ind.medical_devices_mfg':'heartbeat','ind.jewelry_mfg':'diamond','ind.toys_sports_mfg':'horse-toy','ind.printing_industrial':'printer',
 'ind.tobacco_mfg':'smoking','ind.industrial_supplies':'tool','ind.industrial_installation':'settings-cog','ind.recycling':'recycle',
 'ind.general_factory':'building-factory-2',
 # equip
 'equip.heavy_sales':'bulldozer','equip.rental':'key','equip.generators':'bolt','equip.cranes_lifting':'crane','equip.compressors':'wind',
 'equip.welding':'flame','equip.workshop_equipment':'tool','equip.spare_parts':'settings','equip.repair':'tools','equip.cleaning_machines':'vacuum-cleaner',
 'equip.laundry_equipment':'wash-machine','equip.weighing_measuring':'scale','equip.safety_ppe':'helmet',
 # elec
 'elec.mobile_shop':'device-mobile','elec.computers':'device-desktop','elec.electronics_store':'device-tv','elec.appliances_store':'fridge',
 'elec.appliances_wholesale':'fridge','elec.cctv_security':'device-cctv','elec.it_networking_supply':'router','elec.software':'code',
 'elec.hosting_data':'server','elec.telecom':'antenna','elec.telecom_contractor':'antenna-bars-5','elec.printers_copiers':'printer',
 'elec.repair':'device-mobile-cog','elec.appliance_repair':'tool','elec.audio_visual':'speakerphone','elec.gaming':'device-gamepad-2',
 'elec.components':'cpu','elec.pos_systems':'cash-register','elec.satellite_tv':'satellite',
 # auto
 'auto.dealership':'car','auto.used_cars':'car-crash','auto.spare_parts':'settings','auto.tires':'circle','auto.workshop':'car-garage',
 'auto.body_paint':'spray','auto.oil_change':'droplet-half-2','auto.car_wash':'droplets','auto.rental':'key','auto.accessories_tint':'sunglasses',
 'auto.batteries':'battery-automotive','auto.trucks_buses':'bus','auto.trucks_repair':'truck','auto.motorcycles':'motorbike','auto.lubricants_distributor':'droplet-half-2',
 'auto.towing':'truck-loading','auto.inspection':'checkup-list','auto.boats_marine':'sailboat','auto.trailers_bodies':'truck',
 # home
 'home.furniture':'sofa','home.furniture_wholesale':'sofa','home.office_furniture':'armchair-2','home.mattresses':'bed','home.curtains_upholstery':'window',
 'home.carpets':'layout-board','home.kitchenware':'tools-kitchen','home.decor':'flower','home.decor_lighting':'lamp','home.bedding_linen':'bed',
 'home.outdoor_furniture':'armchair','home.home_goods_general':'home','home.used_furniture':'sofa','home.cleaning_supplies':'bucket','home.tents_majlis':'tent',
 # fashion
 'fashion.clothing':'shirt','fashion.abaya':'hanger','fashion.mens_thobe':'hanger-2','fashion.kids':'baby-carriage','fashion.shoes':'shoe',
 'fashion.bags_accessories':'shopping-bag','fashion.perfume':'perfume','fashion.jewelry_gold':'diamond','fashion.watches':'clock',
 'fashion.fabrics':'needle-thread','fashion.tailoring':'needle-thread','fashion.uniforms':'shirt','fashion.apparel_wholesale':'packages','fashion.sportswear':'shirt-sport',
 # beauty
 'beauty.salon_women':'brush','beauty.barber':'scissors','beauty.spa_massage':'massage','beauty.cosmetics_store':'sparkles','beauty.cosmetics_distributor':'packages',
 'beauty.aesthetic_clinic':'sparkles','beauty.salon_supplies':'brush',
 # health
 'health.hospital':'building-hospital','health.clinic':'stethoscope','health.dental':'dental','health.pharmacy':'pill','health.lab':'microscope',
 'health.radiology':'radioactive','health.optics':'eyeglass','health.medical_supply':'first-aid-kit','health.pharma_distributor':'pills',
 'health.pharma_mfg':'vaccine-bottle','health.physio':'stretching','health.vet':'paw','health.home_care':'home-heart','health.dental_supply':'dental',
 'health.residential_care':'home-heart','health.ambulance':'ambulance','health.medical_devices_maintenance':'heartbeat',
 # edu
 'edu.school':'school','edu.nursery':'baby-bottle','edu.kindergarten':'abc','edu.university':'building-community','edu.vocational':'tools',
 'edu.training_center':'presentation','edu.language_center':'language','edu.driving_school':'steering-wheel','edu.tutoring':'pencil',
 'edu.arts_music_school':'music','edu.sports_education':'ball-basketball','edu.educational_supplies':'backpack','edu.quran_center':'book',
 'edu.education_services':'certificate',
 # hosp
 'hosp.hotel':'building-skyscraper','hosp.furnished_apartments':'building','hosp.istiraha':'tent','hosp.camps':'campfire','hosp.wedding_hall':'confetti',
 'hosp.event_planning':'calendar-event','hosp.event_rental':'armchair','hosp.wedding_services':'heart','hosp.travel_agency':'plane',
 'hosp.hajj_umrah':'map-2','hosp.tourism_activities':'map','hosp.hotel_supplies':'bed',
 # log
 'log.freight_customs':'file-certificate','log.courier':'package','log.movers':'truck','log.trucking':'truck-delivery','log.warehousing':'building-warehouse',
 'log.cold_storage':'snowflake','log.3pl':'arrows-exchange','log.passenger_transport':'bus','log.sea_transport':'ship','log.air_cargo':'plane',
 'log.cargo_handling':'forklift','log.packaging_services':'package',
 # biz
 'biz.law':'scale','biz.accounting':'calculator','biz.consulting':'bulb','biz.head_office':'building','biz.marketing_agency':'speakerphone',
 'biz.market_research':'chart-bar','biz.advertising_signage':'sign-right','biz.printing':'printer','biz.copy_center':'copy','biz.design_studio':'palette',
 'biz.photography':'camera','biz.translation':'language','biz.recruitment_manpower':'users','biz.security_services':'shield','biz.cleaning_services':'spray',
 'biz.pest_control':'bug','biz.coworking':'users-group','biz.pro_services':'id','biz.call_center':'headset','biz.stationery_office':'paperclip',
 'biz.general_trading':'arrows-exchange','biz.commercial_agent':'heart-handshake','biz.ecommerce':'shopping-cart','biz.testing_labs':'test-pipe',
 'biz.research':'flask','biz.chamber_association':'building-community','biz.debt_collection':'receipt',
 # re / fin
 're.office':'building-estate','re.developer':'building-skyscraper','re.property_mgmt':'key','re.valuation':'home-dollar','re.commercial_leasing':'building-store',
 'fin.bank':'building-bank','fin.exchange':'arrows-exchange-2','fin.insurance':'shield-check','fin.financing':'cash','fin.atm':'credit-card',
 'fin.investment':'chart-line','fin.fintech_payments':'wallet',
 # retail
 'retail.mall':'building-store','retail.department_store':'building-store','retail.general_store':'shopping-bag','retail.discount_store':'discount',
 'retail.toys':'horse-toy','retail.gifts':'gift','retail.flowers':'flower','retail.pet_shop':'paw','retail.bookstore':'books','retail.baby':'baby-carriage',
 'retail.tobacco_vape':'smoking','retail.party_supplies':'balloon','retail.general_wholesale':'packages','retail.kiosk':'building-store',
 'retail.secondhand':'recycle','retail.antiques':'hourglass','retail.musical_instruments':'guitar-pick','retail.souvenirs_crafts':'gift-card',
 # energy
 'energy.fuel_station':'gas-station','energy.fuel_wholesale':'barrel','energy.lpg':'flame','energy.solar':'solar-panel','energy.electricity':'bolt',
 'energy.water_treatment':'bucket-droplet','energy.water_delivery':'droplet','energy.sewage':'arrows-split','energy.waste':'trash','energy.waste_treatment':'recycle',
 'energy.oil_gas_extraction':'barrel','energy.oil_gas_services':'tool','energy.refining':'building-factory','energy.mining':'pick',
 'energy.mining_services':'pick','energy.ev_charging':'charging-pile','energy.environmental_services':'leaf',
 # sports / media / personal
 'sports.gym':'barbell','sports.club':'trophy','sports.fields':'ball-football','sports.sporting_goods':'ball-tennis','sports.entertainment_center':'confetti',
 'sports.theme_park':'building-carousel','sports.cinema':'movie','sports.pool':'swimming','sports.camping_outdoor':'tent','sports.esports_gaming_center':'device-gamepad',
 'sports.sports_equipment_rental':'key','media.tv_radio':'antenna','media.press':'news','media.publishing':'book-2','media.production':'video',
 'media.arts_crafts':'palette','media.art_gallery':'photo','media.events_entertainment':'microphone-2','media.news_agency':'news',
 'personal.laundry':'wash','personal.shoe_repair':'shoe','personal.watch_jewelry_repair':'clock','personal.funeral':'flower','personal.pet_services':'paw',
 'personal.domestic_help':'home-heart','personal.tailoring_alterations':'needle-thread','personal.other':'user',
}
if __name__ == '__main__':
    import json, sys
    names = set(json.load(open(sys.argv[1])))
    bad = sorted({v for v in list(MAIN.values()) + list(SUB.values()) if v not in names})
    print(len(SUB), 'mapped; invalid:', bad)
