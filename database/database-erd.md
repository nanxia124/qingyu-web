# 轻域数据库完整 ER 图

> 根据 database/migrations 自动生成，共 60 张表，99 组关系。

```mermaid
erDiagram
    agent_threads ||--o{ agent_event_logs : "关联"
    agent_threads ||--o{ agent_messages : "关联"
    ai_providers ||--o{ ai_channels : "关联"
    ai_providers ||--o{ ai_models : "关联"
    ai_providers ||--o{ provider_call_daily : "关联"
    ai_providers ||--o{ provider_credentials : "关联"
    asset_comments ||--o{ asset_comments : "关联"
    asset_comments ||--o{ moderation_records : "关联"
    asset_versions ||--o{ asset_files : "关联"
    assets ||--o{ asset_comments : "关联"
    assets ||--o{ asset_likes : "关联"
    assets ||--o{ asset_references : "关联"
    assets ||--o{ asset_shares : "关联"
    assets ||--o{ asset_versions : "关联"
    assets ||--o{ collection_items : "关联"
    assets ||--o{ moderation_records : "关联"
    canvas_chat_sessions ||--o{ canvas_chat_messages : "关联"
    canvas_nodes ||--o{ canvas_connections : "关联"
    canvas_projects ||--o{ canvas_chat_sessions : "关联"
    canvas_projects ||--o{ canvas_connections : "关联"
    canvas_projects ||--o{ canvas_nodes : "关联"
    collections ||--o{ collection_items : "关联"
    departments ||--o{ departments : "关联"
    departments ||--o{ team_memberships : "关联"
    file_objects ||--o{ asset_files : "关联"
    file_objects ||--o{ generation_outputs : "关联"
    generation_tasks ||--o{ assets : "关联"
    generation_tasks ||--o{ generation_outputs : "关联"
    job_titles ||--o{ team_memberships : "关联"
    orders ||--o{ payments : "关联"
    permissions ||--o{ role_permissions : "关联"
    plans ||--o{ orders : "关联"
    plans ||--o{ plan_features : "关联"
    plans ||--o{ plan_quotas : "关联"
    plans ||--o{ subscriptions : "关联"
    quota_grants ||--o{ quota_allocations : "关联"
    roles ||--o{ role_bindings : "关联"
    roles ||--o{ role_permissions : "关联"
    subscriptions ||--o{ subscription_events : "关联"
    team_memberships ||--o{ membership_events : "关联"
    teams ||--o{ departments : "关联"
    teams ||--o{ job_titles : "关联"
    teams ||--o{ team_invitations : "关联"
    teams ||--o{ team_memberships : "关联"
    teams ||--o{ workspaces : "关联"
    usage_records ||--o{ quota_allocations : "关联"
    user_accounts ||--o{ access_policies : "关联"
    user_accounts ||--o{ agent_threads : "关联"
    user_accounts ||--o{ ai_channels : "关联"
    user_accounts ||--o{ asset_comments : "关联"
    user_accounts ||--o{ asset_likes : "关联"
    user_accounts ||--o{ asset_references : "关联"
    user_accounts ||--o{ asset_shares : "关联"
    user_accounts ||--o{ asset_versions : "关联"
    user_accounts ||--o{ assets : "关联"
    user_accounts ||--o{ audit_logs : "关联"
    user_accounts ||--o{ canvas_chat_sessions : "关联"
    user_accounts ||--o{ canvas_projects : "关联"
    user_accounts ||--o{ collection_items : "关联"
    user_accounts ||--o{ collections : "关联"
    user_accounts ||--o{ consent_records : "关联"
    user_accounts ||--o{ file_objects : "关联"
    user_accounts ||--o{ generation_tasks : "关联"
    user_accounts ||--o{ membership_events : "关联"
    user_accounts ||--o{ moderation_records : "关联"
    user_accounts ||--o{ notifications : "关联"
    user_accounts ||--o{ permission_overrides : "关联"
    user_accounts ||--o{ provider_credentials : "关联"
    user_accounts ||--o{ role_bindings : "关联"
    user_accounts ||--o{ security_events : "关联"
    user_accounts ||--o{ team_invitations : "关联"
    user_accounts ||--o{ team_memberships : "关联"
    user_accounts ||--o{ teams : "关联"
    user_accounts ||--o{ usage_records : "关联"
    user_accounts ||--o{ user_devices : "关联"
    user_accounts ||--o{ user_preferences : "关联"
    user_accounts ||--o{ user_sessions : "关联"
    user_accounts ||--o{ workspaces : "关联"
    user_devices ||--o{ user_sessions : "关联"
    user_sessions ||--o{ security_events : "关联"
    workspaces ||--o{ access_policies : "关联"
    workspaces ||--o{ agent_threads : "关联"
    workspaces ||--o{ ai_channels : "关联"
    workspaces ||--o{ assets : "关联"
    workspaces ||--o{ audit_logs : "关联"
    workspaces ||--o{ canvas_projects : "关联"
    workspaces ||--o{ collections : "关联"
    workspaces ||--o{ file_objects : "关联"
    workspaces ||--o{ generation_tasks : "关联"
    workspaces ||--o{ notifications : "关联"
    workspaces ||--o{ orders : "关联"
    workspaces ||--o{ outbox_events : "关联"
    workspaces ||--o{ payment_customers : "关联"
    workspaces ||--o{ permission_overrides : "关联"
    workspaces ||--o{ quota_grants : "关联"
    workspaces ||--o{ role_bindings : "关联"
    workspaces ||--o{ security_events : "关联"
    workspaces ||--o{ subscriptions : "关联"
    workspaces ||--o{ usage_records : "关联"
    access_policies {
        uuid id PK
        uuid workspace_id
        varchar_120_ name
        varchar_80_ resource_type
        text effect
        jsonb conditions
        boolean enabled
        uuid created_by
        timestamptz created_at
        timestamptz updated_at
    }
    agent_event_logs {
        uuid id PK
        uuid thread_id
        uuid workspace_id
        varchar_120_ event_type
        jsonb payload
        timestamptz occurred_at
    }
    agent_messages {
        uuid id PK
        uuid thread_id
        uuid workspace_id
        varchar_200_ external_item_id
        varchar_32_ role
        text content
        jsonb attachments
        jsonb canvas_references
        jsonb usage
        timestamptz created_at
    }
    agent_threads {
        uuid id PK
        uuid workspace_id
        uuid user_id
        varchar_200_ external_thread_id
        varchar_240_ title
        text workspace_path
        text status
        timestamptz created_at
        timestamptz updated_at
    }
    ai_channels {
        uuid id PK
        uuid workspace_id
        uuid created_by
        uuid provider_id
        varchar_120_ name
        text base_url
        text secret_ref
        jsonb model_allowlist
        integer max_concurrency
        text status
        timestamptz created_at
        timestamptz updated_at
    }
    ai_models {
        uuid id PK
        uuid provider_id
        varchar_160_ code
        varchar_160_ display_name
        jsonb capabilities
        jsonb limits
        jsonb pricing
        boolean enabled
        integer version
        timestamptz created_at
        timestamptz updated_at
    }
    ai_providers {
        uuid id PK
        varchar_80_ code
        varchar_160_ name
        text base_url
        jsonb capabilities
        boolean enabled
        timestamptz created_at
        timestamptz updated_at
    }
    asset_comments {
        uuid id PK
        uuid asset_id
        uuid parent_id
        uuid author_user_id
        text content
        text moderation_status
        timestamptz edited_at
        timestamptz deleted_at
        timestamptz created_at
    }
    asset_files {
        uuid asset_version_id PK
        uuid file_id PK
        varchar_32_ role PK
    }
    asset_likes {
        uuid asset_id PK
        uuid user_id PK
        timestamptz created_at
    }
    asset_references {
        uuid id PK
        uuid source_asset_id
        uuid target_asset_id
        uuid referenced_by
        varchar_120_ purpose
        timestamptz created_at
    }
    asset_shares {
        uuid id PK
        uuid asset_id
        uuid shared_by
        text target_type
        uuid target_id
        text token_hash
        text permission
        timestamptz expires_at
        timestamptz revoked_at
        timestamptz created_at
    }
    asset_versions {
        uuid id PK
        uuid asset_id
        integer version_no
        uuid created_by
        jsonb metadata
        timestamptz created_at
    }
    assets {
        uuid id PK
        uuid workspace_id
        uuid created_by
        uuid source_generation_id
        varchar_32_ asset_type
        varchar_240_ title
        text description
        text visibility
        text moderation_status
        text status
        bigint version
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }
    audit_logs {
        uuid id PK
        uuid actor_user_id
        uuid workspace_id
        varchar_120_ action
        varchar_80_ resource_type
        uuid resource_id
        varchar_32_ result
        varchar_128_ request_id
        jsonb before_summary
        jsonb after_summary
        timestamptz occurred_at
    }
    canvas_chat_messages {
        uuid id PK
        uuid session_id
        uuid workspace_id
        varchar_160_ message_key
        varchar_32_ role
        text content
        jsonb detail
        timestamptz created_at
    }
    canvas_chat_sessions {
        uuid id PK
        uuid project_id
        uuid workspace_id
        varchar_160_ session_key
        varchar_240_ title
        uuid created_by
        timestamptz created_at
        timestamptz updated_at
    }
    canvas_connections {
        uuid id PK
        uuid project_id
        uuid workspace_id
        varchar_160_ connection_key
        uuid from_node_id
        uuid to_node_id
        jsonb metadata
        timestamptz created_at
    }
    canvas_nodes {
        uuid id PK
        uuid project_id
        uuid workspace_id
        varchar_160_ node_key
        varchar_120_ node_type
        varchar_240_ title
        jsonb position
        numeric_12,2_ width
        numeric_12,2_ height
        jsonb metadata
        bigint version
        timestamptz created_at
        timestamptz updated_at
    }
    canvas_projects {
        uuid id PK
        uuid workspace_id
        uuid created_by
        varchar_240_ title
        varchar_32_ background_mode
        boolean show_image_info
        jsonb viewport
        text status
        bigint version
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }
    collection_items {
        uuid collection_id PK
        uuid asset_id PK
        uuid added_by
        timestamptz created_at
    }
    collections {
        uuid id PK
        uuid workspace_id
        uuid created_by
        varchar_160_ name
        text description
        timestamptz created_at
        timestamptz updated_at
    }
    consent_records {
        uuid id PK
        uuid user_id
        varchar_120_ consent_type
        varchar_64_ policy_version
        boolean granted
        varchar_32_ source
        timestamptz created_at
    }
    departments {
        uuid id PK
        uuid team_id
        uuid parent_id
        varchar_120_ name
        text status
        timestamptz created_at
        timestamptz updated_at
    }
    file_objects {
        uuid id PK
        uuid workspace_id
        uuid uploaded_by
        varchar_64_ storage_provider
        varchar_160_ bucket
        text object_key
        text storage_version_id
        varchar_128_ checksum
        bigint size_bytes
        varchar_160_ mime_type
        text status
        timestamptz created_at
        timestamptz deleted_at
    }
    generation_outputs {
        uuid id PK
        uuid task_id
        uuid file_id
        uuid thumbnail_file_id
        varchar_32_ output_type
        integer width
        integer height
        integer duration_ms
        text content_status
        jsonb metadata
        timestamptz created_at
    }
    generation_tasks {
        uuid id PK
        uuid workspace_id
        uuid created_by
        varchar_32_ task_type
        varchar_80_ provider
        varchar_160_ model
        varchar_160_ model_version
        varchar_160_ pricing_version
        text prompt
        jsonb parameters
        text status
        varchar_160_ request_id
        varchar_160_ idempotency_key
        varchar_120_ error_code
        timestamptz started_at
        timestamptz finished_at
        timestamptz created_at
        timestamptz updated_at
    }
    job_titles {
        uuid id PK
        uuid team_id
        varchar_120_ name
        text status
        timestamptz created_at
        timestamptz updated_at
    }
    membership_events {
        uuid id PK
        uuid membership_id
        text event_type
        uuid actor_user_id
        text reason
        varchar_160_ request_id
        timestamptz occurred_at
        jsonb metadata
    }
    moderation_records {
        uuid id PK
        uuid asset_id
        uuid comment_id
        text decision
        text reason
        uuid reviewer_user_id
        timestamptz created_at
    }
    notifications {
        uuid id PK
        uuid user_id
        uuid workspace_id
        varchar_80_ type
        varchar_240_ title
        text body
        jsonb payload
        timestamptz read_at
        timestamptz created_at
    }
    orders {
        uuid id PK
        uuid workspace_id
        uuid plan_id
        varchar_96_ order_no
        text status
        varchar_3_ currency
        bigint amount_minor
        varchar_160_ idempotency_key
        timestamptz expires_at
        timestamptz created_at
        timestamptz updated_at
    }
    outbox_events {
        uuid id PK
        varchar_120_ event_type
        integer schema_version
        varchar_80_ aggregate_type
        uuid aggregate_id
        uuid workspace_id
        jsonb payload
        varchar_32_ status
        integer attempts
        timestamptz available_at
        timestamptz published_at
        timestamptz created_at
    }
    payment_customers {
        uuid id PK
        uuid workspace_id
        varchar_64_ provider
        varchar_160_ provider_customer_id
        timestamptz created_at
    }
    payments {
        uuid id PK
        uuid order_id
        varchar_64_ provider
        varchar_160_ provider_payment_id
        text status
        bigint amount_minor
        jsonb raw_reference
        timestamptz paid_at
        timestamptz created_at
    }
    permission_overrides {
        uuid id PK
        uuid workspace_id
        uuid user_id
        varchar_120_ permission_code
        text effect
        text reason
        timestamptz expires_at
        uuid created_by
        timestamptz created_at
    }
    permissions {
        uuid id PK
        varchar_120_ code
        text description
        timestamptz created_at
    }
    plan_features {
        uuid plan_id PK
        varchar_120_ feature_code PK
        boolean enabled
    }
    plan_quotas {
        uuid plan_id PK
        varchar_120_ quota_code PK
        numeric_20,6_ amount
        varchar_32_ unit
        text reset_interval
    }
    plans {
        uuid id PK
        varchar_64_ code
        varchar_120_ name
        text description
        varchar_3_ currency
        bigint price_minor
        text billing_interval
        text status
        integer version
        timestamptz created_at
        timestamptz updated_at
    }
    provider_call_daily {
        uuid id PK
        date day
        uuid provider_id
        varchar_160_ model
        varchar_80_ capability
        bigint request_count
        bigint success_count
        bigint failure_count
        numeric_24,6_ input_units
        numeric_24,6_ output_units
        bigint total_cost_minor
        timestamptz updated_at
    }
    provider_credentials {
        uuid id PK
        uuid provider_id
        varchar_120_ name
        text secret_ref
        varchar_64_ key_version
        text status
        uuid created_by
        timestamptz created_at
        timestamptz updated_at
    }
    quota_allocations {
        uuid id PK
        uuid grant_id
        uuid usage_record_id
        numeric_20,6_ amount
        text status
        varchar_160_ idempotency_key
        timestamptz created_at
        timestamptz settled_at
    }
    quota_grants {
        uuid id PK
        uuid workspace_id
        varchar_120_ quota_code
        varchar_32_ source_type
        uuid source_id
        numeric_20,6_ granted
        numeric_20,6_ reserved
        numeric_20,6_ consumed
        timestamptz expires_at
        timestamptz created_at
    }
    role_bindings {
        uuid id PK
        uuid workspace_id
        uuid user_id
        uuid role_id
        uuid created_by
        timestamptz created_at
    }
    role_permissions {
        uuid role_id PK
        uuid permission_id PK
        timestamptz created_at
    }
    roles {
        uuid id PK
        varchar_64_ code
        varchar_120_ name
        text description
        timestamptz created_at
    }
    schema_migrations {
        text version PK
        text checksum
        timestamptz applied_at
    }
    security_events {
        uuid id PK
        uuid user_id
        uuid session_id
        uuid workspace_id
        varchar_80_ event_type
        varchar_32_ result
        varchar_128_ request_id
        varchar_128_ ip_hash
        varchar_128_ user_agent_hash
        jsonb details
        timestamptz occurred_at
    }
    subscription_events {
        uuid id PK
        uuid subscription_id
        varchar_64_ event_type
        varchar_160_ idempotency_key
        varchar_160_ provider_event_id
        jsonb payload
        timestamptz occurred_at
        timestamptz created_at
    }
    subscriptions {
        uuid id PK
        uuid workspace_id
        uuid plan_id
        text status
        varchar_64_ provider
        varchar_160_ provider_subscription_id
        timestamptz current_period_start
        timestamptz current_period_end
        boolean cancel_at_period_end
        bigint version
        timestamptz created_at
        timestamptz updated_at
    }
    team_invitations {
        uuid id PK
        uuid team_id
        text email
        uuid invited_user_id
        uuid invited_by
        text token_hash
        text status
        timestamptz expires_at
        timestamptz accepted_at
        timestamptz created_at
    }
    team_memberships {
        uuid id PK
        uuid team_id
        uuid user_id
        uuid department_id
        uuid job_title_id
        app.membership_status status
        timestamptz joined_at
        timestamptz left_at
        uuid invited_by
        timestamptz created_at
        timestamptz updated_at
    }
    teams {
        uuid id PK
        varchar_120_ name
        varchar_80_ slug
        uuid owner_user_id
        app.team_status status
        timestamptz created_at
        timestamptz updated_at
    }
    usage_records {
        uuid id PK
        uuid workspace_id
        uuid user_id
        varchar_120_ feature_code
        varchar_80_ provider
        varchar_160_ model
        numeric_20,6_ quantity
        varchar_32_ unit
        text result
        varchar_160_ idempotency_key
        varchar_160_ request_id
        timestamptz occurred_at
        jsonb metadata
    }
    user_accounts {
        uuid id PK
        varchar_64_ appwrite_user_id
        text email
        varchar_100_ display_name
        uuid avatar_file_id
        varchar_16_ locale
        varchar_64_ timezone
        app.user_status status
        bigint auth_version
        timestamptz last_login_at
        timestamptz created_at
        timestamptz updated_at
    }
    user_devices {
        uuid id PK
        uuid user_id
        uuid installation_id
        varchar_120_ display_name
        varchar_32_ client_type
        varchar_64_ os_family
        varchar_64_ browser_family
        timestamptz created_at
        timestamptz last_seen_at
        timestamptz archived_at
    }
    user_preferences {
        uuid user_id PK
        jsonb values
        bigint version
        timestamptz updated_at
    }
    user_sessions {
        uuid id PK
        uuid user_id
        uuid device_id
        varchar_32_ identity_provider
        varchar_128_ provider_session_id
        app.session_status admission_status
        timestamptz created_at
        timestamptz expires_at
        timestamptz last_seen_at
        timestamptz revoked_at
        varchar_64_ revoked_reason
        bigint admitted_auth_version
        app.provider_revoke_status provider_revocation_status
        timestamptz revoke_retry_at
        integer revoke_attempts
    }
    workspaces {
        uuid id PK
        app.workspace_type type
        uuid team_id
        uuid owner_user_id
        varchar_120_ name
        app.workspace_status status
        bigint version
        timestamptz created_at
        timestamptz updated_at
        _type OR
    }
```
