# apps/

Deployable applications.

| Folder | What | Phase |
|---|---|---|
| `api/` | Modular monolith (Express 5 + TypeScript). It gets smaller as services are extracted. | 0–1 |
| `api-gateway/` | Express gateway built on `http-proxy-middleware`, routing to the microservices | 4 |
| `mobile/` | Expo + React Native app | 6 |
