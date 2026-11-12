#!/usr/bin/env python3
"""Populate a running LOCAL Meridian API with non-sensitive demo content.
Usage: MERIDIAN_API=http://localhost:9990 python scripts/seed_demo.py
Creates a fresh example workspace; never use real credentials or production URLs.
"""
import json
import os
import secrets
import urllib.error
import urllib.request

BASE = os.environ.get('MERIDIAN_API','http://localhost:9990').rstrip('/')
if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
    raise SystemExit('Demo seeding is restricted to a local API URL.')
TOKEN = None

def req(path,data=None,method=None):
    global TOKEN
    headers = {'Content-Type': 'application/json'}
    if TOKEN: headers['Authorization'] = 'Bearer ' + TOKEN
    payload = None if data is None else json.dumps(data).encode()
    r = urllib.request.Request(BASE+'/api'+path,data=payload,headers=headers,method=method or ('POST' if data is not None else 'GET'))
    try:
        with urllib.request.urlopen(r,timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{path}: HTTP {e.code}: {e.read().decode()}') from e

slug='meridian-demo-'+secrets.token_hex(3)
password=secrets.token_urlsafe(20)
account=req('/auth/signup',{'organization':'Northstar Studio','slug':slug,'name':'Meridian Demo','email':f'demo-{slug}@example.test','password':password})
TOKEN=account['token']
project=req('/projects',{'name':'Product platform','key':'PLAT','description':'Sample project for evaluating Meridian.'})
pid=project['id']
items=[
  ('Design unified onboarding','story','high','in_progress'),
  ('Fix search query filter','bug','urgent','in_review'),
  ('Prepare API contract','task','medium','done'),
  ('Build cross-team roadmap','epic','high','todo'),
  ('Add project notification settings','task','low','todo'),
  ('Improve mobile issue details','story','medium','in_progress'),
  ('Create security review checklist','task','high','done'),
  ('Add knowledge relationship navigation','story','medium','todo'),
]
# Two teams, so the team backlog and team sprints have something to show.
platform_team=req('/teams',{'name':'Platform','description':'API, data and infrastructure'})
web_team=req('/teams',{'name':'Web','description':'Browser and mobile experience'})
TEAM_FOR_TITLE={'Build cross-team roadmap':platform_team,'Prepare API contract':platform_team,
  'Create security review checklist':platform_team,'Fix search query filter':platform_team,
  'Design unified onboarding':web_team,'Improve mobile issue details':web_team,
  'Add knowledge relationship navigation':web_team,'Add project notification settings':web_team}
POINTS_FOR_TITLE={'Build cross-team roadmap':13,'Prepare API contract':8,
  'Create security review checklist':5,'Fix search query filter':3,
  'Design unified onboarding':5,'Improve mobile issue details':5,
  'Add knowledge relationship navigation':8,'Add project notification settings':3}
issue_ids={}
for title,kind,priority,status in items:
    issue=req(f'/projects/{pid}/issues',{'title':title,'kind':kind,'priority':priority,'description':'Demonstration work item for the Meridian workspace.'})
    issue_ids[title]=issue['id']
    req(f"/issues/{issue['id']}/team",{'team_id':TEAM_FOR_TITLE[title]['id']},method='PUT')
    if title in POINTS_FOR_TITLE:
        req(f"/issues/{issue['id']}/edit",{'story_points':POINTS_FOR_TITLE[title]},method='PATCH')
    if status != 'todo':req(f"/issues/{issue['id']}",{'status':status},method='PATCH')

# Historical completed sprints establishing team velocity, throughput and predictability.
for s_name, s_goal, s_team, s_items in [
    ('Platform sprint 00', 'Core schemas and authentication', platform_team['id'], [
        ('Set up tenant database isolation', 'task', 'urgent', 'done', 8),
        ('Implement Argon2id password hashing', 'task', 'high', 'done', 5),
        ('Configure session tokens and middleware', 'task', 'high', 'done', 8),
        ('Benchmark query response latency', 'task', 'medium', 'done', 3),
    ]),
    ('Web sprint 00', 'Initial web client navigation and shell', web_team['id'], [
        ('Build responsive layout shell', 'story', 'high', 'done', 8),
        ('Implement theme switching and tokens', 'story', 'medium', 'done', 5),
        ('Connect client auth and session guard', 'task', 'high', 'done', 5),
        ('Draft offline synchronization flow', 'story', 'low', 'in_progress', 3),
    ]),
    ('Platform sprint 00.5', 'Database migrations and OpenAPI generation', platform_team['id'], [
        ('Generate OpenAPI v3 schema contract', 'task', 'urgent', 'done', 8),
        ('Implement foreign key tenant cascading', 'task', 'high', 'done', 5),
        ('Configure audit logging triggers', 'task', 'medium', 'done', 5),
    ]),
]:
    sp = req(f'/projects/{pid}/sprints', {'name': s_name, 'goal': s_goal, 'team_id': s_team})
    sp_issue_ids = []
    for it_title, it_kind, it_priority, it_status, it_pts in s_items:
        it = req(f'/projects/{pid}/issues', {
            'title': it_title,
            'kind': it_kind,
            'priority': it_priority,
            'description': 'Historical completed work item establishing velocity.'
        })
        sp_issue_ids.append(it['id'])
        req(f"/issues/{it['id']}/team", {'team_id': s_team}, method='PUT')
        req(f"/issues/{it['id']}/edit", {'story_points': it_pts}, method='PATCH')
        if it_status != 'todo':
            req(f"/issues/{it['id']}", {'status': it_status}, method='PATCH')
    req(f"/sprints/{sp['id']}/issues", {'issue_ids': sp_issue_ids}, method='POST')
    req(f"/sprints/{sp['id']}", {'state': 'active'}, method='PATCH')
    req(f"/sprints/{sp['id']}", {'state': 'completed'}, method='PATCH')
# A team sprint that is active (team Platform), with its committed issues.
platform_sprint=req(f'/projects/{pid}/sprints',{'name':'Platform sprint 01','goal':'Harden the API contract','team_id':platform_team['id']})
req(f"/sprints/{platform_sprint['id']}/issues",{'issue_ids':[issue_ids['Prepare API contract'],issue_ids['Fix search query filter'],issue_ids['Create security review checklist']]},method='POST')
req(f"/sprints/{platform_sprint['id']}",{'state':'active'},method='PATCH')
# A release with scope: two issues shipped in it, one still planned.
release=req(f'/projects/{pid}/releases',{'name':'0.2 internal pilot','description':'First build for the pilot team.'})
req(f"/releases/{release['id']}/issues",{'issue_ids':[issue_ids['Design unified onboarding'],issue_ids['Fix search query filter'],issue_ids['Prepare API contract']]},method='POST')
for title,content in [
  ('Product vision','Meridian connects work, knowledge, people, and decisions into one unified workspace.\n\n## Core principles\n- Clarity\n- Trust\n- Speed'),
  ('Engineering handbook','Use small, reviewable changes. Verify permissions and tenant boundaries. Capture architecture decisions with context and evidence.'),
  ('Launch checklist','1. Verify critical workflows\n2. Review security\n3. Complete migrations\n4. Run backup restore drill'),
]:req(f'/projects/{pid}/pages',{'title':title,'content':content})
req(f'/projects/{pid}/sprints',{'name':'Sprint 01','goal':'Ship the foundation'})
req(f'/projects/{pid}/goals',{'title':'Release an internal pilot','description':'Validate usability with a small team','progress':55})
req(f'/projects/{pid}/risks',{'title':'Late enterprise SSO integration','mitigation':'Use a staged rollout, integration testing, and a vendor-backed OIDC provider.','likelihood':2,'impact':4})
req(f'/projects/{pid}/decisions',{'title':'Use a modular Rust backend','context':'Avoid distributed system overhead prematurely.','outcome':'Ship a single modular Axum API.'})
print(json.dumps({'workspace_slug':slug,'email':f'demo-{slug}@example.test','project_key':'PLAT','temporary_demo_password':password,'note':'Development-only demo account. Store or discard credentials safely.'},indent=2))
