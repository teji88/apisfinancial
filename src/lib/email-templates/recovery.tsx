import * as React from 'react'

import {
  Button,
  Heading,
  Text,
} from '@react-email/components'
import { EmailShell, emailStyles } from './email-shell'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <EmailShell preview={`Reset your password for ${siteName}`} siteName={siteName}>
        <Heading style={emailStyles.heading}>Reset your password</Heading>
        <Text style={emailStyles.text}>
          We received a request to reset your password for {siteName}. Click
          the button below to choose a new password.
        </Text>
        <Button style={emailStyles.button} href={confirmationUrl}>
          Choose a new password
        </Button>
        <Text style={emailStyles.note}>
          If you didn't request a password reset, you can safely ignore this
          email. Your password will not be changed.
        </Text>
  </EmailShell>
)

export default RecoveryEmail

