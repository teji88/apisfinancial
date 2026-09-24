import * as React from "react";

import { Button, Heading, Link, Text } from "@react-email/components";
import { EmailShell, emailStyles } from "./email-shell";

interface EmailChangeEmailProps {
  siteName: string;
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string;
  email: string;
  newEmail: string;
  confirmationUrl: string;
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <EmailShell preview={`Confirm your email change for ${siteName}`} siteName={siteName}>
    <Heading style={emailStyles.heading}>Confirm your new email</Heading>
    <Text style={emailStyles.text}>
      You requested to change your email address for {siteName} from{" "}
      <Link href={`mailto:${oldEmail}`} style={emailStyles.link}>
        {oldEmail}
      </Link>{" "}
      to{" "}
      <Link href={`mailto:${newEmail}`} style={emailStyles.link}>
        {newEmail}
      </Link>
      .
    </Text>
    <Button style={emailStyles.button} href={confirmationUrl}>
      Confirm email change
    </Button>
    <Text style={emailStyles.note}>
      If you didn't request this change, do not use this link and reset your password immediately.
    </Text>
  </EmailShell>
);

export default EmailChangeEmail;
