const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendResetEmail(to, resetLink) {
  await transporter.sendMail({
    from: '"TSS Dashboard" <no-reply@yourdomain.com>',
    to,
    subject: "Password Reset Instructions",
    html: `
      <p>Hello,</p>
      <p>You requested a password reset. Click the link below to reset your password:</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
      <p>This link expires in 15 minutes.</p>
    `,
  });
}

module.exports = { sendResetEmail };
