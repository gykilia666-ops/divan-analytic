-- Синхронизация матчей и лимитер поставщика (CLAUDE.md §10). Этап 4.
-- Свое имя поставщика (pgtap-fd), чтобы не пересекаться с данными реальной синхронизации.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ======================================================= лимитер
-- Каждый вызов — отдельный оператор: внутри одного запроса планировщик может вызвать
-- некоррелированную функцию один раз и переиспользовать результат.
select is((select allowed from public.provider_try_acquire('test-a', 3)), true, 'запрос 1 из 3 разрешен');
select is((select allowed from public.provider_try_acquire('test-a', 3)), true, 'запрос 2 из 3 разрешен');
select is((select allowed from public.provider_try_acquire('test-a', 3)), true, 'запрос 3 из 3 разрешен');
select is((select allowed from public.provider_try_acquire('test-a', 3)), false,
  'четвертый запрос в окне отклонен: не больше лимита');

select isnt(
  (select retry_at from public.provider_try_acquire('test-a', 3)),
  null,
  'при исчерпании бюджета возвращается время повтора'
);

select is((select allowed from public.provider_try_acquire('test-b', 3)), true,
  'у другого поставщика свой бюджет');

update public.provider_rate_limits set window_start = now() - interval '61 seconds'
  where provider = 'test-a';
select is((select allowed from public.provider_try_acquire('test-a', 3)), true,
  'после окна бюджет восстанавливается');
select is((select request_count from public.provider_rate_limits where provider = 'test-a'), 1,
  'счетчик начат заново');

select isnt(public.provider_report_rate_limited('test-a', 42), null, '429 фиксируется');
select is((select allowed from public.provider_try_acquire('test-a', 3)), false,
  'после 429 запросы запрещены до next_allowed_at');
select ok(
  (select next_allowed_at > now() + interval '30 seconds'
   from public.provider_rate_limits where provider = 'test-a'),
  'next_allowed_at учитывает Retry-After'
);
select ok(
  public.provider_report_rate_limited('test-a', 5)
    >= (select next_allowed_at from public.provider_rate_limits where provider = 'test-a'),
  'более короткий Retry-After не сокращает уже назначенную паузу'
);
select ok(
  (select next_allowed_at < now() + interval '3700 seconds'
   from (select public.provider_report_rate_limited('test-c', 999999) as next_allowed_at) x),
  'Retry-After ограничен часом'
);

select throws_ok($$ select * from public.provider_try_acquire('test-a', 0) $$, '22023', null,
  'нулевой лимит отклоняется');
select throws_ok($$ select * from public.provider_try_acquire('test-a', 3, 4) $$, '22023', null,
  'стоимость больше лимита отклоняется');

-- ======================================================= upsert
create function pg_temp.payload(
  p_status text, p_home int, p_away int, p_kind text, p_updated text, p_kickoff text default '2026-11-06T20:00:00Z'
) returns jsonb language sql as $f$
  select jsonb_build_object(
    'competitions', jsonb_build_array(jsonb_build_object('provider_id','2021','code','PL','name','Premier League')),
    'teams', jsonb_build_array(
      jsonb_build_object('provider_id','62','name','Everton FC','short_name','Everton'),
      jsonb_build_object('provider_id','1076','name','Coventry City FC','short_name',null)),
    'matches', jsonb_build_array(jsonb_build_object(
      'provider_id','560634','competition_provider_id','2021','home_provider_id','62','away_provider_id','1076',
      'kickoff_at',p_kickoff,'status',p_status,'home_score',p_home,'away_score',p_away,
      'result_kind',p_kind,'provider_updated_at',p_updated)))
$f$;

select is(
  public.sync_upsert_matches('pgtap-fd', pg_temp.payload('SCHEDULED', null, null, 'NONE', '2026-11-04T00:20:29Z')),
  '{"inserted": 1, "updated": 0}'::jsonb,
  'первый импорт вставляет матч'
);
select is(
  public.sync_upsert_matches('pgtap-fd', pg_temp.payload('SCHEDULED', null, null, 'NONE', '2026-11-04T00:20:29Z')),
  '{"inserted": 0, "updated": 1}'::jsonb,
  'повторный импорт обновляет, а не дублирует'
);
select is((select count(*) from public.matches where provider = 'pgtap-fd'), 1::bigint,
  'дубликатов нет');
select is((select count(*) from public.teams where provider = 'pgtap-fd'), 2::bigint,
  'команды не дублируются');
select is((select enabled from public.competitions where provider = 'pgtap-fd' and provider_id = '2021'), true,
  'новое соревнование включено');

select lives_ok($$
  select public.sync_upsert_matches('pgtap-fd',
    pg_temp.payload('FINISHED', 2, 1, 'REGULAR', '2026-11-06T22:00:00Z'))
$$, 'более свежие данные принимаются');
select is(
  (select array[status::text, regulation_home_score::text, regulation_away_score::text, result_kind::text]
   from public.matches where provider = 'pgtap-fd' and provider_id = '560634'),
  array['FINISHED', '2', '1', 'REGULAR'],
  'итог основного времени записан'
);

