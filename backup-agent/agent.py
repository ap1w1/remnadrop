#!/usr/bin/env python3
"""RemnaDrop backup worker: PostgreSQL -> local / rclone, one run per due target.

Requires a systemd timer and Docker CLI on the panel host; the web API never touches
Docker or rclone secrets. Intended to run as root with /etc/remnadrop-backups private.
"""
from __future__ import annotations
import fcntl
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.request import Request, urlopen
from urllib.parse import urlsplit
from datetime import datetime, timezone
import uuid

LOG = logging.getLogger('remnadrop-backups')
BASE = Path(os.environ.get('BACKUP_LOCAL_DIR', '/var/lib/remnadrop-backups/archives')).resolve()
RCLONE_CONFIG = os.environ.get('RCLONE_CONFIG', '/etc/remnadrop-backups/rclone.conf')
WEBHOOK_URL = os.environ.get('BACKUP_WEBHOOK_URL', '')
WEBHOOK_SECRET = os.environ.get('BACKUP_WEBHOOK_SECRET', '')
PROVIDER_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$')
PATH_RE = re.compile(r'^[a-zA-Z0-9_./-]{1,160}$')
UUID_RE = re.compile(r'^[0-9a-f-]{36}$')


def db_sql(sql: str) -> str:
    result = subprocess.run(
        ['docker', 'exec', '-i', 'remnawave-db', 'sh', '-ec',
         'exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
        input=sql, text=True, capture_output=True, timeout=120, check=False,
    )
    if result.returncode:
        raise RuntimeError('PostgreSQL operation failed: ' + result.stderr[-3000:])
    return result.stdout.strip()


def sql_lit(text: str) -> str:
    # Values from a database column are escaped even though the UI validates them.
    return "'" + text.replace("'", "''") + "'"


def check_target(t: dict):
    if t['provider'] not in ['local', 's3', 'ftp', 'gdrive']:
        raise ValueError('Unsupported storage type')
    if not isinstance(t['remotePath'], str) or not PATH_RE.fullmatch(t['remotePath']):
        raise ValueError('Invalid storage subfolder')
    if t['remotePath'].startswith('/') or any(v in ('..', '.') for v in t['remotePath'].split('/')):
        raise ValueError('Unsafe storage subfolder')
    if t['provider'] != 'local' and not PROVIDER_RE.fullmatch(t['remoteName']):
        raise ValueError('Invalid rclone remote name')
    if not UUID_RE.fullmatch(t['id']) or not UUID_RE.fullmatch(t['runId']):
        raise ValueError('Invalid target / run id')


def claim_due() -> list[dict]:
    # Atomic DB claim avoids duplicate work even if another worker is started.
    result = db_sql('''WITH due AS (
        SELECT id FROM backup_targets WHERE enabled AND next_run_at <= now()
        ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 6
    ), claimed AS (
        UPDATE backup_targets t SET
            last_run_at = now(), last_status = 'running',
            next_run_at = now() + (t.interval_minutes * interval '1 minute'), updated_at=now()
        FROM due WHERE t.id=due.id
        RETURNING t.*
    ), runs AS (
        INSERT INTO backup_runs(id,target_id,status,started_at)
        SELECT gen_random_uuid(),id,'running',now() FROM claimed RETURNING id,target_id
    )
    SELECT COALESCE(json_agg(json_build_object(
        'id',c.id,'runId',r.id,'name',c.name,'provider',c.provider,
        'remoteName',c.remote_name,'remotePath',c.remote_path,
        'retentionDays',c.retention_days,'maxBytes',c.max_bytes::text,
        'autoDelete',c.auto_delete,'webhookEnabled',c.webhook_enabled
    ))::text,'[]') FROM claimed c JOIN runs r ON r.target_id=c.id;''')
    return json.loads(result or '[]')


def records(target_id: str) -> list[dict]:
    if not UUID_RE.fullmatch(target_id):
        raise ValueError('Invalid UUID')
    s = db_sql('''SELECT COALESCE(json_agg(json_build_object(
       'id',id,'fileName',file_name,'sizeBytes',size_bytes::text,'startedAt',started_at,
       'status',status) ORDER BY started_at,id)::text,'[]')
       FROM backup_runs WHERE target_id = %s::uuid
         AND status='completed' AND deleted_at IS NULL AND file_name IS NOT NULL;''' % sql_lit(target_id))
    return json.loads(s or '[]')


def safe_target_path(t: dict) -> Path:
    dest = BASE / t['remotePath'] / t['id']
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    dest.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not dest.resolve().is_relative_to(BASE):
        raise RuntimeError('Storage path escapes configured base directory')
    return dest


def remote_folder(t: dict) -> str:
    return f"{t['remoteName']}:{t['remotePath']}/{t['id']}"


def rclone(*args: str, timeout: int = 3600) -> str:
    command = ['rclone', '--config', RCLONE_CONFIG, *args]
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError('rclone failed: ' + result.stderr[-1500:])
    return result.stdout


def usage_bytes(t: dict) -> int:
    if t['provider'] == 'local':
        return sum(p.stat().st_size for p in safe_target_path(t).glob('*.dump') if p.is_file())
    # Fail closed when remote usage cannot be established. For the first backup
    # create the folder using `rclone mkdir remote:prefix/target-uuid` or use a
    # remote where rclone size can report zero for a nonexistent prefix.
    return int(json.loads(rclone('size', remote_folder(t), '--json'))['bytes'])


def remove_archive(t: dict, record: dict):
    name = record['fileName']
    if not isinstance(name, str) or not re.fullmatch(r'remnadrop-[0-9T]+-[0-9a-f]{8}\.dump', name):
        raise ValueError('Refusing to remove unexpected filename')
    if t['provider'] == 'local':
        (safe_target_path(t) / name).unlink(missing_ok=True)
    else:
        rclone('deletefile', remote_folder(t) + '/' + name)
    db_sql(f"UPDATE backup_runs SET deleted_at=now() WHERE id={sql_lit(record['id'])}::uuid AND deleted_at IS NULL;")


def process_requested_deletions():
    """Process UI requests on the VPS; never delete the last good copy."""
    result = db_sql("""SELECT COALESCE(json_agg(item)::text,'[]') FROM (
        SELECT json_build_object(
          'id',t.id,'runId',r.id,'provider',t.provider,
          'remoteName',t.remote_name,'remotePath',t.remote_path,
          'fileName',r.file_name
        ) item
        FROM backup_runs r JOIN backup_targets t ON t.id=r.target_id
        WHERE r.delete_requested_at IS NOT NULL
          AND r.deleted_at IS NULL AND r.status='completed'
        ORDER BY r.delete_requested_at LIMIT 20
    ) pending;""")
    for item in json.loads(result or '[]'):
        archive_id = item['runId']
        try:
            check_target(item)
            history = records(item['id'])
            # The last *successful non-deleted* dump must always survive.
            if not history or history[-1]['id'] == archive_id:
                raise RuntimeError('Last verified archive is protected from deletion')
            record = next((x for x in history if x['id'] == archive_id), None)
            if record is None:
                raise RuntimeError('Archive is no longer present in active history')
            remove_archive(item, record)
            db_sql(f"UPDATE backup_runs SET delete_requested_at=NULL,delete_error=NULL "
                   f"WHERE id={sql_lit(archive_id)}::uuid;")
            LOG.info('Archive deletion completed for %s', archive_id)
        except Exception as exc:
            message = str(exc)[:700]
            LOG.exception('Archive deletion failed: %s', archive_id)
            # A permanently protected last archive should not be retried every minute.
            clear = 'delete_requested_at=NULL,' if 'protected' in message else ''
            db_sql(f"UPDATE backup_runs SET {clear}delete_error={sql_lit(message)} "
                   f"WHERE id={sql_lit(archive_id)}::uuid;")


def purge(t: dict, incoming: int):
    history = records(t['id'])
    max_size = int(t['maxBytes'])
    if incoming > max_size:
        raise RuntimeError('Archive exceeds this destination capacity limit')
    used = usage_bytes(t)
    if used + incoming <= max_size and not t['autoDelete']:
        return
    if t['autoDelete']:
        # Keep the latest successful backup until a replacement has been verified.
        protected_id = history[-1]['id'] if history else ''
        now = datetime.now(timezone.utc)
        for entry in history:
            if entry['id'] == protected_id:
                continue
            stamp = datetime.fromisoformat(entry['startedAt'].replace('Z', '+00:00'))
            older = (now - stamp).total_seconds() > int(t['retentionDays']) * 86400
            if older or used + incoming > max_size:
                remove_archive(t, entry)
                used = usage_bytes(t)
    if used + incoming > max_size:
        raise RuntimeError('Storage quota exceeded; last successful archive is protected')


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def upload(t: dict, src: Path, name: str):
    if t['provider'] == 'local':
        folder = safe_target_path(t)
        target = folder / name
        if target.exists():
            raise RuntimeError('Archive name collision')
        shutil.copyfile(src, target)
        os.chmod(target, 0o600)
        if file_sha256(target) != file_sha256(src):
            target.unlink(missing_ok=True)
            raise RuntimeError('Local backup integrity verification failed')
    else:
        dest = remote_folder(t) + '/' + name
        rclone('copyto', str(src), dest, '--retries', '3', timeout=14400)
        info = json.loads(rclone('lsjson', dest, '--stat'))
        if int(info.get('Size', -1)) != src.stat().st_size:
            raise RuntimeError('Remote archive size verification failed')


def notify(t: dict, status: str, name: str, size: int, sha: str, error: str):
    if not t['webhookEnabled'] or not WEBHOOK_URL:
        return
    parsed = urlsplit(WEBHOOK_URL)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        LOG.warning('Webhook skipped: HTTPS URL required')
        return
    event = {'event':'backup.' + status,'targetId':t['id'],'runId':t['runId'],
             'storageType':t['provider'],'name':t['name'],'fileName':name,
             'sizeBytes':str(size),'sha256':sha,'error':error,
             'occurredAt':datetime.now(timezone.utc).isoformat()}
    body = json.dumps(event, ensure_ascii=False, separators=(',', ':')).encode()
    headers = {'Content-Type':'application/json','User-Agent':'RemnaDrop-Backup-Agent/1.0'}
    if WEBHOOK_SECRET:
        sig = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        headers['X-Remnadrop-Signature'] = 'sha256=' + sig
    try:
        with urlopen(Request(WEBHOOK_URL, body, headers, method='POST'), timeout=10) as response:
            if response.status >= 300:
                raise RuntimeError(f'Webhook status {response.status}')
    except Exception as exc:
        LOG.warning('Webhook delivery error: %s', exc)


def run_one(t: dict):
    name = ''
    size = 0
    sha = ''
    err = ''
    status = 'failed'
    try:
        check_target(t)
        if t['provider'] == 'local':
            safe_target_path(t)
        if t['provider'] != 'local':
            # Creating the target prefix is safe and lets rclone size return 0 for
            # a first-time, empty destination instead of an ambiguous 404.
            rclone('mkdir', remote_folder(t))
        with tempfile.TemporaryDirectory(prefix='remnadrop-db-', dir='/var/tmp') as temp:
            path = Path(temp) / 'database.dump'
            with path.open('wb') as out:
                result = subprocess.run(
                    ['docker', 'exec', 'remnawave-db', 'sh', '-ec',
                     'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
                    stdout=out, stderr=subprocess.PIPE, text=False, timeout=7200,
                    check=False,
                )
            if result.returncode or path.stat().st_size == 0:
                raise RuntimeError('pg_dump failed: ' + result.stderr.decode(errors='replace')[-1200:])
            subprocess.run(['docker', 'exec', '-i', 'remnawave-db', 'sh', '-ec',
                            'exec pg_restore --list >/dev/null'], stdin=path.open('rb'),
                           check=True, capture_output=True, timeout=240)
            size = path.stat().st_size
            if t['provider'] == 'local' and shutil.disk_usage(BASE).free < size * 2:
                raise RuntimeError('Not enough free disk space for local archive')
            sha = file_sha256(path)
            purge(t, size)
            name = f"remnadrop-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{t['runId'][:8]}.dump"
            upload(t, path, name)
        try:
            used = usage_bytes(t)
        except Exception as metrics_error:
            LOG.warning('Cannot update backup usage metric: %s', metrics_error)
            used = None
        used_update = f'last_usage_bytes={used},last_usage_at=now(),' if used is not None else ''
        db_sql(f"UPDATE backup_runs SET status='completed',file_name={sql_lit(name)},size_bytes={size},sha256={sql_lit(sha)},finished_at=now() WHERE id={sql_lit(t['runId'])}::uuid;"
               f"UPDATE backup_targets SET {used_update}last_status='completed' WHERE id={sql_lit(t['id'])}::uuid;")
        status = 'completed'
        LOG.info('%s: backup completed, %s, %s bytes', t['name'], name, size)
    except Exception as exc:
        err = str(exc)[:1300]
        LOG.exception('Backup target failed: %s', t.get('name'))
        db_sql(f"UPDATE backup_runs SET status='failed', error={sql_lit(err)},finished_at=now() WHERE id={sql_lit(t['runId'])}::uuid;"
               f"UPDATE backup_targets SET last_status='failed' WHERE id={sql_lit(t['id'])}::uuid;")
    finally:
        notify(t, status, name, size, sha, err)


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    lock_dir = Path('/run/lock')
    with (lock_dir / 'remnadrop-backups.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            LOG.info('A backup agent is already running')
            return
        try:
            db_sql("UPDATE backup_agent_status SET last_seen=now(),last_error=NULL WHERE singleton=1;")
            process_requested_deletions()
            for t in claim_due():
                run_one(t)
            db_sql("UPDATE backup_agent_status SET last_seen=now() WHERE singleton=1;")
        except Exception as exc:
            try:
                db_sql("UPDATE backup_agent_status SET last_seen=now(),last_error=" + sql_lit(str(exc)[:700]) + " WHERE singleton=1;")
            finally:
                raise


if __name__ == '__main__':
    main()
