## Description:

Integrates Tencent Cloud COS object storage and Data Processing CI services so agents can manage storage, processing, retrieval, preview, moderation, speech, MetaInsight, and knowledge-base workflows.

This skill is ready for commercial/non-commercial use.

## Publisher:

[shawnminh](https://clawhub.ai/user/shawnminh)

### License/Terms of Use:

MIT-0

## Use Case:

External developers and cloud operators use this skill to let an agent operate Tencent Cloud COS and CI workflows, including object storage, media and document processing, content recognition, dataset search, result previews, and knowledge-base tasks.

### Deployment Geography for Use:

Global

## Known Risks and Mitigations:

Risk: The skill can operate real Tencent Cloud COS and CI resources with broad cloud-control capabilities.

Mitigation: Install only for intended COS/CI operation, use a dedicated least-privilege sub-account or short-lived STS credentials, and review write, delete, ACL, CORS, and service-lifecycle operations before allowing them.

Risk: Credential persistence and local credential restoration can expose long-lived cloud credentials if used unnecessarily.

Mitigation: Prefer ephemeral shell-session credentials, avoid `--persist` and `decrypt-env` unless required, and remove local credential files when no longer needed.

Risk: Signed preview, `ci-request`, delete, and face-search operations may expose data, invoke broad APIs, or process sensitive biometric content.

Mitigation: Keep `KIKI=1` for stricter behavior when possible and manually review signed-preview, generic CI request, delete, ACL/CORS, and face-search requests before execution.

## Reference(s):

- [Tencent Cloud COS Skill on ClawHub](https://clawhub.ai/shawnminh/skills/tencentcloud-cos)
- [COS Node.js SDK Operation Reference](references/api_reference.md)
- [CI Service Status Query](references/ci-service-status.md)
- [Dataset Search Mapping](references/dataset-search.md)
- [Dataset Catalog](references/dataset-catalog.md)
- [Dataset Simple Query Rules](references/dataset-simple-query.md)
- [Search Results Preview](references/search-results-preview.md)
- [Bucket Content Aggregation](references/bucket-content-aggregation.md)
- [Bucket Content Summary](references/bucket-content-summary.md)
- [Console Feature Guides](references/console-feature-guides.md)
- [Query Spec Schema](references/query-spec.schema.json)
- [Tencent Cloud COS Node.js SDK Documentation](https://cloud.tencent.com/document/product/436/8629)
- [Tencent Cloud Data Processing CI Documentation](https://cloud.tencent.com/document/product/460)

## Skill Output:

**Output Type(s):** [Text, Markdown, Shell commands, Configuration, JSON, Files, Guidance]

**Output Format:** [Markdown guidance with shell commands plus JSON API responses and optional generated HTML or file outputs.]

**Output Parameters:** [1D]

**Other Properties Related to Output:** [Requires Tencent Cloud COS credentials plus Region and Bucket configuration; optional dataset, domain, service domain, protocol, and STS token settings may shape behavior.]

## Skill Version(s):

1.2.0 (source: server release metadata; package.json reports 1.0.0)

## Ethical Considerations:

Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment.
