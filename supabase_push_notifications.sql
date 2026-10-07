-- TAXIS ONE : stockage du token Expo du chauffeur
alter table public.chauffeurs
add column if not exists expo_push_token text;

-- Pour le prototype actuel uniquement.
-- En production, remplacer les politiques publiques par une authentification chauffeur.
drop policy if exists "test_update_chauffeurs" on public.chauffeurs;
create policy "test_update_chauffeurs"
on public.chauffeurs
for update
to anon, authenticated
using (true)
with check (true);
