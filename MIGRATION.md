# Перенос Durak App на новую площадку

Пошаговая инструкция для развёртывания проекта с нуля на новом сервере и переноса
существующей базы (пользователи, игры, рейтинги) и загруженных файлов (аватары,
рубашки карт).

Весь стек поднимается через Docker Compose: **Postgres 16 + Redis 7 + API (NestJS) +
Web + Nginx**. Схема БД создаётся автоматически Prisma-миграциями при старте API,
поэтому переносить нужно только **данные** — из готового дампа.

---

## 0. Что вам должны прислать отдельно

Три файла с бэкапом (их нет в git — там персональные данные):

| Файл | Что это |
|---|---|
| `durak_YYYYMMDD.dump` | дамп Postgres (custom-формат, для `pg_restore`) — **основной** |
| `durak_YYYYMMDD.sql` | тот же дамп в виде обычного SQL — запасной вариант |
| `uploads_YYYYMMDD.tgz` | архив загруженных файлов (аватары/рубашки) |

Положите их в любую папку на сервере, например `~/durak-backup/`.

---

## 1. Предварительные требования на сервере

- Docker + Docker Compose v2 (`docker compose version` должно работать)
- git
- SSH-доступ к серверу

```bash
docker --version
docker compose version
git --version
```

---

## 2. Получить репозиторий

```bash
git clone git@github.com:Ryzhikoff/durak-app.git
cd durak-app
```

Если SSH-ключ на сервере не настроен — по HTTPS:

```bash
git clone https://github.com/Ryzhikoff/durak-app.git
cd durak-app
```

---

## 3. Настроить `.env`

```bash
cp .env.example .env
```

Отредактируйте `.env` (`nano .env`) — обязательно поменяйте:

```ini
# Сгенерировать: openssl rand -base64 48
SESSION_SECRET=<длинная случайная строка>

# Пароль БД — задайте свой (влияет на DATABASE_URL внутри compose автоматически)
POSTGRES_PASSWORD=<надёжный пароль>

# Если сервер за HTTPS:
COOKIE_SECURE=true

# На каком порту хоста слушать (80 по умолчанию). Если 80 занят — например 8080:
HTTP_PORT=80
```

> ⚠️ Пароль БД в `.env` (`POSTGRES_PASSWORD`) должен быть задан **до** первого старта
> Postgres — иначе том инициализируется со старым паролем `durak`.

---

## 4. Поднять ТОЛЬКО Postgres (порядок важен!)

Сначала поднимаем базу отдельно и заливаем в неё дамп — **до** старта API.
Если запустить весь стек сразу, API создаст пустые таблицы миграциями, и restore
дампа упадёт с ошибками «relation already exists».

```bash
docker compose -f docker/docker-compose.yml up -d postgres
```

Дождитесь готовности (статус `healthy`):

```bash
docker compose -f docker/docker-compose.yml ps
```

---

## 5. Восстановить базу из дампа

Подставьте свой путь к файлу бэкапа. **Основной способ — custom-дамп:**

```bash
docker exec -i durak-postgres-1 \
  pg_restore -U durak -d durak --no-owner --no-privileges \
  < ~/durak-backup/durak_YYYYMMDD.dump
```

Возможны безобидные NOTICE/warning — это нормально. Если `pg_restore` по какой-то
причине не подходит, используйте запасной SQL-дамп:

```bash
docker exec -i durak-postgres-1 \
  psql -U durak -d durak \
  < ~/durak-backup/durak_YYYYMMDD.sql
```

**Проверка, что данные на месте:**

```bash
docker exec durak-postgres-1 psql -U durak -d durak -c \
"SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"
```

Ожидаемо увидите строки в `User`, `Game`, `GameParticipant`, `RatingHistory` и т.д.

---

## 6. Восстановить загруженные файлы (аватары/рубашки)

Файлы лежат в docker-томе `durak_api_uploads`. Распакуйте туда архив:

```bash
docker run --rm \
  -v durak_api_uploads:/data \
  -v ~/durak-backup:/backup \
  alpine sh -c "tar xzf /backup/uploads_YYYYMMDD.tgz -C /data"
```

Проверка:

```bash
docker run --rm -v durak_api_uploads:/data alpine ls -la /data
```

---

## 7. Поднять весь стек

Теперь запускаем всё. API при старте выполнит `prisma migrate deploy` — увидит, что
все миграции уже применены (они пришли в дампе, таблица `_prisma_migrations`), и
ничего не пересоздаст.

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Статус всех сервисов:

```bash
docker compose -f docker/docker-compose.yml ps
```

Должны быть `healthy`/`running`: postgres, redis, api, web, nginx.

---

## 8. Проверить, что работает

```bash
# health API (через nginx; замените порт, если HTTP_PORT не 80)
curl http://localhost/api/health

# логи API, если что-то не так
docker compose -f docker/docker-compose.yml logs -f api
```

Откройте сайт в браузере: `http://<адрес-сервера>:<HTTP_PORT>/`
Войдите под существующим логином/паролем из старой базы — учётки перенеслись.

---

## Полезное

**Остановить стек:**
```bash
docker compose -f docker/docker-compose.yml down
```

**Полный сброс БД (если restore пошёл криво и надо начать заново):**
```bash
docker compose -f docker/docker-compose.yml down
docker volume rm durak_postgres_data
# затем снова с шага 4
```

**Первый администратор** уже есть в перенесённой базе — bootstrap-эндпоинт
(`POST /api/admin/setup`) работает только при нуле админов, так что он не понадобится.

**Обновление кода в будущем:**
```bash
git pull
docker compose -f docker/docker-compose.yml up -d --build
```
