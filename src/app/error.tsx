'use client'
import Link from 'next/link'
export default function ErrorPage({ reset }: { reset(): void }) {
  return <main className="workspace"><section className="panel error-page"><h1>We couldn’t load this page</h1><p>Your connection may be interrupted. Try again to continue.</p><button className="primary-action" onClick={reset}>Try again</button><Link className="secondary-action" href="/">Return home</Link></section></main>
}
