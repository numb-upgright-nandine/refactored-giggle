# Daily user maintenance

User-level systemd timer that runs once per day:

- `pi update --extensions`
- `brew upgrade` (skipping cleanup of `pi-coding-agent`)
- `brew autoremove` and `brew cleanup --prune=all`
- `flatpak uninstall --unused`

## Install

```bash
/home/kocsihor/code/github/refactored-giggle/daily-user-maintenance/install.sh
```

## Manual run

```bash
systemctl --user start daily-user-maintenance.service
```

## Uninstall

```bash
systemctl --user disable --now daily-user-maintenance.timer
rm -f ~/.config/systemd/user/daily-user-maintenance.{service,timer}
rm -rf ~/.local/share/doc/daily-user-maintenance
systemctl --user daemon-reload
```
