#!/usr/bin/env python3
"""Populate a running LOCAL Meridian API with non-sensitive demo content.
Usage: MERIDIAN_API=http://localhost:8080 python scripts/seed_demo.py
Creates a fresh example workspace; never use real credentials or production URLs.
"""
import json
import os
import secrets
import urllib.error
import urllib.request

BASE = os.environ.get('MERIDIAN_API','http://localhost:8080').rstrip('/')
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
for title,kind,priority,status in items:
    issue=req(f'/projects/{pid}/issues',{'title':title,'kind':kind,'priority':priority,'description':'Demonstration work item for the Meridian workspace.'})
    if status != 'todo':req(f"/issues/{issue['id']}",{'status':status},method='PATCH')
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
