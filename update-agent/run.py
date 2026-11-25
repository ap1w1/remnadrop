#!/usr/bin/env python3
"""Execute only the fixed, backup-aware RemnaDrop CLI for queued panel requests."""
import datetime
import json
import os
import pathlib
import subprocess
import tempfile

directory = pathlib.Path(os.environ.get('REMNADROP_UPDATE_DIR', '/opt/remnawave/panel-updates'))
request = directory / 'request.json'
processing = directory / 'processing.json'
status = directory / 'status.json'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def write_status(value):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=directory,
                                     prefix='.status-', delete=False) as temporary:
        json.dump(value, temporary)
        temporary_path = pathlib.Path(temporary.name)
    temporary_path.replace(status)

if processing.exists():
    write_status({'state': 'failed', 'finishedAt': now(),
                  'message': 'Update worker was interrupted; inspect journalctl -u remnadrop-update.service'})
    processing.unlink()

if request.exists() and not processing.exists():
    request.replace(processing)
    try:
        queued = json.loads(processing.read_text(encoding='utf-8'))
        request_id = str(queued['id'])
        if len(request_id) != 36:
            raise ValueError('Invalid request ID')
        state = {'id': request_id, 'state': 'running', 'requestedAt': queued['requestedAt'], 'startedAt': now()}
        write_status(state)
        # Neither a shell nor an argument from the request is used here.
        result = subprocess.run(['/usr/local/bin/remnadrop', 'update'], stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, timeout=60 * 60 * 4)
        state.update(state='success' if result.returncode == 0 else 'failed', finishedAt=now(),
                     message='Update completed' if result.returncode == 0 else 'Update failed',
                     log=result.stdout[-6000:])
    except Exception as error:
        state = {'state': 'failed', 'finishedAt': now(), 'message': str(error)[:300]}
    finally:
        write_status(state)
        processing.unlink(missing_ok=True)
