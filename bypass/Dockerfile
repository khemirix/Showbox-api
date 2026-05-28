FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

USER root
RUN apt-get update && apt-get install -y \
    software-properties-common \
    python3-pip \
    python3-venv \
    wget \
    gnupg \
    curl \
    xvfb \
    libgtk-3-0 \
    libxss1 \
    libxtst6 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgdk-pixbuf-2.0-0 \
    libdbus-glib-1-2 \
    libxt6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrender1 \
    libxi6 \
    fonts-liberation \
    libnss3 \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN chown -R nobody:nogroup /app
USER nobody

RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r server_requirements.txt

RUN camoufox fetch

USER root
RUN chmod -R 777 /app/venv/lib/python*/site-packages/playwright_captcha/utils/camoufox_add_init_script/addon/ || true

USER nobody

ENV PORT=8000

CMD python3 server.py --host 0.0.0.0 --port ${PORT}
