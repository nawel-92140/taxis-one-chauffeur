-- TAXIS ONE : géolocalisation du chauffeur
alter table public.chauffeurs
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists precision_gps double precision,
  add column if not exists derniere_position_at timestamptz;

-- Prototype actuel : autorise l'application chauffeur à mettre à jour sa fiche.
-- À remplacer par une authentification chauffeur avant mise en production.
drop policy if exists "test_update_chauffeurs" on public.chauffeurs;
create policy "test_update_chauffeurs"
on public.chauffeurs
for update
to anon, authenticated
using (true)
with check (true);
