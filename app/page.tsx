import GuidedTriage from '@/components/GuidedTriage'
import SmartTriage from '@/components/SmartTriage'
import { BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_E164, SERVICES_FAQ_URL } from '@/lib/config'

export default function Home() {
  return (
    <main>
      <h1>Display &amp; Cell Pros: Get a diagnosis</h1>
      <p>
        Tell us what is wrong with your phone and we will tell you what kind of repair it likely needs. Prefer to talk? Call{' '}
        <a href={`tel:${BUSINESS_PHONE_E164}`}>{BUSINESS_PHONE_DISPLAY}</a>.
      </p>
      <SmartTriage />
      <GuidedTriage />
      <p className="muted">
        More about our services: <a href={SERVICES_FAQ_URL}>services FAQ</a>.
      </p>
    </main>
  )
}