select lives_ok($$
  select public.sync_upsert_matches('pgtap-fd',
    pg_temp.payload('SCHEDULED', null, null, 'NONE', '2026-11-05T00:00:00Z'))
$$, 'устаревшее наблюдение не вызывает ошибку');
select is(
  (select status::text from public.matches where provider = 'pgtap-fd' and provider_id = '560634'),
  'FINISHED',
  'старый provider_updated_at не перезаписывает новое состояние'
);
select lives_ok($$
  select public.sync_upsert_matches('pgtap-fd',
    pg_temp.payload('SCHEDULED', null, null, 'NONE', null))
$$, 'наблюдение без времени обновления не вызывает ошибку');
select is(
  (select status::text from public.matches where provider = 'pgtap-fd' and provider_id = '560634'),
  'FINISHED',
  'неизвестное время обновления не считается новее известного'
);
select ok(
  (select last_seen_at is not null from public.matches where provider = 'pgtap-fd' and provider_id = '560634'),
  'last_seen_at обновляется при каждом наблюдении'
);

update public.competitions set enabled = false where provider = 'pgtap-fd' and provider_id = '2021';
select lives_ok($$
  select public.sync_upsert_matches('pgtap-fd',
    pg_temp.payload('FINISHED', 2, 1, 'REGULAR', '2026-11-06T22:00:00Z'))
$$, 'повторный импорт после отключения соревнования');
select is((select enabled from public.competitions where provider = 'pgtap-fd' and provider_id = '2021'), false,
  'импорт не включает обратно отключенное соревнование');

select is(
  public.sync_upsert_matches('pgtap-fd', jsonb_build_object(
    'competitions', jsonb_build_array(jsonb_build_object('provider_id','2021','code','PL','name','Premier League')),
    'teams', jsonb_build_array(
      jsonb_build_object('provider_id','62','name','Everton FC','short_name',null),
      jsonb_build_object('provider_id','62','name','Everton FC','short_name',null),
      jsonb_build_object('provider_id','1076','name','Coventry City FC','short_name',null)),
    'matches', jsonb_build_array(
      jsonb_build_object('provider_id','777','competition_provider_id','2021','home_provider_id','62',
        'away_provider_id','1076','kickoff_at','2026-11-08T15:00:00Z','status','SCHEDULED',
        'home_score',null,'away_score',null,'result_kind','NONE','provider_updated_at','2026-11-04T00:00:00Z'),
      jsonb_build_object('provider_id','777','competition_provider_id','2021','home_provider_id','62',
        'away_provider_id','1076','kickoff_at','2026-11-08T15:00:00Z','status','POSTPONED',
        'home_score',null,'away_score',null,'result_kind','NONE','provider_updated_at','2026-11-04T01:00:00Z')))),
  '{"inserted": 1, "updated": 0}'::jsonb,
  'дубликаты внутри одного payload схлопываются'
);
select is((select status::text from public.matches where provider = 'pgtap-fd' and provider_id = '777'), 'POSTPONED',
  'из дубликатов берется самое свежее наблюдение');

select is(
  public.sync_upsert_matches('pgtap-fd', '{}'::jsonb),
  '{"inserted": 0, "updated": 0}'::jsonb,
  'пустой payload безопасен'
);

select throws_ok($$
  select public.sync_upsert_matches('pgtap-fd', jsonb_build_object('matches', jsonb_build_array(
    jsonb_build_object('provider_id','888','competition_provider_id','nope','home_provider_id','62',
      'away_provider_id','1076','kickoff_at','2026-11-08T15:00:00Z','status','SCHEDULED',
      'home_score',null,'away_score',null,'result_kind','NONE','provider_updated_at',null))))
$$, '22023', null, 'матч со ссылкой на неизвестное соревнование отклоняется целиком');
select is((select count(*) from public.matches where provider = 'pgtap-fd' and provider_id = '888'), 0::bigint,
  'частичной записи нет');

select throws_ok($$
  select public.sync_upsert_matches('pgtap-fd',
    pg_temp.payload('FINISHED', 1, null, 'REGULAR', '2026-11-07T00:00:00Z'))
$$, '23514', null, 'половина счета отклоняется ограничением БД');

select throws_ok($$
  select public.sync_upsert_matches('pgtap-fd',
    pg_temp.payload('WHATEVER', null, null, 'NONE', '2026-11-07T00:00:00Z'))
$$, '22P02', null, 'неизвестный статус отклоняется типом');

select throws_ok($$ select public.sync_upsert_matches('', '{}'::jsonb) $$, '22023', null,
  'пустой поставщик отклоняется');

-- ======================================================= права
set local role authenticated;
select throws_ok($$ select * from public.provider_try_acquire('x', 3) $$, '42501', null,
  'пользователь не вызывает лимитер');
select throws_ok($$ select public.sync_upsert_matches('x', '{}'::jsonb) $$, '42501', null,
  'пользователь не вызывает upsert');
select throws_ok($$ select * from public.provider_rate_limits $$, '42501', null,
  'пользователь не читает состояние лимитера');
reset role;

set local role anon;
select throws_ok($$ select public.provider_report_rate_limited('x', 1) $$, '42501', null,
  'гость не вызывает функции синхронизации');
select is((select count(*) from public.matches where provider = 'pgtap-fd'), 2::bigint,
  'гость по-прежнему читает публичные матчи');
reset role;

set local role service_role;
select lives_ok($$ select * from public.provider_try_acquire('svc', 3) $$,
  'service_role вызывает лимитер');
select lives_ok($$ select public.sync_upsert_matches('svc', '{}'::jsonb) $$,
  'service_role вызывает upsert');
reset role;

select * from finish();
rollback;
