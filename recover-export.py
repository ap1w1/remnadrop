#!/usr/bin/env python3
"""Recover a local rollback image from a previously exported panel container."""
import json
import pathlib
import subprocess
import sys


def run(*args):
    return subprocess.check_output(args, text=True).strip()


root = pathlib.Path(sys.argv[1]).resolve()
saved = json.loads((root / 'container.json').read_text())[0]
current = json.loads(run('docker', 'inspect', 'remnawave'))[0]
if saved['Id'] != current['Id'] or saved['Image'] != current['Image']:
    raise SystemExit('Container changed since export; refusing this recovery snapshot')
archive = root / 'rootfs.tar'
if not archive.is_file() or not archive.stat().st_size:
    raise SystemExit('Missing rootfs.tar')
config = saved['Config']
args = ['docker', 'image', 'import']
for key in ('WorkingDir', 'User'):
    if config.get(key):
        args += ['--change', ('WORKDIR' if key == 'WorkingDir' else 'USER') + ' ' + config[key]]
for key in ('Entrypoint', 'Cmd'):
    if config.get(key):
        args += ['--change', key.upper() + ' ' + json.dumps(config[key])]
for env in config.get('Env') or []:
    key, value = env.split('=', 1)
    args += ['--change', 'ENV ' + key + '=' + json.dumps(value)]
args += ['--change', 'LABEL recovery.container=' + saved['Id']]
tag = 'panel-fork:recovered-' + saved['Id'][:12]
print('Importing rollback image; existing panel stays running...', flush=True)
# Do not print the command arguments: environment values can contain secrets.
result = subprocess.run(args + [str(archive), tag], capture_output=True, text=True)
if result.returncode:
    raise SystemExit('Docker import failed; panel has not been changed')
run('docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', tag,
    '-e', "const p=require('./package.json');if(p.version!=='2.8.1')process.exit(1);require('nestjs-zod').patchNestJsSwagger();require('fs').accessSync('dist/src/main.js');console.log('Recovery image check OK')")
(root / 'rollback-image').write_text(tag + '\n')
print('Recovery image verified: ' + tag)
