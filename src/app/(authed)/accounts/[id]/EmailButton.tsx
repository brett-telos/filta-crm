"use client";

// Tap-to-email trigger. Renders the same outlined button as the previous
// mailto: link, but instead of handing off to the mail client it opens
// the SendAdHocEmailModal that flows through the CRM's Resend pipeline.

import { useState } from "react";
import SendAdHocEmailModal, {
  type ComposeContact,
  type ComposeTemplate,
} from "./SendAdHocEmailModal";

type Props = {
  accountId: string;
  companyName: string;
  contacts: ComposeContact[];
  templates: ComposeTemplate[];
};

export default function EmailButton({
  accountId,
  companyName,
  contacts,
  templates,
}: Props) {
  const [open, setOpen] = useState(false);

  if (contacts.length === 0) return null;
  const primaryFirstName =
    contacts.find((c) => c.isPrimary)?.firstName ??
    contacts[0].firstName ??
    "contact";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Compose an email to ${companyName}`}
        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border border-filta-blue bg-white px-4 py-2.5 text-sm font-semibold text-filta-blue hover:bg-filta-light-blue sm:flex-none"
      >
        <span aria-hidden>✉</span>
        <span>Email {primaryFirstName}</span>
      </button>
      <SendAdHocEmailModal
        accountId={accountId}
        companyName={companyName}
        contacts={contacts}
        templates={templates}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
