# Atlas read-only test service

This service is a safe test source for Atlas. It generates a small, fully fictional
directory during its image build. It must never receive production data, a database
URL, Meta/WhatsApp credentials, or an AI provider key.

## Railway setup

Create the service in the `atlas-readonly-test` environment with the same Git branch
as the change under review, its root directory set to `services/targeting-api`, and
the Dockerfile path set to `Dockerfile.readonly`.

Set only these variables:

| Variable | Value | Why |
| --- | --- | --- |
| `ATLAS_READ_ONLY` | `1` | Blocks all write routes and all provider calls. |
| `TARGETING_PASSWORD` | A new test-only secret | Protects browser access to the synthetic service. |
| `TARGETING_SERVICE_TOKEN` | A separate new test-only secret | Lets only the Atlas test deployment call the service. |

Do not copy any production variable into this environment. In particular, do not add
`CONSTRUCTION_DB_URL`, `CONSTRUCTION_WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID`, `CONSTRUCTION_WHATSAPP_PHONE_NUMBER_ID`, or
`ANTHROPIC_API_KEY`.

## Roles and test scope

The targeting API accepts service-to-service access and has no user-role model of its
own. Roles belong to the Atlas web application. Create the following test accounts
only in the Atlas test deployment, all pointed at this service:

| Role | Can verify |
| --- | --- |
| Explorer | Search, map, district selection, list browsing. |
| Reviewer | Draft review, request comparison, campaign review screens. |
| Admin | Template and integration screens; all write actions must show the read-only refusal. |

The service rejects `POST /templates`, `POST /send-template`,
`POST /send-test-template`, `POST /send-farq`, and `POST /log` with HTTP 403 and
`READ_ONLY_TEST_ENV`. All remaining data is generated and has no contact channel.

## Reversal

Delete the service or the `atlas-readonly-test` environment. No production data,
database record, provider request, or outbound message exists to undo.
