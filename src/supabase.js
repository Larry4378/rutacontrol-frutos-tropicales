import { createClient } from '@supabase/supabase-js';

// Las claves publicables pueden estar en el navegador: RLS protege los datos.
export const supabase = createClient(
  'https://idwyvmhfyfsklykxmcdm.supabase.co',
  'sb_publishable_nHpWa9PmlROOt9ExaX8kLw_r9cn06P9'
);
