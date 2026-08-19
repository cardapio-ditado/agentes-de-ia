# Testes de migração

SQL que exercita as regras cravadas no banco. Não roda em produção nem é
aplicado pelo Supabase — esta pasta existe fora do fluxo de migração de
propósito (o Supabase aplica `supabase/migrations/*.sql`, não subpastas).

## Por que existem

As regras do módulo CMV vivem em trigger e função, não em código de
aplicação. Testá-las de fora do banco é testar outra coisa. Um teste que
sobe um Postgres limpo, aplica a migração e tenta violar cada regra é o
único que responde "a regra está mesmo valendo?".

## Como rodar

Com um Postgres 16 local (ele recusa rodar como root):

```bash
D=/tmp/pgcmv && rm -rf $D && mkdir -p $D && chown -R postgres $D
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 55432 -k $D' -l $D/log start"

# dependências mínimas que a migração referencia
psql -h $D -p 55432 -U postgres -c "create extension if not exists pgcrypto;
  create table venues (id uuid primary key default gen_random_uuid(), name text);
  create table items (id uuid primary key default gen_random_uuid(),
                      venue_id uuid references venues(id), name text, price numeric);"

psql -h $D -p 55432 -U postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20260820000000_cmv_estoque_fundacao.sql
psql -h $D -p 55432 -U postgres -f supabase/migrations/__testes/20260820000000_cmv_estoque_fundacao.test.sql
```

Toda linha de saída começa com `ok` ou `FALHA`. O arquivo usa
`ON_ERROR_STOP`, então uma regra violada derruba a execução.
