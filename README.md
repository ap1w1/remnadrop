# RemnaDrop

Private development repository for the Remnawave 2.8.1 fork.

**Status:** Source import not yet completed. The repository contains a secure VPS import helper. The full application code will appear after the import command finishes.

## Import source code from a VPS

The full source ZIP can be copied to the server and imported into this repository without sharing a GitHub token in chat. See [scripts/import-vps.sh](scripts/import-vps.sh).

```bash
# Authenticate your VPS with GitHub interactively (one time)
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git

# Clone the private repository
git clone https://github.com/ap1w1/remnadrop.git /opt/remnadrop-git

# Import the locally available source directory
bash /opt/remnadrop-git/scripts/import-vps.sh /opt/panel-build/rework-20261120/remnadrop-updated

# Or import the newest ZIP that you copied to the VPS
bash /opt/remnadrop-git/scripts/import-vps.sh /root/remnadrop-source.zip
```

Do not upload runtime `.env` files, secrets, private keys, database dumps, or `node_modules`. The import script excludes these and checks staged file names. Review the diff before any production use.

## Deployment

This is a **test fork**. Building or importing source code is not the same as deploying it. Back up PostgreSQL and the currently running container before applying schema migrations; see `INSTALL.md` and `MIGRATION.md` after source import.
