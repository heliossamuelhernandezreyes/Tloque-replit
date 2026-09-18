// CI-only provider transport double. Production code has no fixture switch.
if (process.env.CI !== 'true' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.TLOQUE_QA_STRIPE_URL || '')
  || new URL(process.env.DATABASE_URL).pathname !== '/tloque_payments') {
  throw new Error('Stripe transport fixture is restricted to the disposable payment gate');
}
const networkFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url || input.href);
  return networkFetch(url.origin === 'https://api.stripe.com'
    ? process.env.TLOQUE_QA_STRIPE_URL + url.pathname + url.search : input, init);
};
