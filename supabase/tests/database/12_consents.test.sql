-- Согласия (ADR-065, ADR-076): журнал только добавляется, запись идемпотентна, чужие записи не видны,
-- права закрыты, удаление аккаунта фиксирует отзыв. Этап 11.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000c11', 'c11@test.local', '{"user_name":"consent_a"}'),
  ('00000000-0000-4000-8000-000000000c12', 'c12@test.local', '{"user_name":"consent_b"}');

create function pg_temp.as_user(p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$f$;

create temporary table seen (tag text, r jsonb);
grant insert on seen to authenticated;

-- ======================================================= запись при входе
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000c11');
  insert into seen select 'first', public.record_consents('2026-11-05');
  insert into seen select 'again', public.record_consents('2026-11-05');
end $$;
reset role;

-- Вход ничего не создает в public.profiles и кошельках (ADR-075): согласия пишутся и без профиля.
select is((select count(*) from public.profiles where id::text like '00000000-0000-4000-8000-000000000c1%'), 0::bigint,
  'запись согласий при входе профиль не создает');

select ok((select bool_and((r ->> 'ok')::boolean) from seen where tag in ('first', 'again')),
  'record_consents возвращает ok');
select is((select count(*) from public.user_consents where user_id = '00000000-0000-4000-8000-000000000c11'),
  2::bigint, 'вход: две записи (Соглашение и ПДн); повтор ничего не добавляет');
select is((select count(*) from public.user_consents
           where user_id = '00000000-0000-4000-8000-000000000c11' and kind = 'PUBLICATION'),
  0::bigint, 'записей о согласии на публикацию вход не создает (ADR-076)');

-- ======================================================= свои согласия и изоляция
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000c11'); end $$;
select is((select array_agg(kind::text || ':' || granted::text order by kind::text) from public.my_consents()),
  array['PD_PROCESSING:true', 'TERMS_AND_AGE:true'],
  'my_consents: последнее состояние каждого вида');
select is((select count(*) from public.user_consents), 2::bigint, 'владелец видит свои записи');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000c12'); end $$;
select is((select count(*) from public.user_consents), 0::bigint, 'чужие записи согласий не видны');
select is((select count(*) from public.my_consents()), 0::bigint, 'my_consents чужого пользователя пуст');
reset role;

-- ======================================================= новая версия документов
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000c11');
  insert into seen select 'v2', public.record_consents('2026-12-01');
end $$;
reset role;
select is((select count(*) from public.user_consents where user_id = '00000000-0000-4000-8000-000000000c11'),
  4::bigint, 'новая версия документов: Соглашение и ПДн записываются заново');
select is((select doc_version from public.user_consents
           where user_id = '00000000-0000-4000-8000-000000000c11' and kind = 'TERMS_AND_AGE'
           order by created_at desc, id desc limit 1), '2026-12-01', 'последняя запись Соглашения — новой версии');

-- ======================================================= некорректный ввод и лимит
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000c12');
  insert into seen select 'bad', public.record_consents('вчера');
  insert into seen select 'bad-null', public.record_consents(null);
end $$;
reset role;
select is((select array_agg(r ->> 'code' order by tag) from seen where tag in ('bad', 'bad-null')),
  array['INVALID_VERSION', 'INVALID_VERSION'], 'некорректная версия или значение отклоняются ответом');
select is((select count(*) from public.user_consents where user_id = '00000000-0000-4000-8000-000000000c12'),
  0::bigint, 'отклоненный вызов ничего не пишет');

-- ======================================================= журнал только добавляется
select throws_ok($$ update public.user_consents set granted = false
  where user_id = '00000000-0000-4000-8000-000000000c11' $$, '55000', null, 'записи согласий нельзя изменять');
select throws_ok($$ delete from public.user_consents
  where user_id = '00000000-0000-4000-8000-000000000c11' $$, '55000', null, 'записи согласий нельзя удалять');

-- ======================================================= права
select ok(not has_function_privilege('anon', 'public.record_consents(text)', 'execute'),
  'гость не записывает согласия');
select is((select count(*) from pg_proc where proname = 'set_publication_consent'), 0::bigint,
  'функции согласия на публикацию больше нет (ADR-076)');
select ok(not has_function_privilege('anon', 'public.my_consents()', 'execute'), 'гость не читает согласия');
select ok(has_function_privilege('authenticated', 'public.record_consents(text)', 'execute')
  and has_function_privilege('authenticated', 'public.my_consents()', 'execute'),
  'вошедший пользователь вызывает функции согласий');
select ok(not has_function_privilege('authenticated', 'public.consent_append(uuid, public.consent_kind, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.consent_append(uuid, public.consent_kind, text, boolean)', 'execute'),
  'внутренний помощник записи недоступен клиентам');
select ok(not has_table_privilege('authenticated', 'public.user_consents', 'insert')
  and not has_table_privilege('authenticated', 'public.user_consents', 'update')
  and not has_table_privilege('authenticated', 'public.user_consents', 'delete')
  and not has_table_privilege('anon', 'public.user_consents', 'select'),
  'клиенты не пишут в журнал согласий напрямую, гость его не читает');

-- ======================================================= удаление аккаунта = отзыв согласий
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000c11');
  perform public.delete_my_account();
  perform public.delete_my_account();
end $$;
reset role;
select is((select array_agg(l.kind::text || ':' || l.granted::text order by l.kind::text)
           from (select distinct on (c.kind) c.kind, c.granted from public.user_consents c
                 where c.user_id = '00000000-0000-4000-8000-000000000c11'
                 order by c.kind, c.created_at desc, c.id desc) l),
  array['PD_PROCESSING:false', 'TERMS_AND_AGE:false'],
  'удаление аккаунта фиксирует отзыв всех действующих согласий');
select is((select count(*) from public.user_consents where user_id = '00000000-0000-4000-8000-000000000c11'),
  6::bigint, 'повторное удаление не добавляет записей (4 + 2 отзыва)');

-- ======================================================= старые записи о публикации (до ADR-076)
insert into public.user_consents (user_id, kind, doc_version, granted)
values ('00000000-0000-4000-8000-000000000c12', 'PUBLICATION', '2026-11-05', true);
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000c12'); end $$;
select is((select count(*) from public.my_consents()), 0::bigint,
  'старая запись о публикации остается в журнале, но my_consents ее не отдает');
reset role;

select * from finish();
rollback;
