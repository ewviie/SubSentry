import { FREE_PLAN_SUBSCRIPTION_LIMIT, isBetaAllAccess } from "@/lib/billing/plan";

// Split out of faq-section.tsx (a "use client" component) because a Server
// Component importing a plain data export from a client-boundary module
// doesn't work the way it looks like it should: Turbopack's RSC loader turns
// every export of a "use client" file into a client reference, including
// this array, so page.tsx's server-side `FAQS.map(...)` blew up at runtime
// with "FAQS.map is not a function": it wasn't the real array anymore. This
// file has no "use client" directive, so both the client component that
// renders the accordion and the server component that builds FAQPage
// structured data from the same questions can import it safely.
export const FAQS = [
  {
    question: "Do I have to connect my bank account?",
    answer:
      "No. SubSentry doesn't link to your bank or card. You add subscriptions yourself, by typing them in plain English or filling in the details, so nothing about your accounts ever leaves your control.",
  },
  {
    question: "Is there a limit on how many subscriptions I can track?",
    answer: isBetaAllAccess()
      ? "No. SubSentry is free during the beta, with no subscription limit: everything is unlocked."
      : `The free plan tracks up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions. Past that, you can still edit or cancel existing ones. Adding a new one requires upgrading to Pro, or canceling one you're no longer tracking.`,
  },
  {
    question: "Is the AI quick-add required?",
    answer:
      "No, it's optional. Every subscription can be added by hand with a plain form. Quick-add just saves you the typing when you'd rather describe it in a sentence.",
  },
  {
    question: "Can I cancel anytime?",
    answer: isBetaAllAccess()
      ? "There's nothing to cancel. SubSentry is free during the beta, no card or contract involved. You can delete your account and all its data anytime from Settings."
      : "Yes. There's no contract. Open Settings → Plan & billing → Manage billing to cancel or update payment details directly through Stripe's billing portal, no phone call required.",
  },
  {
    question: "Is my data sold or shared?",
    answer:
      "No. SubSentry doesn't use advertising trackers, doesn't resell analytics data, and doesn't sell data to anyone, for any reason.",
  },
];
