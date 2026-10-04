import { LoginForm } from '@/features/auth/ui/LoginForm'
import { Icon } from '@/components/ui/Icon'
export const dynamic = 'force-dynamic'
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string }> }) {
  const params = await searchParams
  return <main className="login-page">
    <section className="login-copy">
      <div className="rail-brand"><span aria-hidden="true"><Icon name="card" size={26} /></span><div><strong>CampusPay</strong><small>MICA staff operations</small></div></div>
      <p className="eyebrow">Your campus, connected.</p>
      <h2>A good school day starts here.</h2>
      <p>From the first sale to the final count, keep your campus store running smoothly.</p>
      <ul className="login-work-areas">
        <li className="login-work-area"><Icon name="register" size={23} /><div><strong>Point of sale</strong><small>Build a sale and take payment.</small></div></li>
        <li className="login-work-area"><Icon name="box" size={23} /><div><strong>Orders & inventory</strong><small>Keep stock and student orders moving.</small></div></li>
        <li className="login-work-area"><Icon name="wallet" size={23} /><div><strong>MICA Money</strong><small>Manage student wallets and funding.</small></div></li>
      </ul>
      <div className="login-footer"><Icon name="shield" size={15} />Authorized staff access</div>
    </section>
    <LoginForm destination={params.next} expired={params.expired === '1'} />
  </main>
}
