import { createClient } from '@supabase/supabase-js';

// Las claves publicables pueden estar en el navegador: RLS protege los datos.
export const SUPABASE_URL = 'https://idwyvmhfyfsklykxmcdm.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_nHpWa9PmlROOt9ExaX8kLw_r9cn06P9';

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
