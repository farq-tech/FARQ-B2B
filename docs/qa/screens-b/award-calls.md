# المسار D — إثبات استدعاءات الترسية: AwardDialog (قبل) مقابل Confirm Sheet (بعد)

الطريقة: نفس الضغطات على الشاشتين في `harness.html?screen=award-legacy|award-sheet&routed=1`؛ كل طلب إلى `/_api` يُعترض في Playwright (`page.route`) ويُرد عليه من fixtures. ما يطلع أي طلب للشبكة.
الطلبات المتوازية (`Promise.all` لقراءة الطلب والمقارنة) تُرتّب قبل المقارنة؛ الكتابات تُقارن بترتيبها.

## السيناريو: مشروع موجود + «أفضل سعر»

| # | قبل (AwardDialog) | بعد (Confirm Sheet) |
|---|---|---|
| 1 | `GET /api/construction/projects` | `GET /api/construction/projects` |
| 2 | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001` | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001` |
| 3 | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001/comparison` | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001/comparison` |
| 4 | `POST /api/construction/rfqs/00000000-0000-4000-8000-000000000001/open-envelopes` | `POST /api/construction/rfqs/00000000-0000-4000-8000-000000000001/open-envelopes` |
| 5 | `POST /api/construction/awards` | `POST /api/construction/awards` |

<details><summary>الأجسام (payload) كاملة</summary>

```
GET /api/construction/projects 
GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001 
GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001/comparison 
POST /api/construction/rfqs/00000000-0000-4000-8000-000000000001/open-envelopes {"reason":"أفضل سعر"}
POST /api/construction/awards {"rfq_id":"00000000-0000-4000-8000-000000000001","project_id":"p1","supplier_quote_version_id":"q1","selection_reason":"أفضل سعر","awarded_line_ids":["l1","l2","l3","l4","l5"],"approval_note":"أفضل سعر"}
```
</details>

**النتيجة: متطابقة (نفس الطرق والمسارات والأجسام)**

## السيناريو: مشروع جديد + «أخرى» بنص

| # | قبل (AwardDialog) | بعد (Confirm Sheet) |
|---|---|---|
| 1 | `GET /api/construction/projects` | `GET /api/construction/projects` |
| 2 | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001` | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001` |
| 3 | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001/comparison` | `GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001/comparison` |
| 4 | `POST /api/construction/rfqs/00000000-0000-4000-8000-000000000001/open-envelopes` | `POST /api/construction/rfqs/00000000-0000-4000-8000-000000000001/open-envelopes` |
| 5 | `POST /api/construction/projects` | `POST /api/construction/projects` |
| 6 | `POST /api/construction/awards` | `POST /api/construction/awards` |

<details><summary>الأجسام (payload) كاملة</summary>

```
GET /api/construction/projects 
GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001 
GET /api/construction/rfqs/00000000-0000-4000-8000-000000000001/comparison 
POST /api/construction/rfqs/00000000-0000-4000-8000-000000000001/open-envelopes {"reason":"توريد أسرع للموقع"}
POST /api/construction/projects {"name":"القسم الكهربائي — توريد كهرباء — فيلا النرجس — الرياض","site_address":"توريد كهرباء — فيلا النرجس — الرياض"}
POST /api/construction/awards {"rfq_id":"00000000-0000-4000-8000-000000000001","project_id":"p-new","supplier_quote_version_id":"q1","selection_reason":"توريد أسرع للموقع","awarded_line_ids":["l1","l2","l3","l4","l5"],"approval_note":"توريد أسرع للموقع"}
```
</details>

**النتيجة: متطابقة (نفس الطرق والمسارات والأجسام)**

