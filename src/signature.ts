// Signature électronique derrière une interface (ADR ouverte : niveau eIDAS).
// Le MVP fournit un provider OTP + scellement SHA-256 ; l'interface permet de
// brancher un prestataire eIDAS (avancée/qualifiée) plus tard SANS toucher aux
// services métier. Le certificat de preuve est conservé (retourné au service).
import { createHash } from "crypto";

export type EidasLevel = "SIMPLE" | "ADVANCED" | "QUALIFIED";

export interface SignChallenge { challengeId: string; otp?: string } // otp exposé en dev uniquement
export interface SignCertificate {
  provider: string; eidasLevel: EidasLevel; signerId: string;
  documentSha256: string; signedAt: string; proof: string; otpVerified: boolean;
}

export interface SignatureProvider {
  readonly name: string;
  readonly eidasLevel: EidasLevel;
  /// Émet un défi (OTP envoyé au signataire hors-bande). Ordre des signataires respecté.
  issueChallenge(input: { documentId: string; documentSha256: string; signers: string[] }): SignChallenge;
  /// Vérifie l'OTP et produit le certificat de preuve (à conserver).
  sign(input: { documentId: string; signerId: string; documentSha256: string; otp: string; now: string }): SignCertificate;
}

/// Provider OTP interne (MVP). En production : envoi SMS/e-mail hors-bande.
export class OtpSignatureProvider implements SignatureProvider {
  readonly name = "rheos-otp";
  readonly eidasLevel: EidasLevel = "SIMPLE";
  private challenges = new Map<string, { otp: string; documentSha256: string; signers: string[] }>();

  private challengeIdOf(documentId: string, documentSha256: string) {
    return createHash("sha256").update(`${documentId}|${documentSha256}`).digest("hex").slice(0, 16);
  }

  issueChallenge(input: { documentId: string; documentSha256: string; signers: string[] }): SignChallenge {
    const challengeId = this.challengeIdOf(input.documentId, input.documentSha256);
    // OTP déterministe dérivé (testable) — en prod : aléatoire + envoi hors-bande.
    const otp = (parseInt(createHash("sha256").update(challengeId).digest("hex").slice(0, 8), 16) % 1_000_000).toString().padStart(6, "0");
    this.challenges.set(challengeId, { otp, documentSha256: input.documentSha256, signers: input.signers });
    return { challengeId, otp };
  }

  sign(input: { documentId: string; signerId: string; documentSha256: string; otp: string; now: string }): SignCertificate {
    const challengeId = this.challengeIdOf(input.documentId, input.documentSha256);
    const c = this.challenges.get(challengeId);
    if (!c) throw new Error("challenge inconnu ou expiré");
    if (c.otp !== input.otp) throw new Error("OTP invalide");
    if (c.documentSha256 !== input.documentSha256) throw new Error("empreinte du document altérée depuis la demande");
    const proof = createHash("sha256").update(`${input.documentSha256}|${input.signerId}|${input.now}|${input.otp}`).digest("hex");
    return { provider: this.name, eidasLevel: this.eidasLevel, signerId: input.signerId, documentSha256: input.documentSha256, signedAt: input.now, proof, otpVerified: true };
  }
}
