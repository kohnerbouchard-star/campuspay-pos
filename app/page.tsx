import { LoginForm } from '@/features/auth/ui/LoginForm'
export const dynamic='force-dynamic'
export default function Home(){return <main className="login-page"><section className="login-copy"><p className="eyebrow">Closed-loop school payments</p><h2>One application.<br/>Only the access required.</h2><p>Cashiers sell. Inventory administrators receive stock. Accountants manage wallet transactions. Super administrators authorize protected credential changes.</p></section><LoginForm/></main>}
