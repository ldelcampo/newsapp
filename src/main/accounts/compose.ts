import { createTransport } from 'nodemailer'
import type { Account, OutgoingMail } from '../../shared/accounts'

/** The message as nodemailer takes it, with reply headers so it lands in the same conversation. */
export function mailOptions(account: Account, mail: OutgoingMail): Parameters<ReturnType<typeof createTransport>['sendMail']>[0] {
  return {
    from: account.name ? { name: account.name, address: account.email } : account.email,
    to: mail.to,
    ...(mail.cc ? { cc: mail.cc } : {}),
    subject: mail.subject,
    text: mail.text,
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: [mail.references, mail.inReplyTo].filter(Boolean).join(' ') } : {})
  }
}

/** Builds the raw RFC 822 message without sending it. */
export async function rawMessage(account: Account, mail: OutgoingMail): Promise<Buffer> {
  const info = await createTransport({ streamTransport: true, buffer: true }).sendMail(mailOptions(account, mail))
  return info.message as Buffer
}
