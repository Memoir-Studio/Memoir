#!/usr/bin/env python3
"""Build a GitHub release body from commit subjects since the previous version tag."""

from __future__ import annotations

import os
import re
import subprocess
import sys

BUMP_RE = re.compile(r"^chore: bump version to \d+\.\d+\.\d+$")


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True, encoding="utf-8")


def cargo_version(path: str = "src-tauri/Cargo.toml") -> str:
    text = open(path, encoding="utf-8").read()
    match = re.search(r'(?m)^version = "([^"]+)"', text)
    if not match:
        raise SystemExit(f"Could not read version from {path}")
    return match.group(1)


def previous_tag(version: str) -> str:
    tags = git(
        "tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"
    ).splitlines()
    return next((tag for tag in tags if tag != f"v{version}"), "")


def commit_subjects(log_range: str) -> list[str]:
    return [
        line
        for line in git(
            "log", log_range, "--pretty=tformat:%s", "--no-merges"
        ).splitlines()
        if line and not BUMP_RE.match(line)
    ]


def build_body(version: str, previous: str, subjects: list[str], repo: str) -> str:
    lines = ["## What's Changed", ""]
    if subjects:
        lines.extend(f"- {subject}" for subject in subjects)
    else:
        lines.append("- No user-facing commits since the previous version.")
    lines.append("")
    if previous:
        lines.append(
            f"**Full Changelog**: https://github.com/{repo}/compare/{previous}...v{version}"
        )
        lines.append("")
    lines.append("See the assets to download this version and install.")
    return "\n".join(lines) + "\n"


def write_output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"{name}<<CHANGELOG_EOF\n")
        fh.write(value)
        if value and not value.endswith("\n"):
            fh.write("\n")
        fh.write("CHANGELOG_EOF\n")


def self_test() -> None:
    body = build_body(
        "0.1.9",
        "v0.1.8",
        [
            "feat(layout): drag to resize the sidebar",
            "fix(sync): bust dir cache",
        ],
        "Memoir-Studio/Memoir",
    )
    assert body.startswith("## What's Changed\n")
    assert "- feat(layout): drag to resize the sidebar" in body
    assert "- fix(sync): bust dir cache" in body
    assert "compare/v0.1.8...v0.1.9" in body
    assert "See the assets to download this version and install." in body
    assert "更新内容" not in body
    empty = build_body("0.1.0", "", [], "Memoir-Studio/Memoir")
    assert "- No user-facing commits since the previous version." in empty
    assert "Full Changelog" not in empty
    print("self-test ok")


def main() -> None:
    if os.environ.get("DRAFT", "true").lower() != "true":
        write_output("body", "")
        return

    version = cargo_version()
    previous = previous_tag(version)
    log_range = f"{previous}..HEAD" if previous else "HEAD"
    repo = os.environ.get("GITHUB_REPOSITORY", "Memoir-Studio/Memoir")
    body = build_body(version, previous, commit_subjects(log_range), repo)
    print(body)
    write_output("body", body)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        main()
