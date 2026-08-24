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


def asset_url(repo: str, version: str, filename: str) -> str:
    return f"https://github.com/{repo}/releases/download/v{version}/{filename}"


def md_link(label: str, url: str) -> str:
    return f"[{label}]({url})"


def downloads_section(version: str, repo: str) -> list[str]:
    def file_link(label: str, filename: str) -> str:
        return md_link(label, asset_url(repo, version, filename))

    windows = file_link("64-bit", f"memoir_{version}_x64-setup.exe")
    mac_apple = file_link("Apple Silicon", f"memoir_{version}_aarch64.dmg")
    mac_intel = file_link("Intel", f"memoir_{version}_x64.dmg")
    deb_name = f"memoir_{version}_amd64.deb"
    rpm_name = f"memoir-{version}-1.x86_64.rpm"
    linux_deb = file_link("64-bit", deb_name)
    linux_rpm = file_link("64-bit", rpm_name)

    return [
        "## Downloads",
        "",
        "### Windows (Windows 10+)",
        "",
        f"- {windows}",
        "",
        "### macOS",
        "",
        f"- {mac_apple} | {mac_intel}",
        "",
        "### Linux",
        "",
        "DEB (Debian / Ubuntu) — `sudo apt install ./path`",
        "",
        f"- {linux_deb}",
        "",
        "RPM (Fedora / RHEL) — `sudo dnf install ./path`",
        "",
        f"- {linux_rpm}",
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
    lines.extend(downloads_section(version, repo))
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
    repo = "Memoir-Studio/Memoir"
    body = build_body(
        "0.1.9",
        "v0.1.8",
        [
            "feat(layout): drag to resize the sidebar",
            "fix(sync): bust dir cache",
        ],
        repo,
    )
    assert body.startswith("## What's Changed\n")
    assert "- feat(layout): drag to resize the sidebar" in body
    assert "- fix(sync): bust dir cache" in body
    assert "compare/v0.1.8...v0.1.9" in body
    assert "## Downloads" in body
    assert "See the assets to download this version and install." not in body
    assert "更新内容" not in body
    prefix = f"https://github.com/{repo}/releases/download/v0.1.9"
    assert f"[64-bit]({prefix}/memoir_0.1.9_x64-setup.exe)" in body
    assert f"[Apple Silicon]({prefix}/memoir_0.1.9_aarch64.dmg)" in body
    assert f"[Intel]({prefix}/memoir_0.1.9_x64.dmg)" in body
    assert f"[64-bit]({prefix}/memoir_0.1.9_amd64.deb)" in body
    assert f"[64-bit]({prefix}/memoir-0.1.9-1.x86_64.rpm)" in body
    empty = build_body("0.1.0", "", [], repo)
    assert "- No user-facing commits since the previous version." in empty
    assert "Full Changelog" not in empty
    assert "## Downloads" in empty
    assert "memoir_0.1.0_x64-setup.exe" in empty
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
