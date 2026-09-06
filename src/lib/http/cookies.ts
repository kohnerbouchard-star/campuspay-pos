import 'server-only'
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { getServerEnv } from '@/lib/env/server'

export const APP_SESSION_COOKIE = 'campuspay_session'
export const TERMINAL_COOKIE = 'campuspay_terminal'
export const CUSTOMER_SESSION_COOKIE = 'campuspay_customer_session'

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: getServerEnv().COOKIE_SECURE,
    path: '/',
  }
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function readAppCookies() {
  const store = await cookies()
  return {
    sessionToken: store.get(APP_SESSION_COOKIE)?.value ?? null,
    terminalToken: store.get(TERMINAL_COOKIE)?.value ?? null,
  }
}

export async function setAppSessionCookie(token: string) {
  const store = await cookies()
  store.set(APP_SESSION_COOKIE, token, { ...cookieBase(), maxAge: 60 * 60 * 8 })
}

export async function ensureTerminalCookie(): Promise<string> {
  const store = await cookies()
  const existing = store.get(TERMINAL_COOKIE)?.value
  if (existing) return existing
  const token = newOpaqueToken()
  store.set(TERMINAL_COOKIE, token, { ...cookieBase(), maxAge: 60 * 60 * 24 * 365 })
  return token
}

export async function clearAppCookies() {
  const store = await cookies()
  store.set(APP_SESSION_COOKIE, '', { ...cookieBase(), maxAge: 0 })
}

export async function readCustomerSessionCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get(CUSTOMER_SESSION_COOKIE)?.value ?? null
}

export async function setCustomerSessionCookie(token: string) {
  const store = await cookies()
  store.set(CUSTOMER_SESSION_COOKIE, token, { ...cookieBase(), maxAge: 60 * 60 * 8 })
}

export async function clearCustomerSessionCookie() {
  const store = await cookies()
  store.set(CUSTOMER_SESSION_COOKIE, '', { ...cookieBase(), maxAge: 0 })
}
