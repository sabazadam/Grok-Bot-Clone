# Optional v2 adapter: full Linux desktop per Bot.
# v1 uses the in-process Forge OS. This image is the swap-in
# when the host can run Docker (XFCE + noVNC).
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    xfce4 \
    xfce4-terminal \
    firefox-esr \
    tigervnc-standalone-server \
    novnc \
    websockify \
    python3 \
    xdotool \
    scrot \
    && rm -rf /var/lib/apt/lists/*

ENV DISPLAY=:1
EXPOSE 6080
CMD ["bash", "-lc", "vncserver :1 -geometry 1280x720 -depth 24 && websockify --web=/usr/share/novnc 6080 localhost:5901"]
