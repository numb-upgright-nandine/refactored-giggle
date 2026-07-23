#!/usr/bin/env bash
# Install daily apt upgrade timer (requires root).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Run as root: sudo $0" >&2
    exit 1
fi

install -d /usr/local/share/doc/daily-apt-upgrade

install -m 0644 "$SCRIPT_DIR/systemd/daily-apt-upgrade.service" /etc/systemd/system/
install -m 0644 "$SCRIPT_DIR/systemd/daily-apt-upgrade.timer" /etc/systemd/system/
install -m 0644 "$SCRIPT_DIR/README.md" /usr/local/share/doc/daily-apt-upgrade/

systemctl daemon-reload
systemctl enable --now daily-apt-upgrade.timer

echo
echo "Installed. Timer status:"
systemctl status daily-apt-upgrade.timer --no-pager || true
echo
echo "Next run:"
systemctl list-timers daily-apt-upgrade.timer --no-pager || true
echo
echo "Run once now:  sudo systemctl start daily-apt-upgrade.service"
echo "View logs:     journalctl -u daily-apt-upgrade.service"
