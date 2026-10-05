-- =====================================================================
-- MYA Pedregalejo - Area de equipo (control horario, turnos y pagos)
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- Es seguro volver a ejecutarlo: no borra datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

create table if not exists public.ajustes (
  id                    int primary key default 1 check (id = 1),
  tarifa_general        numeric(10,2) not null default 10.00 check (tarifa_general >= 0),
  lat_local             double precision default 36.720738,
  lng_local             double precision default -4.375247,
  radio_metros          int not null default 150 check (radio_metros > 0),
  exigir_ubicacion      boolean not null default true,
  bloquear_fuera_zona   boolean not null default false,
  margen_retraso_min    int not null default 5 check (margen_retraso_min >= 0),
  actualizado           timestamptz not null default now()
);
insert into public.ajustes (id) values (1) on conflict (id) do nothing;

create table if not exists public.perfiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  usuario      text not null unique,
  nombre       text not null,
  rol          text not null default 'trabajador' check (rol in ('admin', 'trabajador')),
  tarifa_hora  numeric(10,2) check (tarifa_hora >= 0),   -- null = se usa la tarifa general
  puesto       text,
  telefono     text,
  activo       boolean not null default true,
  creado       timestamptz not null default now()
);

create table if not exists public.fichajes (
  id                  bigint generated always as identity primary key,
  usuario_id          uuid not null references public.perfiles(id) on delete restrict,
  entrada             timestamptz not null default now(),
  salida              timestamptz,
  tarifa              numeric(10,2) not null check (tarifa >= 0),
  entrada_lat         double precision,
  entrada_lng         double precision,
  entrada_precision   double precision,
  entrada_distancia   double precision,
  entrada_dispositivo text,
  salida_lat          double precision,
  salida_lng          double precision,
  salida_precision    double precision,
  salida_distancia    double precision,
  salida_dispositivo  text,
  manual              boolean not null default false,
  nota                text,
  editado_por         uuid references public.perfiles(id) on delete set null,
  editado_en          timestamptz,
  creado              timestamptz not null default now(),
  constraint fichajes_salida_posterior check (salida is null or salida > entrada)
);
create unique index if not exists fichajes_un_abierto on public.fichajes (usuario_id) where salida is null;
create index if not exists fichajes_usuario_entrada on public.fichajes (usuario_id, entrada desc);
create index if not exists fichajes_entrada on public.fichajes (entrada desc);

-- Pagos, anticipos, bonificaciones (propinas, extras) y descuentos
create table if not exists public.movimientos (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles(id) on delete restrict,
  fecha       date not null default current_date,
  tipo        text not null default 'pago' check (tipo in ('pago', 'anticipo', 'bonificacion', 'descuento')),
  importe     numeric(10,2) not null check (importe > 0),
  concepto    text,
  creado_por  uuid references public.perfiles(id) on delete set null,
  creado      timestamptz not null default now()
);
create index if not exists movimientos_usuario_fecha on public.movimientos (usuario_id, fecha desc);

create table if not exists public.turnos (
  id           bigint generated always as identity primary key,
  usuario_id   uuid not null references public.perfiles(id) on delete cascade,
  fecha        date not null,
  hora_inicio  time not null,
  hora_fin     time not null,                -- si es menor que hora_inicio, termina al dia siguiente
  nota         text,
  creado       timestamptz not null default now(),
  constraint turnos_horas_distintas check (hora_inicio <> hora_fin)
);
create index if not exists turnos_fecha on public.turnos (fecha, usuario_id);

-- ---------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin' and activo
  );
$$;

