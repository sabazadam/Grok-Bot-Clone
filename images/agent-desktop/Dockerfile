# GrokBot agent desktop — the OS each agent owns and operates.
# Multi-arch (arm64 for Apple Silicon Mac mini, amd64 for CI/dev).
# Debian is used (not Ubuntu) so Chromium installs as a real .deb on both arches.
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    # display + window manager + panel
    xvfb x11vnc openbox tint2 xterm \
    # noVNC browser-embeddable remote view
    novnc websockify \
    # input + screenshot + window tooling for the actuator
    xdotool scrot x11-utils x11-xserver-utils procps \
    # apps the agent uses
    chromium fonts-dejavu fonts-liberation fonts-liberation2 fonts-noto-core fonts-noto-color-emoji tzdata \
    # file manager + editor niceties
    pcmanfm mousepad \
    # actuator runtime + process supervisor
    python3 supervisor \
    ca-certificates curl sudo locales \
    && rm -rf /var/lib/apt/lists/*

RUN sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8

# Non-root agent user (mirrors Grok Bot: "The Bot runs as a non-root user")
RUN useradd -m -s /bin/bash -u 1001 agent && \
    mkdir -p /home/agent/workspace /home/agent/.config/openbox /home/agent/.config/tint2 && \
    chown -R agent:agent /home/agent

# Stealth browser assets + wrappers (see config/browser scripts and stealth-ext/)
COPY stealth-ext/ /opt/grokbot-stealth/
COPY config/browser /usr/local/bin/browser
COPY config/browser-plain /usr/local/bin/browser-plain
RUN chmod +x /usr/local/bin/browser /usr/local/bin/browser-plain

COPY --chown=agent:agent config/openbox-rc.xml /home/agent/.config/openbox/rc.xml
COPY --chown=agent:agent config/openbox-menu.xml /home/agent/.config/openbox/menu.xml
COPY --chown=agent:agent config/tint2rc /home/agent/.config/tint2/tint2rc
COPY --chown=agent:agent config/desktop-files/ /usr/share/applications/grokbot/
COPY config/openbox-rc.xml /usr/share/applications/grokbot/rc.xml.default
COPY actuator/actuator.py /opt/actuator/actuator.py
COPY config/supervisord.conf /etc/supervisor/supervisord.conf
COPY config/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV DISPLAY=:0 \
    RESOLUTION=1280x800 \
    NOVNC_PORT=6080 \
    ACTUATOR_PORT=8090

EXPOSE 6080 8090

WORKDIR /home/agent
ENTRYPOINT ["/entrypoint.sh"]
