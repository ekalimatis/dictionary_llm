FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /data

ENV WORD_STORE=/data \
    HOST=0.0.0.0 \
    PORT=8000

VOLUME ["/data"]

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
