# Supabase migration recovery inventory

This inventory was captured from the live Supabase project on 17 November 2026. The database stores migration versions and names, but not the original SQL source text. Do not fabricate historical migration files from names alone.

| Version | Migration name | SQL source in GitHub |
|---|---|---|
| 20261113092615 | create_posts_and_image_storage | Not recovered |
| 20261113102630 | create_site_content_manager | Not recovered |
| 20261113125040 | add_multi_admin_access | Not recovered |
| 20261113125117 | secure_admin_role_check_function | Not recovered |
| 20261113130612 | add_social_post_source_fields | Not recovered |
| 20261113154350 | create_super_admin_activity_log | Not recovered |
| 20261116110620 | prepare_private_facebook_connection_storage | Not recovered |
| 20261116113752 | fix_facebook_oauth_service_role_guard | Not recovered |
| 20261116120028 | facebook_connection_status_rpc | Not recovered |
| 20261116144127 | add_youth_link_categories | Not recovered |
| 20261116145028 | add_youth_portal_discovery | Not recovered |
| 20261116155113 | track_youth_portal_clicks | Not recovered |
| 20261116155338 | add_youth_portal_impressions | Not recovered |
| 20261117083745 | unique_facebook_post_imports | Not recovered |
| 20261117101917 | phase1_security_analytics_performance_hardening | Committed as matching SQL migration |
| 20261117101937 | phase1_portal_event_insert_policy_consolidation | Committed as matching SQL migration |
| 20261117102605 | phase1_portal_event_timestamp_integrity | Committed as matching SQL migration |

The original repository had one differently named SQL migration file (202611130001_admin_enhancements.sql). It is retained as historical project material, but it does not replace the missing original SQL for the migrations listed above.

## Recovery rule

Before attempting a fresh-project rebuild, create and review a full schema-only dump of the live project, including tables, types, constraints, indexes, functions, triggers, RLS policies, grants, storage buckets/policies, and required extensions. Then test restoration in a separate Supabase project. Never apply a reconstructed baseline to production as a substitute for the missing migration source.
