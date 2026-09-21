import * as React from 'react'

import {
  Heading,
  Text,
} from '@react-email/components'
import { EmailShell, emailStyles } from './email-shell'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <EmailShell preview="Your Apis Financial verification code">
        <Heading style={emailStyles.heading}>Confirm it's you</Heading>
        <Text style={emailStyles.text}>Use this code to confirm your identity:</Text>
        <Text style={emailStyles.code}>{token}</Text>
        <Text style={emailStyles.note}>
          This code will expire shortly. If you didn't request this, you can
          safely ignore this email.
        </Text>
  </EmailShell>
)

export default ReauthenticationEmail

