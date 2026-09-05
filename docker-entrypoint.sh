#!/bin/sh
set -e

# Каталог для данных приложения (data.json, audio, logs)
STORE="${WORD_STORE:-/data}"
mkdir -p "$STORE/audio" "$STORE/logs"

# При первом запуске (пустой volume) — скопировать начальный словарь
if [ ! -f "$STORE/data.json" ]; then
  echo "==> data.json не найден, копирую шаблон из образа"
  cp /app/data.json "$STORE/data.json"
fi

export WORD_STORE="$STORE"
echo "==> Хранилище данных: $STORE"
exec python /app/server.py
