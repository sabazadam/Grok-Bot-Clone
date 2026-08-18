#!/bin/bash
set -e

# Home may be a fresh named volume (docker copies image contents into empty named
# volumes, but be defensive if it was created another way).
mkdir -p /home/agent/workspace /home/agent/.config/openbox /home/agent/.config/tint2
if [ ! -f /home/agent/.config/openbox/rc.xml ] && [ -f /usr/share/applications/grokbot/rc.xml.default ]; then
  cp /usr/share/applications/grokbot/rc.xml.default /home/agent/.config/openbox/rc.xml
fi
chown -R agent:agent /home/agent

# Neutral desktop background once X is up (best effort, in background)
(
  for i in $(seq 1 30); do
    if DISPLAY=:0 xdpyinfo >/dev/null 2>&1; then
      DISPLAY=:0 xsetroot -solid "#2e3440" || true
      break
    fi
    sleep 1
  done
) &

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
