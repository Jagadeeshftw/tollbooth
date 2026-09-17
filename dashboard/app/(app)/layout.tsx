import { Shell } from '@/components/Shell';
import { requireTenant } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requireTenant();
  return <Shell login={tenant.githubLogin}>{children}</Shell>;
}
