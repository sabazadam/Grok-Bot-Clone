FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc openbox xterm chromium \
    xdotool scrot x11-utils x11-xserver-utils \
    python3 ca-certificates curl wget nano less procps \
    fonts-dejavu fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash agent \
    && mkdir -p /home/agent/workspace \
    && chown -R agent:agent /home/agent

COPY start.sh /usr/local/bin/start.sh
COPY actiond.py /usr/local/bin/actiond.py
COPY browser /usr/local/bin/browser
RUN chmod 755 /usr/local/bin/start.sh /usr/local/bin/browser /usr/local/bin/actiond.py

USER agent
WORKDIR /home/agent
ENV DISPLAY=:0
ENV SCREEN_GEOMETRY=1280x800x24

# 5900 = VNC (x11vnc), 39990 = action daemon
EXPOSE 5900 39990

CMD ["/usr/local/bin/start.sh"]
