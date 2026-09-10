import { LoginForm } from '@/features/auth/ui/LoginForm'
export const dynamic = 'force-dynamic'
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string }> }) {
  const params = await searchParams
  return <main className="login-page"><section className="login-copy"><div className="rail-brand"><span>M</span><strong>MICA Money</strong></div><p className="eyebrow">CampusPay · Staff operations</p><h2>Ready for the<br />school day.</h2><p>Payments, orders and stock. One place to keep the student store running.</p><div className="login-footer">Authorized staff access</div></section><LoginForm destination={params.next} expired={params.expired === '1'} /></main>
}
