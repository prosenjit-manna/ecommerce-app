# infra/

Infrastructure as code.

| Folder | What | Phase |
|---|---|---|
| `terraform/` | AWS resources (VPC, RDS, ECS, S3, EKS, …) | 3, 5 |
| `helm/` | Helm charts for the services | 5 |
| `k8s/` | Plain manifests and Kustomize overlays (staging/prod) | 5 |