create or replace function public.distancia_metros(lat1 double precision, lng1 double precision,
                                                   lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
as $$
  select case when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
  else 2 * 6371000 * asin(sqrt(
         power(sin(radians(lat2 - lat1) / 2), 2) +
         cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
  end;
$$;

-- Crea el perfil automaticamente cuando se da de alta un usuario en Auth.
-- Solo queda activo si lo ha creado el administrador (app_metadata solo se
-- puede fijar con la clave de servicio, nunca desde un registro publico).
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, usuario, nombre, activo)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'usuario', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    coalesce((new.raw_app_meta_data->>'creado_por_admin')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- ---------------------------------------------------------------------
-- Fichar (la hora la pone siempre el servidor, nunca el movil)
-- ---------------------------------------------------------------------

create or replace function public.fichar_entrada(p_lat double precision default null,
                                                 p_lng double precision default null,
                                                 p_precision double precision default null,
                                                 p_dispositivo text default null)
returns public.fichajes
language plpgsql security definer set search_path = public
as $$
declare
  v_perfil public.perfiles;
  v_aj     public.ajustes;
  v_dist   double precision;
  v_fila   public.fichajes;
begin
  select * into v_perfil from public.perfiles where id = auth.uid();
  if v_perfil.id is null or not v_perfil.activo then
    raise exception 'Usuario no autorizado' using errcode = '42501';
  end if;

  select * into v_aj from public.ajustes where id = 1;

  if v_aj.exigir_ubicacion and (p_lat is null or p_lng is null) then
    raise exception 'Es necesario compartir la ubicacion para fichar';
  end if;

  if exists (select 1 from public.fichajes where usuario_id = v_perfil.id and salida is null) then
    raise exception 'Ya tienes una entrada abierta. Ficha la salida primero';
  end if;

  v_dist := public.distancia_metros(p_lat, p_lng, v_aj.lat_local, v_aj.lng_local);

  if v_aj.bloquear_fuera_zona and v_dist is not null and v_dist > v_aj.radio_metros + coalesce(p_precision, 0) then
    raise exception 'Estas fuera del local (a % m). No se puede fichar desde aqui', round(v_dist);
  end if;

  insert into public.fichajes (usuario_id, entrada, tarifa,
                               entrada_lat, entrada_lng, entrada_precision, entrada_distancia, entrada_dispositivo)
  values (v_perfil.id, now(), coalesce(v_perfil.tarifa_hora, v_aj.tarifa_general),
          p_lat, p_lng, p_precision, v_dist, left(p_dispositivo, 300))
  returning * into v_fila;

  return v_fila;
end;
$$;

create or replace function public.fichar_salida(p_lat double precision default null,
                                                p_lng double precision default null,
                                                p_precision double precision default null,
                                                p_dispositivo text default null)
returns public.fichajes
language plpgsql security definer set search_path = public
as $$
declare
  v_perfil public.perfiles;
  v_aj     public.ajustes;
  v_dist   double precision;
  v_fila   public.fichajes;
begin
  select * into v_perfil from public.perfiles where id = auth.uid();
  if v_perfil.id is null or not v_perfil.activo then
    raise exception 'Usuario no autorizado' using errcode = '42501';
  end if;

  select * into v_aj from public.ajustes where id = 1;

  if v_aj.exigir_ubicacion and (p_lat is null or p_lng is null) then
    raise exception 'Es necesario compartir la ubicacion para fichar';
  end if;

  v_dist := public.distancia_metros(p_lat, p_lng, v_aj.lat_local, v_aj.lng_local);

  if v_aj.bloquear_fuera_zona and v_dist is not null and v_dist > v_aj.radio_metros + coalesce(p_precision, 0) then
    raise exception 'Estas fuera del local (a % m). No se puede fichar desde aqui', round(v_dist);
  end if;

  perform set_config('mya.fichaje_propio', '1', true);
  update public.fichajes
     set salida = now(),
         salida_lat = p_lat, salida_lng = p_lng, salida_precision = p_precision,
         salida_distancia = v_dist, salida_dispositivo = left(p_dispositivo, 300)
   where usuario_id = v_perfil.id and salida is null
  returning * into v_fila;

  if v_fila.id is null then
    raise exception 'No tienes ninguna entrada abierta';
  end if;

  return v_fila;
end;
$$;

-- Recalcula la tarifa de los fichajes de un trabajador desde una fecha
-- (util cuando se cambia el sueldo y se quiere aplicar con efecto retroactivo)
create or replace function public.aplicar_tarifa(p_usuario uuid, p_desde date)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_tarifa numeric(10,2);
  v_n      integer;
begin
  if not public.es_admin() then
    raise exception 'Solo el administrador puede hacer esto' using errcode = '42501';
  end if;

  select coalesce(p.tarifa_hora, a.tarifa_general) into v_tarifa
    from public.perfiles p cross join public.ajustes a
   where p.id = p_usuario and a.id = 1;

  update public.fichajes
     set tarifa = v_tarifa, editado_por = auth.uid(), editado_en = now()
   where usuario_id = p_usuario
     and entrada >= (p_desde::timestamp at time zone 'Europe/Madrid');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Marca la edicion manual de un fichaje por el administrador
create or replace function public.marcar_edicion_fichaje()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('mya.fichaje_propio', true), '') <> '1'
     and auth.uid() is not null and public.es_admin() then
    new.editado_por := auth.uid();
    new.editado_en  := now();
  end if;
  return new;
end;
$$;

drop trigger if exists fichajes_marcar_edicion on public.fichajes;
create trigger fichajes_marcar_edicion
  before update on public.fichajes
  for each row
  when (old.entrada is distinct from new.entrada
     or old.salida  is distinct from new.salida
     or old.tarifa  is distinct from new.tarifa)
  execute function public.marcar_edicion_fichaje();

-- ---------------------------------------------------------------------
-- Seguridad a nivel de fila (RLS)
-- Cada trabajador solo puede LEER sus propios datos.
-- Solo el administrador puede crear, modificar o borrar.
-- ---------------------------------------------------------------------

alter table public.ajustes     enable row level security;
alter table public.perfiles    enable row level security;
alter table public.fichajes    enable row level security;
alter table public.movimientos enable row level security;
alter table public.turnos      enable row level security;

drop policy if exists ajustes_leer on public.ajustes;
create policy ajustes_leer on public.ajustes
  for select to authenticated using (true);
drop policy if exists ajustes_admin on public.ajustes;
create policy ajustes_admin on public.ajustes
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists perfiles_leer on public.perfiles;
create policy perfiles_leer on public.perfiles
  for select to authenticated using (id = auth.uid() or public.es_admin());
drop policy if exists perfiles_admin on public.perfiles;
create policy perfiles_admin on public.perfiles
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists fichajes_leer on public.fichajes;
create policy fichajes_leer on public.fichajes
  for select to authenticated using (usuario_id = auth.uid() or public.es_admin());
drop policy if exists fichajes_admin_insertar on public.fichajes;
create policy fichajes_admin_insertar on public.fichajes
  for insert to authenticated with check (public.es_admin());
drop policy if exists fichajes_admin_modificar on public.fichajes;
create policy fichajes_admin_modificar on public.fichajes
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists fichajes_admin_borrar on public.fichajes;
create policy fichajes_admin_borrar on public.fichajes
  for delete to authenticated using (public.es_admin());

drop policy if exists movimientos_leer on public.movimientos;
create policy movimientos_leer on public.movimientos
  for select to authenticated using (usuario_id = auth.uid() or public.es_admin());
drop policy if exists movimientos_admin on public.movimientos;
create policy movimientos_admin on public.movimientos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists turnos_leer on public.turnos;
create policy turnos_leer on public.turnos
  for select to authenticated using (usuario_id = auth.uid() or public.es_admin());
drop policy if exists turnos_admin on public.turnos;
create policy turnos_admin on public.turnos
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Permisos de ejecucion
revoke all on function public.fichar_entrada(double precision, double precision, double precision, text) from public, anon;
revoke all on function public.fichar_salida(double precision, double precision, double precision, text)  from public, anon;
revoke all on function public.aplicar_tarifa(uuid, date) from public, anon;
grant execute on function public.fichar_entrada(double precision, double precision, double precision, text) to authenticated;
grant execute on function public.fichar_salida(double precision, double precision, double precision, text)  to authenticated;
grant execute on function public.aplicar_tarifa(uuid, date) to authenticated;
grant execute on function public.es_admin() to authenticated;

-- Nadie sin sesion puede leer nada
revoke all on public.ajustes, public.perfiles, public.fichajes, public.movimientos, public.turnos from anon;

-- ---------------------------------------------------------------------
-- Saldo pendiente por trabajador (lo que se le debe a dia de hoy)
-- Se ejecuta con los permisos de quien llama: cada trabajador solo
-- obtiene su propia fila y el administrador obtiene todas.
-- ---------------------------------------------------------------------

create or replace function public.saldos()
returns table (usuario_id uuid, horas numeric, devengado numeric, extras numeric, pagado numeric, saldo numeric)
language sql stable security invoker set search_path = public
as $$
  with f as (
    select usuario_id,
           sum(extract(epoch from (salida - entrada)) / 3600) as horas,
           sum(round(extract(epoch from (salida - entrada)) / 3600 * tarifa, 2)) as devengado
      from public.fichajes
     where salida is not null
     group by usuario_id
  ), m as (
    select usuario_id,
           sum(case tipo when 'bonificacion' then importe when 'descuento' then -importe else 0 end) as extras,
           sum(case when tipo in ('pago', 'anticipo') then importe else 0 end) as pagado
      from public.movimientos
     group by usuario_id
  )
  select p.id,
         round(coalesce(f.horas, 0), 2),
         coalesce(f.devengado, 0),
         coalesce(m.extras, 0),
         coalesce(m.pagado, 0),
         coalesce(f.devengado, 0) + coalesce(m.extras, 0) - coalesce(m.pagado, 0)
    from public.perfiles p
    left join f on f.usuario_id = p.id
    left join m on m.usuario_id = p.id;
$$;

revoke all on function public.saldos() from public, anon;
grant execute on function public.saldos() to authenticated;
