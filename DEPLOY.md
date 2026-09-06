# Развёртывание Word Trainer (Docker)

Приложение **Tech English Trainer**: статический сайт + сервер (`server.py`, Python
стандартная библиотека). Данные живут в `data.json`, аудио в `audio/`, логи в `logs/`.
Docker-образ изолирует код в `/app`, а все изменяемые данные хранит в volume `/data`
(подключён через `WORD_STORE=/data`).

---

## 1. Состав

| Файл                  | Назначение |
|-----------------------|------------|
| `Dockerfile`          | Образ на базе `python:3.12-slim` |
| `docker-entrypoint.sh`| При первом старте создаёт пустой `data.json` в хранилище (из `data.example.json`) и запускает сервер |
| `docker-compose.yml`  | Готовый запуск: порт 8000, volume `wordtrainer_data:/data` |
| `.dockerignore`       | Исключает мусор и локальные данные из образа |
| `server.py`           | Сервер (учитывает env: `HOST`, `PORT`, `WORD_STORE`, `FISH_*`) |

Переменные окружения сервера:

- `HOST` — адрес привязки (в контейнере `0.0.0.0`, локально по умолчанию `127.0.0.1`);
- `PORT` — порт (по умолчанию 8000);
- `WORD_STORE` — каталог хранения `data.json`, `audio/`, `logs/`;
- `FISH_API_KEY`, `FISH_MODEL`, `FISH_REFERENCE_ID` — опциональный ключ fish.audio
  (загружаются из `.env`, см. `.env.example`).

---

## 2. Локальный запуск (Docker Desktop / Docker Engine)

Перед запуском создайте файл переменных из шаблона и заполните ключи:

```bash
cp .env.example .env      # затем отредактируйте .env (fish.audio, OPENAI_API_KEY)
```

```bash
cd word-trainer
docker compose up -d --build
docker compose ps
```

Без Docker (напрямую Python):

```bash
python -m pip install -r requirements.txt
cp .env.example .env      # заполнить ключи
python server.py          # http://127.0.0.1:8000
```

Открыть: http://127.0.0.1:8000

Остановка/перезапуск:

```bash
docker compose down          # остановить (данные в volume сохранятся)
docker compose up -d         # снова поднять
docker compose logs -f       # смотреть логи контейнера
```

Без Compose:

```bash
docker build -t wordtrainer .
docker run -d --name wordtrainer -p 8000:8000 \
  -v wordtrainer_data:/data \
  -e WORD_STORE=/data -e HOST=0.0.0.0 -e PORT=8000 \
  wordtrainer
```

> Внутри контейнера данные (словарь, аудио, логи) лежат в `/data`.
> При первом старте туда копируется `data.json` из образа.

---

## 3. Развёртывание на виртуальном сервере (VPS, Ubuntu)

### 3.1. Установка Docker

```bash
sudo apt update && sudo apt install -y ca-certificates curl
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER          # чтобы не писать sudo каждый раз
# перелогиниться (или выполнить: newgrp docker)
sudo systemctl enable --now docker
docker --version
```

### 3.2. Копирование проекта на сервер

Через `git` (если репозиторий) или `scp`:

```bash
# вариант scp с локальной машины:
scp -r word-trainer user@SERVER_IP:/opt/word-trainer

# или на сервере из git:
git clone <url-репозитория> /opt/word-trainer
```

### 3.3. Запуск

```bash
cd /opt/word-trainer
docker compose up -d --build
docker compose ps
```

Проверка на самом сервере:

```bash
curl -I http://127.0.0.1:8000/          # должен вернуть 200
curl http://127.0.0.1:8000/api/words | head -c 200
```

### 3.4. Открытие порта в файрволе (UFW)

```bash
sudo ufw allow 8000/tcp
sudo ufw enable
sudo ufw status
```

После этого сайт доступен по `http://<IP_сервера>:8000`.

> Безопасность: у приложения есть операции удаления слов и записи в файл.
> Для публичного доступа обязательно закройте сервис **basic-аутентификацией** через
> reverse-proxy (см. раздел 4) или ограничьте порт доступом по IP.

---

## 4. Домен + HTTPS (reverse proxy)

