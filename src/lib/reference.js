import { supabase } from './supabase'

// Reference data used across modules: categories, designations, installations.

export async function listCategories() {
  return supabase.from('categories').select('id,name').order('name')
}

export async function listDesignations() {
  // Include the category name so dropdowns can group/label by skill bucket.
  return supabase
    .from('designations')
    .select('id,name,category:categories(id,name)')
    .order('name')
}

export async function listInstallations({ activeOnly = false } = {}) {
  let q = supabase.from('installations').select('id,name,type,is_active').order('name')
  if (activeOnly) q = q.eq('is_active', true)
  return q
}
