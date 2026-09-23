import * as React from "react";

import { Button, Heading, Link, Text } from "@react-email/components";
import { EmailShell, emailStyles } from "./email-shell";

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <EmailShell preview={`Confirm your email for ${siteName}`} siteName={siteName} siteUrl={siteUrl}>
    <Heading style={emailStyles.heading}>Confirm your email</Heading>
    <Text style={emailStyles.text}>
      Welcome to{" "}
      <Link href={siteUrl} style={emailStyles.link}>
        <strong>{siteName}</strong>
      </Link>
      . Confirm your email to start tracking your portfolio.
    </Text>
    <Text style={emailStyles.text}>
      This confirmation is for{" "}
      <Link href={`mailto:${recipient}`} style={emailStyles.link}>
        {recipient}
      </Link>
      .
    </Text>
    <Button style={emailStyles.button} href={confirmationUrl}>
      Confirm email
    </Button>
    <Text style={emailStyles.note}>
      If you didn't create an account, you can safely ignore this email.
    </Text>
  </EmailShell>
);

export default SignupEmail;
