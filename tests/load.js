// Example k6 load smoke against a running, seeded API.
// Usage: MERIDIAN_TOKEN=... MERIDIAN_PROJECT_ID=... k6 run tests/load.js
// Required measurements before GA: p50/p95/p99, peak DB connections, memory, CPU, errors.
import http from 'k6/http';
import {check, sleep} from 'k6';
export const options={stages:[{duration:'30s',target:10},{duration:'2m',target:50},{duration:'30s',target:0}],thresholds:{http_req_duration:['p(95)<400'],http_req_failed:['rate<0.01']}};
const base=__ENV.MERIDIAN_API||'http://localhost:9990';
export default function(){
  const headers={Authorization:`Bearer ${__ENV.MERIDIAN_TOKEN}`};
  const id=__ENV.MERIDIAN_PROJECT_ID;
  const res=http.get(`${base}/api/projects/${id}/issues`,{headers});
  check(res,{'issues loaded':r=>r.status===200});
  if(Math.random()<0.2)http.get(`${base}/api/projects/${id}/pages`,{headers});
  sleep(1);
}
