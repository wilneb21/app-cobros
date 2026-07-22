-- Los días festivos ahora se calculan solos (calendario oficial de Colombia,
-- con Semana Santa y los que la Ley Emiliani corre al lunes) directamente en
-- la aplicación — ya no hace falta que nadie los agregue a mano, así que la
-- tabla que los guardaba ya no se usa.
drop table if exists public.dias_festivos;
