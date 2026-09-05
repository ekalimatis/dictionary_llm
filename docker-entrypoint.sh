#!/bin/sh
set -e

# Каталог для данных приложения (data.json, audio, logs)
STORE="${WORD_STORE:-/data}"
mkdir -p "$STORE/audio" "$STORE/logs"

# При первом запуске (пустой volume) — создать пустой словарь
if [ ! -f "$STORE/data.json" ]; then
  echo "==> data.json не найден, создаю пустой словарь"
  if [ -f /app/data.example.json ]; then
    cp /app/data.example.json "$STORE/data.json"
  else
    echo "[]" > "$STORE/data.json"
  fi
fi

export WORD_STORE="$STORE"
echo "==> Хранилище данных: $STORE"
exec python /app/server.py
