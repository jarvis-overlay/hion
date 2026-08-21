import { createClient } from '@/lib/supabase/server';
import SidebarNav from './SidebarNav';

export default async function Navbar() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <SidebarNav userEmail={user?.email || ''} />;
}
