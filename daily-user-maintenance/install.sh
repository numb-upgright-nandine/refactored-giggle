#!/usr/bin/env bash
# Install daily user maintenance timer (run as your user, not root).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    echo "Run as your user, not root: $0" >&2
    exit 1
fi

install -d "$USER_SYSTEMD_DIR"
install -d "$HOME/.local/share/doc/daily-user-maintenance"

install -m 0644 "$SCRIPT_DIR/systemd/daily-user-maintenance.service" "$USER_SYSTEMD_DIR/"
install -m 0644 "$SCRIPT_DIR/systemd/daily-user-maintenance.timer" "$USER_SYSTEMD_DIR/"
install -m 0644 "$SCRIPT_DIR/README.md" "$HOME/.local/share/doc/daily-user-maintenance/"

systemctl --user daemon-reload
systemctl --user enable --now daily-user-maintenance.timer

echo
echo "Installed. Timer status:"
systemctl --user status daily-user-maintenance.timer --no-pager || true
echo
echo "Next run:"
systemctl --user list-timers daily-user-maintenance.timer --no-pager || true
echo
echo "Run once now:  systemctl --user start daily-user-maintenance.service"
echo "View logs:     journalctl --user -u daily-user-maintenance.service"
