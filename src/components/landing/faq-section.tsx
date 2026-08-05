"use client";

import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, isBetaAllAccess } from "@/lib/billing/plan";
import { fadeInUp, revealViewport, staggerContainer } from "@/lib/motion";

const FAQS = [
  {
    question: "Do I have to connect my bank account?",
    answer:
      "No. SubSentry doesn't link to your bank or card. You add subscriptions yourself, by typing them in plain English or filling in the details, so nothing about your accounts ever leaves your control.",
  },
  {
    question: "Is there a limit on how many subscriptions I can track?",
    answer: isBetaAllAccess()
      ? "No. SubSentry is free during the beta, with no subscription limit — everything is unlocked."
      : `The free plan tracks up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions. Past that, you can still edit or cancel existing ones. Adding a new one requires upgrading to Pro, or canceling one you're no longer tracking.`,
  },
  {
    question: "Is the AI quick-add required?",
    answer:
      "No, it's optional. Every subscription can be added by hand with a plain form. Quick-add just saves you the typing when you'd rather describe it in a sentence.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. There's no contract. Open Settings → Plan & billing → Manage billing to cancel or update payment details directly through Stripe's billing portal, no phone call required.",
  },
  {
    question: "Is my data sold or shared?",
    answer:
      "No. SubSentry doesn't use advertising trackers, doesn't resell analytics data, and doesn't sell data to anyone, for any reason.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
      <motion.div
        variants={staggerContainer(0.1)}
        initial="hidden"
        whileInView="visible"
        viewport={revealViewport}
      >
        <motion.div variants={fadeInUp} className="text-center">
          <h2 className="text-h2 font-semibold">Frequently asked questions</h2>
        </motion.div>

        <motion.div variants={fadeInUp} className="mt-10">
          <Accordion>
            {FAQS.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger className="text-base">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </motion.div>
    </section>
  );
}
