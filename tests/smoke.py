#!/usr/bin/env python3
"""Black-box API tests: require a locally running Meridian backend.
Usage: MERIDIAN_API=http://localhost:9990 python tests/smoke.py
No third-party packages needed. Do not run against production.
"""
import json
import os
import secrets
import urllib.error
import urllib.request

BASE=os.environ.get('MERIDIAN_API','http://localhost:9990').rstrip('/')
if not BASE.startswith(('http://localhost:', 'http://127.0.0.1:')):
    raise SystemExit('Tests only run on local URLs.')

def api(path,token=None,payload=None,method=None):
    h={'Content-Type':'application/json'}
    if token:h['Authorization']='Bearer '+token
    data=json.dumps(payload).encode() if payload is not None else None
    r=urllib.request.Request(BASE+'/api'+path,data=data,headers=h,method=method or ('POST' if payload is not None else 'GET'))
    try:
        with urllib.request.urlopen(r,timeout=10) as v:
            raw=v.read()
            return v.status,json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

def expect(status,path,**kwargs):
    code,result=api(path,**kwargs)
    assert code==status,(path,code,result)
    return result

def signup(tag):
    slug=f'qa-{tag}-{secrets.token_hex(3)}'
    return expect(201,'/auth/signup',payload={'organization':slug,'slug':slug,'name':'Test User','email':f'{slug}@example.test','password':secrets.token_urlsafe(30)})

one=signup('a');two=signup('b')
assert one['tenant_id']!=two['tenant_id']
p=expect(201,'/projects',token=one['token'],payload={'key':'TEST','name':'QA Project'})
issue=expect(201,f"/projects/{p['id']}/issues",token=one['token'],payload={'title':'Private work'})
page=expect(201,f"/projects/{p['id']}/pages",token=one['token'],payload={'title':'Private page','content':'Restricted information'})
expect(404,f"/projects/{p['id']}/issues",token=two['token'])
expect(404,f"/projects/{p['id']}/pages",token=two['token'])
expect(404,f"/issues/{issue['id']}/details",token=two['token'])
expect(404,f"/pages/{page['id']}/versions",token=two['token'])
expect(404,f"/issues/{issue['id']}",token=two['token'],payload={'status':'done'},method='PATCH')
expect(200,f"/issues/{issue['id']}/details",token=one['token'])
expect(201,f"/issues/{issue['id']}/comments",token=one['token'],payload={'body':'Internal review'})
expect(200,'/search?q=Private',token=one['token'])
assert expect(200,'/search?q=Private',token=two['token'])==[]
expect(201,f"/projects/{p['id']}/goals",token=one['token'],payload={'title':'Good outcome','progress':10})
sprint=expect(201,f"/projects/{p['id']}/sprints",token=one['token'],payload={'name':'Sprint A'})
expect(200,f"/sprints/{sprint['id']}/capacity",token=one['token'])
expect(200,f"/projects/{p['id']}/velocity",token=one['token'])
raid=expect(200,f"/projects/{p['id']}/raid",token=one['token'],payload={'kind':'risk','title':'Test Risk','severity':'medium'})
expect(200,f"/projects/{p['id']}/raid",token=one['token'])
expect(404,f"/projects/{p['id']}/raid",token=two['token'])
expect(201,f"/pages/{page['id']}/inline-comments",token=one['token'],payload={'selected_text':'Restricted','content':'Check visibility'})
expect(200,f"/pages/{page['id']}/inline-comments",token=one['token'])
expect(404,f"/pages/{page['id']}/inline-comments",token=two['token'])
expect(200,f"/projects/{p['id']}/analytics",token=one['token'])
expect(200,f"/projects/{p['id']}/export",token=one['token'])
expect(200,'/portfolio',token=one['token'])
print('PASS: registration, tenant isolation, issues, pages, comments, search, planning, velocity, raid, inline comments, analytics, export and portfolio')
