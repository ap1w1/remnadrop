#!/usr/bin/env python3
"""Normalize Linux COMPOSE_FILE lists without sorting their override order."""

from __future__ import annotations

import argparse


def normalize_compose_files(
    value: str, append: str | None = None, managed: str | None = None
) -> str:
    paths = [part.strip() for part in value.split(":") if part.strip()]
    managed_path = append if append is not None else managed
    if managed_path is not None:
        managed_path = managed_path.strip()
        if not managed_path or any(char in managed_path for char in ":\n\r"):
            raise ValueError("The managed Compose path must be one non-empty path")
        if append is not None:
            paths = [path for path in paths if path != managed_path]
            paths.append(managed_path)
        elif managed_path in paths:
            last = len(paths) - 1 - paths[::-1].index(managed_path)
            paths = [
                path for index, path in enumerate(paths)
                if path != managed_path or index == last
            ]

    # Only the updater-owned override is deduplicated. Repeated custom files
    # may deliberately affect Compose's merge semantics and must be preserved.
    if not paths:
        raise ValueError("Compose configuration list is empty")
    if any("\n" in path or "\r" in path for path in paths):
        raise ValueError("Compose paths cannot contain embedded line breaks")
    return ":".join(paths)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", help="Colon-separated COMPOSE_FILE value")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--managed", help="Collapse this managed override at its last position")
    mode.add_argument("--append", help="Ensure this managed override occurs once, last")
    args = parser.parse_args()
    try:
        print(normalize_compose_files(args.files, args.append, args.managed))
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
