# Развёртывание в Dokploy

## Настройки сервиса

- Provider: GitHub
- Repository: `cmetanagames-beep/ProverkaSklad`
- Branch: `main`
- Build Type: `Dockerfile`
- Dockerfile: `Dockerfile`
- Docker Context: `.`
- Container Port: `8787`
- Domain: `proverka.akfixdev.ru`
- HTTPS: включён

## Переменные окружения

Скопируйте перечень из `.env.example`. Обязательно задайте собственные значения для `SESSION_SECRET` и `APP_USERS_JSON`.

После сохранения окружения выполните `Rebuild`. При включённом Autodeploy следующие изменения ветки `main` будут устанавливаться автоматически.

## Проверка

1. Откройте `/health` и убедитесь, что `ok`, `bitrixConfigured` и `telegramConfigured` равны `true`.
2. Откройте домен и войдите тестовым сотрудником.
3. Убедитесь, что список заказов пришёл из Bitrix24.
4. Выполните тестовую проверку на отдельном тестовом заказе.

