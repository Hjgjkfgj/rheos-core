// Module d'envoi d'email (Lot UI-1b).
//   - ConsoleEmailSender : mode DEV local — l'email s'affiche dans les logs, rien ne part.
//   - ScalewayEmailSender : PROD — Scaleway Transactional Email (clé API via env/Secret
//     Manager, JAMAIS en clair dans le code). Expéditeur no-reply@rheos-corp.fr.
// Sélection par getEmailSender() : Scaleway si TEM_SECRET_KEY+projet présents, sinon console.

export interface EmailMessage { to: string; toName?: string; subject: string; text: string; html?: string; }
export interface EmailSender { send(msg: EmailMessage): Promise<void>; }

const FROM_EMAIL = process.env.TEM_FROM ?? "no-reply@rheos-corp.fr";
const FROM_NAME = "Rhéos";

/** DEV : n'envoie rien, écrit l'email dans les logs (mode « console »). */
export class ConsoleEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    console.log(
      `\n===== 📧 EMAIL (mode console — NON envoyé) =====\n` +
      `De    : ${FROM_NAME} <${FROM_EMAIL}>\n` +
      `À     : ${msg.toName ? msg.toName + " " : ""}<${msg.to}>\n` +
      `Objet : ${msg.subject}\n` +
      `------------------------------------------------\n` +
      `${msg.text}\n` +
      `================================================\n`
    );
  }
}

/** PROD : Scaleway Transactional Email (POST .../regions/{region}/emails, X-Auth-Token). */
export class ScalewayEmailSender implements EmailSender {
  constructor(private secretKey: string, private projectId: string, private region = "fr-par") {}
  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch(`https://api.scaleway.com/transactional-email/v1alpha1/regions/${this.region}/emails`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Auth-Token": this.secretKey },
      body: JSON.stringify({
        from: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: msg.to, ...(msg.toName ? { name: msg.toName } : {}) }],
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
        project_id: this.projectId,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Envoi email échoué (${res.status}) : ${body.slice(0, 300)}`);
    }
  }
}

// Mode d'envoi effectif (diagnostic, sans exposer la clé) : "scaleway" si la clé TEM et le
// projet sont présents, sinon "console". Le Project ID DOIT être un UUID (≠ Access Key SCW…).
export function emailMode(): "scaleway" | "console" {
  const key = process.env.TEM_SECRET_KEY;
  const project = process.env.TEM_PROJECT_ID ?? process.env.SCW_DEFAULT_PROJECT_ID;
  return key && project ? "scaleway" : "console";
}

export function getEmailSender(): EmailSender {
  const key = process.env.TEM_SECRET_KEY;
  const project = process.env.TEM_PROJECT_ID ?? process.env.SCW_DEFAULT_PROJECT_ID;
  if (key && project) return new ScalewayEmailSender(key, project, process.env.TEM_REGION ?? "fr-par");
  return new ConsoleEmailSender();
}

// ---------------------------------------------------------------------------
// Templates FR au thème Rhéos. Chaque template renvoie { subject, text, html }.
// Le HTML reste sobre et autoportant (styles inline, compatibles clients mail).
// ---------------------------------------------------------------------------
const NAVY = "#11223b", TEAL = "#1f7a8c", INK = "#1c2530", MUTED = "#6b7785";

function wrap(title: string, bodyHtml: string): string {
  return `<div style="margin:0;padding:24px;background:#eef2f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e7ee">
    <div style="background:${NAVY};padding:20px 24px"><span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.5px">Rhéos</span>
      <span style="color:#8fb0cc;font-size:12px;display:block;margin-top:2px">Circul'RH 360</span></div>
    <div style="padding:24px">
      <h1 style="font-size:18px;color:${NAVY};margin:0 0 12px">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:14px 24px;border-top:1px solid #eef1f4;color:${MUTED};font-size:11px">
      Email automatique — merci de ne pas y répondre. Rhéos · Circul'RH 360
    </div>
  </div>
</div>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${TEAL};color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600;font-size:15px">${label}</a>`;
}

/** Volet 1 — email de demande de réinitialisation (lien à usage unique, 60 min). */
export function resetRequestEmail(link: string): { subject: string; text: string; html: string } {
  const subject = "Réinitialisation de votre mot de passe Rhéos";
  const text =
    `Vous avez demandé la réinitialisation de votre mot de passe Rhéos.\n\n` +
    `Ouvrez ce lien (valable 60 minutes, à usage unique) pour choisir un nouveau mot de passe :\n${link}\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.`;
  const html = wrap("Réinitialiser votre mot de passe", `
    <p style="margin:0 0 16px;font-size:14px">Vous avez demandé la réinitialisation de votre mot de passe Rhéos. Ce lien est valable <b>60 minutes</b> et à <b>usage unique</b>.</p>
    <p style="margin:0 0 20px">${button(link, "Choisir un nouveau mot de passe")}</p>
    <p style="margin:0;color:${MUTED};font-size:12.5px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.</p>`);
  return { subject, text, html };
}

/** Volet 1 — confirmation après changement réussi. */
export function resetDoneEmail(): { subject: string; text: string; html: string } {
  const subject = "Votre mot de passe Rhéos a été modifié";
  const text =
    `Votre mot de passe Rhéos vient d'être modifié, et toutes vos sessions ont été déconnectées.\n\n` +
    `Si vous n'êtes pas à l'origine de ce changement, contactez sans délai votre service RH.`;
  const html = wrap("Mot de passe modifié", `
    <p style="margin:0 0 16px;font-size:14px">Votre mot de passe Rhéos vient d'être modifié, et toutes vos sessions ont été déconnectées.</p>
    <p style="margin:0;color:#b00020;font-size:13px"><b>Si vous n'êtes pas à l'origine de ce changement</b>, contactez sans délai votre service RH.</p>`);
  return { subject, text, html };
}

/** Volet 2 — information au collaborateur qu'un tiers (RH) a réinitialisé son accès. */
export function resetByRhEmail(actorLabel: string, hasLink: boolean): { subject: string; text: string; html: string } {
  const subject = "Votre accès Rhéos a été réinitialisé";
  const how = hasLink
    ? `Vous allez recevoir (ou avez reçu) un email séparé contenant un lien pour choisir votre nouveau mot de passe.`
    : `Un mot de passe temporaire vous a été remis directement ; il vous sera demandé d'en choisir un nouveau à la première connexion.`;
  const text =
    `Votre accès Rhéos a été réinitialisé par ${actorLabel}.\n\n${how}\n\n` +
    `Si vous n'attendiez pas cette opération, contactez votre service RH.`;
  const html = wrap("Votre accès a été réinitialisé", `
    <p style="margin:0 0 12px;font-size:14px">Votre accès Rhéos a été réinitialisé par <b>${actorLabel}</b>.</p>
    <p style="margin:0 0 16px;font-size:14px">${how}</p>
    <p style="margin:0;color:${MUTED};font-size:12.5px">Si vous n'attendiez pas cette opération, contactez votre service RH.</p>`);
  return { subject, text, html };
}
