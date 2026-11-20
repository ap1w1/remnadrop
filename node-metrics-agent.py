#!/usr/bin/env python3
"""Linux CPU sampler. Configure PANEL_URL, NODE_UUID and NODE_METRICS_TOKEN."""
import json
import os
import time
import urllib.request
import urllib.parse

panel = os.environ['PANEL_URL'].rstrip('/')
node = os.environ['NODE_UUID']
token = os.environ['NODE_METRICS_TOKEN']
if urllib.parse.urlsplit(panel).scheme != 'https':
    raise SystemExit('PANEL_URL must use HTTPS')

def counters():
    with open('/proc/stat', encoding='ascii') as source:
        values = [int(v) for v in source.readline().split()[1:9]]
    # Exclude guest counters already included in user/nice.
    return sum(values), values[3] + values[4]

previous = counters()
while True:
    time.sleep(60)
    current = counters()
    total, idle = current[0]-previous[0], current[1]-previous[1]
    previous = current
    if total <= 0 or idle < 0:
        continue
    cpu = max(0, min(100, 100*(1-idle/total)))
    request = urllib.request.Request(
        f'{panel}/api/nodes/{node}/metrics-agent',
        data=json.dumps({'cpu': cpu}).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        # Do not forward the node credential through an HTTP redirect.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            response.read(1024)
    except Exception:
        print('Metric delivery failed; retrying on next sample', flush=True)
