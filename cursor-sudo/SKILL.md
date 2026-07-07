---
name: cursor-sudo
description: Run /sudo-auth before sudo shell commands when using the Cursor SDK provider. Use when tasks need root privileges, apt/dnf/pacman installs, systemctl, docker group setup, or any shell command containing sudo with cursor/composer models.
---

# Sudo with Cursor SDK

The `auth-with-sudo` extension intercepts pi's native `bash` tool automatically. **Cursor SDK shell tools bypass that hook** — they run in Cursor's host Shell tool instead.

## Before any sudo shell command

1. Check whether credentials are likely still cached (within ~5 minutes of the last `/sudo-auth`).
2. If unsure, run **`/sudo-auth`** first and wait for the password prompt to succeed.
3. Then run the sudo shell command normally.

## Reactive recovery

If a Cursor shell command fails with sudo auth errors (`a terminal is required`, `a password is required`, etc.), the extension automatically re-prompts for your password and appends a retry note to the tool result. **Retry the same sudo command** after you see `[auth-with-sudo] Credentials primed`.

## Do not

- Pipe passwords inline (`echo … | sudo -S`) — the extension manages credentials.
- Ask the user to run `/sudo-auth` manually unless the prompt failed or was cancelled.

## Manual commands

- `/sudo-auth` — prime sudo for Cursor SDK and pi shell (cached ~5 min)
- `/sudo-lock` — clear cached credentials
