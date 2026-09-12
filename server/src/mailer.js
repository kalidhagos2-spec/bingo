import nodemailer from 'nodemailer';

/**
 * Sends login codes. With SMTP_URL configured mail goes out through nodemailer; without
 * it the code is printed to the server log and (in dev mode) handed back to the client.
 */
export function createMailer({ smtpUrl, from, devAllowAnon }) {
  const transport = smtpUrl ? nodemailer.createTransport(smtpUrl) : null;
  return {
    live: Boolean(transport),
    /** Returns { sent, devCode } — devCode only when there is no SMTP and dev mode is on. */
    async sendLoginCode(email, code) {
      if (!transport) {
        console.log(`[mail] login code for ${email}: ${code} (set SMTP_URL to send real mail)`);
        return { sent: false, devCode: devAllowAnon ? code : undefined };
      }
      await transport.sendMail({
        from,
        to: email,
        subject: `${code} is your Telegram Bingo login code`,
        text: `Your login code is ${code}. It expires in 10 minutes.\n\nIf you did not request it, ignore this email.`,
      });
      return { sent: true };
    },
  };
}
