# infra/

Infrastructure as code.

| Folder | What | Phase |
|---|---|---|
| `observability/` | Prometheus scrape config and Grafana provisioning + dashboards (as code), used by the `prometheus` and `grafana` compose services | 0–1 |
| `local/` | Local-only setup used by `compose.yaml` (e.g. `postgres-init/` creates one database per service) | 0 |
| `terraform/` | AWS resources (VPC, RDS, ECS, S3, EKS, …) | 3, 4 |
| `helm/` | Helm charts for the services | 4 |
| `k8s/` | Plain manifests and Kustomize overlays (staging/prod) | 4 |
