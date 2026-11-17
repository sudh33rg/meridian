#!/usr/bin/env python3
"""Comprehensive real-world data seeder for Meridian.
Seeds realistic enterprise workspaces, projects, teams, members, issues,
sprints, velocity metrics, releases, knowledge base pages, RAID items,
goals, decisions, roadmaps, milestones, service desk queues, customer portal requests,
incidents, approvals, automations, and webhooks.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("MERIDIAN_API", "http://localhost:9990").rstrip("/")
TOKEN = None

def req(path, data=None, method=None):
    global TOKEN
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    payload = None if data is None else json.dumps(data).encode("utf-8")
    req_obj = urllib.request.Request(
        f"{BASE}/api{path}",
        data=payload,
        headers=headers,
        method=method or ("POST" if data is not None else "GET")
    )
    try:
        with urllib.request.urlopen(req_obj, timeout=20) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8")) if raw else None
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        print(f"FAILED {method or ('POST' if data is not None else 'GET')} {path} -> HTTP {e.code}: {err_msg}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"FAILED {path} -> {e}", file=sys.stderr)
        return None

def main():
    global TOKEN
    print("=== Seeding Meridian Real-World Data ===")
    
    # 1. Signup primary admin user & workspace
    slug = "meridian-cloud"
    email = "sarah.chen@meridian.io"
    password = "Password123!"
    
    account = req("/auth/signup", {
        "organization": "Meridian Cloud Technologies",
        "slug": slug,
        "name": "Sarah Chen",
        "email": email,
        "password": password
    })
    
    if not account:
        print("Signup failed (may already exist). Attempting login...")
        account = req("/auth/login", {
            "slug": slug,
            "email": email,
            "password": password
        })
        if not account:
            print("Login failed as well. Exiting.", file=sys.stderr)
            sys.exit(1)
            
    TOKEN = account["token"]
    user_id = account.get("user_id") or account.get("id")
    print(f"Authenticated as Sarah Chen ({email}) in workspace '{slug}'")

    # Upgrade to Business plan so limits (webhooks, etc.) are lifted
    req("/billing/plan", {"plan": "business"})
    print("Upgraded workspace to Business plan")
    
    # 2. Invite additional team members
    team_members = [
        ("Marcus Vance", "marcus.vance@meridian.io", "admin"),
        ("Elena Rostova", "elena.rostova@meridian.io", "member"),
        ("David Kim", "david.kim@meridian.io", "member"),
        ("Priya Patel", "priya.patel@meridian.io", "member"),
        ("Liam O'Connor", "liam.oconnor@meridian.io", "member"),
    ]
    for m_name, m_email, m_role in team_members:
        req("/invitations", {"email": m_email, "role": m_role})
    print("Invited team members (Marcus, Elena, David, Priya, Liam)")

    # 3. Create Teams
    platform_team = req("/teams", {
        "name": "Core Platform & Infrastructure",
        "description": "Distributed Axum services, storage engines, sharding, and cloud runtime."
    }) or {"id": None}
    
    web_team = req("/teams", {
        "name": "Frontend & Design System",
        "description": "React web client, Flutter companion mobile app, TipTap editor, and design tokens."
    }) or {"id": None}
    
    sre_team = req("/teams", {
        "name": "Site Reliability & Security",
        "description": "Zero-trust network, 24/7 incident response, observability, and compliance."
    }) or {"id": None}

    ops_team = req("/teams", {
        "name": "Customer Operations",
        "description": "Technical support queues, customer SLAs, and service desk management."
    }) or {"id": None}
    print("Created teams: Core Platform, Frontend, SRE & Security, Customer Operations")

    # 4. Create Projects
    projects = req("/projects") or []
    proj_plat = next((p for p in projects if p.get("key") == "PLAT"), None)
    if not proj_plat:
        proj_plat = req("/projects", {
            "name": "Cloud Platform Core",
            "key": "PLAT",
            "description": "High-throughput multi-tenant cloud runtime, active-active PostgreSQL sharding, and real-time Kafka event streaming."
        })
    
    pid = proj_plat["id"]
    print(f"Configuring Project: Cloud Platform Core (PLAT) [{pid}]")

    proj_web = next((p for p in projects if p.get("key") == "WEB"), None)
    if not proj_web:
        proj_web = req("/projects", {
            "name": "Consumer Experience & Mobile",
            "key": "WEB",
            "description": "Next-gen responsive web client, offline-capable Flutter mobile application, and collaborative document editing."
        })
    web_pid = proj_web["id"] if proj_web else None
    print(f"Configuring Project: Consumer Experience & Mobile (WEB) [{web_pid}]")

    # 5. Project Components in PLAT
    comp_names = [
        ("API Gateway", "Reverse proxy, rate limiting, and JWT/session authentication layer."),
        ("PostgreSQL Sharding", "Multi-region read replicas and row-level tenant security."),
        ("Kafka Event Streams", "Event-driven asynchronous messaging and outbox processors."),
        ("Distributed Tracing", "OpenTelemetry collector integration and trace propagation."),
        ("Worker Pool", "Background job runner for email digests and async tasks.")
    ]
    for c_name, c_desc in comp_names:
        req(f"/projects/{pid}/components", {"name": c_name, "description": c_desc})

    # 6. Custom Fields in PLAT
    req(f"/projects/{pid}/fields", {
        "label": "Impact Level",
        "key": "impact_level",
        "field_type": "select",
        "options": ["Low", "Medium", "High", "Critical"]
    })
    req(f"/projects/{pid}/fields", {
        "label": "Service Tier",
        "key": "service_tier",
        "field_type": "select",
        "options": ["Tier-1 Mission Critical", "Tier-2 Standard", "Tier-3 Internal"]
    })
    req(f"/projects/{pid}/fields", {
        "label": "Root Cause",
        "key": "root_cause",
        "field_type": "text"
    })
    print("Added custom fields: Impact Level, Service Tier, Root Cause")

    # 7. Page Templates & Security Levels
    req(f"/projects/{pid}/page-templates", {
        "name": "Architecture Decision Record (ADR)",
        "body": "# ADR: [Title]\n\n## Status\nProposed / Accepted / Superseded\n\n## Context\nWhat problem are we solving?\n\n## Decision\nWhat is the technical choice?\n\n## Consequences\nPositive and negative tradeoffs."
    })
    req(f"/projects/{pid}/page-templates", {
        "name": "Production Post-Mortem",
        "body": "# Incident Post-Mortem: [Incident Title]\n\n## Summary\n- **Date:** YYYY-MM-DD\n- **Duration:** XX minutes\n- **Severity:** Sev-1 / Sev-2\n\n## Root Cause\nWhat triggered the failure?\n\n## Action Items\n- [ ] Immediate fix\n- [ ] Long term preventive measure"
    })
    req(f"/projects/{pid}/security-levels", {
        "name": "Security & Core Team Only",
        "description": "Restricted visibility for vulnerability disclosures and sensitive infra migrations."
    })

    # Saved Views
    req(f"/projects/{pid}/views", {
        "name": "P0 & Urgent Blockers",
        "filters": {"priority": "urgent"},
        "shared": True
    })
    req(f"/projects/{pid}/views", {
        "name": "Active Sprint In-Progress",
        "filters": {"status": "in_progress"},
        "shared": True
    })

    # 8. Historical Completed Sprints (for Velocity, Predictability & Burndown Charts)
    existing_sprints = req(f"/projects/{pid}/sprints") or []
    past_sprints = [
        ("Sprint 41 - Data Layer Isolation & RLS", "Ship database row-level security and tenant session contexts.", platform_team["id"], [
            ("Enforce PostgreSQL RLS policies across all tenant tables", "task", "urgent", "done", 8),
            ("Implement tenant-bound transaction extractor in Axum", "story", "high", "done", 5),
            ("Benchmark tenant query isolation overhead under concurrency", "task", "medium", "done", 5),
            ("Audit foreign key cascade deletion security boundaries", "task", "high", "done", 3),
        ]),
        ("Sprint 42 - Auth Hardening & TOTP Multi-Factor", "Deliver enterprise authentication and TOTP verification.", platform_team["id"], [
            ("Implement RFC 6238 TOTP enrollment and QR code generation", "story", "high", "done", 8),
            ("Secure recovery codes generation with Argon2id hashing", "task", "urgent", "done", 5),
            ("Session rotation and HttpOnly cookie refresh protection", "story", "high", "done", 5),
            ("Write brute-force rate limiter for authentication endpoints", "task", "medium", "done", 3),
        ]),
        ("Sprint 43 - High-Throughput Event Streaming", "Introduce Apache Kafka outbox processor and durable events.", platform_team["id"], [
            ("Design transactional outbox table schema and publisher worker", "story", "urgent", "done", 8),
            ("Build idempotent message consumer with dead-letter queue", "story", "high", "done", 8),
            ("Add OpenTelemetry distributed trace headers to Kafka payloads", "task", "medium", "done", 5),
        ]),
    ]

    for s_name, s_goal, s_team, s_items in past_sprints:
        sp = next((s for s in existing_sprints if s.get("name") == s_name), None)
        if not sp:
            sp = req(f"/projects/{pid}/sprints", {"name": s_name, "goal": s_goal, "team_id": s_team})
            if not sp: continue
            sp_id = sp["id"]
            sp_issues = []
            for it_title, it_kind, it_priority, it_status, it_pts in s_items:
                it = req(f"/projects/{pid}/issues", {
                    "title": it_title,
                    "kind": it_kind,
                    "priority": it_priority,
                    "description": f"Completed deliverable for {s_name}."
                })
                if it:
                    sp_issues.append(it["id"])
                    req(f"/issues/{it['id']}/edit", {"story_points": it_pts, "status": it_status}, method="PATCH")
                    if s_team:
                        req(f"/issues/{it['id']}/team", {"team_id": s_team}, method="PUT")
            req(f"/sprints/{sp_id}/issues", {"issue_ids": sp_issues})
            req(f"/sprints/{sp_id}", {"state": "active"}, method="PATCH")
            req(f"/sprints/{sp_id}", {"state": "completed"}, method="PATCH")
    print("Populated historical completed sprints for velocity and analytics")

    # 9. Active Sprint: Sprint 44
    sp44 = next((s for s in existing_sprints if "Sprint 44" in s.get("name", "")), None)
    if not sp44:
        sp44 = req(f"/projects/{pid}/sprints", {
            "name": "Sprint 44 - Multi-Region Read Replicas & Observability",
            "goal": "Achieve sub-50ms read latency across US-East and US-West with full OTel tracing.",
            "team_id": platform_team["id"]
        })
    sp44_id = sp44["id"] if sp44 else None

    # 10. Future Sprint: Sprint 45
    sp45 = next((s for s in existing_sprints if "Sprint 45" in s.get("name", "")), None)
    if not sp45:
        sp45 = req(f"/projects/{pid}/sprints", {
            "name": "Sprint 45 - Zero-Trust Network & Service Mesh",
            "goal": "Deploy mutual TLS across all internal micro-services and automated mTLS cert rotation.",
            "team_id": platform_team["id"]
        })
    sp45_id = sp45["id"] if sp45 else None

    # 11. Work Items / Issues for Project 1 (PLAT)
    issues_data = [
        # Epic
        ("Multi-Region Active-Active Database Replication Architecture", "epic", "urgent", "in_progress", 13,
         "Design and benchmark multi-master / active-active read replica topologies across AWS us-east-1 and us-west-2.\n\n### Requirements:\n- Replication lag under 100ms P99\n- Automatic read routing with health checks\n- Zero-data-loss failover sequence",
         ["database", "architecture", "high-availability"], sp44_id),
        # Urgent bug
        ("Connection pool exhaustion under burst traffic in US-West cluster", "bug", "urgent", "in_review", 8,
         "Under load test simulating 15,000 req/sec, Hikari/SQLx connection pool exhausted due to unindexed foreign key lookups.\n\n### Steps to reproduce:\n1. Execute k6 load test suite `load-sim-15k.js`\n2. Observe connection starvation errors in Datadog dashboard\n3. PostgreSQL `pg_stat_activity` shows queries in `idle in transaction` state",
         ["p0", "database", "incident"], sp44_id),
        # Stories & Tasks in Active Sprint
        ("Implement distributed rate limiter with Redis cluster fallback", "story", "high", "in_progress", 5,
         "Protect public API endpoints against volumetric abuse. Implement token bucket algorithm with local sliding window fallback.",
         ["api", "performance", "security"], sp44_id),
        ("Configure OpenTelemetry distributed trace context propagation", "task", "medium", "in_progress", 5,
         "Propagate W3C `traceparent` and `tracestate` headers across HTTP requests and Kafka event boundaries.",
         ["observability", "tracing"], sp44_id),
        ("Automate zero-downtime PostgreSQL schema migrations with expand/contract", "story", "high", "done", 5,
         "Ensure all database migrations run forward without locking tables during production deployments.",
         ["database", "reliability"], sp44_id),
        ("Implement cryptographically signed audit logging verification", "task", "high", "done", 5,
         "Compute SHA-256 HMAC chain for every audit log entry to guarantee non-repudiation.",
         ["security", "audit", "compliance"], sp44_id),
        # Backlog & Future Sprint items
        ("Deploy Envoy service mesh sidecars for mutual TLS (mTLS)", "story", "high", "todo", 8,
         "Automate SPIFFE/SPIRE identity attestation and rotate mTLS certificates every 24 hours.",
         ["security", "infrastructure"], sp45_id),
        ("Upgrade PgBouncer connection pooler to 1.23 with prepared statement support", "task", "medium", "todo", 3,
         "Enable protocol-level query preparation to reduce SQL parsing overhead by ~18%.",
         ["database", "performance"], sp45_id),
        ("Implement streaming CSV export with backpressure for large audit datasets", "story", "medium", "todo", 5,
         "Avoid memory OOM by chunking query cursor results directly into gzip output stream.",
         ["audit", "export", "performance"], sp45_id),
        ("Graceful SIGTERM shutdown handling in background worker daemon", "bug", "low", "todo", 2,
         "Ensure in-flight jobs finish executing within 15s grace period before process termination.",
         ["containers", "reliability"], None),
        ("Automated disaster recovery drill for cross-region snapshot restore", "task", "high", "todo", 5,
         "Weekly automated task that restores latest DB snapshot to ephemeral RDS instance and executes verification suite.",
         ["backup", "disaster-recovery"], None),
        ("Add WebSocket connection heartbeat with ping/pong jitter", "story", "medium", "todo", 3,
         "Prevent AWS ALB 60s idle timeout disconnects on collaborative rich-text editor sessions.",
         ["collab", "websocket"], None),
    ]

    all_proj_issues = req(f"/projects/{pid}/issues") or []
    created_issues = {i["title"]: i["id"] for i in all_proj_issues}
    sp44_issue_ids = []

    for title, kind, priority, status, pts, desc, labels, sprint_id in issues_data:
        iid = created_issues.get(title)
        if not iid:
            payload = {
                "title": title,
                "kind": kind,
                "priority": priority,
                "description": desc,
                "team_id": platform_team["id"]
            }
            iss = req(f"/projects/{pid}/issues", payload)
            if not iss: continue
            iid = iss["id"]
            created_issues[title] = iid

        # Update details: points, status, labels, custom fields, assignee
        edit_data = {
            "story_points": pts,
            "status": status,
            "labels": labels,
            "assignee_id": user_id,
            "custom_fields": {
                "impact_level": "High" if priority in ("urgent", "high") else "Medium",
                "service_tier": "Tier-1 Mission Critical"
            }
        }
        req(f"/issues/{iid}/edit", edit_data, method="PATCH")

        if sprint_id == sp44_id:
            sp44_issue_ids.append(iid)

    # Link issues into active sprint 44
    if sp44_id and sp44_issue_ids:
        req(f"/sprints/{sp44_id}/issues", {"issue_ids": sp44_issue_ids})
        req(f"/sprints/{sp44_id}", {"state": "active"}, method="PATCH")
        print(f"Committed {len(sp44_issue_ids)} issues into active Sprint 44")

    # Issue Checklists & Comments
    bug_title = "Connection pool exhaustion under burst traffic in US-West cluster"
    if bug_title in created_issues:
        bid = created_issues[bug_title]
        # Checklist items
        req(f"/issues/{bid}/checklist", {"text": "Capture thread dumps during high-load simulation"})
        req(f"/issues/{bid}/checklist", {"text": "Add composite index on (tenant_id, created_at) to work_items"})
        req(f"/issues/{bid}/checklist", {"text": "Increase max_connections in PgBouncer pooler config"})
        req(f"/issues/{bid}/checklist", {"text": "Verify P99 query latency returns under 25ms"})

        # Comments
        req(f"/issues/{bid}/comments", {
            "body": "P0 update from SRE: We reproduced this in staging using 500 concurrent worker threads. The bottleneck is indeed the unindexed audit log query. Fixing that drops active connections from 180 to 22."
        })
        req(f"/issues/{bid}/comments", {
            "body": "Patch is submitted in PR #142. Running regression smoke test suite now."
        })

        # Worklogs
        req(f"/issues/{bid}/worklogs", {
            "minutes": 180,
            "comment": "Profiling SQL execution plans with EXPLAIN ANALYZE on replica nodes."
        })

    epic_title = "Multi-Region Active-Active Database Replication Architecture"
    if epic_title in created_issues and bug_title in created_issues:
        # Issue link
        req(f"/issues/{created_issues[bug_title]}/links", {
            "target_id": created_issues[epic_title],
            "relation": "blocks"
        })

    # 12. Sprint Capacity for Sprint 44
    if sp44_id and user_id:
        req(f"/sprints/{sp44_id}/capacity", {
            "capacities": [
                {"user_id": user_id, "capacity_hours": 36.0}
            ]
        }, method="PUT")

    # 13. Releases
    all_releases = req(f"/projects/{pid}/releases") or []
    rel_v24 = next((r for r in all_releases if "v2.4.0" in r.get("name", "")), None)
    if not rel_v24:
        rel_v24 = req(f"/projects/{pid}/releases", {
            "name": "v2.4.0 - Enterprise Security Baseline",
            "description": "SOC 2 Type II controls, TOTP 2FA, encrypted audit logging, and tenant RLS isolation."
        })
    rel_v25 = next((r for r in all_releases if "v2.5.0" in r.get("name", "")), None)
    if not rel_v25:
        rel_v25 = req(f"/projects/{pid}/releases", {
            "name": "v2.5.0 - Multi-Region High Availability",
            "description": "Cross-region read replicas, automated failover, and sub-50ms global query routing."
        })
    rel_v30 = next((r for r in all_releases if "v3.0.0" in r.get("name", "")), None)
    if not rel_v30:
        rel_v30 = req(f"/projects/{pid}/releases", {
            "name": "v3.0.0 - Next-Gen Event Streaming Runtime",
            "description": "Distributed Kafka outbox, real-time reactive sync, and collaborative canvas."
        })
    if rel_v25 and sp44_issue_ids:
        req(f"/releases/{rel_v25['id']}/issues", {"issue_ids": sp44_issue_ids[:3]})
    print("Configured releases: v2.4.0, v2.5.0, v3.0.0")

    # 14. Knowledge Base Pages (Hierarchical Tree with Real Markdown & Inline Comments)
    all_pages = req(f"/projects/{pid}/pages") or []
    root_page = next((p for p in all_pages if "Handbook" in p.get("title", "")), None)
    if not root_page:
        root_page = req(f"/projects/{pid}/pages", {
            "title": "Platform Architecture & Engineering Handbook",
            "content": "# Platform Architecture & Engineering Handbook\n\nWelcome to the Meridian Core Platform documentation. This knowledge base serves as the single source of truth for architectural principles, reliability standards, and operational runbooks.\n\n## Core Principles\n1. **Zero-Trust by Default:** All inter-service communication is mutually authenticated via mTLS.\n2. **Tenant Isolation:** Double-enforced PostgreSQL Row Level Security (RLS) with bound sessions.\n3. **Event-Driven Resilience:** Asynchronous outbox pattern guarantees at-least-once event delivery.\n\n## Subsystems Overview\n- **API Ingress:** Axum async runtime on Tokio\n- **Persistence:** PostgreSQL 17 with composite keys `(tenant_id, id)`\n- **Streaming:** Apache Kafka cluster with transactional producers\n- **Client:** React 19 web app and Flutter mobile companion"
        })
    root_page_id = root_page["id"] if root_page else None

    if root_page_id:
        page_ha = next((p for p in all_pages if "High Availability" in p.get("title", "")), None)
        if not page_ha:
            page_ha = req(f"/projects/{pid}/pages", {
                "title": "High Availability & Multi-Region Database Strategy",
                "parent_id": root_page_id,
                "content": "# High Availability & Multi-Region Database Strategy\n\n## Target Topology\nOur primary production cluster runs in **AWS us-east-1 (N. Virginia)** with warm standby read replicas in **us-west-2 (Oregon)** and **eu-central-1 (Frankfurt)**.\n\n| Region | Role | Target Replication Lag | Failover RTO |\n|---|---|---|---|\n| us-east-1 | Primary Writer | 0ms (Local) | < 30 seconds |\n| us-west-2 | Read Replica | < 60ms (Async) | < 2 minutes |\n| eu-central-1 | Disaster Recovery | < 120ms (Async) | < 5 minutes |\n\n## Read-Write Splitting\nAll mutation queries (`INSERT`, `UPDATE`, `DELETE`) are routed through the primary writer pool.\nRead queries (`SELECT`) with tenant filters automatically target regional read pools using health-checked PgBouncer endpoints."
            })

        page_runbook = next((p for p in all_pages if "Incident" in p.get("title", "")), None)
        if not page_runbook:
            page_runbook = req(f"/projects/{pid}/pages", {
                "title": "Incident Severity & Response Runbook (Sev-1 & Sev-2)",
                "parent_id": root_page_id,
                "content": "# Incident Response Runbook\n\n## Severity Definitions\n- **Sev-1 (Critical Outage):** Customer data loss, complete API unresponsiveness, or security breach. Response time: **< 15 minutes**.\n- **Sev-2 (Degraded Performance):** High latency (> 500ms P95), partial regional degradation, or background job backlog. Response time: **< 30 minutes**.\n- **Sev-3 (Minor Defect):** Non-blocking functional bugs with acceptable workarounds. Response time: **< 4 hours**.\n\n## Escalation Cadence\n1. Page on-call primary SRE via Opsgenie / PagerDuty.\n2. Open dedicated incident Slack war-room `#incident-[date]-[service]`.\n3. Post customer status page update within 20 minutes of incident declaration."
            })

        # Add comments and inline comments on knowledge page
        if page_ha:
            ha_id = page_ha["id"]
            req(f"/pages/{ha_id}/comments", {
                "body": "Reviewed by Marcus (Principal SRE): Latency benchmarks from staging confirm us-west-2 replication lag stays under 42ms during peak simulated load."
            })
            req(f"/pages/{ha_id}/inline-comments", {
                "selected_text": "Failover RTO",
                "content": "Can we run a monthly automated chaos drill to verify this 30-second failover time?"
            })
    print("Created knowledge base pages with hierarchy and inline comments")

    # 15. RAID Register Items
    raid_items = [
        ("risk", "Cloud KMS latency spike impacting P99 API response times",
         "Third-party KMS API degradation could increase request signing latency.", "high", "open", "2026-12-15"),
        ("risk", "Upstream schema migration lock contention on large tables",
         "Large table alter statements could hold ACCESS EXCLUSIVE locks without strict expand-contract rules.", "critical", "mitigated", "2026-11-30"),
        ("assumption", "Cross-region network latency remains under 35ms between us-east-1 and us-west-2",
         "Based on AWS DirectConnect SLA and historical CloudWatch ping metrics.", "medium", "open", "2026-12-31"),
        ("issue", "Redis Sentinel failover intermittently causes 3s socket disconnect in staging",
         "Client connection retry backoff logic needs exponential jitter tuning.", "high", "open", "2026-11-25"),
        ("dependency", "AWS DirectConnect 10Gbps dedicated link provisioned before volume testing",
         "Telecom provider scheduled cutover for next Thursday.", "critical", "open", "2026-12-05"),
    ]
    for kind, title, desc, sev, stat, due in raid_items:
        req(f"/projects/{pid}/raid", {
            "kind": kind,
            "title": title,
            "description": desc,
            "severity": sev,
            "status": stat,
            "due_date": due
        })
    print("Populated RAID items: Risks, Assumptions, Issues, Dependencies")

    # 16. Architecture Decisions (ADRs)
    adrs = [
        ("ADR-001: Modular Axum Monolith over Microservices",
         "Need high developer velocity, type safety, and zero network serialization overhead in initial development phases.",
         "Deploy a single high-performance Rust binary using Axum, Tokio, and domain modules with shared PostgreSQL connection pool."),
        ("ADR-002: Double-Enforced PostgreSQL Row Level Security (RLS)",
         "Multi-tenant SaaS platforms require ironclad defense-in-depth against data co-mingling or accidental tenant leakage.",
         "Every database connection executes `SET LOCAL app.current_tenant_id = $1` inside request transaction; RLS policies enforce isolation automatically."),
        ("ADR-003: TipTap and Yjs CRDT over WebSockets for Document Collaboration",
         "Knowledge management requires concurrent multi-user editing with conflict-free convergence and offline capability.",
         "Implement Yjs CRDT binary document synchronization over authenticated WebSockets with incremental updates stored in PostgreSQL."),
    ]
    for title, ctx, out in adrs:
        req(f"/projects/{pid}/decisions", {
            "title": title,
            "context": ctx,
            "outcome": out
        })
    print("Added Architecture Decision Records (ADRs)")

    # 17. Goals / OKRs
    goals = [
        ("Achieve 99.99% Core API Availability across all regions", "Zero unexpected downtime across production API endpoints.", 88, "on_track"),
        ("Reduce P95 API Response Latency under 45ms", "Optimize database indexing and cache frequently read tenant policies.", 65, "on_track"),
        ("Complete SOC 2 Type II Security Compliance Audit", "Finalize evidence collection across IAM, encryption, and audit log controls.", 92, "on_track"),
    ]
    for title, desc, prog, stat in goals:
        req(f"/projects/{pid}/goals", {
            "title": title,
            "description": desc,
            "progress": prog,
            "status": stat
        })
    print("Added organizational Goals / OKRs")

    # 18. Roadmaps, Milestones & Baselines
    init = req("/initiatives", {
        "name": "Global Multi-Region Scalability 2026",
        "description": "Expand platform footprint across North America and Europe with sub-50ms data locality."
    })
    if init and "Multi-Region Active-Active Database Replication Architecture" in created_issues:
        req(f"/initiatives/{init['id']}/epics", {
            "issue_ids": [created_issues["Multi-Region Active-Active Database Replication Architecture"]]
        }, method="PUT")

    req(f"/projects/{pid}/milestones", {
        "name": "Architecture Review & Security Sign-off",
        "target_on": "2026-11-20"
    })
    req(f"/projects/{pid}/milestones", {
        "name": "Multi-Region Staging Pilot",
        "target_on": "2026-12-10"
    })
    req(f"/projects/{pid}/milestones", {
        "name": "Production Cutover & General Availability",
        "target_on": "2027-01-15"
    })
    req(f"/projects/{pid}/baselines", {
        "name": "Q4 Approved Scope Baseline"
    })
    print("Configured Roadmaps, Initiatives, Milestones, and Baselines")

    # 19. Customer Service Desk & Customer Portal
    existing_queues = req(f"/projects/{pid}/service/queues") or []
    q_urgent = next((q for q in existing_queues if "Urgent" in q.get("name", "")), None)
    if not q_urgent:
        q_urgent = req(f"/projects/{pid}/service/queues", {
            "name": "Urgent Production Triage"
        })
    q_general = next((q for q in existing_queues if "Enterprise" in q.get("name", "")), None)
    if not q_general:
        q_general = req(f"/projects/{pid}/service/queues", {
            "name": "Enterprise Customer Requests"
        })

    if q_urgent and q_general:
        existing_types = req(f"/projects/{pid}/service/request-types") or []
        rt_outage = next((r for r in existing_types if "Outage" in r.get("name", "")), None)
        if not rt_outage:
            rt_outage = req(f"/projects/{pid}/service/request-types", {
                "name": "Critical Service Outage / Degraded Performance",
                "description": "Report severe production anomalies, API downtime, or significant transaction errors.",
                "flow": "incident",
                "queue_id": q_urgent["id"],
                "target_hours": 1
            })

        rt_sso = next((r for r in existing_types if "SSO" in r.get("name", "")), None)
        if not rt_sso:
            rt_sso = req(f"/projects/{pid}/service/request-types", {
                "name": "Enterprise SSO & SAML / OIDC Setup",
                "description": "Request single sign-on domain verification and identity provider federation assistance.",
                "flow": "request",
                "queue_id": q_general["id"],
                "target_hours": 8
            })

        rt_quota = next((r for r in existing_types if "Quota" in r.get("name", "")), None)
        if not rt_quota:
            rt_quota = req(f"/projects/{pid}/service/request-types", {
                "name": "API Rate Limit & Quota Increase",
                "description": "Request elevated burst and sustained API quota limits for scheduled enterprise campaigns.",
                "flow": "request",
                "queue_id": q_general["id"],
                "target_hours": 4
            })

        # Submit sample customer service requests
        if rt_outage:
            req(f"/projects/{pid}/service/requests", {
                "request_type_id": rt_outage["id"],
                "title": "FinTech Corp: Spike in 504 Gateway Timeouts during market opening bells",
                "description": "Our automated trading ingestion webhook experienced elevated 504 timeouts between 09:30 and 09:45 EST."
            })
        if rt_quota:
            req(f"/projects/{pid}/service/requests", {
                "request_type_id": rt_quota["id"],
                "title": "GlobalRetail Inc: Rate limit increase to 60,000 req/min for Black Friday",
                "description": "Expecting 4x normal API traffic during upcoming holiday promotion window."
            })
        if rt_sso:
            req(f"/projects/{pid}/service/requests", {
                "request_type_id": rt_sso["id"],
                "title": "HealthSecure Systems: Assistance configuring Okta OIDC claims mapping",
                "description": "Need to map custom department claims to Meridian workspace teams automatically via SCIM."
            })
    print("Configured Customer Service Desk queues, request types, and tickets")

    # 20. Incidents (with sev-2 format)
    if bug_title in created_issues:
        req(f"/projects/{pid}/incidents", {
            "issue_id": created_issues[bug_title],
            "severity": "sev-2",
            "impact": "Elevated P99 read latency on customer analytics dashboards.",
            "root_cause": "Long-running analytical aggregation query starved connection pool."
        })
        print("Logged production incident linked to issue")

    # 21. Approvals
    if epic_title in created_issues and user_id:
        req(f"/projects/{pid}/approvals", {
            "title": "Production Schema Migration 0062: Composite Index on Audit Log Events",
            "subject_type": "issue",
            "subject_id": created_issues[epic_title],
            "reviewer_id": user_id,
            "note": "Verified zero-lock execution plan in staging environment with 50M rows."
        })
        print("Created production change approval request")

    # 22. Automations
    req(f"/projects/{pid}/automations", {
        "name": "Auto-notify Project Admins on Urgent Priority Issues",
        "trigger_event": "issue_created",
        "action_type": "notify_project_admins"
    })
    req(f"/projects/{pid}/automations", {
        "name": "Escalate Security Labeled Issues to High Priority",
        "trigger_event": "issue_created",
        "action_type": "set_priority_high"
    })
    print("Created automation rules")

    # 23. Integrations: Webhooks & API Tokens
    req("/admin/webhooks", {
        "name": "Production Slack Alerts Channel",
        "url": "https://example.com/integrations/slack/webhook",
        "events": ["issue.created", "incident.created", "release.published"]
    })
    req("/admin/webhooks", {
        "name": "Datadog Observability Ingest",
        "url": "https://example.com/integrations/datadog/webhook",
        "events": ["incident.created", "approval.requested"]
    })

    req("/me/tokens", {
        "name": "CI/CD Deployment Automation Key",
        "scope": "write",
        "expires_days": 90
    })
    req("/me/tokens", {
        "name": "Prometheus Health Check Bot",
        "scope": "read",
        "expires_days": 180
    })
    print("Registered webhooks and API tokens")

    # 24. Populate Second Project: Consumer Experience & Mobile (WEB)
    if web_pid:
        web_issues = [
            ("Implement responsive navigation sidebar with collapsible rail", "story", "high", "done", 5),
            ("Build cross-platform Flutter companion home and issues reader", "story", "urgent", "in_progress", 8),
            ("Add WCAG 2.1 AA accessibility audit and focus trap indicators", "task", "high", "in_review", 5),
            ("Implement dark and light theme token synchronization with system preference", "story", "medium", "done", 3),
            ("Fix virtualized list scroll jank on 1,000+ items board view", "bug", "high", "todo", 5),
            ("Offline draft synchronization queue with SQLite persistence", "story", "urgent", "todo", 8),
        ]
        for w_title, w_kind, w_pri, w_stat, w_pts in web_issues:
            w_iss = req(f"/projects/{web_pid}/issues", {
                "title": w_title,
                "kind": w_kind,
                "priority": w_pri,
                "description": f"Work item for frontend design system and mobile client."
            })
            if w_iss:
                req(f"/issues/{w_iss['id']}/edit", {"story_points": w_pts, "status": w_stat}, method="PATCH")
                if web_team["id"]:
                    req(f"/issues/{w_iss['id']}/team", {"team_id": web_team["id"]}, method="PUT")

        req(f"/projects/{web_pid}/pages", {
            "title": "Design System & Component Guidelines",
            "content": "# Design System & Component Guidelines\n\n## Typography & Tokens\n- **Primary Font:** Manrope\n- **Body Font:** DM Sans\n- **Monospace:** JetBrains Mono\n\n## Spacing System\nBased on an 8pt grid with compact 4pt density options.\n\n## Accessibility Target\nEvery interactive component must meet WCAG 2.1 AA contrast ratios and provide full keyboard navigation."
        })
        print("Populated second project: Consumer Experience & Mobile (WEB)")

    print("\n=== Real-World Seeding Complete! ===")
    print(f"Workspace: {slug}")
    print(f"Admin Login: {email}")
    print(f"Password: {password}")
    print(f"Web URL: http://localhost:9991")

if __name__ == "__main__":
    main()
