import * as React from "react";

import { Button, Heading, Text } from "@react-email/components";
import { EmailShell, emailStyles } from "./email-shell";

interface MagicLinkEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <EmailShell preview={`Your secure sign-in link for ${siteName}`} siteName={siteName}>
    <Heading style={emailStyles.heading}>Sign in securely</Heading>
    <Text style={emailStyles.text}>
      Use this one-time link to sign in to {siteName}. For your security, the link expires shortly.
    </Text>
    <Button style={emailStyles.button} href={confirmationUrl}>
      Sign in to Apis Financial
    </Button>
    <Text style={emailStyles.note}>
      If you didn't request this link, you can safely ignore this email.
    </Text>
  </EmailShell>
);

export default MagicLinkEmail;
