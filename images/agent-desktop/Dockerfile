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
    # input + screenshot + window/clipboard tooling for the actuator
    xdotool scrot x11-utils x11-xserver-utils procps wmctrl xclip \
    # apps the agent uses
    chromium fonts-dejavu fonts-liberation fonts-liberation2 fonts-noto-core fonts-noto-color-emoji fonts-noto-cjk fonts-noto-extra tzdata \
    # tooling agents commonly need (git for repos, unzip already below)
    git \
    # file manager + editor niceties
    pcmanfm mousepad \
    # actuator runtime + process supervisor
    python3 supervisor \
    ca-certificates curl sudo locales unzip \
    # Firefox/Camoufox runtime libs not already pulled in by Chromium's dependency closure
    libdbus-glib-1-2 libxt6 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# ── Camoufox (engine-level anti-detect browser) ───────────────────────────
# Installed by default (per product decision). Set --build-arg INSTALL_CAMOUFOX=0 to skip it for
# offline / constrained CI builds; the browser wrapper then falls back to Chromium at runtime.
# Bump CAMOUFOX_VERSION/CAMOUFOX_RELEASE to track upstream releases (daijro/camoufox).
ARG INSTALL_CAMOUFOX=1
ARG CAMOUFOX_VERSION=135.0.1
ARG CAMOUFOX_RELEASE=beta.24
ARG TARGETARCH
RUN if [ "$INSTALL_CAMOUFOX" = "1" ]; then \
      set -eux; \
      arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
      case "$arch" in \
        amd64|x86_64) cfarch="x86_64" ;; \
        arm64|aarch64) cfarch="arm64" ;; \
        *) echo "unsupported arch for Camoufox: $arch" >&2; exit 1 ;; \
      esac; \
      url="https://github.com/daijro/camoufox/releases/download/v${CAMOUFOX_VERSION}-${CAMOUFOX_RELEASE}/camoufox-${CAMOUFOX_VERSION}-${CAMOUFOX_RELEASE}-lin.${cfarch}.zip"; \
      echo "Downloading Camoufox: $url"; \
      mkdir -p /opt/camoufox; \
      curl -fL --retry 3 -o /tmp/camoufox.zip "$url"; \
      unzip -q /tmp/camoufox.zip -d /opt/camoufox; \
      rm -f /tmp/camoufox.zip; \
      if [ ! -x /opt/camoufox/camoufox-bin ] && [ -f /opt/camoufox/camoufox-bin ]; then chmod +x /opt/camoufox/camoufox-bin; fi; \
      test -f /opt/camoufox/camoufox-bin || (echo "camoufox-bin missing after unzip" >&2; ls -la /opt/camoufox; exit 1); \
      chmod +x /opt/camoufox/camoufox-bin; \
    else \
      echo "Skipping Camoufox install (INSTALL_CAMOUFOX=0)"; \
    fi

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
