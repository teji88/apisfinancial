import * as React from "react";

import { Button, Heading, Link, Text } from "@react-email/components";
import { EmailShell, emailStyles } from "./email-shell";

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <EmailShell
    preview={`You've been invited to join ${siteName}`}
    siteName={siteName}
    siteUrl={siteUrl}
  >
    <Heading style={emailStyles.heading}>Your invitation is ready</Heading>
    <Text style={emailStyles.text}>
      You've been invited to join{" "}
      <Link href={siteUrl} style={emailStyles.link}>
        <strong>{siteName}</strong>
      </Link>
      , a Canadian portfolio tracker and retirement planner.
    </Text>
    <Button style={emailStyles.button} href={confirmationUrl}>
      Accept invitation
    </Button>
    <Text style={emailStyles.note}>
      If you weren't expecting this invitation, you can safely ignore this email.
    </Text>
  </EmailShell>
);

export default InviteEmail;
