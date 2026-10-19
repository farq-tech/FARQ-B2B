# Global B2B marketplace, procurement, CRM, and map/list benchmarks

## When do maps add value versus search and lists?

### Takeaway
Maps are most defensible when location changes the commercial decision: users need to see coverage, proximity, local clusters, or plan in-person visits. For comparing companies against many attributes, a filterable list is the primary working surface; the strongest documented implementations keep map and list linked rather than making the map the only way to discover records.

### Cited Findings
- **[Strong — official product documentation]** Salesforce Maps presents a list of plotted records, lets field users sort, filter, compare selected markers, calculate drive/straight-line distance, and export the selected records. Salesforce explicitly frames this as helping representatives prioritize visits. [Salesforce Maps list view](https://help.salesforce.com/s/articleView?id=000381386&language=en_US&type=1)
- **[Strong — official product documentation]** Salesforce’s desktop Maps guidance says map location helps users prioritize where to spend time and plan efficient trips; after a marker layer is plotted, the companion list supports sorting/filtering, group actions, and export. [Salesforce Maps desktop UI](https://help.salesforce.com/s/articleView?id=000380162&language=en_US&type=1)
- **[Strong — official product documentation]** Google’s Places UI Kit implements text/location search as a result list plus map markers; selecting a result opens its place details, and clicking a marker displays the same details. [Google Maps Places UI Kit](https://developers.google.com/maps/architecture/places-ui-kit-getting-started)
- **[Strong — official product documentation]** Google Places text search supports refining results by price level, rating, and open status, with distance or popularity ranking. [Google Place Search Element](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-search)
- **[Moderate — peer-reviewed research, exploratory and mobile specific]** A month-long field study of 34 users compared map and text interfaces for location-based mobile search, so it is evidence that interface form changes discovery behavior, but it does not establish a universal B2B default. [The “Map Trap?” study](https://www.researchgate.net/publication/221022934_The_Map_Trap_an_evaluation_of_map_versus_text-based_interfaces_for_location-based_mobile_search_services)
- **[Moderate — published user study, mobile specific]** A comparative study reported similar performance for search tasks across map, list, and augmented-reality interfaces, while the map performed worst for browsing and the list rated better for usability. [Comparative evaluation of location-based interfaces](https://scispace.com/papers/comparative-evaluation-of-interfaces-for-presenting-location-q0vlkqoa4y)
- **[Strong — official product documentation]** Thomas’ industrial supplier discovery starts with search and filters by location, certification, and other attributes; supplier profiles then provide catalogs, certifications, and capabilities before outreach. [Thomas sourcing overview](https://sourcing.thomasnet.com/)
- **[Strong — official product documentation]** Thomas lets users save a filtered supplier search and later return to vetting, shortlisting, and sending RFIs. [Thomas saved searches](https://help.thomasnet.com/saved-searches)

### Inferences
- Farq should open to a **list/search workspace**, with the map synchronized to the current result set. The list should support the dense comparison work: company name, match reason, city/region, category, verification/completeness, responsiveness when available, and saved status.
- Make the map a first-class mode only for explicitly geographic questions: “who is in Riyadh / near this project / in this industrial area?”, service coverage, territory allocation, or route planning. For a general opportunity pipeline, a map-only start adds navigation work without improving company comparison.
- Keep list and pins bidirectionally linked: selecting either highlights the other and opens one consistent company preview. Let users filter before navigating the map; do not make pin density the only discovery mechanism.
- A Saudi Arabic interface should maintain an Arabic-first RTL list, filter drawer, and record preview. Geographic labels need a consistently defined hierarchy (city, district, industrial zone, coverage region) before location is presented as a decision signal. This is a product-design inference and needs validation with Farq users; the cited sources do not test Saudi Arabic users.

### Gaps
- No source located in this pass establishes whether Saudi B2B buyers or suppliers prefer map, list, or split-view discovery, or which Saudi address granularity is sufficiently reliable for routing. Test this with representative buyers and suppliers before setting a permanent default.
- The cited academic comparisons are location-search/mobile studies rather than RFQ marketplace studies; they support a cautious map/list design hypothesis, not a quantified Farq conversion claim.

## Which documented marketplace and procurement patterns connect discovery to RFQ or an order?

### Takeaway
The most transferable marketplace pattern is a progressive path: find candidates, evaluate a structured profile, keep a shortlist or saved search, then start a request containing the information needed for a supplier response. Mature procurement products retain that request and supplier responses in a dedicated workspace rather than relying on a one-off contact action.

### Cited Findings
- **[Strong — official product documentation]** Alibaba.com exposes “Request for Quotation” as a sourcing start point for posting customized requirements and receiving quotes from multiple matching suppliers; it also presents verified manufacturers as a sourcing path. [Alibaba.com sourcing page](https://supplier.alibaba.com/page/products-services?inviter=&joinSource=m_buyer.1688.com&tracelog=20220414_ICBU-SUPPLIER-PC-BANNER-HOME__T)
- **[Strong — official seller documentation]** Alibaba’s RFQ workflow is documented as: buyer posts a need, platform reviews it, suppliers quote, parties communicate, and they reach an agreement. The page also describes efforts to improve buyer information and reduce junk requests. [Alibaba RFQ service](https://supplier.alibaba.com/supplier/rfq.html)
- **[Strong — official product documentation]** Amazon Business initiates RFQ from an eligible product detail page; the request includes purchase/delivery dates, ZIP code, quantity, and target price. Offers are evaluated in a Manage Quotes dashboard, then an offer can move to checkout. [Amazon Business RFQ](https://business.amazon.com/en/solutions/bulk-buying/request-for-quote)
- **[Strong — official product documentation]** Amazon Business supports one RFQ containing multiple SKUs and lets buyers compare offers, contact sellers, set preferred suppliers for future RFQs, review ratings/performance, save draft quotes, and track pending/completed requests. [Amazon Business RFQ FAQ](https://business.amazon.com/en/solutions/bulk-buying/request-for-quote)
- **[Strong — official product documentation]** Thomas documents a sourcing sequence of search/filter, supplier-profile evaluation, shortlist, then direct contact by RFI, website, or phone. [Thomas sourcing overview](https://sourcing.thomasnet.com/)
- **[Strong — official product documentation]** Thomas’s advanced filters include supplier validation, company type, quality certification, ownership/diversity status, product details, locations served, ZIP-radius, and keywords. [Thomas saved searches](https://help.thomasnet.com/saved-searches)
- **[Strong — official product documentation]** Thomas defines its verified badge as business-information validation plus product/service discovery and verification; the badge is therefore a trust cue with a defined verification process, rather than a generic decorative label. [Thomas Verified Core](https://business.thomasnet.com/programs/verified-core)
- **[Strong — official product documentation]** Faire’s documented discovery starts with product, brand, or keyword search and category browsing; buyers can save products, follow brands, and use boards to organize possible purchases. [Faire search help](https://www.faire.com/support/articles/29979556053787?section=1); [Faire boards guide](https://external.faire.com/open-with-faire/academy/buy-retail-inventory)
- **[Strong — official product documentation]** Faire’s Brands List is a single destination to track, reorder, and stay current with brands; its Favorites area holds saved products and followed brands, while boards can organize saved products. [Faire Brands List and Favorites](https://www.faire.com/en-gb/support/articles/4465163851675)
- **[Strong — official product documentation]** Faire surfaces a product’s brand name, platform rating, and order minimum on the product description path; its help documentation describes badges as criteria-based signals, while “brand values” are self-identified. [Faire search help](https://www.faire.com/support/articles/29979556053787?section=1)

### Inferences
- Farq can use three clear discovery start points: **search for a company/category**, **browse an area/sector**, and **create a requirement/RFQ** when the buyer knows the need but not the supplier. Each should arrive at the same evaluable company or opportunity record.
- The candidate detail should show evidence, not a generic score: matching capabilities/categories, location or coverage, available trust/verification facts, and relevant response/transaction indicators only when their definitions are visible.
- Let a user save a company, a filtered search, and a short list separately. A saved search means “watch this market”; a short list means “evaluate this group for a specific requirement.” Both need names, ownership, dates, and a route into an RFQ or internal handoff.
- An RFQ draft should collect only decision-relevant structure: requirement/category, quantity or scope, desired date, service location, budget/target terms where appropriate, attachments, and recipient shortlist. After submission, provide a durable request workspace showing status, recipient companies, responses, timestamps, and the next action.
- This is an inference from global products, not evidence that Farq should copy Amazon’s checkout-first flow or Alibaba’s supplier-side market mechanics. Farq’s eventual transaction, payment, and dispute model should be designed for its own Saudi commercial/legal operation.

### Gaps
- No official public documentation located here proves Alibaba’s current buyer-side profile fields, supplier-matching algorithm, or RFQ ranking logic in enough detail to prescribe Farq matching logic.
- No public evidence located here establishes which verification sources or procurement fields Farq can lawfully and reliably use in Saudi Arabia. Confirm data provenance, consent, eligibility definitions, and user-visible label language before using badges or scores.

## Which CRM/outreach patterns are transferable, and what should Farq avoid copying?

### Takeaway
CRM products convert a selected record or record set into owned, traceable work: a task has an assignee, due time, priority, context, and visible history. Farq can transfer this controlled handoff pattern after discovery, while avoiding automatic outbound messaging and opaque engagement automation.

### Cited Findings
- **[Strong — official product documentation]** HubSpot tasks can be created for an individual record or a selected set of records, with task type, priority, associated record(s), assignee, queue, due date, reminders, and notes. [HubSpot tasks](https://knowledge.hubspot.com/tasks/create-tasks?openLinerExtension=true)
- **[Strong — official product documentation]** HubSpot sequences can create automated emails or manual email/call/general task reminders, and sequence steps can pause until a manual task is completed. [HubSpot sequences](https://knowledge.hubspot.com/sequences/create-and-edit-sequences?ut_source3=inline)
- **[Strong — official product documentation]** HubSpot distinguishes an automated email from a manual email task: the latter opens an email composer with a template for human review/send when completed from the contact record or task queue. [HubSpot sequences](https://knowledge.hubspot.com/sequences/create-and-edit-sequences?ut_source3=inline); [HubSpot sequence tasks](https://knowledge.hubspot.com/sequences/complete-your-sequence-tasks)
- **[Strong — official product documentation]** Salesforce lead lists can be filtered into custom views and support single-record actions and bulk status/quick actions. [Salesforce lead list views](https://help.salesforce.com/s/articleView?id=sales.leads_overview.htm&language=en_US&type=5); [Salesforce custom list views](https://help.salesforce.com/s/articleView?id=sf.listviews_parent.htm&language=en_US&type=5)
- **[Strong — official product documentation]** Salesforce Maps lets a user select a subset of plotted markers into a dedicated selected-markers tab, then compare them or apply group actions. [Salesforce Maps list view](https://help.salesforce.com/s/articleView?id=000381386&language=en_US&type=1)

### Inferences
- A Farq opportunity/company action should create an explicit internal object: **Save**, **assign to colleague**, **request quote**, **request verification**, or **prepare contact**. Store who initiated it, who owns it, related companies/RFQ, status, due date, and activity history.
- Provide a reviewed contact handoff: open a prefilled Arabic message or contact panel where the user can edit, choose a channel, and deliberately send. Do not represent WhatsApp outreach as automatic or as a guaranteed delivery mechanism; permission, account configuration, recipient availability, and local policy still require product and legal decisions.
- For selected map/list results, permit bulk *internal* operations such as add to shortlist, tag, assign owner, export if authorized, or start an RFQ draft. Require individual review where supplier-specific content is being sent.
- Avoid copying: (1) consumer-product checkout as the primary interaction for complex services/procurement; (2) unexplained platform badges or composite “match” scores; (3) a map overloaded with all records and no comparison list; (4) automatic outbound sequences from a discovery click; and (5) imported U.S.-specific filters such as ownership/diversity classifications unless Farq has a clear local, user-understandable definition and data source.

### Gaps
- Public documentation does not answer which outreach channels Farq supports, what supplier consent has been captured, or whether a WhatsApp business integration exists. Do not infer these from CRM patterns.
- No benchmark source in this pass supplies Saudi-specific consent, commercial-communication, or data-retention requirements. Validate the eventual outreach and CRM policy with Farq’s Saudi legal/compliance owners before implementation.