Рекомендуется за прокси: `127.0.0.1:8000` (внутри контейнера — `container:8000`).

### 4.1. Caddy (проще всего, авто-HTTPS)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
words.example.com {
    reverse_proxy 127.0.0.1:8000

    # простая защита паролем (опционально)
    # basicauth {
    #     user $2a$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # хеш: caddy hash-password
    # }
}
```

```bash
sudo systemctl restart caddy
```

### 4.2. Nginx (пример)

```nginx
server {
    listen 80;
    server_name words.example.com;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name words.example.com;

    ssl_certificate     /etc/letsencrypt/live/words.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/words.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo certbot --nginx -d words.example.com
```

---

## 5. Резервное копирование и восстановление

Все данные — в volume `wordtrainer_data` (каталог `/data` внутри контейнера).

Бэкап (создаёт архив в текущей папке):

```bash
docker run --rm -v wordtrainer_data:/data -v "$PWD":/backup \
  alpine tar czf /backup/words-backup-$(date +%F).tar.gz -C /data .
```

Восстановление:

```bash
docker run --rm -v wordtrainer_data:/data -v "$PWD":/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/words-backup-ДАТА.tar.gz -C /data"
docker restart wordtrainer
```

Внутри архива: `data.json`, `audio/*.mp3`, `logs/requests.log`.

---

## 6. Обновление версии

```bash
cd /opt/word-trainer
git pull            # если проект из git (или повторно скопировать файлы)
docker compose up -d --build
```

Данные в volume не затрагиваются; при необходимости сделайте бэкап (раздел 5).

---

## 7. Логи и диагностика

- Логи процесса контейнера: `docker compose logs -f`
- Файловый лог запросов (внутри volume): `logs/requests.log`
- Просмотр файлового лога:
  ```bash
  docker run --rm -v wordtrainer_data:/data alpine tail -n 50 /data/logs/requests.log
  ```

---

## 8. Важные замечания по функциональности

### 8.1. Озвучка через fish.audio (внешний сервис)
- Сервер должен иметь доступ в интернет к `https://api.fish.audio` (исходящие соединения).
- Ключ задаётся в `.env` \(переменная `FISH_API_KEY`\) или через env при запуске.
- Если fish.audio недоступен, слова всё равно сохраняются (без аудио), а в
  `logs/requests.log` фиксируются ошибки `external_request`.

### 8.2. Генерация карточек через Ollama
- Кнопка «Сгенерировать» в браузере обращается **к Ollama клиента** по адресу
  из настроек (по умолчанию `http://127.0.0.1:11434`). На удалённом сервере это
  не сработает из чужого браузера: `localhost` там — машина пользователя.
- Варианты для серверного развёртывания:
  - установить Ollama на том же VPS (`curl -fsSL https://ollama.com/install.sh | sh`,
    `ollama pull gemma3:4b`), в настройках сайта указать
    `http://<IP_сервера>:11434` и запустить Ollama с разрешённым origin:
    ```
    OLLAMA_ORIGINS="https://words.example.com" ollama serve
    ```
    (порт 11434 открыть только для нужного origin / за прокси);
  - либо использовать генерацию локально у себя, а на сервере пользоваться
    словарём, повторением и тестами.

### 8.3. Ресурсы
- Приложение лёгкое (Python stdlib). VPS с 512 МБ–1 ГБ ОЗУ достаточно,
  если Ollama не разворачивается на нём.
- При развёртывании Ollama рядом требуется больше памяти (4b-модель — от 4–6 ГБ
  свободной ОЗУ); при нехватке ресурсов уменьшайте `num_ctx` в настройках сайта.

---

## 9. Быстрая проверка после развёртывания

1. Открыть сайт — виден словарь (пустой словарь — слова добавляются через сайт или копированием своего `data.json` в volume).
2. Вкладка «Повторение» — запустить набор 10 слов.
3. Вкладка «Тест» — пройти тест.
4. «＋ Добавить» → ввести слово → «Сгенерировать через Ollama» (если настроена
   Ollama) или заполнить вручную → «Сохранить в словарь» — слово появится в
   `data.json` (volume), счётчик увеличится.
5. 🔊 слова — воспроизводится mp3 (если fish.audio доступен) либо системный синтез.
