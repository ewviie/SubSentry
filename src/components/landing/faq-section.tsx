"use client";

import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { fadeInUp, revealViewport, staggerContainer } from "@/lib/motion";
import { FAQS } from "./faq-data";

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
