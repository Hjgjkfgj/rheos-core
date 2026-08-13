// Rhéos — client S3 minimal (Lot 19, aucune dépendance). Signature AWS SigV4,
// style « path » (https://endpoint/bucket/key), compatible Scaleway Object Storage.
// Suffisant pour put/get/delete d'objets chiffrés (coffre-fort documentaire).
import { createHash, createHmac } from "crypto";

export interface S3Config { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }

const sha256hex = (d: Buffer | string) => createHash("sha256").update(d).digest("hex");
const hmac = (key: Buffer, data: string) => createHmac("sha256", key).update(data).digest();
// Encodage RFC 3986 « à la AWS » : tout sauf A-Za-z0-9 -_.~
const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

function sign(cfg: S3Config, method: string, key: string, body: Buffer) {
  const origin = new URL(cfg.endpoint).origin;
  const host = new URL(cfg.endpoint).host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = "/" + uriEncode(cfg.bucket) + "/" + key.split("/").map(uriEncode).join("/");
  const payloadHash = sha256hex(body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  let k = hmac(Buffer.from("AWS4" + cfg.secretKey), dateStamp);
  k = hmac(k, cfg.region); k = hmac(k, "s3"); k = hmac(k, "aws4_request");
  const signature = createHmac("sha256", k).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: origin + canonicalUri, headers: { host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, authorization } as Record<string, string> };
}

export async function s3Put(cfg: S3Config, key: string, body: Buffer, contentType = "application/octet-stream"): Promise<void> {
  const { url, headers } = sign(cfg, "PUT", key, body);
  const res = await fetch(url, { method: "PUT", headers: { ...headers, "content-type": contentType }, body: body as unknown as BodyInit });
  if (!res.ok) throw new Error(`S3 PUT ${res.status} : ${(await res.text()).slice(0, 200)}`);
}
export async function s3Get(cfg: S3Config, key: string): Promise<Buffer> {
  const { url, headers } = sign(cfg, "GET", key, Buffer.alloc(0));
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error(`S3 GET ${res.status} : ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}
export async function s3Delete(cfg: S3Config, key: string): Promise<void> {
  const { url, headers } = sign(cfg, "DELETE", key, Buffer.alloc(0));
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${res.status} : ${(await res.text()).slice(0, 200)}`);
}
