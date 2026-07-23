# Daily apt upgrade

System-level systemd timer that runs once per day:

- `apt update`
- `apt full-upgrade -y`

## Install

```bash
sudo /home/kocsihor/code/github/refactored-giggle/daily-apt-upgrade/install.sh
```

## Manual run

```bash
sudo systemctl start daily-apt-upgrade.service
```

## Uninstall

```bash
sudo systemctl disable --now daily-apt-upgrade.timer
sudo rm -f /etc/systemd/system/daily-apt-upgrade.{service,timer}
sudo rm -rf /usr/local/share/doc/daily-apt-upgrade
sudo systemctl daemon-reload
```
