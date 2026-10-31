"""SPD surveyor top categories (TRX after cleaning, 25 values) -> which of our subcategories are consistent, and the default sub
when ours contradicts the surveyor. Learned 2026-10-15: name-based subs agree with the surveyor 88.6 % of the time;
the misses are context errors such as «صيانة» inside Automotive Services (our building maintenance, really a car workshop)."""
CONSISTENT = {
 'Mosques': ['noncom.mosque'], 'Restaurants': ['food.'], 'Automotive Services': ['auto.', 'energy.fuel_station', 'equip.'],
 'Grocery': ['food.'], 'Education': ['edu.'], 'Public Parks': ['noncom.park', 'noncom.landmark'], 'Beauty and Spa': ['beauty.', 'health.'],
 'Hotels and Accommodations': ['hosp.', 'noncom.residential', 're.'], 'Fuel Stations': ['energy.fuel_station', 'auto.'], 'Pharmacies': ['health.'],
 'Hospitals': ['health.'], 'Banks': ['fin.'], 'Coffee Shops': ['food.'], 'Sports': ['sports.', 'edu.sports_education'],
 'Cultural Sites': ['noncom.landmark', 'noncom.museum', 'media.'], 'Government Services': ['noncom.government', 'biz.pro_services'],
 'Food and Beverages': ['food.'], 'Entertainment': ['sports.', 'media.'], 'Transportation': ['log.', 'auto.', 'noncom.transport_hub'],
 'Home Goods': ['home.', 'build.', 'retail.'],
}
DEFAULT = {
 'Mosques': 'noncom.mosque', 'Restaurants': 'food.restaurant', 'Automotive Services': 'auto.workshop', 'Grocery': 'food.grocery',
 'Education': 'edu.school', 'Public Parks': 'noncom.park', 'Beauty and Spa': 'beauty.salon_women', 'Hotels and Accommodations': 'hosp.hotel',
 'Fuel Stations': 'energy.fuel_station', 'Pharmacies': 'health.pharmacy', 'Hospitals': 'health.hospital', 'Banks': 'fin.bank',
 'Coffee Shops': 'food.cafe', 'Sports': 'sports.club', 'Cultural Sites': 'noncom.landmark', 'Government Services': 'noncom.government',
 'Food and Beverages': 'food.restaurant', 'Entertainment': 'sports.entertainment_center', 'Transportation': 'log.passenger_transport',
 'Home Goods': 'home.home_goods_general',
}
# a context-specific fix is better than the bare default: (surveyor category, our sub) -> sub
CONTEXT = {
 ('Automotive Services', 'personal.laundry'): 'auto.car_wash', ('Automotive Services', 'contract.maintenance'): 'auto.workshop',
 ('Automotive Services', 'contract.electrical'): 'auto.workshop', ('Automotive Services', 'build.hvac_supply'): 'auto.workshop',
 ('Automotive Services', 'build.metal_fabrication'): 'auto.body_paint', ('Automotive Services', 'build.aluminum_glass'): 'auto.accessories_tint',
 ('Beauty and Spa', 'fashion.tailoring'): 'beauty.salon_women', ('Grocery', 'retail.general_store'): 'food.grocery',
}
