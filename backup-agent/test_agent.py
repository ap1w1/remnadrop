import importlib.util
import json
import tempfile
from pathlib import Path
from unittest import TestCase, mock, main

spec = importlib.util.spec_from_file_location('agent', Path(__file__).with_name('agent.py'))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


def target(**kw):
    return dict(id='fdd0e928-e732-4c7f-9d1a-68bc0830a21b',
                runId='6aac0556-4dcd-49f9-98ae-fba5f8d2f461',
                provider='local',remoteName='',remotePath='remnadrop',
                maxBytes='110',retentionDays=30,autoDelete=True,webhookEnabled=False, name='Local',**kw)


class BackupAgentTests(TestCase):
    def test_path_traversal_rejected(self):
        t=target(); t['remotePath']='../../etc'
        with self.assertRaises(ValueError): agent.check_target(t)
    def test_unknown_remote_name_rejected(self):
        t=target(); t['provider']='s3'; t['remoteName']='foo;rm -rf'
        with self.assertRaises(ValueError): agent.check_target(t)
    def test_last_good_copy_never_deleted(self):
        t=target()
        history=[{'id':'one','fileName':'remnadrop-20261120T101010-abcd1234.dump', 'startedAt':'2026-01-01T00:00:00+00:00'},
                 {'id':'two','fileName':'remnadrop-20261120T111111-aaaa1111.dump', 'startedAt':'2026-01-01T00:00:00+00:00'}]
        with mock.patch.object(agent,'records',return_value=history),mock.patch.object(agent,'usage_bytes',side_effect=[100,50]),mock.patch.object(agent,'remove_archive') as remove:
            agent.purge(t,40)
            remove.assert_called_once_with(t,history[0])
    def test_quota_rejects_when_only_one_copy_remains(self):
        t=target()
        history=[{'id':'one','fileName':'remnadrop-20261120T101010-abcd1234.dump','startedAt':'2026-01-01T00:00:00+00:00'}]
        with mock.patch.object(agent,'records',return_value=history),mock.patch.object(agent,'usage_bytes',return_value=100),mock.patch.object(agent,'remove_archive') as remove:
            with self.assertRaisesRegex(RuntimeError,'quota exceeded'): agent.purge(t,40)
            remove.assert_not_called()
    def test_last_backup_cannot_be_deleted_from_ui_queue(self):
        t=target()
        item=dict(t,fileName='remnadrop-20261120T111111-fba5f8d2.dump')
        history=[{'id':t['runId'],'fileName':item['fileName']}]
        with mock.patch.object(agent,'db_sql',side_effect=[json.dumps([item]),'']) as db, \
             mock.patch.object(agent,'records',return_value=history), \
             mock.patch.object(agent,'remove_archive') as remove:
            agent.process_requested_deletions()
            remove.assert_not_called()
            self.assertIn('delete_requested_at=NULL',db.call_args_list[-1][0][0])

    def test_old_backup_deletion_request_is_processed(self):
        t=target()
        item=dict(t,fileName='remnadrop-20261120T111111-fba5f8d2.dump')
        history=[
            {'id':t['runId'],'fileName':item['fileName']},
            {'id':'1bd9e101-9916-498f-9647-62bd64c0cbe9','fileName':'remnadrop-20261120T121212-62bd64c0.dump'},
        ]
        with mock.patch.object(agent,'db_sql',side_effect=[json.dumps([item]),'']) as db, \
             mock.patch.object(agent,'records',return_value=history), \
             mock.patch.object(agent,'remove_archive') as remove:
            agent.process_requested_deletions()
            remove.assert_called_once_with(item,history[0])
            self.assertIn('delete_requested_at=NULL',db.call_args_list[-1][0][0])

    def test_archive_size_must_fit_cap(self):
        with mock.patch.object(agent,'records',return_value=[]),mock.patch.object(agent,'usage_bytes',return_value=0):
            with self.assertRaisesRegex(RuntimeError,'exceeds'): agent.purge(target(),111)
    def test_local_usage_only_counts_managed_dump_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(agent,'BASE',Path(tmp)):
                path=agent.safe_target_path(target())
                (path/'test.dump').write_bytes(b'abc')
                (path/'untracked.txt').write_bytes(b'12345678')
                self.assertEqual(agent.usage_bytes(target()),3)


if __name__ == '__main__':
    main()
