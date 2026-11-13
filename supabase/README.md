# База расписания (Supabase)

Проект: `qytzszvgikiztjwdvjrw` (https://qytzszvgikiztjwdvjrw.supabase.co).
Старый проект `ysgtxwvlxdjwesswdgvz` принадлежит другому сайту — не трогать.

## Миграции

Файлы в `migrations/` применяются по порядку номеров. Любой способ:

- Supabase MCP: `apply_migration` с содержимым файла;
- SQL Editor в панели Supabase: вставить файл целиком и выполнить;
- CLI: `supabase link --project-ref qytzszvgikiztjwdvjrw && supabase db push`.

Все таблицы закрыты RLS без политик. Сайт и команда работают только через функции
`free_slots`, `create_request`, `team_*`, `head_*` (security definer).

## Тесты

Каждый файл в `tests/` самодостаточен: открывает транзакцию, пишет вывод pgTAP
во временную таблицу, печатает его одной строкой и делает `rollback` — данные в базе не остаются.
Выполнить файл целиком через `execute_sql` или SQL Editor. Тест прошёл, если каждая строка
вывода (кроме `1..N`) начинается с `ok`.

JS-тесты: `node --test tests/*.test.mjs`.
